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
    el('productDetails').textContent = ''; el('submissionSummary').textContent = '';
    el('exportExcel').hidden = true; el('exportExcel').disabled = false;
    el('appContent').hidden = true; el('loginPanel').hidden = false;
    el('signedInAs').textContent = ''; el('password').value = '';
    status('submissionStatus', 'Drafts are held in memory. Submit before leaving or signing out.');
    sync();
  }
  async function api(path, body) {
    const headers = accessToken ? {'Authorization':`Bearer ${accessToken}`} : {};
    if (body !== undefined) Object.assign(headers, {'Content-Type':'application/json', 'X-Label-Lens-CSRF':csrf, 'X-Label-Lens-Origin':location.origin});
    let response;
    try {
      response = await fetch(API_BASE + path, {
        method: body === undefined ? 'GET' : 'POST', credentials:'omit', cache:'no-store', headers,
        signal:AbortSignal.timeout(12000), ...(body === undefined ? {} : {body:JSON.stringify(body)})
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
    return Boolean(user && user.role !== 'viewer' && !submitting && product() && el('productForm').checkValidity() && el('dealerName').value.trim() && el('batchName').value.trim());
  }
  function sync() {
    const locked = draft.length > 0 || submitting;
    const readOnly = locked || user?.role === 'viewer';
    ['productBrand','productLitres','dealerName','batchName'].forEach(id => { el(id).disabled = readOnly; });
    el('productModel').disabled = readOnly || !el('productBrand').value;
    el('productRating').disabled = readOnly || !el('productModel').value;
    el('productType').disabled = readOnly || !el('productRating').value;
    el('submitBatch').disabled = submitting || !draft.length || !ready();
    el('submitBatch').textContent = submitting ? 'Submitting…' : `3. Submit ${draft.length ? draft.length + ' serial' + (draft.length === 1 ? '' : 's') : 'list'}`;
    el('manualAdd').disabled = !ready(); el('manualSerial').disabled = !ready();
    el('signOut').disabled = submitting;
    el('exportExcel').disabled = exporting || !user || user.role !== 'admin';
    const selected = product();
    el('productDetails').textContent = selected ? `${selected.model} | ${gradeLabel(selected.viscosity)} | ${typeLabel(selected.oil_type)}\nSpecification: ${selected.ratings}` : '';
    el('submissionSummary').textContent = selected && draft.length ? `${selected.brand} · ${selected.model} | ${gradeLabel(selected.viscosity)} | ${typeLabel(selected.oil_type)} · ${el('productLitres').value} — Dealer: ${el('dealerName').value.trim()} — Batch: ${el('batchName').value.trim()}` : '';
    status('setupStatus', user?.role === 'viewer' ? 'Your shared account is read-only. You can view your history.' : locked ? 'Product and batch are locked to this draft. Submit or clear the draft to change them.' : ready() ? 'Ready to scan. These details apply to every serial in this draft.' : 'Complete the fields before scanning.');
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
  function draftChanged(items) { draft = items; sync(); }
  async function enter(result) {
    const epoch = ++authEpoch;
    if (result.access_token) { accessToken = result.access_token; localStorage.setItem(TOKEN_KEY, accessToken); }
    user = result.user; csrf = result.csrf;
    el('password').value = ''; el('signedInAs').textContent = `${user.username} · ${user.role === 'admin' ? 'Admin' : user.role === 'viewer' ? 'Read-only' : 'User'}`;
    el('historyScopeLabel').hidden = user.role !== 'admin';
    el('exportExcel').hidden = user.role !== 'admin';
    const catalogue = await api('/api/products');
    if (epoch !== authEpoch) return;
    fillProducts(catalogue); el('loginPanel').hidden = true; el('appContent').hidden = false;
    await loadHistory();
  }
  el('loginForm').onsubmit = async event => {
    event.preventDefault(); el('signIn').disabled = true; status('loginStatus', 'Signing in…');
    try { await enter(await api('/api/auth/login', {username:el('username').value.trim(), password:el('password').value})); }
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
    const epoch = authEpoch;
    const payload = {product_id:product().id, litres:el('productLitres').value, dealer:el('dealerName').value.trim(), batch:el('batchName').value.trim(), serials:draft.map(item => ({code:item.code,method:item.method || 'manual',inferred:Boolean(item.inferred),edited:Boolean(item.edited)}))};
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
    const estimates = entry.serials.filter(serial => serial.inferred).length;
    card.innerHTML = `<h3>${escape(p.brand)} ${escape(p.model)} · ${escape(entry.litres)}</h3><p>${escape(p.viscosity)} · ${escape(p.oil_type)}<br>${escape(p.ratings)}</p><p>Dealer: ${escape(entry.dealer)}<br>Batch: ${escape(entry.batch)}</p><p>#${entry.id} · ${escape(entry.username || user.username)} · ${escape(new Date(entry.created).toLocaleString())}</p><div class="saved-codes">${escape(codes)}</div>${estimates ? `<p>${estimates} QR-derived estimate${estimates === 1 ? '' : 's'} recorded; not authenticity checks.</p>` : ''}`;
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'mini'; copy.textContent = 'Copy serials';
    copy.onclick = () => scanner()?.copy(codes, 'Serials copied'); card.append(copy); el('savedResults').append(card);
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
      const result = await api('/api/submissions?' + params);
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
  window.LabelLensAccount = {ready, saving:() => submitting, draftChanged};
  (async () => {
    el('signIn').disabled = true;
    if (!accessToken) { status('loginStatus', 'Sign in with your shared account.'); el('signIn').disabled = false; sync(); return; }
    try { await enter(await api('/api/auth/me')); }
    catch (error) { if (error.status !== 401) { clearPrivate(); status('loginStatus', error.message, true); } else status('loginStatus', 'Sign in with your shared account.'); }
    finally { el('signIn').disabled = false; sync(); }
  })();
})();

