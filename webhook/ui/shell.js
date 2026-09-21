// The single-page-app shell: one static HTML document (inline CSS + browser JS)
// that boots the polling UI. The browser script is embedded as a template
// literal, so it deliberately avoids backticks and ${...} in its own code.

export function htmlShell() {
    const uiUrl = (process.env["OBELISK_UI_URL"] || "http://localhost:8080").replace(/\/$/, "");
    return new Response(SHELL_HTML.replace("__OBELISK_UI_URL__", uiUrl), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, max-age=0" },
    });
}

const SHELL_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agent-template</title>
<style>
  :root {
    --bg:#fafafa; --panel:#fff; --line:#e5e5e5; --muted:#777;
    --accent:#2868c8; --accent-bg:#eef3fb; --ok:#2a7a3a; --ok-bg:#ebf6ee;
    --err:#b32626; --err-bg:#fcecec; --warn:#965c00;
  }
  * { box-sizing:border-box; }
  html,body { height:100%; margin:0; }
  body { font:14px/1.45 -apple-system, system-ui, sans-serif; color:#1d1d1f; background:var(--bg); display:flex; }
  aside { width:290px; border-right:1px solid var(--line); background:var(--panel); display:flex; flex-direction:column; }
  aside header { padding:1rem; border-bottom:1px solid var(--line); }
  aside header h1 { margin:0 0 .6rem; font-size:1rem; font-weight:600; }
  #new-convo { width:100%; padding:.55em .9em; font:inherit; font-weight:600; cursor:pointer; border:1px solid var(--accent); background:var(--accent); color:#fff; border-radius:4px; }
  #new-convo:hover { background:#1f57ad; }
  #runs { flex:1; overflow-y:auto; }
  .run { padding:.6rem 1rem; border-bottom:1px solid var(--line); cursor:pointer; }
  .run:hover { background:var(--accent-bg); }
  .run.active { background:var(--accent-bg); border-left:3px solid var(--accent); padding-left:calc(1rem - 3px); }
  .run .title { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .run .meta { color:var(--muted); font-size:.8em; margin-top:.2em; display:flex; justify-content:space-between; gap:.5em; }
  .chip { font-size:.72em; font-weight:600; padding:.1em .5em; border-radius:10px; background:#eee; color:#555; }
  .chip.working { background:#fff3e0; color:var(--warn); }
  .chip.awaiting { background:var(--accent-bg); color:var(--accent); }
  .chip.finished { background:var(--ok-bg); color:var(--ok); }
  .chip.err { background:var(--err-bg); color:var(--err); }
  main { flex:1; display:flex; flex-direction:column; overflow:hidden; }
  .detail-head { padding:.8rem 2rem; border-bottom:1px solid var(--line); background:var(--panel); display:flex; align-items:center; gap:.7em; }
  .detail-head .id { font-family:ui-monospace, monospace; font-size:.82em; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .detail-head .id a { color:var(--accent); text-decoration:none; }
  .detail-head .id a:hover { text-decoration:underline; }
  .detail-head .spacer { flex:1; }
  .detail-head button { padding:.35em .8em; font:inherit; cursor:pointer; border:1px solid var(--line); background:var(--panel); border-radius:4px; }
  .detail-head button.danger { color:var(--err); border-color:var(--err); }
  .detail-head button.danger:hover { background:var(--err-bg); }
  #detail { flex:1; overflow-y:auto; }
  #detail-body { padding:1rem 2rem 2rem; max-width:60rem; }
  .msg { margin:0 0 1rem; }
  .role { font-size:.72em; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin-bottom:.25em; }
  .bubble { border:1px solid var(--line); border-radius:8px; padding:.6em .8em; background:var(--panel); }
  .bubble.user { background:var(--accent-bg); border-color:#d4e2f6; }
  .bubble.err { background:var(--err-bg); border-color:#f3cccc; color:var(--err); }
  .md { white-space:pre-wrap; word-break:break-word; }
  .tool { border:1px solid var(--line); border-radius:8px; margin:.5em 0; background:var(--panel); overflow:hidden; }
  .tool summary { cursor:pointer; padding:.5em .7em; font-weight:600; display:flex; gap:.5em; align-items:center; }
  .tool summary .name { font-family:ui-monospace, monospace; }
  .tool summary .dur { color:var(--muted); font-weight:400; font-size:.85em; margin-left:auto; }
  .tool .body { border-top:1px solid var(--line); padding:.5em .7em; }
  .tool pre { margin:.3em 0; padding:.5em; background:#f6f6f6; border-radius:5px; overflow-x:auto; font-size:.85em; }
  .tool .label { font-size:.75em; color:var(--muted); text-transform:uppercase; letter-spacing:.03em; }
  .tool.err .body pre { background:var(--err-bg); }
  .turn-latency { font-size:.72em; color:var(--muted); margin:-.5rem 0 1rem; }
  .ask { border:1px solid var(--accent); background:var(--accent-bg); border-radius:8px; padding:.7em .8em; margin:0 0 1rem; }
  .ask .q { font-weight:600; margin-bottom:.5em; }
  .ask textarea { width:100%; min-height:2.5em; padding:.4em; border:1px solid var(--line); border-radius:5px; font:inherit; }
  .ask button { margin-top:.4em; padding:.4em 1em; font:inherit; font-weight:600; cursor:pointer; border:1px solid var(--accent); background:var(--accent); color:#fff; border-radius:5px; }
  #composer { border-top:1px solid var(--line); background:var(--panel); padding:.7rem 2rem 1rem; }
  #composer textarea { width:100%; resize:vertical; min-height:3em; max-height:40vh; padding:.5em .7em; border:1px solid var(--line); border-radius:6px; font:inherit; }
  .composer-row { display:flex; gap:.5em; align-items:center; margin-top:.5em; }
  #composer select { padding:.4em; border:1px solid var(--line); border-radius:4px; font:inherit; background:var(--panel); }
  .composer-row .spacer { flex:1; }
  #send { padding:.5em 1.3em; font:inherit; font-weight:600; cursor:pointer; border:1px solid var(--accent); background:var(--accent); color:#fff; border-radius:6px; }
  #send:disabled { opacity:.5; cursor:not-allowed; }
  #stop { padding:.5em 1.3em; font:inherit; font-weight:600; cursor:pointer; border:1px solid var(--err); background:none; color:var(--err); border-radius:6px; }
  #stop:hover { background:var(--err-bg); }
  .working-indicator { display:flex; align-items:center; gap:.5em; margin-bottom:.5em; color:var(--warn); font-size:.85em; font-weight:600; }
  .dot { width:.55em; height:.55em; border-radius:50%; background:var(--warn); animation:pulse 1s infinite; }
  @keyframes pulse { 0%,100%{opacity:.3} 50%{opacity:1} }
  .empty { color:var(--muted); padding:3rem 2rem; text-align:center; }
  [hidden] { display:none !important; }
</style>
</head>
<body>
<aside>
  <header>
    <h1>agent-template</h1>
    <button id="new-convo">New conversation</button>
  </header>
  <div id="runs"></div>
</aside>
<main>
  <div class="detail-head" id="detail-head" hidden>
    <span class="chip" id="head-chip"></span>
    <span class="id" id="head-id"></span>
    <span class="spacer"></span>
    <button class="danger" id="cancel-btn">Cancel</button>
  </div>
  <div id="detail"><div class="empty" id="empty">Pick a conversation, or start a new one below.</div><div id="detail-body" hidden></div></div>
  <div id="composer">
    <div class="working-indicator" id="working" hidden><span class="dot"></span><span id="working-text">working</span></div>
    <textarea id="input" placeholder="Send a message... (Shift+Enter for newline)" rows="2"></textarea>
    <div class="composer-row">
      <select id="model"></select>
      <select id="effort">
        <option value="">effort: default</option>
        <option value="low">low</option>
        <option value="medium">medium</option>
        <option value="high">high</option>
      </select>
      <span class="spacer"></span>
      <button id="stop" hidden>Stop</button>
      <button id="send">Send</button>
    </div>
  </div>
</main>
<script>
"use strict";
var state = { runs: [], currentId: null, detail: null, timer: null, lastDetailHtml: null };
// Reset at the top of each renderDetail so tool cards get a stable, unique,
// position-based id (transcript order never changes as it grows). Keying open
// state on the tool call id instead would collide when a provider — or the mock
// — is not perfectly unique, and would bleed expand state across sessions.
var toolCardSeq = 0;

// Substituted server-side (see htmlShell); each session's id links to its
// execution page in the Obelisk web UI.
var OBELISK_UI_URL = "__OBELISK_UI_URL__";
function execLink(id) { return OBELISK_UI_URL + "/execution/" + encodeURIComponent(id); }
function el(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
async function api(method, path, body) {
  var opts = { method: method, headers: {} };
  if (body !== undefined) { opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body); }
  var resp = await fetch(path, opts);
  var text = await resp.text();
  var data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
  if (!resp.ok) throw new Error((data && data.error) || ("HTTP " + resp.status));
  return data;
}
function genId(prefix) { return prefix + "-" + Date.now() + "-" + Math.floor(Math.random() * 1e6); }

// ----- models -----
async function loadModels() {
  var data = await api("GET", "/api/models");
  var sel = el("model");
  sel.innerHTML = "";
  (data.models || []).forEach(function (m) {
    var opt = document.createElement("option");
    opt.value = m.id; opt.textContent = m.label || m.id;
    sel.appendChild(opt);
  });
  if (!sel.options.length) { var o = document.createElement("option"); o.value = ""; o.textContent = "(default)"; sel.appendChild(o); }
}

// ----- run list -----
async function refreshRuns() {
  try {
    var data = await api("GET", "/api/runs");
    state.runs = data.runs || [];
    renderRuns();
  } catch (e) { /* transient */ }
}
function renderRuns() {
  var box = el("runs");
  box.innerHTML = "";
  state.runs.forEach(function (run) {
    var div = document.createElement("div");
    div.className = "run" + (run.id === state.currentId ? " active" : "");
    div.innerHTML =
      '<div class="title">' + esc(shortId(run.id)) + "</div>" +
      '<div class="meta"><span>' + esc(when(run.created_at)) + "</span>" +
      '<span class="chip ' + esc(run.cls || "") + '">' + esc(run.label || run.status) + "</span></div>";
    div.onclick = function () { selectRun(run.id); };
    box.appendChild(div);
  });
}
function shortId(id) { return id.length > 34 ? id.slice(0, 16) + "..." + id.slice(-14) : id; }
function when(iso) {
  if (!iso) return "";
  var d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString();
}

// ----- url <-> selection -----
// The open session's execution id lives in the ?execution query param so a
// session is a real, shareable URL that survives a reload. replaceState keeps
// it out of the history stack; popstate re-syncs on back/forward.
function runIdFromUrl() {
  return new URLSearchParams(location.search).get("execution") || null;
}
function syncUrl() {
  var params = new URLSearchParams(location.search);
  if (state.currentId) params.set("execution", state.currentId);
  else params.delete("execution");
  var qs = params.toString();
  var target = location.pathname + (qs ? "?" + qs : "");
  if (target !== location.pathname + location.search) history.replaceState(null, "", target);
}

// ----- detail -----
async function selectRun(id) {
  state.currentId = id;
  state.detail = null;
  state.lastDetailHtml = null;
  syncUrl();
  renderRuns();
  await refreshDetail();
  scheduleDetailPoll();
}
async function refreshDetail() {
  if (!state.currentId) return;
  try {
    state.detail = await api("GET", "/api/runs/" + encodeURIComponent(state.currentId));
    renderDetail();
  } catch (e) { /* transient */ }
}
function renderDetail() {
  var d = state.detail;
  el("empty").hidden = true;
  el("detail-head").hidden = false;
  var body = el("detail-body");
  body.hidden = false;
  el("head-chip").className = "chip " + (d.cls || "");
  el("head-chip").textContent = d.label || d.status || "";
  el("head-id").innerHTML =
    '<a href="' + esc(execLink(d.id)) + '" target="_blank" rel="noopener" title="open in Obelisk web UI">' + esc(d.id) + "</a>" +
    (d.backend ? "  ·  " + esc(d.backend) : "");
  var terminal = d.status === "finished";
  el("cancel-btn").hidden = terminal;

  var t = d.transcript || {};
  toolCardSeq = 0;
  var html = "";
  if (d.prompt) html += bubble("prompt", "user", d.prompt);
  html += renderTimeline(t);
  var pending = pendingAsk(t.human_input_events || []);
  if (pending) html += renderAskForm(pending);
  html = html || '<div class="empty">Empty session. Send the first message below.</div>';
  // Only rebuild the transcript DOM when it actually changed: polling re-renders
  // otherwise wipe user state (a tool card the user expanded would collapse
  // every poll). When it changes, carry forward which cards were open - but only
  // for the SAME run (lastDetailHtml is reset to null on a run switch, so we do
  // not bleed one session's open cards onto another's).
  if (html !== state.lastDetailHtml) {
    var preserve = state.lastDetailHtml !== null;
    var openIds = {};
    if (preserve) {
      var existing = body.querySelectorAll("details[data-tool-id]");
      for (var i = 0; i < existing.length; i++) {
        if (existing[i].open) openIds[existing[i].getAttribute("data-tool-id")] = true;
      }
    }
    body.innerHTML = html;
    state.lastDetailHtml = html;
    if (preserve) {
      var fresh = body.querySelectorAll("details[data-tool-id]");
      for (var j = 0; j < fresh.length; j++) {
        if (openIds[fresh[j].getAttribute("data-tool-id")]) fresh[j].open = true;
      }
    }
    wireAskForm(pending);
  }

  // Composer state: working indicator + stop button.
  var working = t.agent_working === true;
  el("working").hidden = !working;
  el("working-text").textContent = working ? "agent is working" : "";
  var offer = t.input_offer;
  el("stop").hidden = !(working && offer && offer.id);
}

function renderTimeline(t) {
  var users = t.user_messages || [];
  var replies = t.replies || [];
  var results = {};
  (t.sent_results || []).forEach(function (r) { results[r.id] = r; });
  var sessionStart = t.session_started && t.session_started.created_at;
  var maxTurn = 0;
  users.concat(replies).forEach(function (x) { if (typeof x.turn_index === "number") maxTurn = Math.max(maxTurn, x.turn_index); });
  var html = "";
  for (var turn = 0; turn <= maxTurn; turn++) {
    var turnUsers = users.filter(function (m) { return (m.turn_index || 0) === turn; });
    turnUsers.forEach(function (m) { html += bubble("user", "user", m.text); });
    // The turn starts when its prompt was recorded (turn 0's prompt is the
    // workflow's start arg, so fall back to session start). The per-turn latency
    // is real wall-clock from that point to the turn's final reply, so it
    // captures the whole turn - LLM steps, tool calls, waits, and replays -
    // unlike a per-step duration measured inside the workflow.
    var startTs = turnUsers.length ? turnUsers[0].created_at : (turn === 0 ? sessionStart : null);
    var turnReplies = replies.filter(function (r) { return (r.turn_index || 0) === turn; })
      .sort(function (a, b) { return (a.step || 0) - (b.step || 0); });
    turnReplies.forEach(function (r, idx) {
      var latency = (idx === turnReplies.length - 1 && r.turn_complete) ? turnLatency(startTs, r.created_at) : "";
      html += renderReply(r, results, latency);
    });
  }
  return html;
}
// Human-readable duration: ms under a second, then s, then m/s once it is long
// enough that a bare millisecond (or even second) count reads terribly.
function fmtDur(ms) {
  if (typeof ms !== "number" || !isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return Math.round(ms) + "ms";
  var s = ms / 1000;
  if (s < 60) return (s < 10 ? s.toFixed(1) : String(Math.round(s))) + "s";
  var m = Math.floor(s / 60), rem = Math.round(s % 60);
  return rem ? m + "m " + rem + "s" : m + "m";
}
function turnLatency(startIso, endIso) {
  var s = parseTs(startIso), e = parseTs(endIso);
  if (!isFinite(s) || !isFinite(e) || e < s) return "";
  return fmtDur(e - s);
}
// Obelisk timestamps can carry sub-millisecond precision Date.parse rejects;
// trim the fraction to 3 digits before parsing.
function parseTs(iso) {
  if (typeof iso !== "string") return NaN;
  var t = Date.parse(iso);
  if (isFinite(t)) return t;
  return Date.parse(iso.replace(/(\\.\\d{3})\\d+(?=Z|[+-]\\d\\d:?\\d\\d)/, "$1"));
}
function renderReply(r, results, latency) {
  var rep = r.reply || {};
  var lat = latency ? '<div class="turn-latency">turn: ' + esc(latency) + "</div>" : "";
  if (rep.error) return bubble("agent", "err", rep.error) + lat;
  if (typeof rep.response === "string") return bubble("agent", "", rep.response) + lat;
  var html = "";
  if (r.narration) html += bubble("agent", "", r.narration);
  (rep.tool_calls || []).forEach(function (call) {
    html += renderTool(call, results[call.id]);
  });
  return html + lat;
}
function renderTool(call, result) {
  var isErr = result && result.err !== undefined;
  var dur = result && typeof result.duration_milliseconds === "number" ? fmtDur(result.duration_milliseconds) : "";
  var argStr = "";
  try { argStr = JSON.stringify(call.args, null, 2); } catch (e) { argStr = String(call.args); }
  var out = "";
  if (result) {
    var val = isErr ? result.err : result.ok;
    out = '<div class="label">result</div><pre>' + esc(pretty(val)) + "</pre>";
  } else {
    out = '<div class="label">running...</div>';
  }
  return '<details class="tool' + (isErr ? " err" : "") + '" data-tool-id="tc-' + (toolCardSeq++) + '"' + (isErr ? " open" : "") + '>' +
    '<summary><span class="name">' + esc(call.name) + "</span>" +
    (dur ? '<span class="dur">' + esc(dur) + "</span>" : "") + "</summary>" +
    '<div class="body"><div class="label">arguments</div><pre>' + esc(argStr) + "</pre>" + out + "</div></details>";
}
function pretty(val) {
  if (typeof val !== "string") { try { return JSON.stringify(val, null, 2); } catch (e) { return String(val); } }
  try { return JSON.stringify(JSON.parse(val), null, 2); } catch (e) { return val; }
}
function bubble(role, cls, text) {
  return '<div class="msg"><div class="role">' + esc(role) + "</div>" +
    '<div class="bubble ' + cls + '"><div class="md">' + esc(text) + "</div></div></div>";
}

// ----- ask_user gate -----
function pendingAsk(events) {
  var resolved = {};
  events.forEach(function (e) { if (e.kind === "resolved") resolved[e.id] = true; });
  var open = events.filter(function (e) { return e.kind === "requested" && !resolved[e.id]; });
  return open.length ? open[open.length - 1] : null;
}
function renderAskForm(ask) {
  return '<div class="ask"><div class="q">' + esc(ask.question) + "</div>" +
    '<textarea id="ask-input" placeholder="Your answer... (Shift+Enter for newline)"></textarea>' +
    '<button id="ask-send">Answer</button></div>';
}
function wireAskForm(ask) {
  if (!ask) return;
  var btn = el("ask-send");
  if (!btn) return;
  var submit = async function () {
    var text = (el("ask-input").value || "").trim();
    if (!text) return;
    btn.disabled = true;
    try { await api("POST", "/api/answer/" + encodeURIComponent(ask.id), { answer: text }); await refreshDetail(); }
    catch (e) { btn.disabled = false; alert("answer failed: " + e.message); }
  };
  btn.onclick = submit;
  el("ask-input").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
  });
}

// ----- composer actions -----
async function send() {
  var text = (el("input").value || "").trim();
  if (!text) return;
  var backend = el("model").value || null;
  var effort = el("effort").value || null;
  var btn = el("send");
  btn.disabled = true;
  try {
    var d = state.detail;
    var offer = d && d.transcript && d.transcript.input_offer;
    if (d && offer && offer.id && d.id === state.currentId && d.status !== "finished") {
      await api("POST", "/api/input/" + encodeURIComponent(state.currentId),
        { offer_id: offer.id, input: { prompt: { id: genId("u"), text: text } } });
    } else {
      var res = await api("POST", "/api/submit", { prompt: text, backend: backend, effort: effort });
      state.currentId = res.execution_id;
      state.detail = null;
      state.lastDetailHtml = null;
      syncUrl();
    }
    el("input").value = "";
    await refreshRuns();
    await refreshDetail();
    scheduleDetailPoll();
  } catch (e) { alert("send failed: " + e.message); }
  finally { btn.disabled = false; }
}
async function stop() {
  var d = state.detail;
  var offer = d && d.transcript && d.transcript.input_offer;
  if (!offer || !offer.id) return;
  try { await api("POST", "/api/interrupt/" + encodeURIComponent(state.currentId), { offer_id: offer.id }); await refreshDetail(); }
  catch (e) { alert("stop failed: " + e.message); }
}
async function cancel() {
  if (!state.currentId) return;
  if (!confirm("Cancel this run?")) return;
  try { await api("POST", "/api/cancel/" + encodeURIComponent(state.currentId)); await refreshRuns(); await refreshDetail(); }
  catch (e) { alert("cancel failed: " + e.message); }
}
function newConversation() {
  state.currentId = null; state.detail = null; state.lastDetailHtml = null;
  syncUrl();
  el("detail-head").hidden = true; el("detail-body").hidden = true; el("empty").hidden = false;
  el("working").hidden = true; el("stop").hidden = true;
  renderRuns(); el("input").focus();
}

// ----- polling -----
function scheduleDetailPoll() {
  if (state.timer) clearTimeout(state.timer);
  var d = state.detail;
  var busy = d && (d.status === "running" || (d.transcript && d.transcript.agent_working));
  var delay = busy ? 1500 : 5000;
  state.timer = setTimeout(async function () {
    await refreshRuns();
    if (state.currentId) await refreshDetail();
    scheduleDetailPoll();
  }, delay);
}

el("send").onclick = send;
el("stop").onclick = stop;
el("cancel-btn").onclick = cancel;
el("new-convo").onclick = newConversation;
el("input").addEventListener("keydown", function (e) {
  // Enter sends; Shift+Enter (or IME composition) inserts a newline.
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
});

window.addEventListener("popstate", function () {
  var id = runIdFromUrl();
  if (id && id !== state.currentId) selectRun(id);
  else if (!id && state.currentId) newConversation();
});

(async function boot() {
  await loadModels();
  await refreshRuns();
  var id = runIdFromUrl();
  if (id) await selectRun(id);
  scheduleDetailPoll();
})();
</script>
</body>
</html>`;
