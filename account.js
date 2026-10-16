(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const API_BASE = 'https://m9kw6gfq-8088.asse.devtunnels.ms';
  const TOKEN_KEY = 'label_lens_access_token';
  let accessToken = localStorage.getItem(TOKEN_KEY) || '';
  let user = null, csrf = '', products = [], draft = [], submitting = false, exporting = false;
  let retry = null, nextBefore = null, historyEpoch = 0, historyBusy = false, authEpoch = 0;
  const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function status(id, text, error = false) { el(id).textContent = text; el(id).dataset.error = String(error); }
  function scanner() { return window.LabelLensScanner; }
  function clearPrivate() {
    authEpoch++; historyEpoch++; user = null; csrf = ''; products = []; draft = []; retry = null;
    accessToken = ''; localStorage.removeItem(TOKEN_KEY);
    nextBefore = null; submitting = false; exporting = false; historyBusy = false;
    scanner()?.reset(); el('productForm').reset(); el('savedResults').replaceChildren();
    el('historyScope').value = 'mine'; el('historyQuery').value = '';
    el('productBrand').replaceChildren(new Option('Choose brand', ''));
    el('productModel').replaceChildren(new Option('Choose model', ''));
    el('productRating').replaceChildren(new Option('Choose rating', ''));
    el('productType').replaceChildren(new Option('Choose type', ''));
    el('productLitres').replaceChildren(new Option('Choose litres', ''));
    el('productDetails').textContent = ''; el('submissionSummary').textContent = ''; el('currentSpec').textContent = 'Current spec: Not selected';
    el('exportExcel').hidden = true; el('exportExcel').disabled = false;
    el('appContent').hidden = true; el('loginPanel').hidden = false;
    el('signedInAs').textContent = ''; el('password').value = '';
    status('submissionStatus', 'Drafts are held in memory. Submit before leaving or signing out.');
    sync();
  }
  async function api(path, body, timeoutMs = 12000) {
    const headers = accessToken ? {'Authorization':`Bearer ${accessToken}`} : {};
    if (body !== undefined) Object.assign(headers, {'Content-Type':'application/json', 'X-Label-Lens-CSRF':csrf, 'X-Label-Lens-Origin':location.origin});
    let response;
    try {
      response = await fetch(API_BASE + path, {
        method: body === undefined ? 'GET' : 'POST', credentials:'omit', cache:'no-store', headers,
        signal:AbortSignal.timeout(timeoutMs), ...(body === undefined ? {} : {body:JSON.stringify(body)})
      });
    } catch (error) {
      throw new Error(error?.name === 'TimeoutError' ? 'The scanner server took too long to respond. Check that the scanner PC and VS Code tunnel are running.' : 'Cannot reach the scanner server. Check that the scanner PC and VS Code tunnel are running.');
    }
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 && path !== '/api/auth/login') { clearPrivate(); status('loginStatus', 'Session ended. Please sign in again.', true); }
      throw Object.assign(new Error(typeof result?.detail === 'string' ? result.detail : 'Server unavailable. Your draft has not been submitted.'), {status:response.status});
    }
    if (!result) throw new Error('The scanner backend is not available at this address.');
    return result;
  }
  const unique = values => [...new Set(values)].sort((a, b) => a.localeCompare(b));
  const gradeLabel = value => value.replace(/^SAE\s*/i, '');
  const typeLabel = value => ({'FULLY SYNTHETIC':'Fully', 'SEMI SYNTHETIC':'Semi', 'MINERAL ENGINE OIL':'Mineral', 'MINERAL':'Mineral'}[value.toUpperCase()] || value);
  const resetSelect = (id, label) => el(id).replaceChildren(new Option(label, ''));
  const addOptions = (id, entries) => entries.forEach(([label, value]) => el(id).add(new Option(label, value)));
  function product() { return products.find(entry => entry.id === el('productType').value); }
  function ready() {
    return Boolean(user && user.role !== 'viewer' && !submitting && product() && el('productLitres').value && el('productForm').checkValidity());
  }
  function canScan() {
    return Boolean(user && user.role !== 'viewer' && !submitting);
  }
  function sync() {
    // A draft may be collected before its product details are known. Lock the
    // details only once they are complete, so every saved serial shares them.
    const locked = submitting || (draft.length > 0 && ready());
    const readOnly = locked || user?.role === 'viewer';
    ['productBrand','productLitres'].forEach(id => { el(id).disabled = readOnly; });
    ['dealerName','batchName'].forEach(id => { el(id).disabled = submitting || user?.role === 'viewer'; });
    el('productModel').disabled = readOnly || !el('productBrand').value;
    el('productRating').disabled = readOnly || !el('productModel').value;
    el('productType').disabled = readOnly || !el('productRating').value;
    el('submitBatch').disabled = submitting || !draft.length || !ready();
    el('newSubmission').disabled = submitting || !canScan();
    el('submitBatch').textContent = submitting ? 'Submitting…' : `Submit ${draft.length ? draft.length + ' serial' + (draft.length === 1 ? '' : 's') : 'serials'}`;
    el('manualAdd').disabled = !canScan(); el('manualSerial').disabled = !canScan();
    el('signOut').disabled = submitting;
    el('exportExcel').disabled = exporting || !user || user.role !== 'admin';
    const selected = product();
    el('productDetails').textContent = selected ? `${selected.model} | ${gradeLabel(selected.viscosity)} | ${typeLabel(selected.oil_type)}\nSpecification: ${selected.ratings}` : '';
    el('currentSpec').textContent = selected ? `Current spec: ${selected.brand} | ${selected.model} | ${gradeLabel(selected.viscosity)} | ${typeLabel(selected.oil_type)} | ${el('productLitres').value || 'Litres not selected'}` : 'Current spec: Not selected';
    el('submissionSummary').textContent = selected && draft.length && ready() ? `${selected.brand} · ${selected.model} | ${gradeLabel(selected.viscosity)} | ${typeLabel(selected.oil_type)} · ${el('productLitres').value} — Dealer: ${el('dealerName').value.trim()} — Batch: ${el('batchName').value.trim()}` : '';
    status('setupStatus', user?.role === 'viewer' ? 'Your shared account is read-only. You can view your history.' : locked ? 'Product is selected for this draft. Dealer and batch are optional.' : ready() ? 'Ready to submit. These details apply to every serial in this draft.' : draft.length ? `Scan complete for ${draft.length} serial${draft.length === 1 ? '' : 's'}. Select the product and litres before submitting.` : 'You can scan now. Select the product and litres before submitting.');
    scanner()?.sync();
  }
  function fillProducts(data) {
    products = data.products;
    for (const brand of [...new Set(products.map(entry => entry.brand))].sort()) el('productBrand').add(new Option(brand, brand));
    for (const litres of data.litres) el('productLitres').add(new Option(litres, litres));
    sync();
  }
  el('productBrand').onchange = () => {
    resetSelect('productModel', 'Choose model');
    resetSelect('productRating', 'Choose rating');
    resetSelect('productType', 'Choose type');
    addOptions('productModel', unique(products.filter(entry => entry.brand === el('productBrand').value).map(entry => entry.model)).map(value => [value, value]));
    sync();
  };
  el('productModel').onchange = () => {
    resetSelect('productRating', 'Choose rating');
    resetSelect('productType', 'Choose type');
    addOptions('productRating', unique(products.filter(entry => entry.brand === el('productBrand').value && entry.model === el('productModel').value).map(entry => entry.viscosity)).map(value => [gradeLabel(value), value]));
    sync();
  };
  el('productRating').onchange = () => {
    resetSelect('productType', 'Choose type');
    products.filter(entry => entry.brand === el('productBrand').value && entry.model === el('productModel').value && entry.viscosity === el('productRating').value).sort((a,b) => a.oil_type.localeCompare(b.oil_type)).forEach(entry => {
      el('productType').add(new Option(typeLabel(entry.oil_type), entry.id));
    });
    sync();
  };
  el('productForm').addEventListener('input', sync);
  el('productForm').addEventListener('change', sync);
  el('productForm').onsubmit = event => event.preventDefault();
  el('productForm').addEventListener('keydown', event => {
    if (event.key === 'Enter') event.preventDefault();
  });
  function draftChanged(items) { draft = items; sync(); }
  function startNewSubmission() {
    if (submitting || !canScan()) return;
    const hasCurrentWork = draft.length || [...el('productForm').elements].some(field => field.value);
    if (hasCurrentWork && !confirm('Clear the current unsubmitted serials and product details? Submitted history will not be deleted.')) return;
    scanner()?.reset();
    draft = [];
    el('productForm').reset();
    resetSelect('productModel', 'Choose model');
    resetSelect('productRating', 'Choose rating');
    resetSelect('productType', 'Choose type');
    el('productDetails').textContent = ''; el('submissionSummary').textContent = '';
    status('submissionStatus', 'New submission ready. Scan serials or choose the product details first.');
    sync();
  }
  el('newSubmission').onclick = startNewSubmission;
  async function enter(result) {
    const epoch = ++authEpoch;
    if (result.access_token) { accessToken = result.access_token; localStorage.setItem(TOKEN_KEY, accessToken); }
    user = result.user; csrf = result.csrf;
    el('password').value = ''; el('signedInAs').textContent = `${user.username} · ${user.role === 'admin' ? 'Admin' : user.role === 'viewer' ? 'Read-only' : 'User'}`;
    el('historyScopeLabel').hidden = user.role !== 'admin';
    el('exportExcel').hidden = user.role !== 'admin';
    // Product choices and saved history are independent. Show the workspace at
    // once and load both in parallel instead of making staff wait for each one.
    el('loginPanel').hidden = true; el('appContent').hidden = false;
    const [catalogue] = await Promise.all([api('/api/products'), loadHistory()]);
    if (epoch !== authEpoch) return;
    fillProducts(catalogue);
  }
  el('loginForm').onsubmit = async event => {
    event.preventDefault(); el('signIn').disabled = true; status('loginStatus', 'Signing in…');
    try { await enter(await api('/api/auth/login', {username:el('username').value.trim(), password:el('password').value}, 30000)); }
    catch (error) { clearPrivate(); status('loginStatus', error.message, true); }
    finally { el('signIn').disabled = false; }
  };
  el('signOut').onclick = async () => {
    if (submitting || (draft.length && !confirm('Sign out and discard your unsubmitted draft?'))) return;
    el('signOut').disabled = true;
    try { await api('/api/auth/logout', {}); clearPrivate(); status('loginStatus', 'Signed out.'); }
    catch (error) { status(user ? 'submissionStatus' : 'loginStatus', error.message, true); }
    finally { el('signOut').disabled = false; }
  };
  el('submitBatch').onclick = async () => {
    if (!ready() || !draft.length) return;
    const count = draft.length;
    if (!confirm(`Submit ${count} serial${count === 1 ? '' : 's'} now?`)) return;
    const epoch = authEpoch;
    const payload = {product_id:product().id, litres:el('productLitres').value, dealer:el('dealerName').value.trim(), batch:el('batchName').value.trim(), serials:draft.map(item => ({code:item.code,method:item.method === 'hybrid' ? 'qr' : item.method || 'manual',inferred:Boolean(item.inferred),edited:Boolean(item.edited)}))};
    const fingerprint = JSON.stringify(payload);
    if (!retry || retry.fingerprint !== fingerprint) retry = {fingerprint, id:crypto.randomUUID()};
    submitting = true; scanner()?.pause(); sync(); status('submissionStatus', 'Saving confirmed serials…');
    try {
      const result = await api('/api/submissions', {...payload, request_id:retry.id});
      if (epoch !== authEpoch) return;
      retry = null; scanner()?.clearDraft();
      const savedCount = result.submission.serials.length;
      status('submissionStatus', `Saved submission #${result.submission.id}: ${savedCount} serial${savedCount === 1 ? '' : 's'}. You can start another draft.`);
      await loadHistory();
    } catch (error) { if (epoch === authEpoch) status('submissionStatus', error.message + ' Your draft is still here; nothing has been cleared.', true); }
    finally { if (epoch === authEpoch) { submitting = false; sync(); } }
  };
  function renderSubmission(entry) {
    const card = document.createElement('article'); card.className = 'saved-card';
    const p = entry.product;
    const codes = entry.serials.map(serial => serial.code).join('\n');
    card.innerHTML = `<h3>${escape(p.brand)} | ${escape(p.model)} | ${escape(p.viscosity)} | ${escape(entry.litres)}</h3><p>Serial numbers</p><div class="saved-codes">${escape(codes)}</div>`;
    if (user?.role !== 'viewer') {
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'mini'; edit.textContent = 'Edit submission';
      edit.onclick = () => editSubmission(entry, card, edit);
      card.append(edit);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'mini clear'; remove.textContent = 'Delete submission';
      remove.onclick = () => deleteSubmission(entry, remove);
      card.append(remove);
    }
    el('savedResults').append(card);
  }
  async function deleteSubmission(entry, button) {
    const count = entry.serials.length;
    if (!confirm(`Delete this submission and its ${count} serial${count === 1 ? '' : 's'}? This cannot be undone.`)) return;
    button.disabled = true;
    try {
      await api(`/api/submissions/${entry.id}/delete`, {revision:entry.revision});
      status('historyStatus', 'Submission deleted.');
      await loadHistory();
    } catch (error) {
      button.disabled = false;
      status('historyStatus', error.message, true);
    }
  }
  function editSubmission(entry, card, button) {
    button.disabled = true;
    const form = document.createElement('form'); form.className = 'history-editor';
    const options = products.map(p => `<option value="${escape(p.id)}">${escape(p.brand)} | ${escape(p.model)} | ${escape(gradeLabel(p.viscosity))} | ${escape(typeLabel(p.oil_type))}</option>`).join('');
    form.innerHTML = `<label>Product<select name="product" required>${options}</select></label><label>Litres<select name="litres">${['1L','3.5L','4L','5L','18L'].map(v=>`<option>${v}</option>`).join('')}</select></label><label>Dealer name (optional)<input name="dealer" maxlength="120"></label><label>Batch (optional)<input name="batch" maxlength="120"></label><label>Serial numbers — one per line<textarea name="serials" rows="6" required autocapitalize="characters" spellcheck="false"></textarea></label><div class="confirm-actions"><button type="submit" class="btn btn-main">Save changes</button><button type="button" class="btn btn-soft" name="cancel">Cancel</button></div><p class="form-status" role="status"></p>`;
    const fields = form.elements;
    fields.product.value = entry.product_id; fields.litres.value = entry.litres;
    fields.dealer.value = entry.dealer; fields.batch.value = entry.batch;
    fields.serials.value = entry.serials.map(s=>s.code).join('\n');
    const message = form.querySelector('[role="status"]');
    fields.cancel.onclick = () => { form.remove(); button.disabled = false; };
    form.onsubmit = async event => {
      event.preventDefault();
      const serials = fields.serials.value.split(/\r?\n/).map(s=>s.trim().toUpperCase()).filter(Boolean);
      if (!serials.length || serials.length > 500 || serials.some(s=>!/^([A-Z]{3})\d{6,10}$/.test(s)) || new Set(serials).size !== serials.length) {
        message.textContent = 'Enter unique serials, one per line: three letters followed by 6–10 digits.'; return;
      }
      const body = {request_id:crypto.randomUUID(),revision:entry.revision,product_id:fields.product.value,litres:fields.litres.value,dealer:fields.dealer.value.trim(),batch:fields.batch.value.trim(),serials:serials.map(code=>({code,method:'manual',edited:true}))};
      [...fields].forEach(field=>field.disabled=true); message.textContent='Saving changes…';
      try { await api(`/api/submissions/${entry.id}/edit`,body); form.remove(); await loadHistory(); }
      catch(error) { message.textContent=error.message; [...fields].forEach(field=>field.disabled=false); }
    };
    card.append(form);
  }
  async function loadHistory(append = false) {
    if (!user || (append && (historyBusy || !nextBefore))) return;
    const epoch = ++historyEpoch; historyBusy = true;
    if (!append) { el('savedResults').replaceChildren(); nextBefore = null; }
    el('olderHistory').hidden = true; el('refreshHistory').disabled = true;
    el('savedTitle').textContent = el('historyScope').value === 'all' ? 'Admin master history' : 'My submitted history';
    status('historyStatus', 'Loading submissions…');
    const params = new URLSearchParams({scope:el('historyScope').value, q:el('historyQuery').value.trim()});
    if (append) params.set('before', nextBefore);
    try {
      // History can include many serials per submission and travel through the
      // Dev Tunnel, so give it more time than lightweight scanner requests.
      const result = await api('/api/submissions?' + params, undefined, 30000);
      if (epoch !== historyEpoch) return;
      result.submissions.forEach(renderSubmission); nextBefore = result.next_before;
      status('historyStatus', el('savedResults').childElementCount ? `${el('savedResults').childElementCount} submission${el('savedResults').childElementCount === 1 ? '' : 's'} shown.` : 'No submitted scans found.');
    } catch (error) { if (epoch === historyEpoch) status('historyStatus', error.message, true); }
    finally { if (epoch === historyEpoch) { historyBusy = false; el('refreshHistory').disabled = false; el('olderHistory').hidden = !nextBefore; } }
  }
  el('refreshHistory').onclick = () => loadHistory();
  el('olderHistory').onclick = () => loadHistory(true);
  el('exportExcel').onclick = async () => {
    if (!user || user.role !== 'admin' || exporting) return;
    exporting = true; sync(); status('historyStatus', 'Preparing the Excel export…');
    try {
      const query = new URLSearchParams({q:el('historyQuery').value.trim()});
      const response = await fetch(API_BASE + '/api/exports/submissions.xlsx?' + query, {
        headers:{'Authorization':`Bearer ${accessToken}`, 'Accept':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},
        credentials:'omit', cache:'no-store', signal:AbortSignal.timeout(30000)
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        if (response.status === 401) { clearPrivate(); status('loginStatus', 'Session ended. Please sign in again.', true); }
        throw new Error(typeof result?.detail === 'string' ? result.detail : 'Could not create the Excel export.');
      }
      const file = await response.blob();
      if (!file.size) throw new Error('The Excel export was empty.');
      const url = URL.createObjectURL(file), link = document.createElement('a');
      link.href = url; link.download = 'label-lens-master-submissions.xlsx'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status('historyStatus', 'Excel export downloaded.');
    } catch (error) {
      if (user) status('historyStatus', error.message || 'Could not create the Excel export.', true);
    } finally { exporting = false; sync(); }
  };
  el('historyScope').onchange = () => loadHistory();
  el('historyFilter').onsubmit = event => { event.preventDefault(); loadHistory(); };
  window.addEventListener('beforeunload', event => { if (draft.length || submitting) { event.preventDefault(); event.returnValue = ''; } });
  window.LabelLensAccount = {ready, canScan, saving:() => submitting, draftChanged};
  (async () => {
    el('signIn').disabled = true;
    if (!accessToken) { status('loginStatus', 'Sign in with your shared account.'); el('signIn').disabled = false; sync(); return; }
    try { await enter(await api('/api/auth/me')); }
    catch (error) { if (error.status !== 401) { clearPrivate(); status('loginStatus', error.message, true); } else status('loginStatus', 'Sign in with your shared account.'); }
    finally { el('signIn').disabled = false; sync(); }
  })();
})();

