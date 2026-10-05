const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const state = { csrf: null, aiEnabled: false, aiProvider: 'none', roots: [], shortcuts: [], preferences: null,
  path: null, listing: null, focusPath: null, view: 'dashboard', search: '', scan: null };
const voice = { active: false, ready: false, mode: 'off', controller: null, lastAnswer: '', lastError: '' };
const formatSize = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
const formatDate = iso => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const icon = item => item.kind === 'folder' ? '<div class="file-icon folder">▤</div>' : `<div class="file-icon ${esc(item.name.split('.').pop().toLowerCase())}">${esc(item.name.split('.').pop().slice(0, 4).toUpperCase())}</div>`;
let toastTimer, searchTimer, scanTimer;
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.add('hidden'), 4000); }
async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.method && options.method !== 'GET') headers['x-csrf-token'] = state.csrf || '';
  const res = await fetch(url, { credentials: 'same-origin', ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { $('#app').classList.add('hidden'); $('#auth').classList.remove('hidden'); }
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
async function boot() {
  const session = await api('/api/session');
  state.csrf = session.csrf; state.aiEnabled = session.aiEnabled; state.aiProvider = session.aiProvider;
  if (!session.authenticated) {
    $('#auth').classList.remove('hidden'); $('#app').classList.add('hidden');
    $('#auth-title').textContent = session.configured ? 'Welcome back' : "Welcome to Jermi's Assistant";
    $('#auth-description').textContent = session.configured ? 'Sign in to your local PC assistant.' : 'Create a password to secure your local assistant.';
    $('#auth-submit').firstChild.textContent = session.configured ? 'Sign in ' : 'Create my space ';
    $('#password').minLength = session.configured ? 1 : 12;
    $('#password').autocomplete = session.configured ? 'current-password' : 'new-password';
    $('#auth-form').dataset.mode = session.configured ? 'login' : 'setup';
    return;
  }
  $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden');
  [state.preferences, state.scan] = await Promise.all([api('/api/preferences'), api('/api/pc/scan')]);
  try { voice.ready = Boolean((await api('/api/voice/status')).ready); } catch { voice.ready = false; }
  const places = await api('/api/pc/roots'); state.roots = places.roots; state.shortcuts = places.shortcuts;
  state.path ||= state.shortcuts.find(p => p.name === 'Documents')?.path || state.shortcuts[0]?.path || state.roots[0]?.path;
  renderSidebar(); render();
}
function selectView(view) { if (view !== 'assistant' && voice.active) stopVoice(); state.view = view; renderSidebar(); render(); $('#main').focus(); }
function updateSidebarCollapse() {
  const collapsed = localStorage.getItem('jermi-sidebar-collapsed') === '1' ||
    (localStorage.getItem('jermi-sidebar-collapsed') === null && matchMedia('(max-width: 800px)').matches);
  $('.sidebar').classList.toggle('collapsed', collapsed);
  $('#sidebar-toggle').setAttribute('aria-expanded', String(!collapsed));
  $('#sidebar-toggle').setAttribute('aria-label', collapsed ? 'Expand menu' : 'Collapse menu');
  $('#sidebar-toggle').title = collapsed ? 'Expand menu' : 'Collapse menu';
}
function renderSidebar() {
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === state.view));
  $('#sidebar-projects').innerHTML = [...state.shortcuts, ...state.roots].map(place =>
    `<button class="project-link" data-place="${esc(place.path)}"><span class="project-dot"></span>${esc(place.name)}</button>`).join('');
  $$('[data-place]', $('#sidebar-projects')).forEach(button => button.onclick = () => openFolder(button.dataset.place));
}
function pageHead(label, title, subtitle, action = '') { return `<div class="page-head"><div><div class="eyebrow">${label}</div><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`; }
function render() {
  $('#breadcrumb-current').textContent = { dashboard: 'Home', files: 'My PC', assistant: 'Assistant', settings: 'Settings' }[state.view];
  if (state.view === 'dashboard') renderDashboard();
  if (state.view === 'files') renderFiles();
  if (state.view === 'assistant') renderAssistant();
  if (state.view === 'settings') renderSettings();
}
function renderDashboard() {
  const name = esc(state.preferences?.assistant_name || "Jermi's Assistant");
  $('#main').innerHTML = `<div class="page">${pageHead('YOUR COMPUTER, IN CONTEXT', 'A clearer way to work with your PC.', 'Browse, find, understand, and organize files through one local assistant.')}
    <div class="hero-grid"><section class="hero"><div class="hero-copy"><div class="hero-badge"><span>✦</span> YOUR PC ASSISTANT</div><h2>Talk to your<br><span class="gradient-text">digital world.</span></h2><p>Ask about files on this computer. Follow every answer back to its source, then put things in their place.</p><button id="hero-chat" class="button primary small">✦ &nbsp; Talk to ${name} <span>→</span></button></div><div class="hero-visual"><div class="hero-orbit"></div><img src="/assets/assistant.png" alt="Blue holographic AI assistant"></div></section>
    <div class="hero-side"><section class="mini-card glass"><div class="mini-icon">⌕</div><div class="card-kicker">EXPLORE YOUR PC</div><h3>Files where they already live.</h3><p>Open a drive or folder and work with its files in place.</p><button id="hero-files" class="inline-link">Browse my PC →</button></section><section class="mini-card glass"><div class="mini-icon">▥</div><div class="card-kicker">MAKE IT FINDABLE</div><h3>Know what is inside.</h3><p>Scan a folder to add document text to your local search index.</p><button id="hero-scan" class="inline-link">Choose a folder →</button></section></div></div>
    <div class="stats"><div class="stat-card glass"><div class="stat-icon">▤</div><div><strong>${state.roots.length}</strong><small>Local drives</small></div></div><div class="stat-card glass"><div class="stat-icon">⬡</div><div><strong>${state.shortcuts.length}</strong><small>Quick places</small></div></div><div class="stat-card glass"><div class="stat-icon">✧</div><div><strong>${state.aiEnabled ? 'On' : 'Local'}</strong><small>${state.aiEnabled ? `${esc(state.aiProvider)} conversation` : 'Search and summaries'}</small></div></div></div>
    <div class="two-column"><section class="section-card glass"><div class="section-head"><h2 class="section-title">Quick places</h2><button id="view-all" class="inline-link">See drives →</button></div><div class="document-list">${[...state.shortcuts, ...state.roots].slice(0, 5).map(place => `<div class="doc-row" data-open-folder="${esc(place.path)}"><div class="file-icon folder">▤</div><div class="doc-info"><strong>${esc(place.name)}</strong><small>${esc(place.path)}</small></div><span class="doc-arrow">›</span></div>`).join('')}</div></section><section class="section-card ask-card"><div class="section-head"><h2 class="section-title">Start a conversation</h2><span>✦</span></div><p>Ask ${name} about a file or find something by name.</p><div class="prompt-chips"><button class="prompt-chip" data-prompt="Find my latest project notes">Find my latest project notes ↗</button><button class="prompt-chip" data-prompt="What can you help me do on this PC?">What can you help me do? ↗</button></div></section></div></div>`;
  $('#hero-chat').onclick = () => selectView('assistant');
  $('#hero-files').onclick = $('#hero-scan').onclick = $('#view-all').onclick = () => selectView('files');
  $$('[data-open-folder]').forEach(row => activate(row, () => openFolder(row.dataset.openFolder)));
  attachPrompts();
}
function activate(element, action) {
  element.setAttribute('role', 'button'); element.tabIndex = 0; element.onclick = action;
  element.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(); } };
}
async function openFolder(folder) {
  if (voice.active) stopVoice();
  state.path = folder; state.search = ''; state.view = 'files'; renderSidebar(); renderFiles();
}
function renderFiles() {
  $('#main').innerHTML = `<div class="page">${pageHead('LOCAL FILE EXPLORER', 'My PC', 'Browse your drives, inspect documents, and organize files in place.', '<button id="new-folder" class="button primary small">＋ New folder</button>')}
    <div class="toolbar"><div class="search-box"><span>⌕</span><input id="search-input" type="search" placeholder="Search filenames and indexed text..." value="${esc(state.search)}"></div><div class="file-toolbar-actions"><button id="scan-folder" class="button ghost small">✧ Scan folder</button><button id="tidy-folder" class="button ghost small">Tidy folder</button><button id="go-path" class="button ghost small">Go to path</button></div></div>
    <div class="folder-location glass"><div><small>CURRENT FOLDER</small><strong id="current-path">${esc(state.path || 'Choose a drive')}</strong></div><button id="up-folder" class="button ghost small">↑ Up</button></div>
    <div id="scan-status" class="scan-status"></div><div id="files-content"></div></div>`;
  $('#new-folder').onclick = openCreateFolder;
  $('#scan-folder').onclick = startScan;
  $('#tidy-folder').onclick = () => openOrganizePreview(state.path);
  $('#go-path').onclick = openGoToPath;
  $('#up-folder').onclick = () => state.listing?.parent && openFolder(state.listing.parent);
  $('#search-input').oninput = event => { state.search = event.target.value; drawFiles(); };
  updateScanStatus(); drawFiles();
}
async function drawFiles() {
  const target = $('#files-content'); if (!target) return;
  const query = state.search.trim();
  if (query) {
    target.innerHTML = '<div class="empty">Searching local files…</div>';
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      try {
        const results = await api(`/api/pc/search?q=${encodeURIComponent(query)}`);
        if ($('#search-input')?.value.trim() !== query || target !== $('#files-content')) return;
        target.innerHTML = results.length ? `<div class="result-list">${results.map(item => `<div class="result-card glass" data-result-path="${esc(item.path)}" data-result-kind="${esc(item.kind)}"><strong>${esc(item.name)}</strong><span class="result-tag">${item.source === 'content' ? 'TEXT MATCH' : item.kind.toUpperCase()}</span><p>${esc(item.excerpt || item.path)}</p></div>`).join('')}</div>` : '<div class="empty">No matches in the current search window. Search checks a bounded number of filenames; scan a relevant folder to search its document text.</div>';
        $$('[data-result-path]', target).forEach(row => activate(row, () => row.dataset.resultKind === 'folder' ? openFolder(row.dataset.resultPath) : openFile({ path: row.dataset.resultPath, name: row.querySelector('strong').textContent, kind: 'file', readable: true })));
      } catch (err) { if (target === $('#files-content')) target.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
    }, 300);
    return;
  }
  target.innerHTML = '<div class="empty">Opening folder…</div>';
  try {
    const requestedPath = state.path;
    const listing = await api(`/api/pc/list?path=${encodeURIComponent(requestedPath)}`);
    if (target !== $('#files-content') || state.path !== requestedPath || state.search) return;
    state.path = listing.path; state.listing = listing; $('#current-path').textContent = listing.path;
    $('#up-folder').disabled = !listing.parent;
    renderListing(target, listing);
  } catch (err) { if (target === $('#files-content')) target.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
}
function renderListing(target, listing) {
  target.innerHTML = listing.entries.length ? `<div class="document-list glass">${listing.entries.map(item => `<div class="doc-row" data-entry-path="${esc(item.path)}">${icon(item)}<div class="doc-info"><strong>${esc(item.name)}</strong><small>${item.kind === 'folder' ? 'Folder' : esc(formatSize(item.size))} · ${esc(formatDate(item.modifiedAt))}</small></div><span class="doc-arrow">›</span></div>`).join('')}</div><p class="listing-note">Showing ${listing.entries.length} of ${listing.total} items.</p>${listing.nextOffset !== null ? '<button id="load-more" class="button ghost small">Load more</button>' : ''}`
    : '<div class="empty"><span class="empty-icon">▤</span>This folder is empty.</div>';
  $$('[data-entry-path]', target).forEach((row, index) => activate(row, () => {
    const item = listing.entries[index]; item.kind === 'folder' ? openFolder(item.path) : openFile(item);
  }));
  if (listing.nextOffset !== null) $('#load-more').onclick = async () => {
    const button = $('#load-more'); button.disabled = true; button.textContent = 'Loading…';
    try {
      const page = await api(`/api/pc/list?path=${encodeURIComponent(listing.path)}&offset=${listing.nextOffset}`);
      if (target !== $('#files-content') || state.path !== listing.path || state.search) return;
      listing.entries.push(...page.entries); listing.nextOffset = page.nextOffset; listing.total = page.total;
      renderListing(target, listing);
    } catch (err) { button.disabled = false; button.textContent = 'Load more'; toast(err.message); }
  };
}
function updateScanStatus() {
  const el = $('#scan-status'); if (!el || !state.scan) return;
  el.textContent = state.scan.queued?.includes(state.path) ? `Queued a scan of ${state.path}. Current scan: ${state.scan.folder || 'starting'}.`
    : state.scan.running ? `${state.scan.source === 'automatic' ? 'Automatically scanning' : 'Scanning'} ${state.scan.folder} · ${state.scan.visited} entries checked · ${state.scan.indexed} documents updated`
    : state.scan.error ? `Scan stopped: ${state.scan.error}`
      : state.scan.finishedAt ? `Last scan: ${state.scan.indexed} documents updated, ${state.scan.skipped} skipped.` : '';
}
async function startScan() {
  try {
    state.scan = await api('/api/pc/scan', { method: 'POST', body: JSON.stringify({ path: state.path }) });
    updateScanStatus(); toast(state.scan.queued?.includes(state.path) ? 'Folder scan queued.' : 'Folder scan started. Documents are read in place.');
    clearInterval(scanTimer);
    scanTimer = setInterval(async () => {
      try { state.scan = await api('/api/pc/scan'); updateScanStatus(); if (!state.scan.running && !state.scan.queued?.length) clearInterval(scanTimer); }
      catch { clearInterval(scanTimer); }
    }, 1600);
  } catch (err) { toast(err.message); }
}
function showModal(html, wide = false) {
  $('#modal').className = `modal glass ${wide ? 'wide-modal' : ''}`; $('#modal').innerHTML = html;
  $('#modal-backdrop').classList.remove('hidden');
  $$('.modal-close').forEach(button => button.onclick = closeModal);
}
function closeModal() { $('#modal-backdrop').classList.add('hidden'); $('#modal').innerHTML = ''; }
function openGoToPath() {
  showModal(`<div class="modal-head"><div><h2>Go to a folder</h2><p>Enter a full local path.</p></div><button class="modal-close" aria-label="Close">×</button></div><form id="go-form"><div class="field"><label for="go-input">Folder path</label><input id="go-input" value="${esc(state.path)}" required></div><div class="modal-actions"><button type="button" id="cancel-go" class="button ghost">Cancel</button><button class="button primary" type="submit">Open folder</button></div></form>`);
  $('#cancel-go').onclick = closeModal;
  $('#go-form').onsubmit = async event => { event.preventDefault(); const next = $('#go-input').value.trim();
    try { await api(`/api/pc/list?path=${encodeURIComponent(next)}`); closeModal(); openFolder(next); }
    catch (err) { toast(err.message); } };
  $('#go-input').focus();
}
function openCreateFolder() {
  showModal(`<div class="modal-head"><div><h2>Create a folder</h2><p>Inside ${esc(state.path)}</p></div><button class="modal-close" aria-label="Close">×</button></div><form id="folder-form"><div class="field"><label for="folder-name">Folder name</label><input id="folder-name" maxlength="120" required></div><div class="modal-actions"><button type="button" id="cancel-folder" class="button ghost">Cancel</button><button class="button primary" type="submit">Create folder</button></div></form>`);
  $('#cancel-folder').onclick = closeModal;
  $('#folder-form').onsubmit = async event => { event.preventDefault(); try {
    await api('/api/pc/folders', { method: 'POST', body: JSON.stringify({ parent: state.path, name: $('#folder-name').value }) });
    closeModal(); drawFiles(); toast('Folder created.');
  } catch (err) { toast(err.message); } };
  $('#folder-name').focus();
}
async function openOrganizePreview(folder) {
  try {
    const plan = await api(`/api/pc/organize-preview?path=${encodeURIComponent(folder)}`);
    showModal(`<div class="modal-head"><div><h2>Tidy this folder</h2><p>${esc(plan.folder)}</p></div><button class="modal-close" aria-label="Close">×</button></div>
      <p>${plan.items.length ? `${plan.items.length} proposed move${plan.items.length === 1 ? '' : 's'} into category folders. ${plan.skipped} item${plan.skipped === 1 ? '' : 's'} will stay in place.` : 'There are no safe moves to propose in this folder.'}${plan.limited ? ' Review another batch after this one.' : ''}</p>
      ${plan.items.length ? `<div class="tidy-list">${plan.items.map(item => `<div><strong>${esc(item.name)}</strong><span>→ ${esc(item.category)}</span></div>`).join('')}</div><form id="organize-form"><div class="field"><label for="organize-confirm">Type ORGANIZE to confirm these moves</label><input id="organize-confirm" autocomplete="off" required></div><div class="modal-actions"><button type="button" id="cancel-organize" class="button ghost">Cancel</button><button class="button primary" type="submit">Organize ${plan.items.length} files</button></div></form>` : '<div class="modal-actions"><button id="cancel-organize" class="button ghost">Close</button></div>'}`, true);
    $('#cancel-organize').onclick = closeModal;
    if (plan.items.length) $('#organize-form').onsubmit = async event => { event.preventDefault(); try {
      const result = await api('/api/pc/organize', { method: 'POST', body: JSON.stringify({ path: plan.folder, items: plan.items, confirm: $('#organize-confirm').value }) });
      closeModal(); if (state.view === 'files' && state.path === plan.folder) drawFiles();
      toast(`Moved ${result.moved.length} file${result.moved.length === 1 ? '' : 's'}.${result.failed.length ? ` ${result.failed.length} could not be moved.` : ''}`);
    } catch (err) { toast(err.message); } };
  } catch (err) { toast(err.message); }
}
async function openFile(item) {
  let doc = null, note = '';
  try { doc = await api(`/api/pc/file?path=${encodeURIComponent(item.path)}`); }
  catch (err) { note = err.message; }
  showModal(`<div class="modal-head"><div><div class="eyebrow">LOCAL FILE</div><h2>${esc(item.name)}</h2><p>${esc(item.path)}</p></div><button class="modal-close" aria-label="Close">×</button></div>
    ${doc ? `<div class="summary-box"><strong>✦ QUICK SUMMARY</strong><div>${esc(doc.summary)}</div></div><div class="card-kicker preview-kicker">FILE TEXT</div><div id="doc-content" class="doc-preview"></div>` : `<div class="summary-box"><strong>PREVIEW</strong><div>${esc(note || 'No text preview is available.')}</div></div>`}
    <div class="modal-actions"><button id="rename-file" class="button ghost small">Rename</button><button id="move-file" class="button ghost small">Move</button>${doc ? '<button id="ask-file" class="button primary small">Discuss this file →</button>' : ''}</div>`, true);
  if (doc) $('#doc-content').textContent = doc.content + (doc.truncated ? '\n\n[Preview truncated]' : '');
  $('#rename-file').onclick = () => openRelocate(item, 'rename');
  $('#move-file').onclick = () => openRelocate(item, 'move');
  if (doc) $('#ask-file').onclick = () => { state.focusPath = item.path; closeModal(); selectView('assistant'); };
}
function openRelocate(item, mode) {
  const renameMode = mode === 'rename';
  showModal(`<div class="modal-head"><div><h2>${renameMode ? 'Rename' : 'Move'} ${esc(item.name)}</h2><p>${esc(item.path)}</p></div><button class="modal-close" aria-label="Close">×</button></div><form id="relocate-form"><div class="field"><label for="relocate-input">${renameMode ? 'New name' : 'Destination folder path'}</label><input id="relocate-input" value="${renameMode ? esc(item.name) : esc(state.path)}" required></div><p>Jermi's Assistant will not replace an existing file or folder.</p><div class="modal-actions"><button type="button" id="cancel-relocate" class="button ghost">Cancel</button><button class="button primary" type="submit">${renameMode ? 'Rename' : 'Move'} ${esc(item.kind)}</button></div></form>`);
  $('#cancel-relocate').onclick = closeModal;
  $('#relocate-form').onsubmit = async event => { event.preventDefault(); try {
    const payload = renameMode ? { path: item.path, name: $('#relocate-input').value } : { path: item.path, destination: $('#relocate-input').value };
    await api(`/api/pc/${mode}`, { method: 'POST', body: JSON.stringify(payload) });
    if (state.focusPath === item.path) state.focusPath = null;
    closeModal(); drawFiles(); toast(`${item.kind === 'file' ? 'File' : 'Folder'} ${renameMode ? 'renamed' : 'moved'}.`);
  } catch (err) { toast(err.message); } };
  $('#relocate-input').focus();
}
function renderAssistant() {
  const name = esc(state.preferences?.assistant_name || "Jermi's Assistant");
  $('#main').innerHTML = `<div class="page">${pageHead('YOUR LOCAL CONVERSATION', `Talk to ${name}`, 'Ask about the files on your PC and follow answers to their source.')}
    <div class="assistant-layout"><section class="chat-panel glass"><div class="chat-head"><span class="sparkle">✦</span><div class="chat-title"><strong>${name}</strong><small>${state.aiEnabled ? `${esc(state.aiProvider)} AI connected` : 'Local file search and extractive answers'}</small></div><button id="speak-last" class="voice-replay" type="button" title="Read the last answer aloud" aria-label="Read the last answer aloud">Read aloud</button></div>
      ${state.focusPath ? `<div class="focus-strip">Discussing <strong>${esc(state.focusPath)}</strong><button id="clear-focus" type="button">Clear focus ×</button></div>` : ''}<div id="chat-messages" class="chat-messages"></div><div id="voice-status" class="voice-status" role="status" aria-live="polite"></div>
      <form id="chat-form" class="chat-compose"><textarea id="chat-input" rows="1" placeholder="Ask about a file, folder, or topic…" aria-label="Your message" required></textarea><button id="mic-button" class="button ghost mic-button" type="button" aria-label="Start voice conversation" aria-pressed="false" title="Start voice conversation"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2" width="6" height="13" rx="3"></rect><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8"></path></svg></button><button id="send-button" class="button primary small" type="submit">Send ↗</button></form></section>
    <aside class="context-panel glass"><div class="card-kicker">LOCAL CONTEXT</div><h3>Your PC</h3><p>Jermi's Assistant can browse files in place, find names and locations, and discuss text from scanned folders or a selected file.</p><div class="side-divider"></div><div class="card-kicker">TRY ASKING</div><div class="suggested-list"><button class="prompt-chip" data-prompt="Where did I save my project notes?">Where did I save my project notes?</button><button class="prompt-chip" data-prompt="What is this document about?">What is this document about?</button><button class="prompt-chip" data-prompt="How can you help me organize files?">How can you help me organize files?</button></div><div class="side-divider"></div><div class="card-kicker">VOICE CHAT</div><p>The microphone and speaker run on this PC using an offline speech model and Windows speech. Select the microphone again to stop.</p><div class="side-divider"></div><div class="card-kicker">FILE ACTIONS</div><p>Create folders, rename, and move items from My PC. Jermi's Assistant will ask before a PC shutdown.</p></aside></div></div>`;
  $('#chat-form').onsubmit = sendChat;
  $('#mic-button').onclick = toggleVoice;
  $('#speak-last').onclick = () => voice.lastAnswer ? speakText(voice.lastAnswer) : toast('No answer to read aloud yet.');
  $('#chat-input').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('#chat-form').requestSubmit(); } };
  if (state.focusPath) $('#clear-focus').onclick = () => { state.focusPath = null; renderAssistant(); };
  attachPrompts(); loadMessages(); updateVoiceUI();
}
function attachPrompts() { $$('[data-prompt]', $('#main')).forEach(button => button.onclick = () => { selectView('assistant'); $('#chat-input').value = button.dataset.prompt; $('#chat-input').focus(); }); }
async function loadMessages() {
  const box = $('#chat-messages'); if (!box) return;
  try {
    const messages = await api('/api/messages'); if (box !== $('#chat-messages')) return;
    box.innerHTML = '';
    if (!messages.length) appendMessage({ role: 'assistant', content: `Hi, I’m ${state.preferences?.assistant_name || "Jermi's Assistant"}. How can I help you today? Ask me about your PC or open a file to discuss it.`, citations: [] });
    else messages.forEach(appendMessage);
    if (messages.length) voice.lastAnswer = messages.filter(message => message.role === 'assistant').at(-1)?.content || '';
  } catch (err) { toast(err.message); }
}
function appendMessage(message) {
  const box = $('#chat-messages'); if (!box) return;
  const el = document.createElement('div'); el.className = `message ${message.role}`;
  if (message.role === 'user') el.textContent = message.content;
  else {
    voice.lastAnswer = message.content;
    const avatar = document.createElement('div'); avatar.className = 'message-avatar'; avatar.textContent = '✦';
    const body = document.createElement('div'); body.className = 'message-body'; body.textContent = message.content;
    if (message.citations?.length) {
      const cites = document.createElement('div'); cites.className = 'citations';
      message.citations.forEach(citation => { const button = document.createElement('button'); button.className = 'citation'; button.textContent = `[${citation.number}] ${citation.name}`;
        button.onclick = () => openFile({ path: citation.path, name: citation.name, kind: 'file', readable: true }); cites.append(button); });
      body.append(cites);
    }
    if (message.actions?.length) {
      const actions = document.createElement('div'); actions.className = 'citations';
      message.actions.forEach(action => { if (!['openFolder', 'organizeFolder'].includes(action.type)) return;
        const button = document.createElement('button'); button.className = 'citation'; button.textContent = action.label || 'Open folder';
        button.onclick = () => action.type === 'openFolder' ? openFolder(action.path) : openOrganizePreview(action.path); actions.append(button); });
      body.append(actions);
    }
    el.append(avatar, body);
  }
  box.append(el); box.scrollTop = box.scrollHeight; return el;
}
async function sendChat(event) {
  if (voice.active) stopVoice();
  event.preventDefault(); await submitMessage($('#chat-input')?.value.trim());
}
async function submitMessage(message) {
  if (!message || !$('#chat-input')) return;
  const input = $('#chat-input'), box = $('#chat-messages'), button = $('#send-button'), path = state.focusPath;
  input.value = ''; const pending = appendMessage({ role: 'user', content: message });
  button.disabled = true; button.textContent = 'Thinking…';
  if (voice.active) { voice.mode = 'processing'; updateVoiceUI(); }
  try {
    const answer = await api('/api/chat', { method: 'POST', body: JSON.stringify({ message, path, folder: state.path }) });
    if (box === $('#chat-messages')) appendMessage(answer);
    return answer.content;
  } catch (err) {
    pending?.remove(); toast(err.message);
    return 'Sorry, I could not complete that request. Please try again.';
  } finally { if (button.isConnected) { button.disabled = false; button.textContent = 'Send ↗'; } }
}
function updateVoiceUI() {
  const mic = $('#mic-button'), status = $('#voice-status');
  if (mic) {
    mic.classList.toggle('active', voice.active);
    mic.setAttribute('aria-pressed', String(voice.active));
    mic.setAttribute('aria-label', voice.active ? 'Stop voice conversation' : 'Start voice conversation');
    mic.title = voice.active ? 'Stop voice conversation' : 'Start voice conversation';
  }
  if (!status) return;
  status.className = `voice-status ${voice.lastError ? 'error' : voice.mode}`;
  status.textContent = voice.lastError || (voice.mode === 'greeting' || voice.mode === 'speaking' ? 'Speaking through this PC… Select the microphone to stop.'
    : voice.mode === 'listening' ? 'Listening on this PC… Speak naturally. Select the microphone to stop.'
    : voice.mode === 'processing' ? 'Thinking about what you said…'
    : voice.mode === 'starting' ? 'Starting the offline microphone…'
    : voice.ready ? 'Select the microphone for an offline conversation.' : 'Select the microphone to check the offline voice setup.');
}
function stopVoice(error = '') {
  voice.active = false; voice.mode = 'off'; voice.lastError = error;
  voice.controller?.abort(); voice.controller = null;
  void api('/api/voice/stop', { method: 'POST', body: '{}' }).catch(() => {});
  updateVoiceUI();
}
async function voiceRequest(route, body = {}) {
  const controller = new AbortController(); voice.controller = controller;
  try { return await api(route, { method: 'POST', body: JSON.stringify(body), signal: controller.signal }); }
  finally { if (voice.controller === controller) voice.controller = null; }
}
async function speakText(text) {
  if (voice.active) stopVoice();
  try { await api('/api/voice/speak', { method: 'POST', body: JSON.stringify({ text }) }); }
  catch (error) { toast(error.message); }
}
async function runVoiceLoop() {
  try {
    const status = await api('/api/voice/status');
    if (!status.ready) throw new Error(status.reason || 'Install the offline voice model first.');
    voice.ready = true; voice.mode = 'greeting'; updateVoiceUI();
    const name = state.preferences?.assistant_name || "Jermi's Assistant";
    await voiceRequest('/api/voice/speak', { text: `Hello, I'm ${name}. How can I help you today?` });
    while (voice.active && state.view === 'assistant') {
      voice.mode = 'listening'; updateVoiceUI();
      const heard = await voiceRequest('/api/voice/listen');
      if (!voice.active) break;
      const message = String(heard.text || '').trim();
      if (!message) continue;
      if (/^(stop listening|goodbye|end conversation|stop voice)$/i.test(message)) { stopVoice(); break; }
      voice.mode = 'processing'; updateVoiceUI();
      const reply = await submitMessage(message);
      if (voice.active && reply) {
        voice.mode = 'speaking'; updateVoiceUI();
        await voiceRequest('/api/voice/speak', { text: reply });
      }
    }
  } catch (error) { if (voice.active) stopVoice(`Offline voice stopped: ${error.message}`); }
}
function toggleVoice() {
  if (voice.active) { stopVoice(); return; }
  voice.active = true; voice.mode = 'starting'; voice.lastError = ''; updateVoiceUI();
  void runVoiceLoop();
}
function renderSettings() {
  const prefs = state.preferences || { assistant_name: "Jermi's Assistant", persona: 'Executive Assistant', tone: 'Professional', language: 'English (US)' };
  const options = (kind, values, selected) => values.map(value => `<button type="button" class="preference-option ${value === selected ? 'active' : ''}" data-option="${kind}" data-value="${esc(value)}" aria-pressed="${value === selected}">${esc(value)}</button>`).join('');
  $('#main').innerHTML = `<div class="page">${pageHead('CONTROL CENTER', 'Settings', 'Set the tone for your assistant and manage local access.')}
    <section class="setting-card glass personalization-card"><div class="card-kicker">PERSONALIZE YOUR ASSISTANT</div><h3>Make it yours</h3><p>These preferences shape AI answers when a model is connected.</p><form id="preferences-form"><div class="field"><label for="assistant-name">Assistant name</label><input id="assistant-name" maxlength="30" required value="${esc(prefs.assistant_name)}"></div><div class="field"><label>Persona</label><div class="preference-options">${options('persona', ['Corporate Analyst','Project Manager','Executive Assistant','HR Advisor','Customer Success'], prefs.persona)}</div></div><div class="field"><label>Tone of voice</label><div class="preference-options">${options('tone', ['Professional','Friendly','Formal'], prefs.tone)}</div></div><div class="field"><label for="assistant-language">Language</label><select id="assistant-language">${['English (US)','English (UK)','French','Spanish'].map(language => `<option ${language === prefs.language ? 'selected' : ''}>${language}</option>`).join('')}</select></div><button class="button primary small" type="submit">Save changes</button></form></section>
    <section class="setting-card glass"><div class="card-kicker">CONVERSATION ENGINE</div><h3>${state.aiEnabled ? `${esc(state.aiProvider)} model connected` : 'Local search mode'}</h3><p>${state.aiEnabled ? "Jermi's Assistant can discuss retrieved file excerpts with source citations." : "Jermi's Assistant can find files and show extractive summaries. For richer conversation, connect a local Ollama model or set OPENAI_API_KEY."}</p></section>
    <section class="setting-card glass"><div class="card-kicker">VOICE CONVERSATION</div><h3>${voice.ready ? 'Offline voice ready' : 'Offline voice setup needed'}</h3><p>Select the microphone in chat to begin. The assistant greets you, listens through the PC microphone and an on-device speech model, speaks through Windows, and listens again until you stop it. Audio never passes through the browser or an internet speech service. ${voice.ready ? '' : 'Run the setup script described in the README, then reload this page.'}</p></section>
    <section class="setting-card glass"><div class="card-kicker">PRIVACY & ACCESS</div><h3>Files stay where they are</h3><p>Jermi's Assistant reads files from local drives and stores searchable text in its local data folder when you scan a folder. File changes happen only when you choose a specific action. If an external AI key is configured, relevant excerpts may be sent to that provider.</p></section>
    <section class="setting-card glass"><div class="card-kicker">POWER CONTROLS</div><h3>Shut down or restart this PC</h3><p>Each confirmed action gives you 60 seconds to cancel. Turning on a fully off PC requires firmware scheduling, Wake-on-LAN, or another powered device.</p><button id="shutdown-pc" class="button danger small">Schedule shutdown</button> <button id="restart-pc" class="button ghost small">Schedule restart</button> <button id="cancel-shutdown" class="button ghost small">Cancel power action</button></section>
    <section class="setting-card glass"><div class="card-kicker">ACCOUNT</div><h3>Local access</h3><p>Your password protects Jermi's Assistant on this computer.</p><button id="sign-out" class="button danger small">Sign out</button></section></div>`;
  $$('[data-option]').forEach(button => button.onclick = () => $$(`[data-option="${button.dataset.option}"]`).forEach(other => { other.classList.toggle('active', other === button); other.setAttribute('aria-pressed', String(other === button)); }));
  $('#preferences-form').onsubmit = async event => { event.preventDefault(); try {
    state.preferences = await api('/api/preferences', { method: 'PUT', body: JSON.stringify({ assistantName: $('#assistant-name').value.trim(), persona: $('[data-option="persona"].active')?.dataset.value, tone: $('[data-option="tone"].active')?.dataset.value, language: $('#assistant-language').value }) });
    renderSettings(); toast('Preferences saved.');
  } catch (err) { toast(err.message); } };
  $('#shutdown-pc').onclick = () => openPower('shutdown');
  $('#restart-pc').onclick = () => openPower('restart');
  $('#cancel-shutdown').onclick = async () => { try { await api('/api/pc/cancel-shutdown', { method: 'POST', body: '{}' }); toast('Scheduled power action cancelled.'); } catch (err) { toast(err.message); } };
  $('#sign-out').onclick = async () => { try { await api('/api/logout', { method: 'POST', body: '{}' }); location.reload(); } catch (err) { toast(err.message); } };
}
function openPower(mode) {
  const restart = mode === 'restart', phrase = restart ? 'RESTART' : 'SHUT DOWN', verb = restart ? 'restart' : 'shut down';
  showModal(`<div class="modal-head"><div><h2>${restart ? 'Restart' : 'Shut down'} this PC?</h2><p>Windows will ${verb} in 60 seconds. You can cancel from Settings before then.</p></div><button class="modal-close" aria-label="Close">×</button></div><form id="shutdown-form"><div class="field"><label for="shutdown-confirm">Type ${phrase} to confirm</label><input id="shutdown-confirm" autocomplete="off" required></div><div class="modal-actions"><button type="button" id="cancel-power" class="button ghost">Keep PC on</button><button class="button danger" type="submit">Schedule ${restart ? 'restart' : 'shutdown'}</button></div></form>`);
  $('#cancel-power').onclick = closeModal;
  $('#shutdown-form').onsubmit = async event => { event.preventDefault(); try {
    await api(`/api/pc/${mode}`, { method: 'POST', body: JSON.stringify({ confirm: $('#shutdown-confirm').value }) });
    closeModal(); toast(`${restart ? 'Restart' : 'Shutdown'} scheduled for 60 seconds from now.`);
  } catch (err) { toast(err.message); } };
  $('#shutdown-confirm').focus();
}
$('#auth-form').onsubmit = async event => { event.preventDefault(); $('#auth-error').textContent = '';
  try { const result = await api(`/api/${$('#auth-form').dataset.mode}`, { method: 'POST', body: JSON.stringify({ password: $('#password').value }) });
    state.csrf = result.csrf; $('#password').value = ''; await boot(); }
  catch (err) { $('#auth-error').textContent = err.message; } };
$$('[data-view]').forEach(button => button.onclick = () => selectView(button.dataset.view));
$('#sidebar-toggle').onclick = () => { const next = !$('.sidebar').classList.contains('collapsed'); localStorage.setItem('jermi-sidebar-collapsed', next ? '1' : '0'); updateSidebarCollapse(); };
updateSidebarCollapse();
$('#top-files').onclick = () => selectView('files');
$('#profile-button').onclick = () => selectView('settings');
$('#modal-backdrop').onclick = event => { if (event.target === $('#modal-backdrop')) closeModal(); };
document.onkeydown = event => { if (event.key === 'Escape' && !$('#modal-backdrop').classList.contains('hidden')) closeModal(); };
boot().catch(err => toast(err.message));
