'use strict';

const $ = selector => document.querySelector(selector);
const canvas = $('#canvas'), ctx = canvas.getContext('2d');
const video = $('#video'), wrap = $('#wrap'), box = $('#box');
let source = null, rotation = 0, drag = null, resizing = null, items = [];
let stream = null, starting = false, workerPromise = null, busy = false;
let session = 0, cropVersion = 0, loopTimer = null, pending = null;
let lastCandidate = '', candidateReads = 0, skippedCode = '', skipUntil = 0, lastConfirmedRead = '';

try {
  const saved = JSON.parse(localStorage.getItem('labelLensScans') || '[]');
  if (Array.isArray(saved)) items = saved.filter(x => x && typeof x.code === 'string' && typeof x.time === 'string');
} catch {}

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
  $('#copyAll').disabled = $('#clearAll').disabled = !items.length;
  $('#results').innerHTML = items.map((item, i) => `<article class="result-row"><span class="number">${i + 1}</span><div><div class="result-code">${escapeHtml(item.code)}</div><div class="result-time">${escapeHtml(item.time)}</div></div><button class="copy-one" data-i="${i}">Copy</button></article>`).join('');
}
function save() {
  try { localStorage.setItem('labelLensScans', JSON.stringify(items)); } catch {}
  renderList();
}
function normalizeCode(text) { return text.toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function extractCode(text, strict = false) {
  const clean = normalizeCode(text);
  const label = clean.match(/TAA\d{7,10}(?!\d)/)?.[0];
  if (label || strict) return label || '';
  const candidates = (text.toUpperCase().match(/[A-Z0-9][A-Z0-9 -]{5,}/g) || []).map(normalizeCode);
  return candidates.sort((a, b) => b.length - a.length)[0] || (clean.length >= 5 ? clean : '');
}
function alreadyAdded(code) { return items.some(item => normalizeCode(item.code) === code); }

function syncControls() {
  $('#liveButton').textContent = starting ? 'Cancel camera' : stream ? 'Stop camera' : 'Start live scan';
  $('#liveButton').disabled = busy && !stream && !starting;
  $('#scan').hidden = Boolean(stream || starting || pending);
  $('#scanHelp').hidden = Boolean(stream || starting || pending);
  $('#scan').disabled = !source || busy;
  $('#left').disabled = $('#right').disabled = !source || busy || Boolean(stream) || starting;
  $('#file').disabled = $('#upload').disabled = busy && !stream;
  $('#confirmation').hidden = !pending;
}
function validateConfirmation() {
  const code = normalizeCode($('#detectedCode').value);
  const duplicate = alreadyAdded(code);
  $('#addCode').disabled = code.length < 5 || duplicate;
  $('#confirmError').textContent = duplicate ? 'This code is already in your list.' : code.length < 5 ? 'Enter at least 5 letters or numbers.' : '';
  return code;
}
function showConfirmation(code, origin) {
  pending = {code, origin};
  $('#detectedCode').value = code;
  $('#last').style.display = 'none';
  validateConfirmation();
  syncControls();
  if (stream) liveStatus('Code detected. Check it and tap Add to list.');
  $('#confirmation').scrollIntoView({behavior: 'smooth', block: 'nearest'});
}
function clearConfirmation() {
  pending = null;
  lastCandidate = '';
  candidateReads = 0;
  syncControls();
}
$('#detectedCode').addEventListener('input', validateConfirmation);
$('#confirmForm').addEventListener('submit', event => {
  event.preventDefault();
  if (!pending) return;
  const code = validateConfirmation();
  if (code.length < 5 || alreadyAdded(code)) return;
  lastConfirmedRead = pending.code;
  items.push({code, time: new Intl.DateTimeFormat(undefined, {hour: 'numeric', minute: '2-digit'}).format(new Date())});
  save();
  clearConfirmation();
  $('#lastCode').textContent = code;
  $('#last').style.display = 'block';
  toast('Added to list');
  if (stream) { liveStatus('Added. Point at the next serial.'); scheduleLive(); }
});
$('#tryAgain').onclick = () => {
  if (!pending) return;
  skippedCode = pending.code;
  skipUntil = Date.now() + 3500;
  clearConfirmation();
  if (stream) { liveStatus('Hold the serial steady inside the box.'); scheduleLive(); }
};

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
};
$('#copyAll').onclick = () => copyText(items.map(item => item.code).join('\n'), `${items.length} code${items.length === 1 ? '' : 's'} copied`);
$('#clearAll').onclick = () => {
  if (!items.length || !confirm('Clear all scanned codes from this device?')) return;
  items = []; lastConfirmedRead = ''; save(); validateConfirmation(); $('#last').style.display = 'none'; toast('List cleared');
};

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
  if (!navigator.mediaDevices?.getUserMedia) {
    liveStatus('Live camera is unavailable here. Open this HTTPS link in Safari or Chrome, or upload a photo.'); return;
  }
  const ticket = ++session;
  starting = true; lastConfirmedRead = ''; clearConfirmation(); $('#last').style.display = 'none';
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
    starting = false; syncControls();
    requestAnimationFrame(() => { if (ticket === session) placeDefault(true); });
    stream.getTracks().forEach(track => track.addEventListener('ended', () => { if (ticket === session) stopCamera('Camera disconnected. Tap Start live scan to retry.'); }, {once: true}));
    liveStatus('Loading scanner…');
    await getWorker();
    if (ticket !== session) return;
    liveStatus('Hold the serial horizontally and steady inside the box.');
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
  const file = event.target.files[0]; if (!file) return;
  stopCamera('Photo mode. Adjust the box, then tap Scan text.', false);
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
    if (!window.Tesseract) throw new Error('OCR library unavailable');
    const worker = await Tesseract.createWorker('eng', 1, {logger: message => {
      const percent = Math.round((message.progress || 0) * 100);
      if (starting || (stream && !busy)) liveStatus(`Loading scanner… ${percent}%`);
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
  if (stream && !pending && !starting) loopTimer = setTimeout(scanLive, delay);
}
async function scanLive() {
  if (!stream || pending || starting) return;
  if (busy || drag || resizing || document.hidden) { scheduleLive(); return; }
  const ticket = session, cropTicket = cropVersion;
  busy = true;
  try {
    const image = cropFrame(), worker = await getWorker();
    const {data} = await worker.recognize(image);
    if (ticket !== session || cropTicket !== cropVersion || !stream || pending) return;
    const code = extractCode(data.text, true);
    if (!code || data.confidence < 45) { lastCandidate = ''; candidateReads = 0; liveStatus('Hold the serial horizontally and steady inside the box.'); return; }
    if (alreadyAdded(code) || code === lastConfirmedRead) { lastCandidate = ''; candidateReads = 0; liveStatus('Already confirmed. Point at the next serial.'); return; }
    if (code === skippedCode && Date.now() < skipUntil) return;
    candidateReads = code === lastCandidate ? candidateReads + 1 : 1; lastCandidate = code;
    if (candidateReads >= 2) showConfirmation(code, 'live');
    else liveStatus('Reading the serial… hold steady.');
  } catch {
    if (ticket === session && stream) stopCamera('Scanner could not read camera frames. Tap Start live scan to retry.');
  } finally {
    busy = false; syncControls(); if (ticket === session) scheduleLive();
  }
}
$('#scan').onclick = async () => {
  if (!source || stream || busy || pending) return;
  const ticket = session, cropTicket = cropVersion;
  busy = true; syncControls(); $('#progress').style.display = 'block'; $('#last').style.display = 'none';
  try {
    const image = cropFrame(), worker = await getWorker();
    const {data} = await worker.recognize(image);
    if (ticket !== session || cropTicket !== cropVersion) return;
    const code = extractCode(data.text);
    if (!code) toast('No clear text found — adjust the box');
    else showConfirmation(code, 'photo');
  } catch { toast('Scan failed — check your connection and try again'); }
  finally { busy = false; $('#progress').style.display = 'none'; syncControls(); }
};
document.addEventListener('visibilitychange', () => { if (document.hidden && (stream || starting)) stopCamera('Camera paused. Tap Start live scan when you return.'); });
window.addEventListener('pagehide', () => {
  stopCamera('Camera stopped.');
  workerPromise?.then(worker => worker.terminate()).catch(() => {}); workerPromise = null;
});
renderList(); syncControls();
