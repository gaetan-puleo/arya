/** Login page served when there is no valid session. Posts to /login, then loads the dashboard. */
export const LOGIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Arya · Sign in</title>
<style>
  :root {
    --bg:#0b0b0d; --surface:#141416; --line:rgba(255,255,255,.09); --fg:#f1f1f2; --muted:#9a9aa0; --faint:#6a6a70;
    --accent:#f1f1f2; --accent-fg:#111113; --danger:#e5646c;
  }
  * { box-sizing:border-box; }
  html,body { height:100%; }
  body {
    margin:0; color:var(--fg); background:var(--bg);
    font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    -webkit-font-smoothing:antialiased;
    display:flex; align-items:center; justify-content:center; padding:24px;
  }
  .box { width:100%; max-width:360px; background:var(--surface); border:1px solid var(--line); border-radius:14px; padding:32px 30px 28px; }
  .brand { display:flex; align-items:center; gap:11px; margin-bottom:26px; }
  .mark { width:30px; height:30px; border-radius:8px; display:grid; place-items:center; background:var(--accent); color:var(--accent-fg); font-weight:700; font-size:15px; }
  .brand .name { font-size:15px; font-weight:600; letter-spacing:.2px; }
  h1 { font-size:18px; margin:0 0 3px; font-weight:600; }
  .sub { color:var(--muted); margin:0 0 22px; font-size:13px; }
  label { display:block; font-size:12px; font-weight:500; color:var(--muted); margin:14px 0 6px; }
  input { width:100%; padding:10px 12px; background:#0e0e10; border:1px solid var(--line); border-radius:9px; color:var(--fg); font:inherit; transition:border-color .15s; }
  input:focus { outline:none; border-color:rgba(255,255,255,.28); }
  button { margin-top:22px; width:100%; padding:11px; border:none; border-radius:9px; cursor:pointer; background:var(--accent); color:var(--accent-fg); font-weight:600; font-size:14px; transition:opacity .15s; }
  button:hover { opacity:.9; }
  .err { color:var(--danger); font-size:13px; margin-top:14px; min-height:18px; }
</style>
</head>
<body>
  <form class="box" id="f">
    <div class="brand"><div class="mark">A</div><div class="name">Arya</div></div>
    <h1>Sign in</h1>
    <p class="sub">Task board and sub-agent registry.</p>
    <label for="u">Username</label><input id="u" autocomplete="username" autofocus required />
    <label for="p">Password</label><input id="p" type="password" autocomplete="current-password" required />
    <div class="err" id="e"></div>
    <button type="submit">Sign in</button>
  </form>
<script>
document.getElementById('f').addEventListener('submit', function (ev) {
  ev.preventDefault();
  var e = document.getElementById('e'); e.textContent = '';
  var btn = ev.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Signing in…';
  fetch('/login', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: document.getElementById('u').value, password: document.getElementById('p').value }) })
    .then(function (r) { if (r.ok) { location.href = '/'; } else { e.textContent = 'Invalid username or password'; btn.disabled = false; btn.textContent = 'Sign in'; } })
    .catch(function () { e.textContent = 'Network error'; btn.disabled = false; btn.textContent = 'Sign in'; });
});
</script>
</body>
</html>`;

/**
 * The Arya admin dashboard — a single self-contained HTML document (vanilla JS,
 * no build step) served by the admin HTTP server. Auth is the session cookie set
 * by /login; the `/admin` WebSocket is gated by that same cookie. Kept as a
 * string so it bundles into the arya binary with no static-asset pipeline.
 *
 * Minimalist neutral theme: flat surfaces, hairline borders, one accent, color
 * reserved for small status dots. Full-height board, create form behind a FAB.
 */
export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Arya · Admin</title>
<style>
  :root {
    --bg:#0b0b0d; --surface:#141416; --surface2:#1a1a1d; --line:rgba(255,255,255,.09); --line2:rgba(255,255,255,.16);
    --fg:#f1f1f2; --muted:#9a9aa0; --faint:#6a6a70;
    --accent:#f1f1f2; --accent-fg:#111113; --danger:#e5646c; --ok:#5fb877;
    --backlog:#6b7280; --todo:#5b8def; --in_progress:#d9a441; --in_review:#9b7fd4; --done:#5fb877;
    --p-high:#d9a441; --p-urgent:#e5646c; --p-low:#6b7280;
    --radius:12px;
  }
  * { box-sizing:border-box; }
  html, body { height:100%; }
  body {
    margin:0; color:var(--fg); background:var(--bg);
    font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    -webkit-font-smoothing:antialiased;
    display:flex; flex-direction:column; height:100vh; height:100dvh; overflow:hidden;
  }
  ::selection { background:rgba(255,255,255,.18); }

  /* Header */
  header { flex:0 0 auto; display:flex; align-items:center; gap:14px; padding:13px 20px; border-bottom:1px solid var(--line); }
  .brand { display:flex; align-items:center; gap:10px; }
  .mark { width:26px; height:26px; border-radius:7px; display:grid; place-items:center; background:var(--accent); color:var(--accent-fg); font-weight:700; font-size:14px; }
  .brand .name { font-size:14px; font-weight:600; letter-spacing:.2px; }
  .grow { flex:1; }
  .pill { display:inline-flex; align-items:center; gap:7px; padding:5px 10px; border-radius:999px; border:1px solid var(--line); font-size:12px; color:var(--muted); font-weight:500; }
  .dot { width:7px; height:7px; border-radius:50%; background:var(--danger); }
  .dot.on { background:var(--ok); }
  .seg { display:inline-flex; border:1px solid var(--line); border-radius:9px; padding:2px; gap:2px; }
  .tab { padding:6px 14px; border:none; border-radius:7px; background:transparent; color:var(--muted); font:inherit; font-weight:500; font-size:13px; cursor:pointer; transition:color .15s, background .15s; }
  .tab:hover { color:var(--fg); }
  .tab.active { background:var(--surface2); color:var(--fg); }
  .iconbtn { width:32px; height:32px; border-radius:8px; border:1px solid var(--line); background:transparent; color:var(--muted); cursor:pointer; display:grid; place-items:center; transition:color .15s, border-color .15s; }
  .iconbtn:hover { color:var(--fg); border-color:var(--line2); }

  /* Main / views — full height */
  main { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; padding:18px 20px; }
  .view { flex:1 1 auto; min-height:0; display:flex; flex-direction:column; }
  .view.hidden { display:none; }

  /* Board */
  .board { flex:1 1 auto; min-height:0; display:grid; grid-template-columns:repeat(5,minmax(220px,1fr)); grid-template-rows:minmax(0,1fr); gap:12px; }
  .col { background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); padding:0; min-height:0; overflow-y:auto; overscroll-behavior-y:contain; overscroll-behavior-x:auto; scrollbar-gutter:stable; }
  .col-head { position:sticky; top:0; z-index:2; display:flex; align-items:center; gap:8px; padding:11px 13px; margin:0; background:var(--surface); border-bottom:1px solid var(--line); }
  .col-head .cdot { width:8px; height:8px; border-radius:50%; background:var(--sc); }
  .col-head h2 { font-size:12px; text-transform:uppercase; letter-spacing:.6px; color:var(--fg); margin:0; font-weight:600; }
  .col-head .count { margin-left:auto; font-size:11px; font-weight:600; color:var(--faint); }
  .cards { display:flex; flex-direction:column; gap:8px; padding:10px 12px 12px; }

  .card { position:relative; background:var(--surface2); border:1px solid var(--line); border-radius:10px; padding:11px 12px; transition:border-color .12s ease; }
  .card:hover { border-color:var(--line2); }
  .card .t { font-weight:500; font-size:13.5px; margin-bottom:7px; word-break:break-word; }
  .card .meta { display:flex; gap:7px; flex-wrap:wrap; align-items:center; color:var(--muted); font-size:11.5px; }
  .badge { display:inline-flex; align-items:center; gap:5px; font-weight:600; font-size:10.5px; letter-spacing:.3px; text-transform:uppercase; color:var(--muted); }
  .badge::before { content:''; width:6px; height:6px; border-radius:50%; background:var(--pc,transparent); }
  .who { display:inline-flex; align-items:center; gap:4px; }
  .mv { display:flex; gap:6px; margin-top:10px; }
  .mv button { flex:1; padding:5px; border:1px solid var(--line); background:transparent; color:var(--faint); border-radius:7px; cursor:pointer; font-size:12px; transition:color .12s, border-color .12s; }
  .mv button:hover:not(:disabled) { color:var(--fg); border-color:var(--line2); }
  .mv button.del:hover:not(:disabled) { color:var(--danger); border-color:var(--danger); }
  .mv button:disabled { opacity:.25; cursor:default; }

  /* Agents */
  .agents { flex:1 1 auto; min-height:0; overflow-y:auto; display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:10px; align-content:start; }
  .agent { display:flex; align-items:flex-start; gap:12px; padding:13px; border:1px solid var(--line); border-radius:10px; background:var(--surface); transition:border-color .12s; }
  .agent:hover { border-color:var(--line2); }
  .swatch { width:30px; height:30px; border-radius:8px; flex:none; display:grid; place-items:center; color:#fff; font-weight:700; font-size:13px; }
  .agent .info { min-width:0; flex:1; }
  .agent .an { font-weight:600; font-size:14px; }
  .agent .d { color:var(--muted); font-size:12.5px; margin-top:2px; word-break:break-word; }
  .agent .del { margin-left:auto; color:var(--faint); background:none; border:none; cursor:pointer; font-size:15px; padding:2px 4px; border-radius:6px; }
  .agent .del:hover { color:var(--danger); }

  /* Sessions: list + chat */
  .sessions { flex:1 1 auto; min-height:0; display:grid; grid-template-columns:260px 1fr; gap:12px; }
  .sess-list { display:flex; flex-direction:column; min-height:0; border:1px solid var(--line); border-radius:12px; background:var(--surface); }
  .sess-list-head { display:flex; align-items:center; justify-content:space-between; padding:11px 13px; border-bottom:1px solid var(--line); font-size:12px; text-transform:uppercase; letter-spacing:.6px; color:var(--muted); font-weight:600; }
  .btn-mini { padding:4px 10px; border:1px solid var(--line); background:transparent; color:var(--fg); border-radius:7px; cursor:pointer; font:inherit; font-size:12px; font-weight:600; }
  .btn-mini:hover { border-color:var(--line2); }
  .sess-items { flex:1; overflow-y:auto; padding:8px; display:flex; flex-direction:column; gap:6px; }
  .sess-item { text-align:left; padding:10px 11px; border:1px solid var(--line); border-radius:9px; background:transparent; cursor:pointer; color:var(--fg); display:flex; flex-direction:column; gap:3px; transition:border-color .12s; }
  .sess-item:hover { border-color:var(--line2); }
  .sess-item.active { border-color:var(--fg); }
  .sess-item .st { font-weight:600; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .sess-item .sm { color:var(--muted); font-size:11.5px; }
  .sess-search { padding:8px 8px 0; }
  .sess-search input { width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid var(--line); border-radius:8px; background:transparent; color:var(--fg); font-size:12.5px; }
  .sess-search input:focus { outline:none; border-color:var(--line2); }
  .sess-item .snip { color:var(--muted); font-size:11.5px; line-height:1.35; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .sess-chat { display:flex; flex-direction:column; min-height:0; border:1px solid var(--line); border-radius:12px; background:var(--surface); }
  .sess-chat-head { display:flex; align-items:center; gap:8px; padding:11px 13px; border-bottom:1px solid var(--line); font-weight:600; font-size:13px; }
  .skill-suggest { display:flex; align-items:flex-start; gap:8px; padding:9px 13px; background:rgba(59,130,246,.08); border-bottom:1px solid var(--line); font-size:12.5px; line-height:1.4; color:var(--fg); }
  .skill-suggest.hidden { display:none; }
  .skill-suggest .ss-icon { flex:none; }
  .skill-suggest .ss-close { margin-left:auto; flex:none; background:transparent; border:none; color:var(--muted); cursor:pointer; font-size:13px; padding:0 2px; }
  .skill-suggest .ss-close:hover { color:var(--fg); }
  .sess-chat-head .back { display:none; width:26px; height:26px; font-size:18px; padding:0; }
  .chat-log { flex:1; overflow-y:auto; padding:14px; display:flex; flex-direction:column; gap:10px; }
  .msg { max-width:82%; padding:9px 12px; border-radius:12px; font-size:13.5px; line-height:1.5; white-space:pre-wrap; word-break:break-word; }
  .msg.user { align-self:flex-end; background:var(--accent); color:var(--accent-fg); border-bottom-right-radius:4px; }
  .msg.assistant { align-self:flex-start; background:var(--surface2); border:1px solid var(--line); border-bottom-left-radius:4px; }
  .msg.system { align-self:center; color:var(--faint); font-size:12px; }
  .typing { align-self:flex-start; color:var(--muted); font-size:12.5px; font-style:italic; }
  .chat-form { display:flex; gap:8px; padding:12px; border-top:1px solid var(--line); }
  .chat-form input { flex:1; }
  .btn-send { width:42px; flex:none; border:none; border-radius:9px; background:var(--accent); color:var(--accent-fg); cursor:pointer; display:grid; place-items:center; }
  .btn-send:hover { opacity:.9; }

  .empty { color:var(--faint); font-size:12.5px; padding:16px 8px; text-align:center; }

  /* Floating action button */
  .fab { position:fixed; right:20px; bottom:20px; z-index:40; display:inline-flex; align-items:center; gap:8px; padding:12px 18px; border:none; border-radius:999px; cursor:pointer; background:var(--accent); color:var(--accent-fg); font:inherit; font-weight:600; font-size:13.5px; transition:opacity .15s; }
  .fab:hover { opacity:.9; }
  .fab svg { width:17px; height:17px; }

  /* Modal */
  .modal { position:fixed; inset:0; z-index:100; display:flex; align-items:center; justify-content:center; padding:18px; }
  .modal.hidden { display:none; }
  .modal-backdrop { position:absolute; inset:0; background:rgba(0,0,0,.6); }
  .modal-card { position:relative; width:100%; max-width:460px; max-height:90dvh; overflow:auto; background:var(--surface); border:1px solid var(--line2); border-radius:14px; }
  .modal-head { display:flex; align-items:center; padding:15px 18px; border-bottom:1px solid var(--line); }
  .modal-head h3 { margin:0; font-size:14px; font-weight:600; }
  .modal-x { margin-left:auto; width:28px; height:28px; border-radius:7px; border:1px solid var(--line); background:transparent; color:var(--muted); cursor:pointer; display:grid; place-items:center; }
  .modal-x:hover { color:var(--fg); border-color:var(--line2); }
  .modal-body { padding:18px; }
  .field { display:flex; flex-direction:column; gap:6px; margin-bottom:14px; }
  .field:last-child { margin-bottom:0; }
  label { font-size:11.5px; font-weight:500; color:var(--muted); }
  input, select, textarea { padding:10px 12px; background:#0e0e10; border:1px solid var(--line); border-radius:9px; color:var(--fg); font:inherit; transition:border-color .15s; width:100%; }
  input:focus, select:focus, textarea:focus { outline:none; border-color:rgba(255,255,255,.28); }
  textarea { min-height:120px; resize:vertical; line-height:1.55; }
  select { appearance:none; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%239a9aa0' stroke-width='2'%3E%3Cpath d='M2 4l4 4 4-4'/%3E%3C/svg%3E"); background-repeat:no-repeat; background-position:right 12px center; padding-right:32px; }
  .grid3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; }
  .btn { padding:11px 18px; border:none; border-radius:9px; cursor:pointer; font:inherit; font-weight:600; font-size:13.5px; background:var(--accent); color:var(--accent-fg); width:100%; margin-top:4px; transition:opacity .15s; }
  .btn:hover { opacity:.9; }

  .toast { position:fixed; bottom:20px; right:20px; padding:11px 15px; border-radius:10px; z-index:120; background:var(--surface2); border:1px solid var(--line2); color:var(--fg); font-weight:500; font-size:13px; opacity:0; transform:translateY(10px); transition:opacity .2s, transform .2s; max-width:360px; }
  .toast.show { opacity:1; transform:translateY(0); }
  .toast.err { border-color:var(--danger); }
  .hidden { display:none; }

  /* Scrollbars */
  .col, .agents { scrollbar-width:thin; scrollbar-color:rgba(255,255,255,.12) transparent; }
  .col::-webkit-scrollbar, .agents::-webkit-scrollbar { width:10px; }
  .col::-webkit-scrollbar-track, .agents::-webkit-scrollbar-track { background:transparent; }
  .col::-webkit-scrollbar-thumb, .agents::-webkit-scrollbar-thumb { background:rgba(255,255,255,.10); border-radius:999px; border:3px solid transparent; background-clip:padding-box; }
  .col::-webkit-scrollbar-thumb:hover, .agents::-webkit-scrollbar-thumb:hover { background:rgba(255,255,255,.2); background-clip:padding-box; }

  /* Responsive */
  @media (max-width:1180px) {
    .board { display:flex; gap:12px; overflow-x:auto; -webkit-overflow-scrolling:touch; padding-bottom:10px; scrollbar-width:thin; }
    .col { flex:0 0 320px; }
    .board::-webkit-scrollbar { height:10px; }
    .board::-webkit-scrollbar-thumb { background:rgba(255,255,255,.12); border-radius:999px; border:3px solid transparent; background-clip:padding-box; }
  }
  @media (max-width:720px) {
    header { padding:10px 14px; gap:10px; flex-wrap:wrap; }
    .brand { order:1; flex:1 1 auto; min-width:0; }
    #conn { order:2; }
    #logout { order:3; }
    .grow { display:none; }
    .seg { order:4; flex:1 1 100%; margin-top:4px; }
    .tab { flex:1; text-align:center; padding:9px 10px; }
    main { padding:12px 14px; }
    .board { padding:0 14px 10px; margin:0 -14px; }
    .col { flex:0 0 84%; }
    .mv button { padding:10px; font-size:13px; }
    .agents { grid-template-columns:1fr; }
    .grid3 { grid-template-columns:1fr; }
    .sessions { grid-template-columns:1fr; }
    .sessions:not(.chat-open) .sess-chat { display:none; }
    .sessions.chat-open .sess-list { display:none; }
    .sess-chat-head .back { display:grid; }
    .modal { padding:14px; align-items:flex-end; }
    .modal-card { max-width:none; border-radius:14px 14px 0 0; }
    .toast { left:14px; right:14px; bottom:84px; max-width:none; }
  }
  @media (max-width:420px) {
    .col { flex:0 0 88%; }
  }
</style>
</head>
<body>
<header>
  <div class="brand">
    <div class="mark">A</div>
    <div class="name">Arya</div>
  </div>
  <span id="conn" class="pill"><span id="dot" class="dot"></span><span id="connText">connecting…</span></span>
  <span class="grow"></span>
  <div class="seg">
    <button class="tab active" data-view="board">Kanban</button>
    <button class="tab" data-view="agents">Sub-agents</button>
    <button class="tab" data-view="sessions">Sessions</button>
  </div>
  <button class="iconbtn" id="logout" title="Sign out" aria-label="Sign out">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
  </button>
</header>
<main>
  <section id="view-board" class="view">
    <div class="board" id="board"></div>
  </section>
  <section id="view-agents" class="view hidden">
    <div class="agents" id="agents"></div>
  </section>

  <section id="view-sessions" class="view hidden">
    <div class="sessions" id="sessions">
      <aside class="sess-list">
        <div class="sess-list-head"><span>Sessions</span><button id="sessNew" class="btn-mini">+ New</button></div>
        <div class="sess-search"><input id="sessSearch" placeholder="Search sessions…" autocomplete="off" /></div>
        <div id="sessItems" class="sess-items"><div class="empty">Loading…</div></div>
      </aside>
      <div class="sess-chat">
        <div class="sess-chat-head">
          <button id="sessBack" class="iconbtn back" aria-label="Back">‹</button>
          <span id="sessTitle">No session selected</span>
        </div>
        <div id="skillSuggest" class="skill-suggest hidden">
          <span class="ss-icon">💡</span>
          <span id="skillSuggestText"></span>
          <button id="skillSuggestDismiss" class="ss-close" aria-label="Dismiss">✕</button>
        </div>
        <div id="chatLog" class="chat-log"><div class="empty">Select or create a session to chat with arya.</div></div>
        <form id="chatForm" class="chat-form hidden">
          <input id="chatInput" placeholder="Message arya…" autocomplete="off" />
          <button class="btn-send" type="submit" aria-label="Send">➤</button>
        </form>
      </div>
    </div>
  </section>
</main>

<button class="fab" id="fab" aria-label="Add">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
  <span id="fabLabel">Add task</span>
</button>

<div class="modal hidden" id="modal" role="dialog" aria-modal="true">
  <div class="modal-backdrop" data-close></div>
  <div class="modal-card">
    <div class="modal-head"><h3 id="modalTitle">New task</h3><button class="modal-x" data-close aria-label="Close">✕</button></div>
    <div class="modal-body">
      <form id="newTask">
        <div class="field"><label for="nt-title">Task</label><input id="nt-title" placeholder="What needs doing?" required /></div>
        <div class="grid3">
          <div class="field"><label for="nt-status">Status</label>
            <select id="nt-status"><option value="backlog">Backlog</option><option value="todo" selected>To do</option><option value="in_progress">In progress</option><option value="in_review">In review</option><option value="done">Done</option></select>
          </div>
          <div class="field"><label for="nt-priority">Priority</label>
            <select id="nt-priority"><option value="low">Low</option><option value="normal" selected>Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select>
          </div>
          <div class="field"><label for="nt-assignee">Assignee</label><input id="nt-assignee" placeholder="arya" /></div>
        </div>
        <button class="btn" type="submit">Add task</button>
      </form>
      <form id="newAgent" class="hidden">
        <div class="field"><label for="ag-name">Name</label><input id="ag-name" placeholder="researcher" required /></div>
        <div class="field"><label for="ag-color">Color</label><input id="ag-color" placeholder="#5b8def" /></div>
        <div class="field"><label for="ag-desc">Description</label><input id="ag-desc" placeholder="What is this sub-agent for?" /></div>
        <div class="field"><label for="ag-prompt">System prompt</label><textarea id="ag-prompt" placeholder="You are a focused sub-agent that…"></textarea></div>
        <button class="btn" type="submit">Create sub-agent</button>
      </form>
    </div>
  </div>
</div>

<div id="toast" class="toast"></div>
<script>
(function () {
  var COLS = ['backlog','todo','in_progress','in_review','done'];
  var LABEL = { backlog:'Backlog', todo:'To do', in_progress:'In progress', in_review:'In review', done:'Done' };
  var PCOLOR = { low:'var(--p-low)', normal:'', high:'var(--p-high)', urgent:'var(--p-urgent)' };
  var tasks = [];
  var currentView = 'board';
  var ws, reconnectDelay = 800;

  function toast(msg, isErr) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.className = 'toast show' + (isErr ? ' err' : '');
    setTimeout(function () { t.className = 'toast'; }, 3200);
  }
  function esc(s) { return (s==null?'':String(s)).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

  function connect() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/admin');
    ws.onopen = function () {
      document.getElementById('dot').className = 'dot on';
      document.getElementById('connText').textContent = 'live';
      ws.send(JSON.stringify({ type: 'tasks:list' }));
      ws.send(JSON.stringify({ type: 'agents:list' }));
      reconnectDelay = 800;
    };
    ws.onclose = function () {
      document.getElementById('dot').className = 'dot';
      document.getElementById('connText').textContent = 'offline';
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 8000);
    };
    ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === 'tasks:list') { tasks = m.tasks || []; renderBoard(); }
      else if (m.type === 'task_event') { upsertTask(m.event); }
      else if (m.type === 'agents:list') { renderAgents(m.agents || []); }
      else if (m.type === 'agent:created') { toast('Sub-agent "' + m.name + '" created'); ws.send(JSON.stringify({ type:'agents:list' })); }
      else if (m.type === 'agent:deleted') { toast('Sub-agent deleted'); ws.send(JSON.stringify({ type:'agents:list' })); }
      else if (m.type === 'error') { toast(m.message, true); }
    };
  }

  function upsertTask(e) {
    var i = tasks.findIndex(function (t) { return t.id === e.task.id; });
    if (e.type === 'removed') { if (i >= 0) tasks.splice(i, 1); }
    else if (i >= 0) tasks[i] = e.task; else tasks.push(e.task);
    renderBoard();
  }

  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

  function renderBoard() {
    var board = document.getElementById('board');
    board.innerHTML = COLS.map(function (c) {
      var items = tasks.filter(function (t) { return t.status === c; });
      var cards = items.map(function (t) { return card(t); }).join('');
      return '<div class="col" style="--sc:var(--' + c + ')">' +
        '<div class="col-head"><span class="cdot"></span>' +
        '<h2>' + LABEL[c] + '</h2><span class="count">' + items.length + '</span></div>' +
        '<div class="cards">' + (cards || '<div class="empty">Empty</div>') + '</div></div>';
    }).join('');
  }

  function card(t) {
    var idx = COLS.indexOf(t.status);
    var pc = PCOLOR[t.priority] || '';
    var pbadge = t.priority && t.priority !== 'normal' ? '<span class="badge" style="--pc:' + pc + '">' + t.priority + '</span>' : '';
    var who = t.assignee ? '<span class="who">@' + esc(t.assignee) + '</span>' : '';
    return '<div class="card">' +
      '<div class="t">' + esc(t.title) + '</div>' +
      ((pbadge || who) ? '<div class="meta">' + pbadge + who + '</div>' : '') +
      '<div class="mv">' +
        '<button ' + (idx <= 0 ? 'disabled' : '') + ' title="Move left" onclick="AryaMove(\\'' + t.id + '\\',' + (idx - 1) + ')">◀</button>' +
        '<button class="del" title="Delete" onclick="AryaDel(\\'' + t.id + '\\')">✕</button>' +
        '<button ' + (idx >= COLS.length - 1 ? 'disabled' : '') + ' title="Move right" onclick="AryaMove(\\'' + t.id + '\\',' + (idx + 1) + ')">▶</button>' +
      '</div></div>';
  }

  window.AryaMove = function (id, colIdx) {
    if (colIdx < 0 || colIdx >= COLS.length) return;
    send({ type: 'task:move', id: id, status: COLS[colIdx] });
  };
  window.AryaDel = function (id) {
    if (confirm('Delete this task?')) send({ type: 'task:remove', id: id });
  };

  function renderAgents(list) {
    var el = document.getElementById('agents');
    if (!list.length) { el.innerHTML = '<div class="empty">No sub-agents yet.</div>'; return; }
    el.innerHTML = list.map(function (a) {
      var color = a.color || '#5b8def';
      var initial = esc((a.name || '?').charAt(0).toUpperCase());
      return '<div class="agent">' +
        '<span class="swatch" style="background:' + esc(color) + '">' + initial + '</span>' +
        '<div class="info"><div class="an">' + esc(a.name) + '</div><div class="d">' + esc(a.description) + '</div></div>' +
        '<button class="del" title="Delete" onclick="AryaDelAgent(\\'' + esc(a.file) + '\\',\\'' + esc(a.name) + '\\')">✕</button>' +
        '</div>';
    }).join('');
  }

  window.AryaDelAgent = function (file, name) {
    if (confirm('Delete sub-agent "' + name + '"?')) send({ type: 'agent:delete', file: file });
  };

  /* Modal */
  function openModal(view) {
    currentView = view || currentView;
    document.getElementById('newTask').classList.toggle('hidden', currentView !== 'board');
    document.getElementById('newAgent').classList.toggle('hidden', currentView !== 'agents');
    document.getElementById('modalTitle').textContent = currentView === 'agents' ? 'New sub-agent' : 'New task';
    document.getElementById('modal').classList.remove('hidden');
    var f = currentView === 'agents' ? document.getElementById('ag-name') : document.getElementById('nt-title');
    setTimeout(function () { if (f) f.focus(); }, 60);
  }
  function closeModal() { document.getElementById('modal').classList.add('hidden'); }

  document.getElementById('fab').addEventListener('click', function () { openModal(currentView); });
  document.querySelectorAll('[data-close]').forEach(function (el) { el.addEventListener('click', closeModal); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  document.getElementById('newTask').addEventListener('submit', function (e) {
    e.preventDefault();
    send({ type: 'task:create',
      title: document.getElementById('nt-title').value,
      status: document.getElementById('nt-status').value,
      priority: document.getElementById('nt-priority').value,
      assignee: document.getElementById('nt-assignee').value });
    this.reset();
    closeModal();
  });

  document.getElementById('newAgent').addEventListener('submit', function (e) {
    e.preventDefault();
    send({ type: 'agent:create',
      name: document.getElementById('ag-name').value,
      color: document.getElementById('ag-color').value,
      description: document.getElementById('ag-desc').value,
      prompt: document.getElementById('ag-prompt').value });
    this.reset();
    closeModal();
  });

  /* ---- Sessions + chat (connects to the main chat WS) ---- */
  var chat = { ws: null, ready: false, activeId: null, transcript: [], liveText: '', streaming: false };

  function chatSend(o) { if (chat.ws && chat.ws.readyState === 1) chat.ws.send(JSON.stringify(o)); }
  function setSessItems(html) { document.getElementById('sessItems').innerHTML = html; }

  function chatConnect() {
    if (chat.ws) return;
    fetch('/admin/chat-config', { headers: { 'accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (cfg) {
        if (!cfg || !cfg.port) { setSessItems('<div class="empty">Chat not configured.</div>'); return; }
        var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        var url = proto + '//' + location.hostname + ':' + cfg.port + '/?token=' + encodeURIComponent(cfg.token || '');
        var ws = new WebSocket(url);
        chat.ws = ws;
        ws.onopen = function () { chat.ready = true; chatSend({ type: 'sessions:list' }); };
        ws.onclose = function () { chat.ready = false; chat.ws = null; setTimeout(chatConnect, 1500); };
        ws.onmessage = function (ev) { var m; try { m = JSON.parse(ev.data); } catch (e) { return; } chatOn(m); };
      })
      .catch(function () { setSessItems('<div class="empty">Could not load chat config.</div>'); });
  }

  function chatOn(m) {
    if (m.type === 'sessions:listed') { renderSessions(m.sessions || []); }
    else if (m.type === 'sessions:search:results') { renderSearchResults(m.results || [], m.query || ''); }
    else if (m.type === 'sessions:changed') { if (m.kind === 'deleted' && m.sessionId === chat.activeId) closeChat(); chatSend({ type: 'sessions:list' }); }
    else if (m.type === 'sessions:history') { if (m.sessionId === chat.activeId) loadHistory(m.session); }
    else if (m.type === 'turn_start') { if (m.sessionId === chat.activeId) { chat.streaming = true; chat.liveText = ''; renderChat(); } }
    else if (m.type === 'stream') { if (m.sessionId === chat.activeId) { chat.liveText += (m.text || ''); renderChat(); } }
    else if (m.type === 'turn_end') { if (m.sessionId === chat.activeId) { if (chat.liveText) chat.transcript.push({ role: 'assistant', content: chat.liveText }); chat.liveText = ''; chat.streaming = false; renderChat(); } }
    else if (m.type === 'message') { if (m.sessionId === chat.activeId && m.message && m.message.role === 'assistant' && !chat.streaming && m.message.content) { chat.transcript.push({ role: 'assistant', content: m.message.content }); renderChat(); } }
    else if (m.type === 'skill:suggestion') { if (m.sessionId === chat.activeId) showSkillSuggestion(m); }
    else if (m.type === 'error') { if (!m.sessionId || m.sessionId === chat.activeId) { toast(m.message || 'chat error', true); chat.streaming = false; renderChat(); } }
  }

  function showSkillSuggestion(m) {
    var el = document.getElementById('skillSuggest');
    var txt = document.getElementById('skillSuggestText');
    var label = m.kind === 'improve'
      ? ('Skill “' + (m.skill || '') + '” could be refined — ' + (m.reason || ''))
      : (m.reason || 'This task could be captured as a reusable skill.');
    txt.textContent = label;
    el.classList.remove('hidden');
  }
  function hideSkillSuggestion() { document.getElementById('skillSuggest').classList.add('hidden'); }

  function renderSessions(list) {
    var el = document.getElementById('sessItems');
    if (!list.length) { el.innerHTML = '<div class="empty">No sessions yet. Tap “+ New”.</div>'; return; }
    el.innerHTML = list.map(function (s) {
      var title = s.title || s.id;
      var when = s.updatedAt ? new Date(s.updatedAt).toLocaleString() : '';
      var active = s.id === chat.activeId ? ' active' : '';
      return '<button class="sess-item' + active + '" onclick="AryaSelectSession(\\'' + esc(s.id) + '\\')">' +
        '<span class="st">' + esc(title) + '</span>' +
        '<span class="sm">' + (s.messageCount || 0) + ' msg · ' + esc(when) + '</span>' +
        '</button>';
    }).join('');
  }

  function renderSearchResults(results, query) {
    var el = document.getElementById('sessItems');
    if (!query) { chatSend({ type: 'sessions:list' }); return; }
    if (!results.length) { el.innerHTML = '<div class="empty">No match for “' + esc(query) + '”.</div>'; return; }
    el.innerHTML = results.map(function (r) {
      var active = r.id === chat.activeId ? ' active' : '';
      return '<button class="sess-item' + active + '" onclick="AryaSelectSession(\\'' + esc(r.id) + '\\')">' +
        '<span class="st">' + esc(r.title || r.id) + '</span>' +
        '<span class="snip">' + esc(r.snippet) + '</span>' +
        '<span class="sm">' + r.matches + ' match' + (r.matches > 1 ? 'es' : '') + '</span>' +
        '</button>';
    }).join('');
  }

  function loadHistory(session) {
    chat.transcript = [];
    if (session && session.messages) {
      session.messages.forEach(function (msg) {
        if ((msg.role === 'user' || msg.role === 'assistant') && msg.content) chat.transcript.push({ role: msg.role, content: msg.content });
      });
    }
    renderChat();
  }

  function renderChat() {
    var log = document.getElementById('chatLog');
    var html = chat.transcript.map(function (m) { return '<div class="msg ' + m.role + '">' + esc(m.content) + '</div>'; }).join('');
    if (chat.streaming) html += (chat.liveText ? '<div class="msg assistant">' + esc(chat.liveText) + '</div>' : '<div class="typing">arya is thinking…</div>');
    log.innerHTML = html || '<div class="empty">No messages yet.</div>';
    log.scrollTop = log.scrollHeight;
  }

  function selectSession(id) {
    chat.activeId = id; chat.transcript = []; chat.liveText = ''; chat.streaming = false;
    hideSkillSuggestion();
    document.getElementById('sessions').classList.add('chat-open');
    document.getElementById('sessTitle').textContent = 'Session';
    document.getElementById('chatForm').classList.remove('hidden');
    chatSend({ type: 'sessions:get', sessionId: id });
    document.querySelectorAll('.sess-item').forEach(function (el) { el.classList.remove('active'); });
    setTimeout(function () { document.getElementById('chatInput').focus(); }, 50);
  }
  window.AryaSelectSession = function (id) { selectSession(id); };

  function closeChat() {
    chat.activeId = null; chat.transcript = []; chat.liveText = ''; chat.streaming = false;
    hideSkillSuggestion();
    document.getElementById('sessions').classList.remove('chat-open');
    document.getElementById('sessTitle').textContent = 'No session selected';
    document.getElementById('chatForm').classList.add('hidden');
    document.getElementById('chatLog').innerHTML = '<div class="empty">Select or create a session to chat with arya.</div>';
  }

  document.getElementById('sessNew').addEventListener('click', function () {
    var id = 'sess-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    chatSend({ type: 'sessions:create', sessionId: id, title: 'New session' });
    selectSession(id);
    chatSend({ type: 'sessions:list' });
  });
  document.getElementById('sessBack').addEventListener('click', function () { closeChat(); });
  document.getElementById('skillSuggestDismiss').addEventListener('click', function () { hideSkillSuggestion(); });

  var searchSeq = 0, searchTimer = null;
  document.getElementById('sessSearch').addEventListener('input', function (e) {
    var q = (e.target.value || '').trim();
    if (searchTimer) clearTimeout(searchTimer);
    if (!q) { chatSend({ type: 'sessions:list' }); return; }
    searchTimer = setTimeout(function () {
      chatSend({ type: 'sessions:search', requestId: 'srch-' + (++searchSeq), query: q });
    }, 250);
  });
  document.getElementById('chatForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = document.getElementById('chatInput');
    var text = input.value.trim();
    if (!text || !chat.activeId) return;
    chat.transcript.push({ role: 'user', content: text });
    chatSend({ type: 'chat', sessionId: chat.activeId, text: text });
    input.value = '';
    renderChat();
  });

  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      var v = tab.getAttribute('data-view');
      currentView = v;
      document.getElementById('fabLabel').textContent = v === 'agents' ? 'New agent' : 'Add task';
      document.getElementById('fab').classList.toggle('hidden', v === 'sessions');
      document.getElementById('view-board').classList.toggle('hidden', v !== 'board');
      document.getElementById('view-agents').classList.toggle('hidden', v !== 'agents');
      document.getElementById('view-sessions').classList.toggle('hidden', v !== 'sessions');
      if (v === 'sessions') chatConnect();
    });
  });

  document.getElementById('logout').addEventListener('click', function () {
    fetch('/logout', { method: 'POST' }).then(function () { location.href = '/login'; });
  });

  connect();
})();
</script>
</body>
</html>`;
