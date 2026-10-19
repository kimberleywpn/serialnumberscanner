(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const API_BASE = 'https://m9kw6gfq-8088.asse.devtunnels.ms';
  const TOKEN_KEY = 'label_lens_access_token';
  const CATALOGUE_KEY = 'label_lens_catalogue_v1';
  let accessToken = localStorage.getItem(TOKEN_KEY) || '';
  let user = null, csrf = '', products = [], draft = [], submitting = false, exporting = false;
  let retry = null, nextBefore = null, historyEpoch = 0, historyBusy = false, authEpoch = 0;
  let catalogueEpoch = 0, catalogueBusy = false, catalogueTask = null;
  let authBusy = false;
  const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function status(id, text, error = false) { el(id).textContent = text; el(id).dataset.error = String(error); }
  function scanner() { return window.LabelLensScanner; }
  function clearPrivate({preserveDraft = false} = {}) {
    const savedDraft = preserveDraft ? scanner()?.items?.() || draft : [];
    authEpoch++; historyEpoch++; catalogueEpoch++; user = null; csrf = '';
    catalogueBusy = false; catalogueTask = null;
    if (!preserveDraft) { products = []; retry = null; }
    draft = savedDraft;
    accessToken = ''; localStorage.removeItem(TOKEN_KEY);
    nextBefore = null; submitting = false; exporting = false; historyBusy = false;
    if (preserveDraft) {
      scanner()?.pause();
    } else {
      scanner()?.reset(); el('productForm').reset();
    }
    el('savedResults').replaceChildren();
    el('historyScope').value = 'mine'; el('historyQuery').value = '';
    if (!preserveDraft) {
      el('productBrand').replaceChildren(new Option('Choose brand', ''));
      el('productModel').replaceChildren(new Option('Choose model', ''));
      el('productRating').replaceChildren(new Option('Choose rating', ''));
      el('productType').replaceChildren(new Option('Choose type', ''));
      el('productLitres').replaceChildren(new Option('Choose litres', ''));
      el('productDetails').textContent = ''; el('submissionSummary').textContent = ''; el('currentSpec').textContent = 'Current spec: Not selected';
    }
    el('exportExcel').hidden = true; el('exportExcel').disabled = false;
    el('retrySession').hidden = true;
    el('retryProducts').hidden = true; el('retryProducts').disabled = false;
    status('catalogueStatus', ''); el('catalogueStatus').hidden = true;
    el('bootPanel').hidden = true;
    el('appContent').hidden = true; el('loginPanel').hidden = false;
    el('signedInAs').textContent = ''; el('password').value = '';
    if (!preserveDraft) status('submissionStatus', 'Drafts are held in memory. Submit before leaving or signing out.');
    sync();
  }
  async function api(path, body, timeoutMs = 20000) {
    const requestToken = accessToken;
    const headers = requestToken ? {'Authorization':`Bearer ${requestToken}`} : {};
    if (body !== undefined) Object.assign(headers, {'Content-Type':'application/json', 'X-Label-Lens-CSRF':csrf, 'X-Label-Lens-Origin':location.origin});
    let response, result;
    const deadline = Date.now() + timeoutMs;
    const attempts = body === undefined ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      // A read gets one recovery attempt within the same overall deadline.
      // Writes are never repeated automatically because they may have saved.
      const remaining = Math.max(1, deadline - Date.now());
      const signal = AbortSignal.timeout(body === undefined && attempt === 0 ? Math.min(10000, remaining) : remaining);
      try {
        response = await fetch(API_BASE + path, {
        method: body === undefined ? 'GET' : 'POST', credentials:'omit', cache:'no-store', headers,
        signal, ...(body === undefined ? {} : {body:JSON.stringify(body)})
        });
        if (body === undefined && [502, 503, 504].includes(response.status) && attempt + 1 < attempts && deadline - Date.now() > 750) {
          await response.body?.cancel().catch(() => {});
          await new Promise(resolve => setTimeout(resolve, 750));
          continue;
        }
        result = await response.json().catch(error => {
          if (signal.aborted) throw signal.reason;
          if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw error;
          return null;
        });
        break;
      } catch (error) {
        if (attempt + 1 < attempts && deadline - Date.now() > 750) {
          await new Promise(resolve => setTimeout(resolve, 750));
          continue;
        }
        const timedOut = error?.name === 'TimeoutError' || (error?.name === 'AbortError' && signal.aborted);
        throw new Error(timedOut ? 'Connection timed out. Please try again. Your saved login and draft are kept.' : 'Connection interrupted. Please try again. Your saved login and draft are kept.');
      }
    }
    if (!response.ok) {
      if (response.status === 401 && path !== '/api/auth/login' && requestToken === accessToken) { clearPrivate({preserveDraft:true}); status('loginStatus', 'Session ended. Sign in again to continue with your saved draft.', true); }
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
    status('setupStatus', user?.role === 'viewer' ? 'Your shared account is read-only. You can view your history.' : locked ? 'Product is selected for this draft.' : ready() ? 'Ready to submit. These details apply to every serial in this draft.' : draft.length ? `Scan complete for ${draft.length} serial${draft.length === 1 ? '' : 's'}. Select the product and litres before submitting.` : 'You can scan now. Select the product and litres before submitting.');
    scanner()?.sync();
  }
  function fillProducts(data) {
    const selected = {
      brand:el('productBrand').value, model:el('productModel').value,
      rating:el('productRating').value, type:el('productType').value,
      litres:el('productLitres').value,
    };
    products = data.products;
    resetSelect('productModel', 'Choose model');
    resetSelect('productRating', 'Choose rating');
    resetSelect('productType', 'Choose type');
    el('productBrand').replaceChildren(new Option('Choose brand', ''));
    el('productLitres').replaceChildren(new Option('Choose litres', ''));
    for (const brand of [...new Set(products.map(entry => entry.brand))].sort()) el('productBrand').add(new Option(brand, brand));
    for (const litres of data.litres) el('productLitres').add(new Option(litres, litres));
    if ([...el('productBrand').options].some(option => option.value === selected.brand)) {
      el('productBrand').value = selected.brand; el('productBrand').onchange();
      el('productModel').value = selected.model; el('productModel').onchange();
      el('productRating').value = selected.rating; el('productRating').onchange();
      el('productType').value = selected.type;
    }
    if ([...el('productLitres').options].some(option => option.value === selected.litres)) el('productLitres').value = selected.litres;
    sync();
  }
  function validCatalogue(data) {
    const litres = ['1L','3.5L','4L','5L','18L'];
    return Boolean(data && Array.isArray(data.products) && data.products.length > 0 && data.products.length <= 1000
      && data.products.every(product => product && ['id','brand','model','viscosity','oil_type','ratings'].every(key => typeof product[key] === 'string' && product[key].length <= 1000) && product.id && product.brand && product.model)
      && new Set(data.products.map(product => product.id)).size === data.products.length
      && Array.isArray(data.litres) && data.litres.length === litres.length && new Set(data.litres).size === litres.length && data.litres.every(value => litres.includes(value)));
  }
  function savedCatalogue() {
    try {
      const saved = JSON.parse(localStorage.getItem(CATALOGUE_KEY) || 'null');
      return saved?.apiBase === API_BASE && validCatalogue(saved.data) ? saved.data : null;
    } catch { return null; }
  }
  function loadProducts() {
    if (!user) return Promise.resolve();
    if (catalogueBusy) return catalogueTask;
    const epoch = authEpoch, request = ++catalogueEpoch;
    catalogueBusy = true;
    el('retryProducts').disabled = true;
    status('catalogueStatus', products.length ? 'Checking product updates…' : 'Loading products…');
    el('catalogueStatus').hidden = false;
    catalogueTask = (async () => {
      try {
        const data = await api('/api/products');
        if (epoch !== authEpoch || request !== catalogueEpoch) return;
        if (!validCatalogue(data)) throw new Error('Invalid product details');
        fillProducts(data);
        try { localStorage.setItem(CATALOGUE_KEY, JSON.stringify({apiBase:API_BASE, savedAt:Date.now(), data})); } catch { /* Storage may be full or unavailable. */ }
        status('catalogueStatus', ''); el('catalogueStatus').hidden = true;
        el('retryProducts').hidden = true;
      } catch (error) {
        if (epoch !== authEpoch || request !== catalogueEpoch) return;
        status('catalogueStatus', products.length ? 'Using saved product details. Retry to check for updates.' : 'Product details could not load. You can keep scanning and retry here. Your draft is kept.', !products.length);
        el('catalogueStatus').hidden = false;
        el('retryProducts').hidden = false;
      } finally {
        if (epoch === authEpoch && request === catalogueEpoch) {
          catalogueBusy = false; catalogueTask = null;
          el('retryProducts').disabled = false;
        }
      }
    })();
    return catalogueTask;
  }
  el('retryProducts').onclick = () => loadProducts();
  window.addEventListener('online', () => {
    if (!user) return;
    if (!el('retryProducts').hidden) loadProducts();
    if (el('historyStatus').dataset.error === 'true') loadHistory();
  });
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
    authEpoch++;
    if (result.access_token) { accessToken = result.access_token; localStorage.setItem(TOKEN_KEY, accessToken); }
    user = result.user; csrf = result.csrf;
    el('password').value = ''; el('signedInAs').textContent = `${user.username} · ${user.role === 'admin' ? 'Admin' : user.role === 'viewer' ? 'Read-only' : 'User'}`;
    el('retrySession').hidden = true;
    el('historyScopeLabel').hidden = user.role !== 'admin';
    el('exportExcel').hidden = user.role !== 'admin';
    // Product choices and saved history are independent. Show the workspace at
    // once and load both in parallel instead of making staff wait for each one.
    el('bootPanel').hidden = true; el('loginPanel').hidden = true; el('appContent').hidden = false;
    // Cached product metadata is used only after the server verifies the login.
    // Never store private history, drafts, or permissions in this cache.
    const cached = savedCatalogue();
    if (cached) fillProducts(cached);
    else sync();
    catalogueEpoch++; catalogueBusy = false; catalogueTask = null;
    loadProducts();
    loadHistory();
  }
  el('loginForm').onsubmit = async event => {
    event.preventDefault();
    if (authBusy) return;
    authBusy = true; el('signIn').disabled = true; el('retrySession').disabled = true;
    status('loginStatus', 'Signing in…');
    try { await enter(await api('/api/auth/login', {username:el('username').value.trim(), password:el('password').value}, 15000)); }
    catch (error) { clearPrivate({preserveDraft:true}); status('loginStatus', error.message, true); }
    finally { authBusy = false; el('signIn').disabled = false; el('retrySession').disabled = false; }
  };
  el('retrySession').onclick = async () => {
    if (!accessToken || authBusy) return;
    authBusy = true; el('signIn').disabled = true; el('retrySession').disabled = true;
    status('loginStatus', 'Reconnecting…');
    try { await enter(await api('/api/auth/me')); }
    catch (error) {
      if (error.status !== 401) {
        status('loginStatus', error.message, true);
        el('retrySession').hidden = false;
      }
    } finally { authBusy = false; el('signIn').disabled = false; el('retrySession').disabled = false; }
  };
  el('signOut').onclick = async () => {
    if (submitting || (draft.length && !confirm('Sign out and discard your unsubmitted draft?'))) return;
    el('signOut').disabled = true;
    try { await api('/api/auth/logout', {}); clearPrivate(); status('loginStatus', 'Signed out.'); }
    catch (error) { clearPrivate(); status('loginStatus', `Signed out on this device. ${error.message}`, true); }
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
    const uploader = user?.role === 'admin' && el('historyScope').value === 'all' && entry.username
      ? `<p class="saved-uploader">Uploaded by: ${escape(entry.username)}</p>` : '';
    card.innerHTML = `<h3>${escape(p.brand)} | ${escape(p.model)} | ${escape(p.viscosity)} | ${escape(entry.litres)}</h3>${uploader}<p>Serial numbers</p><div class="saved-codes">${escape(codes)}</div>`;
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
    if (!products.length) {
      status('historyStatus', 'Load product details before editing. Use Retry products above if needed.', true);
      return;
    }
    button.disabled = true;
    const form = document.createElement('form'); form.className = 'history-editor';
    const options = products.map(p => `<option value="${escape(p.id)}">${escape(p.brand)} | ${escape(p.model)} | ${escape(gradeLabel(p.viscosity))} | ${escape(typeLabel(p.oil_type))}</option>`).join('');
    form.innerHTML = `<label>Product<select name="product" required>${options}</select></label><label>Litres<select name="litres">${['1L','3.5L','4L','5L','18L'].map(v=>`<option>${v}</option>`).join('')}</select></label><label>Dealer name<input name="dealer" maxlength="120"></label><label>Batch<input name="batch" maxlength="120"></label><label>Serial numbers — one per line<textarea name="serials" rows="6" required autocapitalize="characters" spellcheck="false"></textarea></label><div class="confirm-actions"><button type="submit" class="btn btn-main">Save changes</button><button type="button" class="btn btn-soft" name="cancel">Cancel</button></div><p class="form-status" role="status"></p>`;
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
    el('olderHistory').hidden = true; el('refreshHistory').disabled = true;
    el('savedTitle').textContent = el('historyScope').value === 'all' ? 'Admin master history' : 'My submitted history';
    status('historyStatus', 'Loading submissions…');
    const params = new URLSearchParams({scope:el('historyScope').value, q:el('historyQuery').value.trim()});
    if (append) params.set('before', nextBefore);
    try {
      // History can include many serials per submission and travel through the
      // Dev Tunnel, so give it more time than lightweight scanner requests.
      const result = await api('/api/submissions?' + params, undefined, 15000);
      if (epoch !== historyEpoch) return;
      if (!append) el('savedResults').replaceChildren();
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
        if (response.status === 401) { clearPrivate({preserveDraft:true}); status('loginStatus', 'Session ended. Sign in again to continue with your saved draft.', true); }
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
    authBusy = true; el('signIn').disabled = true; el('retrySession').disabled = true;
    if (!accessToken) { clearPrivate({preserveDraft:true}); status('loginStatus', 'Sign in with your shared account.'); authBusy = false; el('signIn').disabled = false; el('retrySession').disabled = false; return; }
    try { await enter(await api('/api/auth/me')); }
    catch (error) {
      if (error.status !== 401) {
        // A tunnel or server interruption must not strand the page on the
        // loading panel or erase a still-valid saved login.
        scanner()?.pause();
        el('bootPanel').hidden = true;
        el('appContent').hidden = true;
        el('loginPanel').hidden = false;
        status('loginStatus', error.message, true);
        el('retrySession').hidden = false;
      } else status('loginStatus', draft.length ? 'Session ended. Sign in again to continue with your saved draft.' : 'Sign in with your shared account.', Boolean(draft.length));
    }
    finally { authBusy = false; el('signIn').disabled = false; el('retrySession').disabled = false; sync(); }
  })();
})();

