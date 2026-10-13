'use strict';

const $ = selector => document.querySelector(selector);
const canvas = $('#canvas'), ctx = canvas.getContext('2d');
const video = $('#video'), wrap = $('#wrap'), box = $('#box');
let source = null, rotation = 0, drag = null, resizing = null, items = [];
let stream = null, starting = false, workerPromise = null, busy = false;
let session = 0, cropVersion = 0, loopTimer = null, pending = null;
let lastCandidate = '', candidateReads = 0, skippedCode = '', skipUntil = 0, lastConfirmedRead = '';
const frozenCanvas = $('#freezeFrame');
let frozen = false, detected = [], previousReads = new Map(), confirmedReads = new Set();
let qrPass = 0;
let qrDiagnostics = {available:false,decoded:0,unsupported:0}, torchOn=false;

// Authenticated drafts never load device-wide localStorage history.

function toast(text) {
  $('#toast').textContent = text;
  $('#toast').classList.add('show');
  setTimeout(() => $('#toast').classList.remove('show'), 1600);
}
function liveStatus(text) {
  $('#liveState').textContent = text;
  $('#liveState').dataset.active = Boolean(stream).toString();
}
function escapeHtml(text) {
  return text.replace(/[&<>'"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[c]));
}
function renderList() {
  $('#count').textContent = items.length;
  $('#emptyList').style.display = items.length ? 'none' : 'block';
  $('#copyAll').disabled = $('#clearAll').disabled = !items.length || LabelLensAccount.saving();
  $('#results').innerHTML = items.map((item, i) => `<article class="result-row"><span class="number">${i + 1}</span><div><div class="result-code">${escapeHtml(item.code)}</div><div class="result-time">${escapeHtml(item.time)}${item.inferred ? ' · QR estimate' : ''}${item.edited ? ' · corrected' : ''}</div></div><div class="draft-row-actions"><button class="copy-one" data-i="${i}">Copy</button><button class="remove-one" data-remove="${i}" aria-label="Remove ${escapeHtml(item.code)}" ${LabelLensAccount.saving() ? 'disabled' : ''}>×</button></div></article>`).join('');
}
function save() {
  renderList();
  LabelLensAccount.draftChanged(items);
}
function normalizeCode(text) { return text.toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function extractCode(text, strict = false) {
  const clean = normalizeCode(text);
  const label = clean.match(/(?:TAA|TBA|THA)\d{7,10}(?!\d)/)?.[0];
  if (label || strict) return label || '';
  const candidates = (text.toUpperCase().match(/[A-Z0-9][A-Z0-9 -]{5,}/g) || []).map(normalizeCode);
  return candidates.sort((a, b) => b.length - a.length)[0] || (clean.length >= 5 ? clean : '');
}
function alreadyAdded(code) { return items.some(item => normalizeCode(item.code) === code); }

function syncControls() {
  const ready = LabelLensAccount.ready();
  $('#liveButton').textContent = starting ? 'Cancel camera' : stream ? 'Stop camera' : 'Start live scan';
  $('#liveButton').disabled = !ready && !stream && !starting || busy && !stream && !starting;
  $('#scan').hidden = Boolean(stream || starting || pending);
  $('#scanHelp').hidden = Boolean(stream || starting || pending);
  $('#scan').disabled = !ready || !source || busy;
  $('#left').disabled = $('#right').disabled = !source || busy || Boolean(stream) || starting;
  $('#file').disabled = $('#upload').disabled = !ready || busy && !stream;
  $('#confirmation').hidden = !pending;
  $('#box').hidden = Boolean(stream) || !$('#precisionMode').checked || frozen;
  $('#precisionLabel').hidden = !source || Boolean(stream) || starting;
  $('#captureText').hidden = !stream || frozen || starting;
  $('#captureText').disabled = busy;
  $('#liveGuide').hidden = !stream || frozen || starting;
  $('#cameraTools').hidden = !stream || frozen || starting || ($('#zoomLabel').hidden && $('#torch').hidden);
  $('#resumeScan').hidden = !stream || !frozen;
  $('#selectionHint').hidden = !stream || Boolean(pending);
  validateConfirmation(); renderList();
}
function validateConfirmation() {
  const code = normalizeCode($('#detectedCode').value);
  const duplicate = alreadyAdded(code);
  const valid = /^[A-Z]{3}\d{7,10}$/.test(code);
  $('#addCode').disabled = !LabelLensAccount.ready() || !valid || duplicate || items.length >= 500;
  $('#copyDetected').disabled = !code.length;
  $('#confirmError').textContent = duplicate ? 'This code is already in your draft.' : !valid ? 'Use 3 letters followed by 7–10 digits.' : items.length >= 500 ? 'Submit this draft before adding more serials.' : '';
  return code;
}
function showConfirmation(code, origin) {
  const reading = detected.find(item => item.code === code);
  pending = {code, origin, method:reading?.method || 'ocr', inferred:Boolean(reading?.inferred)};
  $('#readingNote').textContent = pending.inferred
    ? 'QR-derived estimate for the sample TAA8 series. Check the printed serial. This is not a SIRIM authenticity check.'
    : pending.method === 'qr' ? 'Read directly from QR data. Check before adding.' : 'Read from printed text. Check before adding.';
  $('#detectedCode').value = code;
  $('#last').style.display = 'none';
  validateConfirmation();
  syncControls();
  if (stream) liveStatus('Check the text, then copy it or add it to your list.');
  renderDetections();
  $('#confirmation').scrollIntoView({behavior: 'smooth', block: 'nearest'});
}
function clearConfirmation() {
  pending = null;
  lastCandidate = '';
  candidateReads = 0;
  syncControls();
  renderDetections();
}
$('#detectedCode').addEventListener('input', validateConfirmation);
$('#confirmForm').addEventListener('submit', event => {
  event.preventDefault();
  if (!pending) return;
  const code = validateConfirmation();
  if (!LabelLensAccount.ready() || !/^[A-Z]{3}\d{7,10}$/.test(code) || alreadyAdded(code) || items.length >= 500) return;
  lastConfirmedRead = pending.code;
  confirmedReads.add(pending.code);
  detected = detected.filter(reading => reading.code !== pending.code);
  items.push({code, originalCode:pending.code, method:pending.method, inferred:pending.inferred, edited:code !== pending.code, time: new Intl.DateTimeFormat(undefined, {hour: 'numeric', minute: '2-digit'}).format(new Date())});
  save();
  clearConfirmation();
  $('#lastCode').textContent = code;
  $('#last').style.display = 'block';
  toast('Added to list');
  if (stream) {
    if (detected.length) liveStatus('Added. Tap another serial, or continue scanning.');
    else resumeCamera();
  }
});
$('#tryAgain').onclick = () => {
  if (!pending) return;
  skippedCode = pending.code;
  skipUntil = Date.now() + 3500;
  clearConfirmation();
  if (stream) liveStatus('Tap another serial, or continue scanning.');
};
$('#copyDetected').onclick = () => { if (pending) copyText(normalizeCode($('#detectedCode').value), 'Text copied'); };
$('#precisionMode').onchange = () => { resetDetections(); clearConfirmation(); syncControls(); cropChanged(); };

async function copyText(text, message) {
  try { await navigator.clipboard.writeText(text); toast(message); }
  catch {
    const field = document.createElement('textarea');
    field.value = text;
    field.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0';
    document.body.append(field); field.select();
    const copied = document.execCommand('copy'); field.remove();
    toast(copied ? message : 'Select the code and hold to copy');
  }
}
$('#results').onclick = event => {
  const button = event.target.closest('[data-i]');
  if (button) copyText(items[Number(button.dataset.i)].code, 'Code copied');
  const remove = event.target.closest('[data-remove]');
  if (remove && !LabelLensAccount.saving()) { const [removed] = items.splice(Number(remove.dataset.remove), 1); confirmedReads.delete(removed.originalCode || removed.code); save(); validateConfirmation(); }
};
$('#copyAll').onclick = () => copyText(items.map(item => item.code).join('\n'), `${items.length} code${items.length === 1 ? '' : 's'} copied`);
$('#clearAll').onclick = () => {
  if (LabelLensAccount.saving() || !items.length || !confirm('Discard this unsubmitted draft? Saved history will not be deleted.')) return;
  items = []; lastConfirmedRead = ''; confirmedReads.clear(); save(); validateConfirmation(); $('#last').style.display = 'none'; toast('List cleared');
};

function resetDetections() {
  detected = []; previousReads.clear(); frozen = false;
  $('#textOverlay').replaceChildren(); $('#detectedChoices').replaceChildren(); $('#textTray').hidden = true;
  frozenCanvas.style.display = 'none';
}
function renderDetections() {
  $('#textOverlay').replaceChildren(); $('#detectedChoices').replaceChildren();
  const available = detected.filter(reading => !alreadyAdded(reading.code) && !confirmedReads.has(reading.code));
  $('#textTray').hidden = !available.length;
  for (const reading of available) {
    const choose = () => showConfirmation(reading.code, stream ? 'live' : 'photo');
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'serial-choice'; button.textContent = reading.code + (reading.method === 'qr' ? ' · QR' : '');
    button.setAttribute('aria-label', `Select serial ${reading.code}`); button.onclick = choose;
    $('#detectedChoices').append(button);
    if (reading.bounds) {
      const highlight = document.createElement('button');
      highlight.type = 'button'; highlight.className = 'text-highlight' + (pending?.code === reading.code ? ' selected' : '');
      highlight.setAttribute('aria-label', `Highlighted serial ${reading.code}`); highlight.title = reading.code;
      const {left, top, width, height} = reading.bounds;
      highlight.style.cssText = `left:${left * 100}%;top:${top * 100}%;width:${width * 100}%;height:${height * 100}%;`;
      highlight.onclick = choose; $('#textOverlay').append(highlight);
    }
  }
}
function findSerials(data, frame, cropped = false) {
  const found = new Map();
  const collect = unit => {
    if (unit.confidence < 45 || !unit.bbox) return;
    const codes = normalizeCode(unit.text || '').match(/(?:TAA|TBA|THA)\d{7,10}(?!\d)/g) || [];
    for (const code of codes) {
      if (found.has(code)) continue;
      const {x0, y0, x1, y1} = unit.bbox;
      const left = Math.max(0, (x0 - 4) / frame.width), top = Math.max(0, (y0 - 4) / frame.height);
      found.set(code, {code, method:'ocr', inferred:false, bounds: cropped ? null : {left, top, width: Math.min(1 - left, (x1 - x0 + 8) / frame.width), height: Math.min(1 - top, (y1 - y0 + 8) / frame.height)}});
    }
  };
  // Prefer word boxes; lines recover serials whose prefix and digits were separated.
  (data.words || []).forEach(collect); (data.lines || []).forEach(collect);
  return [...found.values()];
}
function wholeFrame() {
  const input = stream ? video : canvas;
  const width = stream ? video.videoWidth : canvas.width, height = stream ? video.videoHeight : canvas.height;
  if (!width || !height) throw new Error('No camera frame');
  const scale = Math.min(1.5, 1920 / Math.max(width, height));
  const display = document.createElement('canvas'); display.width = Math.round(width * scale); display.height = Math.round(height * scale);
  display.getContext('2d').drawImage(input, 0, 0, display.width, display.height);
  const image = document.createElement('canvas'); image.width = display.width; image.height = display.height;
  const context = image.getContext('2d'); context.filter = 'grayscale(1) contrast(1.5)'; context.drawImage(display, 0, 0);
  return {image, display};
}
function centreCameraFrame() {
  // Read native camera pixels before whole-frame downsampling. The guide matches this crop.
  const width=video.videoWidth,height=video.videoHeight;
  const x=Math.round(width*.2),y=Math.round(height*.2),w=Math.round(width*.6),h=Math.round(height*.6);
  const frame=document.createElement('canvas'),scale=Math.min(2,1600/Math.max(w,h));
  frame.width=Math.max(1,Math.round(w*scale));frame.height=Math.max(1,Math.round(h*scale));
  frame.getContext('2d').drawImage(video,x,y,w,h,0,0,frame.width,frame.height);
  return {frame,bounds:{left:x/width,top:y/height,width:w/width,height:h/height}};
}
async function configureCamera() {
  const track=stream?.getVideoTracks()[0],ticket=session;
  $('#zoomLabel').hidden=true;$('#torch').hidden=true;torchOn=false;
  let caps={},settings={};
  try {caps=track?.getCapabilities?.() || {};settings=track?.getSettings?.() || {};} catch {}
  if(caps.focusMode?.includes('continuous')) {
    try {await track.applyConstraints({advanced:[{focusMode:'continuous'}]});} catch {}
  }
  if(ticket!==session || !stream) return;
  if(caps.zoom && caps.zoom.max>caps.zoom.min) {
    const slider=$('#cameraZoom');slider.min=caps.zoom.min;slider.max=Math.max(caps.zoom.min,Math.min(caps.zoom.max,4));slider.step=caps.zoom.step || .1;
    slider.value=Math.min(Number(slider.max),Math.max(caps.zoom.min,settings.zoom || caps.zoom.min));
    $('#zoomValue').textContent=Number(slider.value).toFixed(1)+'×';$('#zoomLabel').hidden=false;
  }
  $('#torch').hidden=!caps.torch;$('#torch').textContent='Light off';$('#torch').setAttribute('aria-pressed','false');
}
$('#cameraZoom').onchange=async()=>{
  const track=stream?.getVideoTracks()[0],ticket=session;if(!track) return;
  try {await track.applyConstraints({advanced:[{zoom:Number($('#cameraZoom').value)}]});
    if(ticket===session) {$('#zoomValue').textContent=Number($('#cameraZoom').value).toFixed(1)+'×';previousReads.clear();}}
  catch {toast('This camera could not change zoom');}
};
$('#torch').onclick=async()=>{
  const track=stream?.getVideoTracks()[0],ticket=session;if(!track) return;
  try {await track.applyConstraints({advanced:[{torch:!torchOn}]});if(ticket!==session) return;
    torchOn=!torchOn;$('#torch').textContent=torchOn?'Light on':'Light off';$('#torch').setAttribute('aria-pressed',String(torchOn));}
  catch {toast('Camera light is unavailable');}
};
function freezeCamera(frame, readings) {
  frozen = true; detected = readings;
  clearTimeout(loopTimer); video.pause(); video.style.display = 'none'; canvas.style.display = 'none';
  frozenCanvas.width = frame.width; frozenCanvas.height = frame.height;
  frozenCanvas.getContext('2d').drawImage(frame, 0, 0); frozenCanvas.style.display = 'block';
  liveStatus(readings.length ? readings.some(reading=>reading.method === 'qr') ? 'QR found. Tap a serial and check it against the label.' : 'Text found. Tap a highlighted serial to select it.' : 'No clear serial found. Move closer and continue scanning.');
  renderDetections(); syncControls();
}
async function resumeCamera() {
  if (!stream) return;
  clearConfirmation(); resetDetections(); canvas.style.display = 'none'; video.style.display = 'block';
  $('#last').style.display = 'none';
  const ticket = session;
  try { await video.play(); }
  catch { if (ticket === session) stopCamera('Camera paused. Tap Start live scan to retry.'); return; }
  if (ticket !== session) return;
  liveStatus('Point at one QR code. Printed text is the fallback.'); syncControls(); scheduleLive(100);
}
$('#resumeScan').onclick = resumeCamera;
$('#captureText').onclick = () => scanLive(true);

function placeDefault(live = false) {
  const width = wrap.clientWidth, height = wrap.clientHeight;
  const cropHeight = Math.min(height * .25, Math.max(32, height * .12));
  box.style.left = width * .1 + 'px';
  box.style.top = (live ? (height - cropHeight) / 2 : height * .65) + 'px';
  box.style.width = width * .8 + 'px';
  box.style.height = cropHeight + 'px';
  cropChanged();
}
function renderPhoto() {
  resetDetections();
  video.style.display = 'none'; canvas.style.display = 'block';
  if (!source) { wrap.style.display = 'none'; $('#empty').style.display = 'grid'; return; }
  const turn = ((rotation % 360) + 360) % 360, swap = turn === 90 || turn === 270;
  // Cap large phone photos to avoid filling mobile memory during preprocessing.
  const factor = Math.min(1, 2560 / Math.max(source.width, source.height));
  const width = Math.round(source.width * factor), height = Math.round(source.height * factor);
  canvas.width = swap ? height : width; canvas.height = swap ? width : height;
  ctx.save(); ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(rotation * Math.PI / 180);
  ctx.drawImage(source, -width / 2, -height / 2, width, height); ctx.restore();
  wrap.style.display = 'block'; $('#empty').style.display = 'none';
  requestAnimationFrame(() => placeDefault(false));
}
function stopCamera(message = 'Camera stopped.', keepPending = true) {
  session++; cropVersion++; starting = false;
  clearTimeout(loopTimer); loopTimer = null;
  const previous = stream; stream = null;
  previous?.getTracks().forEach(track => track.stop());
  video.pause(); video.srcObject = null;
  if (!keepPending) clearConfirmation();
  renderPhoto(); liveStatus(message); syncControls();
}
async function startCamera() {
  if (!LabelLensAccount.ready()) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    liveStatus('Live camera is unavailable here. Open this HTTPS link in Safari or Chrome, or upload a photo.'); return;
  }
  const ticket = ++session;
  starting = true; lastConfirmedRead = ''; confirmedReads.clear(); resetDetections(); clearConfirmation(); $('#last').style.display = 'none';
  liveStatus('Allow camera access to start live scanning.'); syncControls();
  try {
    const nextStream = await navigator.mediaDevices.getUserMedia({audio: false, video: {facingMode: {ideal: 'environment'}, width: {ideal: 1920}, height: {ideal: 1080}}});
    if (ticket !== session) { nextStream.getTracks().forEach(track => track.stop()); return; }
    stream = nextStream;
    video.srcObject = stream;
    canvas.style.display = 'none'; video.style.display = 'block'; wrap.style.display = 'block'; $('#empty').style.display = 'none';
    await video.play();
    if (ticket !== session) return;
    if (!video.videoWidth) await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No camera frames')), 8000);
      video.addEventListener('loadedmetadata', () => { clearTimeout(timer); resolve(); }, {once: true});
    });
    if (ticket !== session) return;
    video.width = video.videoWidth; video.height = video.videoHeight;
    await configureCamera();
    if(ticket!==session) return;
    starting = false; syncControls();
    requestAnimationFrame(() => { if (ticket === session) placeDefault(true); });
    stream.getTracks().forEach(track => track.addEventListener('ended', () => { if (ticket === session) stopCamera('Camera disconnected. Tap Start live scan to retry.'); }, {once: true}));
    qrPass = 0;
    liveStatus('Point at one QR code. Printed text is the fallback.');
    scheduleLive(200);
  } catch (error) {
    if (ticket !== session) return;
    const message = error.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in your browser, or upload a photo.'
      : error.name === 'NotFoundError' ? 'No camera found. You can still upload a photo.'
      : error.name === 'NotReadableError' ? 'Camera is busy. Close other camera apps and try again.'
      : 'Could not start live scanning. Check your connection and camera, then try again.';
    stopCamera(message, false);
  }
}
$('#liveButton').onclick = () => { if (stream || starting) stopCamera(); else startCamera(); };
function loadPhoto(event) {
  if (!LabelLensAccount.ready()) { event.target.value = ''; return; }
  const file = event.target.files[0]; if (!file) return;
  stopCamera('Photo mode. Tap Scan labels to read QR codes first.', false);
  confirmedReads.clear();
  const ticket = session, image = new Image(), url = URL.createObjectURL(file);
  image.onload = () => {
    URL.revokeObjectURL(url); event.target.value = '';
    if (ticket !== session) return;
    source = image; rotation = 0; renderPhoto(); syncControls(); $('#last').style.display = 'none';
  };
  image.onerror = () => { URL.revokeObjectURL(url); toast('Choose a JPG or PNG image'); };
  image.src = url;
}
$('#file').onchange = $('#upload').onchange = loadPhoto;
$('#left').onclick = () => { clearConfirmation(); rotation -= 90; renderPhoto(); };
$('#right').onclick = () => { clearConfirmation(); rotation += 90; renderPhoto(); };

function cropChanged() { cropVersion++; lastCandidate = ''; candidateReads = 0; }
function point(event) { const bounds = wrap.getBoundingClientRect(); return {x: event.clientX - bounds.left, y: event.clientY - bounds.top}; }
function clampBox(left, top, width, height) {
  width = Math.min(wrap.clientWidth, Math.max(58, width)); height = Math.min(wrap.clientHeight, Math.max(18, height));
  box.style.width = width + 'px'; box.style.height = height + 'px';
  box.style.left = Math.max(0, Math.min(wrap.clientWidth - width, left)) + 'px';
  box.style.top = Math.max(0, Math.min(wrap.clientHeight - height, top)) + 'px';
}
box.addEventListener('pointerdown', event => {
  if (event.target.id === 'handle') return;
  drag = {...point(event), left: box.offsetLeft, top: box.offsetTop}; cropChanged(); box.setPointerCapture(event.pointerId);
});
box.addEventListener('pointermove', event => {
  if (!drag) return; const position = point(event);
  clampBox(drag.left + position.x - drag.x, drag.top + position.y - drag.y, box.offsetWidth, box.offsetHeight); cropChanged();
});
['pointerup', 'pointercancel'].forEach(name => box.addEventListener(name, () => { drag = null; }));
$('#handle').addEventListener('pointerdown', event => {
  event.stopPropagation(); resizing = {...point(event), width: box.offsetWidth, height: box.offsetHeight}; cropChanged(); event.target.setPointerCapture(event.pointerId);
});
$('#handle').addEventListener('pointermove', event => {
  if (!resizing) return; const position = point(event);
  clampBox(box.offsetLeft, box.offsetTop, Math.min(wrap.clientWidth - box.offsetLeft, resizing.width + position.x - resizing.x), Math.min(wrap.clientHeight - box.offsetTop, resizing.height + position.y - resizing.y)); cropChanged();
});
['pointerup', 'pointercancel'].forEach(name => $('#handle').addEventListener(name, () => { resizing = null; }));
box.addEventListener('keydown', event => {
  const directions = {ArrowLeft: [-4, 0], ArrowRight: [4, 0], ArrowUp: [0, -4], ArrowDown: [0, 4]};
  const direction = directions[event.key]; if (!direction) return; event.preventDefault();
  clampBox(box.offsetLeft + (event.shiftKey ? 0 : direction[0]), box.offsetTop + (event.shiftKey ? 0 : direction[1]), box.offsetWidth + (event.shiftKey ? direction[0] : 0), box.offsetHeight + (event.shiftKey ? direction[1] : 0)); cropChanged();
});
window.addEventListener('resize', () => {
  if (!wrap.clientWidth) return;
  clampBox(box.offsetLeft, box.offsetTop, box.offsetWidth, box.offsetHeight); cropChanged();
});

function cropFrame() {
  const live = Boolean(stream), input = live ? video : canvas;
  const width = live ? video.videoWidth : canvas.width, height = live ? video.videoHeight : canvas.height;
  if (!width || !height || !wrap.clientWidth || !wrap.clientHeight) throw new Error('No image');
  const x = box.offsetLeft / wrap.clientWidth * width, y = box.offsetTop / wrap.clientHeight * height;
  const cropWidth = Math.min(width - x, box.offsetWidth / wrap.clientWidth * width), cropHeight = Math.min(height - y, box.offsetHeight / wrap.clientHeight * height);
  const scale = Math.min(2, 1600 / Math.max(cropWidth, cropHeight));
  const result = document.createElement('canvas');
  result.width = Math.max(1, Math.round(cropWidth * scale)); result.height = Math.max(1, Math.round(cropHeight * scale));
  const context = result.getContext('2d'); context.filter = 'grayscale(1) contrast(1.7)';
  context.drawImage(input, x, y, cropWidth, cropHeight, 0, 0, result.width, result.height);
  return result;
}
function getWorker() {
  if (!workerPromise) workerPromise = (async () => {
    if (!window.Tesseract) await new Promise((resolve,reject)=>{
      const script=$('#ocrLibrary'),timer=setTimeout(()=>finish(new Error('OCR library unavailable')),15000);
      const finish=error=>{clearTimeout(timer);script?.removeEventListener('load',loaded);script?.removeEventListener('error',failed);error?reject(error):resolve();};
      const loaded=()=>finish(),failed=()=>finish(new Error('OCR library unavailable'));
      script?.addEventListener('load',loaded,{once:true});script?.addEventListener('error',failed,{once:true});
    });
    if (!window.Tesseract) throw new Error('OCR library unavailable');
    const worker = await Tesseract.createWorker('eng', 1, {logger: message => {
      const percent = Math.round((message.progress || 0) * 100);
      if (starting || stream) liveStatus(`Text fallback: ${message.status} ${percent}%`);
      if (busy && !stream) { $('#status').textContent = message.status; $('#pct').textContent = percent + '%'; $('#bar').style.width = percent + '%'; }
    }});
    try { await worker.setParameters({tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ', tessedit_pageseg_mode: '7', user_defined_dpi: '300'}); }
    catch (error) { await worker.terminate(); throw error; }
    return worker;
  })().catch(error => { workerPromise = null; throw error; });
  return workerPromise;
}
function scheduleLive(delay = 900) {
  clearTimeout(loopTimer);
  if (stream && !pending && !starting && !frozen) loopTimer = setTimeout(scanLive, delay);
}
async function readQR(frame, exhaustive, ticket) {
  qrDiagnostics={available:Boolean(window.LabelQR && typeof window.jsQR==='function'),decoded:0,unsupported:0};
  if (!qrDiagnostics.available) return [];
  const image = frame.getContext('2d', {willReadFrequently:true}).getImageData(0,0,frame.width,frame.height);
  return LabelQR.scanFrame(image,jsQR,{
    exhaustive, pass:qrPass++, cancelled:()=>ticket !== session,
    onDecode:({supported})=>{qrDiagnostics.decoded++;if(!supported) qrDiagnostics.unsupported++;},
    stopWhen:exhaustive ? undefined : reading=>!alreadyAdded(reading.code) && !confirmedReads.has(reading.code),
    progress:percent=>{
      if (ticket !== session || !exhaustive) return;
      $('#status').textContent = 'Reading QR codes'; $('#pct').textContent = percent + '%'; $('#bar').style.width = percent + '%';
    }
  });
}
async function scanLive(capture = false) {
  if (!LabelLensAccount.ready()) { if (stream) stopCamera('Complete the product and batch fields to continue.', false); return; }
  if (!stream || pending || starting || frozen) return;
  if (busy || drag || resizing || document.hidden) { scheduleLive(); return; }
  const ticket = session, cropTicket = cropVersion;
  busy = true;
  syncControls();
  try {
    const {image, display} = wholeFrame();
    const centre=centreCameraFrame();
    let rawReadings=await readQR(centre.frame,false,ticket);
    const centreDiagnostics={...qrDiagnostics};
    rawReadings=rawReadings.map(reading=>({...reading,bounds:{left:centre.bounds.left+reading.bounds.left*centre.bounds.width,top:centre.bounds.top+reading.bounds.top*centre.bounds.height,width:reading.bounds.width*centre.bounds.width,height:reading.bounds.height*centre.bounds.height}}));
    if(!rawReadings.some(reading=>!alreadyAdded(reading.code) && !confirmedReads.has(reading.code))) {
      const fullReadings=await readQR(display,Boolean(capture),ticket);
      rawReadings=[...new Map([...rawReadings,...fullReadings].map(reading=>[reading.code,reading])).values()];
      qrDiagnostics.decoded+=centreDiagnostics.decoded;qrDiagnostics.unsupported+=centreDiagnostics.unsupported;
    }
    const qrReadings = rawReadings.filter(reading=>!alreadyAdded(reading.code) && !confirmedReads.has(reading.code));
    if (ticket !== session || cropTicket !== cropVersion || !stream || pending) return;
    if (qrReadings.length) { freezeCamera(display,qrReadings); return; }
    if(rawReadings.length) {liveStatus('QR read — this serial is already in your list. Point at a different label.');return;}
    if(!qrDiagnostics.available) {liveStatus('QR decoder did not load. Refresh this page while online.');return;}
    // Give QR tiles a chance to cover the view before loading the larger OCR engine.
    if (!capture && qrPass % 3 !== 0 && typeof window.jsQR === 'function') {
      liveStatus(qrDiagnostics.unsupported ? 'QR read, but this format is not supported. Trying printed text next.' : 'Centre one QR in the yellow guide. Move closer, then hold still for focus.'); return;
    }
    liveStatus('No supported QR found. Trying printed-text OCR…');
    const worker = await getWorker();
    await worker.setParameters({tessedit_pageseg_mode: '11'});
    const {data} = await worker.recognize(image);
    if (ticket !== session || cropTicket !== cropVersion || !stream || pending) return;
    const readings = findSerials(data, image).filter(reading => !alreadyAdded(reading.code) && !confirmedReads.has(reading.code));
    const nextReads = new Map(readings.map(reading => [reading.code, (previousReads.get(reading.code) || 0) + 1]));
    const stable = readings.filter(reading => nextReads.get(reading.code) >= 2);
    previousReads = nextReads;
    if (capture || stable.length) freezeCamera(display, capture ? readings : stable);
    else liveStatus(readings.length ? 'Text detected… hold steady.' : qrDiagnostics.unsupported ? 'QR read, but its serial format is unsupported. Try a close photo of the printed text.' : 'QR is not readable yet. Keep one whole QR in the guide; avoid glare and wait for focus.');
  } catch {
    if (ticket === session && stream) liveStatus('Text fallback failed to load or read. QR scanning will keep trying; you can also take a close photo.');
  } finally {
    busy = false; syncControls(); if (ticket === session) scheduleLive();
  }
}
$('#scan').onclick = async () => {
  if (!source || stream || busy || pending) return;
  const ticket = session, cropTicket = cropVersion;
  busy = true; syncControls(); $('#progress').style.display = 'block'; $('#last').style.display = 'none';
  $('#status').textContent = 'Reading labels…'; $('#pct').textContent = '0%'; $('#bar').style.width = '0%';
  try {
    const cropped = $('#precisionMode').checked;
    const frame = cropped ? {image:cropFrame(),display:null} : wholeFrame();
    let qrReadings = [];
    if (!cropped) qrReadings = await readQR(frame.display,true,ticket);
    if (ticket !== session || cropTicket !== cropVersion) return;
    if (qrReadings.length) {
      detected = qrReadings.filter(reading=>!alreadyAdded(reading.code) && !confirmedReads.has(reading.code)); renderDetections();
      liveStatus(detected.length ? `${detected.length} QR-derived serial${detected.length === 1 ? '' : 's'} found. Check against the printed labels.` : 'All decoded QR serials are already in your list.');
      if (detected.length) $('#textTray').scrollIntoView({behavior:'smooth',block:'nearest'});
      else toast('All decoded QR serials are already in your list');
      return;
    }
    $('#status').textContent = 'No supported QR found. Trying printed text…';
    const image = frame.image, worker = await getWorker();
    await worker.setParameters({tessedit_pageseg_mode: cropped ? '7' : '11'});
    const {data} = await worker.recognize(image);
    if (ticket !== session || cropTicket !== cropVersion) return;
    const readings = findSerials(data, image, cropped);
    detected = readings.filter(reading => !alreadyAdded(reading.code) && !confirmedReads.has(reading.code)); renderDetections();
    if (readings.length && !detected.length) { toast('All detected serials are already in your list'); return; }
    if (detected.length) { liveStatus('Text found. Tap a serial to select it.'); $('#textTray').scrollIntoView({behavior:'smooth', block:'nearest'}); }
    else if (cropped) {
      const code = extractCode(data.text); if (code) showConfirmation(code, 'photo'); else toast('No clear text found — adjust the crop');
    } else toast('No clear serial found — rotate, move closer, or use precision crop');
  } catch { toast('Scan failed — check your connection and try again'); }
  finally { busy = false; $('#progress').style.display = 'none'; syncControls(); }
};
document.addEventListener('visibilitychange', () => { if (document.hidden && (stream || starting)) stopCamera('Camera paused. Tap Start live scan when you return.'); });
window.addEventListener('pagehide', () => {
  stopCamera('Camera stopped.');
  workerPromise?.then(worker => worker.terminate()).catch(() => {}); workerPromise = null;
});
$('#manualForm').onsubmit = event => {
  event.preventDefault(); if (!LabelLensAccount.ready()) return;
  const code = normalizeCode($('#manualSerial').value);
  if (!/^[A-Z]{3}\d{7,10}$/.test(code)) { toast('Use 3 letters followed by 7–10 digits'); return; }
  if (stream) stopCamera('Manual serial review.', false);
  showConfirmation(code, 'manual'); pending.method = 'manual'; pending.inferred = false;
  $('#readingNote').textContent = 'Manually entered. Check against the printed label before adding.';
  $('#manualSerial').value = '';
};
function clearDraft() { items = []; confirmedReads.clear(); lastConfirmedRead = ''; clearConfirmation(); $('#last').style.display = 'none'; save(); }
window.LabelLensScanner = {
  sync:syncControls, copy:copyText, pause:()=>stopCamera('Camera paused for submission.', false), clearDraft,
  reset:()=> { stopCamera('Sign in and choose a product to scan.', false); source = null; rotation = 0; canvas.width = canvas.height = frozenCanvas.width = frozenCanvas.height = 0; $('#manualSerial').value = ''; renderPhoto(); clearDraft(); }
};
renderList(); syncControls();

