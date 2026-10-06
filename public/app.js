/* RSlide — front end (no build step). Routes:
   /              home: join with a code, or host a new session
   /e/CODE        attendee: Q&A + live polls
   /host/CODE#key host: moderate Q&A, run polls, settings, export
   /present/CODE  big screen for the room                                  */
(() => {
  "use strict";
  const $ = (sel, root = document) => root.querySelector(sel);
  const app = $("#app");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const pid = store.get("rs.pid") || (() => { const id = crypto.randomUUID().replace(/-/g, "").slice(0, 16); store.set("rs.pid", id); return id; })();
  const ago = (ts) => { const s = Math.round((Date.now() - ts) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`; return new Date(ts).toLocaleDateString(); };
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const ICON_UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  const TYPE_LABEL = { multiple: "Multiple choice", quiz: "Quiz", rating: "Rating", wordcloud: "Word cloud", open: "Open text" };

  let toastTimer;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2800); }

  const CFG = Object.assign({ name: "RSlide", logoUrl: "", heroKicker: "", heroTitle: "Ask. Vote. Be heard.", heroText: "", titlePlaceholder: "" }, window.RSLIDE_CONFIG || {});
  const brand = `<a class="brand" href="/">${CFG.logoUrl ? `<img src="${esc(CFG.logoUrl)}" alt="${esc(CFG.name)}" style="height:28px;display:block" />` : `<b>${esc(CFG.name)}</b>`}</a>`;
  const joinUrl = (code) => `${location.origin}/e/${code}`;

  // ---------- realtime connection with auto-reconnect ----------
  function connect(code, role, key, onState) {
    let ws, retry = 0, closed = false, pingT;
    const status = { online: false };
    const listeners = new Set();
    const setOnline = (v) => { status.online = v; listeners.forEach((f) => f(v)); };
    function open() {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const qs = new URLSearchParams({ role, pid, ...(key ? { key } : {}) });
      ws = new WebSocket(`${proto}://${location.host}/api/events/${code}/ws?${qs}`);
      ws.onopen = () => { retry = 0; setOnline(true); clearInterval(pingT); pingT = setInterval(() => ws.readyState === 1 && ws.send('{"type":"ping"}'), 25000); };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === "state") onState(m.state);
        else if (m.type === "online") onState(null, m.online);
        else if (m.type === "error") toast(m.message);
      };
      ws.onclose = () => { setOnline(false); clearInterval(pingT); if (!closed) setTimeout(open, Math.min(8000, 500 * 2 ** retry++)); };
    }
    open();
    return {
      send(msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); else toast("Reconnecting… try again in a second"); },
      onStatus(f) { listeners.add(f); f(status.online); },
      close() { closed = true; ws.close(); },
    };
  }

  async function checkEvent(code) {
    const r = await fetch(`/api/events/${encodeURIComponent(code)}`);
    return r.ok ? r.json() : null;
  }

  // ---------- shared renderers ----------
  function resultsHtml(p, opts = {}) {
    const r = p.results || {};
    if (r.counts === undefined && r.words === undefined && r.answers === undefined)
      return `<p class="muted small">${plural(r.total || 0, "response")} so far. Results are hidden by the host.</p>`;
    const total = r.total || 0;
    let html = "";
    if (p.type === "multiple" || p.type === "quiz") {
      const denom = Math.max(1, total);
      html = p.options.map((o, i) => {
        const pct = Math.round((r.counts[i] / denom) * 100);
        const ok = p.correct && p.correct.includes(i);
        return `<div class="res ${ok ? "correct" : ""}"><div class="lbl"><span>${ok ? "✓ " : ""}${esc(o)}</span><b>${pct}%</b></div><div class="track"><div class="fill" style="width:${pct}%"></div></div></div>`;
      }).join("");
    } else if (p.type === "rating") {
      const max = Math.max(1, ...r.counts);
      html = `<div class="feature" style="text-align:center;font-size:${opts.big ? "72px" : "40px"}">${r.avg || "–"}<span class="muted" style="font-size:.4em"> / ${p.scale || 5}</span></div>` +
        r.counts.map((c, i) => `<div class="res"><div class="lbl"><span>${"★".repeat(i + 1)}</span><b>${c}</b></div><div class="track"><div class="fill" style="width:${(c / max) * 100}%;background:var(--accent)"></div></div></div>`).reverse().join("");
    } else if (p.type === "wordcloud") {
      const max = Math.max(1, ...r.words.map((w) => w[1]));
      const colors = ["var(--brand)", "var(--link)", "#8a5b00", "var(--brand-2)", "#1f8a5b"];
      const base = opts.big ? 20 : 14, span = opts.big ? 64 : 30;
      html = r.words.length ? `<div class="cloud">${r.words.map(([w, c], i) => `<span style="font-size:${base + (c / max) * span}px;color:${colors[i % colors.length]}" title="${c}">${esc(w)}</span>`).join("")}</div>` : `<div class="empty">Words will appear here</div>`;
    } else if (p.type === "open") {
      html = r.answers.length ? `<ul class="answers">${r.answers.slice(0, opts.big ? 12 : 50).map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : `<div class="empty">Answers will appear here</div>`;
    }
    return html + `<p class="muted small" style="margin-top:10px">${plural(total, "response")}</p>`;
  }

  function sortQuestions(list, mode) {
    const a = [...list];
    if (mode === "recent") a.sort((x, y) => y.ts - x.ts);
    else a.sort((x, y) => y.votes - x.votes || y.ts - x.ts);
    return a.sort((x, y) => (y.highlighted ? 1 : 0) - (x.highlighted ? 1 : 0));
  }

  // =====================================================================
  // HOME
  // =====================================================================
  function home() {
    document.title = CFG.name;
    const mine = store.get("rs.hosted", []);
    app.innerHTML = `
      <header class="bar">${brand}<div class="title"></div></header>
      <section class="hero">
        <div class="kicker" style="color:var(--accent)">${esc(CFG.heroKicker)}</div>
        <h1 style="margin-top:10px">${esc(CFG.heroTitle)}</h1>
        <p>${esc(CFG.heroText)}</p>
      </section>
      <section class="home-cards">
        <form class="card stack" id="joinForm">
          <div class="kicker">Join a session</div>
          <h2>Enter your event code</h2>
          <input class="input code-input" id="code" maxlength="8" placeholder="ABC123" autocomplete="off" autocapitalize="characters" aria-label="Event code" />
          <button class="btn accent" style="width:100%">Join</button>
        </form>
        <form class="card stack" id="hostForm">
          <div class="kicker">Host a session</div>
          <h2>Start a new event</h2>
          <input class="input" id="title" maxlength="120" placeholder="${esc(CFG.titlePlaceholder)}" aria-label="Event title" />
          <button class="btn" style="width:100%">Create event</button>
          ${mine.length ? `<div><div class="muted small" style="margin:8px 0 4px">Your recent events</div>${mine.slice(0, 5).map((e) => `<div class="row" style="padding:6px 0;border-top:1px solid var(--line)"><span class="grow">${esc(e.title)} <span class="muted small">#${esc(e.code)}</span></span><a class="btn sm ghost" href="/host/${esc(e.code)}#${esc(e.key)}">Open</a></div>`).join("")}</div>` : ""}
        </form>
      </section>`;
    $("#joinForm").onsubmit = async (e) => {
      e.preventDefault();
      const code = $("#code").value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!code) return toast("Type the event code");
      if (!(await checkEvent(code))) return toast("We couldn't find that event code");
      go(`/e/${code}`);
    };
    $("#hostForm").onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.submitter; btn.disabled = true;
      try {
        const r = await fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: $("#title").value }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        store.set("rs.hosted", [{ code: d.code, key: d.hostKey, title: d.title, ts: Date.now() }, ...mine].slice(0, 30));
        go(`/host/${d.code}#${d.hostKey}`);
      } catch (err) { toast(err.message || "Could not create event"); btn.disabled = false; }
    };
  }

  // =====================================================================
  // ATTENDEE
  // =====================================================================
  async function attendee(code) {
    const info = await checkEvent(code);
    if (!info) return notFound(code);
    document.title = `${info.title} · ${CFG.name}`;
    let S = null, tab = "qa", sort = "popular", pollKey = "";
    const draftSel = {};
    app.innerHTML = `
      <header class="bar">${brand}<div class="title" id="t"></div><span class="chip">#${esc(code)}</span><span class="chip" title="Connection"><span class="dot" id="conn"></span></span></header>
      <div class="wrap stack">
        <div class="tabs" role="tablist">
          <button class="tab active" data-tab="qa">Q&amp;A</button>
          <button class="tab" data-tab="poll">Polls <span id="pollBadge"></span></button>
        </div>
        <section id="qaView" class="stack">
          <form class="card stack" id="askForm">
            <textarea class="input" id="qtext" maxlength="300" placeholder="Type your question" aria-label="Your question"></textarea>
            <div class="row"><input class="input grow" id="qname" maxlength="40" placeholder="Your name (optional)" aria-label="Your name" style="flex:1 1 180px" /><button class="btn accent">Send</button></div>
            <div class="muted small" id="askNote"></div>
          </form>
          <div class="row"><b class="grow" id="qCount"></b>
            <div class="tabs" style="padding:3px"><button class="tab active" data-sort="popular" style="padding:5px 12px">Popular</button><button class="tab" data-sort="recent" style="padding:5px 12px">Recent</button></div>
          </div>
          <div class="card" id="qList"></div>
        </section>
        <section id="pollView" class="hidden"></section>
      </div>`;
    $("#qname").value = store.get("rs.name", "");
    const conn = connect(code, "attendee", null, (state, online) => { if (state) { S = state; render(); } });
    conn.onStatus((on) => $("#conn").classList.toggle("off", !on));

    app.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { tab = b.dataset.tab; render(); }));
    app.querySelectorAll("[data-sort]").forEach((b) => (b.onclick = () => { sort = b.dataset.sort; app.querySelectorAll("[data-sort]").forEach((x) => x.classList.toggle("active", x === b)); render(); }));
    $("#askForm").onsubmit = (e) => {
      e.preventDefault();
      const text = $("#qtext").value.trim();
      if (!text) return toast("Type a question first");
      const name = $("#qname").value.trim();
      store.set("rs.name", name);
      conn.send({ type: "ask", text, name });
      $("#qtext").value = "";
      toast(S?.settings.moderation ? "Sent! The host will review it shortly." : "Question sent");
    };
    $("#qList").onclick = (e) => { const b = e.target.closest("[data-vote]"); if (b) conn.send({ type: "vote", id: b.dataset.vote }); };

    function render() {
      if (!S) return;
      $("#t").textContent = S.title;
      document.title = `${S.title} · ${CFG.name}`;
      const active = S.polls[0];
      $("#pollBadge").innerHTML = active ? `<span class="badge pulse">1</span>` : "";
      app.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
      $("#qaView").classList.toggle("hidden", tab !== "qa");
      $("#pollView").classList.toggle("hidden", tab !== "poll");

      // Q&A
      const f = $("#askForm");
      f.querySelectorAll("textarea,input,button").forEach((el) => (el.disabled = !S.settings.qaOpen));
      $("#askNote").textContent = !S.settings.qaOpen ? "The host has closed questions for now." : S.settings.moderation ? "Questions are reviewed by the host before they appear." : "";
      $("#qname").placeholder = S.settings.allowAnonymous && !S.settings.requireName ? "Your name (optional)" : "Your name (required)";
      const qs = sortQuestions(S.questions, sort);
      const visible = qs.filter((q) => q.status !== "pending");
      $("#qCount").textContent = plural(visible.length, "question");
      $("#qList").innerHTML = qs.length ? qs.map((q) => `
        <div class="q ${q.highlighted ? "hl" : ""}">
          <div class="body">
            ${q.highlighted ? `<span class="tag hl">Now answering</span> ` : ""}
            <div class="text">${esc(q.text)}</div>
            <div class="meta"><span>${esc(q.name || "Anonymous")}</span><span>·</span><span>${ago(q.ts)}</span>
              ${q.status === "pending" ? `<span class="tag pending">Waiting for approval</span>` : ""}${q.status === "answered" ? `<span class="tag answered">Answered</span>` : ""}</div>
          </div>
          ${q.status !== "pending" ? `<button class="vote ${q.voted ? "on" : ""}" data-vote="${q.id}" aria-label="Upvote" aria-pressed="${q.voted}">${ICON_UP}<span>${q.votes}</span></button>` : ""}
        </div>`).join("") : `<div class="empty">No questions yet. Be the first to ask!</div>`;

      // Poll
      const pv = $("#pollView");
      if (!active) { pollKey = ""; pv.innerHTML = `<div class="card empty">No poll is running right now.<br/>It will show up here when the host starts one.</div>`; return; }
      const key = `${active.id}|${active.status}|${JSON.stringify(active.myResponse)}|${active.type}|${active.options?.join("¦")}|${active.title}`;
      if (key !== pollKey) { pollKey = key; renderPollForm(active); }
      const rbox = $("#pollResults");
      if (rbox) rbox.innerHTML = active.myResponse != null || active.status === "closed" ? resultsHtml(active) : "";
    }

    function renderPollForm(p) {
      const answered = p.myResponse != null;
      const sel = draftSel[p.id] || (Array.isArray(p.myResponse) && typeof p.myResponse[0] === "number" ? [...p.myResponse] : []);
      draftSel[p.id] = sel;
      let body = "";
      if (p.type === "multiple" || p.type === "quiz") {
        body = p.options.map((o, i) => `<button type="button" class="opt ${p.multi ? "multi" : ""} ${sel.includes(i) ? "sel" : ""}" data-opt="${i}"><span class="box"></span><span>${esc(o)}</span></button>`).join("") +
          (p.multi ? `<p class="muted small">You can pick more than one.</p>` : "");
      } else if (p.type === "rating") {
        const v = typeof p.myResponse === "number" ? p.myResponse : 0;
        body = `<div class="stars">${Array.from({ length: p.scale || 5 }, (_, i) => `<button type="button" class="star ${i < v ? "on" : ""}" data-star="${i + 1}" aria-label="${i + 1} stars">★</button>`).join("")}</div>`;
      } else if (p.type === "wordcloud") {
        body = `<input class="input" id="pw" maxlength="30" placeholder="One word or short phrase" />`;
      } else if (p.type === "open") {
        body = `<textarea class="input" id="pw" maxlength="200" placeholder="Your answer"></textarea>`;
      }
      const canResend = p.type === "multiple" || p.type === "quiz" || p.type === "rating";
      $("#pollView").innerHTML = `
        <div class="card stack">
          <div class="row"><span class="kicker grow">${TYPE_LABEL[p.type]}</span>${p.status === "closed" ? `<span class="status closed">Closed</span>` : `<span class="status active">Live</span>`}</div>
          <h2>${esc(p.title)}</h2>
          ${p.status === "active" ? `<div>${body}</div>
          <div class="row"><button class="btn accent" id="psend" ${p.type === "rating" ? "hidden" : ""}>${answered && canResend ? "Update answer" : "Send"}</button>
          ${answered ? `<span class="muted small">✓ Your answer was sent${p.type === "wordcloud" || p.type === "open" ? " — you can send another" : ""}</span>` : ""}</div>` : ""}
          ${p.type === "quiz" && p.correct && answered ? `<p><b>${p.correct.every((c) => p.myResponse.includes(c)) && p.myResponse.length === p.correct.length ? "✅ Correct!" : "❌ Not quite."}</b></p>` : ""}
          <div id="pollResults"></div>
        </div>`;
      const pv = $("#pollView");
      pv.querySelectorAll("[data-opt]").forEach((b) => (b.onclick = () => {
        const i = +b.dataset.opt;
        if (p.multi) { const k = sel.indexOf(i); k < 0 ? sel.push(i) : sel.splice(k, 1); } else { sel.length = 0; sel.push(i); }
        pv.querySelectorAll("[data-opt]").forEach((x) => x.classList.toggle("sel", sel.includes(+x.dataset.opt)));
      }));
      pv.querySelectorAll("[data-star]").forEach((b) => (b.onclick = () => conn.send({ type: "respond", pollId: p.id, value: +b.dataset.star })));
      const sendBtn = $("#psend");
      if (sendBtn) sendBtn.onclick = () => {
        if (p.type === "multiple" || p.type === "quiz") { if (!sel.length) return toast("Pick an option"); conn.send({ type: "respond", pollId: p.id, value: sel }); }
        else { const v = $("#pw").value.trim(); if (!v) return toast("Type something first"); conn.send({ type: "respond", pollId: p.id, value: p.type === "wordcloud" ? [v] : v }); $("#pw").value = ""; }
      };
    }
  }

  // =====================================================================
  // HOST
  // =====================================================================
  async function host(code) {
    const key = decodeURIComponent(location.hash.slice(1));
    const info = await checkEvent(code);
    if (!info) return notFound(code);
    if (!key) {
      app.innerHTML = `<header class="bar">${brand}</header><div class="wrap"><div class="card stack"><h2>Host link needed</h2><p class="muted">Open this event from the private host link you got when you created it.</p></div></div>`;
      return;
    }
    let S = null, qTab = "live", editing = null;
    app.innerHTML = `
      <header class="bar">${brand}<div class="title" id="t"></div>
        <span class="chip">#${esc(code)}</span><span class="chip"><span class="dot" id="conn"></span><span id="online">0</span> online</span>
        <a class="btn sm accent" href="/present/${esc(code)}#${esc(key)}" target="_blank" rel="noopener">Present ↗</a>
      </header>
      <div class="wrap wide stack">
        <div class="card row">
          <input class="input grow" id="titleIn" maxlength="120" aria-label="Event title" style="flex:1 1 260px;font-weight:600" />
          <span class="muted small">Join at <b>${esc(location.host)}</b> with code <b>${esc(code)}</b></span>
          <button class="btn sm ghost" id="copyJoin">Copy join link</button>
          <button class="btn sm ghost" id="copyHost">Copy host link</button>
          <a class="btn sm ghost" href="/api/events/${esc(code)}/export?key=${encodeURIComponent(key)}">Export CSV</a>
        </div>
        <div class="grid2">
          <section class="card stack">
            <div class="row"><h2 class="grow">Q&amp;A</h2>
              <label class="check small"><input type="checkbox" data-set="qaOpen" /> Open</label>
              <label class="check small"><input type="checkbox" data-set="moderation" /> Review first</label>
              <label class="check small"><input type="checkbox" data-set="allowAnonymous" /> Allow anonymous</label>
            </div>
            <div class="tabs" id="qTabs"></div>
            <div id="hq"></div>
          </section>
          <section class="card stack">
            <div class="row"><h2 class="grow">Polls</h2><button class="btn sm" id="newPoll">+ New poll</button></div>
            <div class="row small"><span class="muted">Big screen shows:</span>
              ${["auto", "qa", "poll", "code"].map((m) => `<button class="btn sm ghost" data-mode="${m}">${{ auto: "Auto", qa: "Q&A", poll: "Poll", code: "Join code" }[m]}</button>`).join("")}</div>
            <div id="editor"></div>
            <div id="hp"></div>
          </section>
        </div>
      </div>`;
    const conn = connect(code, "host", key, (state, online) => {
      if (state) { S = state; render(); } else if (online != null) $("#online").textContent = online;
    });
    conn.onStatus((on) => $("#conn").classList.toggle("off", !on));
    const send = (m) => conn.send(m);

    // remember on this device
    const hosted = store.get("rs.hosted", []);
    if (!hosted.find((e) => e.code === code)) store.set("rs.hosted", [{ code, key, title: info.title, ts: Date.now() }, ...hosted].slice(0, 30));

    $("#titleIn").onchange = (e) => send({ type: "setTitle", title: e.target.value });
    const copy = (txt, msg) => navigator.clipboard?.writeText(txt).then(() => toast(msg), () => prompt("Copy this:", txt));
    $("#copyJoin").onclick = () => copy(joinUrl(code), "Join link copied");
    $("#copyHost").onclick = () => copy(location.href, "Host link copied — keep it private");
    app.querySelectorAll("[data-set]").forEach((c) => (c.onchange = () => send({ type: "setSettings", settings: { [c.dataset.set]: c.checked } })));
    app.querySelectorAll("[data-mode]").forEach((b) => (b.onclick = () => send({ type: "setPresentMode", mode: b.dataset.mode })));
    $("#newPoll").onclick = () => { editing = { type: "multiple", title: "", options: ["", ""], correct: [], multi: false }; renderEditor(); };

    $("#hq").onclick = (e) => {
      const b = e.target.closest("[data-qa]"); if (!b) return;
      const [type, id] = b.dataset.qa.split(":");
      if (type === "deleteQuestion" && !confirm("Delete this question?")) return;
      send({ type, id });
    };
    $("#hp").onclick = (e) => {
      const b = e.target.closest("[data-pa]"); if (!b) return;
      const [type, pollId, dir] = b.dataset.pa.split(":");
      if (type === "edit") { const p = S.polls.find((x) => x.id === pollId); editing = { id: p.id, type: p.type, title: p.title, options: [...p.options], correct: [...(p.correct || [])], multi: p.multi }; return renderEditor(); }
      if (type === "deletePoll" && !confirm("Delete this poll and its results?")) return;
      if (type === "resetPoll" && !confirm("Clear all responses to this poll?")) return;
      if (type === "activatePoll" && pollId === "none") return send({ type, pollId: null });
      send({ type, pollId, dir });
    };

    function render() {
      $("#t").textContent = S.title;
      document.title = `Host · ${S.title}`;
      if (document.activeElement !== $("#titleIn")) $("#titleIn").value = S.title;
      $("#online").textContent = S.online;
      app.querySelectorAll("[data-set]").forEach((c) => (c.checked = !!S.settings[c.dataset.set]));
      app.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === S.presentMode));

      const by = { live: [], pending: [], answered: [], archived: [] };
      S.questions.forEach((q) => by[q.status]?.push(q));
      const tabs = [["live", "Live"], ["pending", "Review"], ["answered", "Answered"], ["archived", "Archived"]];
      if (!S.settings.moderation && !by.pending.length && qTab === "pending") qTab = "live";
      $("#qTabs").innerHTML = tabs.filter(([k]) => k !== "pending" || S.settings.moderation || by.pending.length)
        .map(([k, l]) => `<button class="tab ${qTab === k ? "active" : ""}" data-qt="${k}">${l}${by[k].length ? ` <span class="badge" ${k === "pending" ? "" : 'style="background:#dfe4ee"'}>${by[k].length}</span>` : ""}</button>`).join("");
      $("#qTabs").querySelectorAll("[data-qt]").forEach((b) => (b.onclick = () => { qTab = b.dataset.qt; render(); }));
      const list = sortQuestions(by[qTab], "popular");
      $("#hq").innerHTML = list.length ? list.map((q) => `
        <div class="q ${q.highlighted ? "hl" : ""}">
          <div class="vote" style="cursor:default">${ICON_UP}<span>${q.votes}</span></div>
          <div class="body">
            <div class="text">${esc(q.text)}</div>
            <div class="meta"><span>${esc(q.name || "Anonymous")}</span><span>·</span><span>${ago(q.ts)}</span>${q.highlighted ? `<span class="tag hl">On screen</span>` : ""}</div>
            <div class="actions">
              ${q.status === "pending" ? `<button class="btn sm" data-qa="approve:${q.id}">Approve</button>` : ""}
              ${q.status !== "archived" ? `<button class="btn sm ${q.highlighted ? "on" : "ghost"}" data-qa="highlight:${q.id}">${q.highlighted ? "Unhighlight" : "Highlight"}</button>` : ""}
              ${q.status !== "pending" && q.status !== "archived" ? `<button class="btn sm ghost" data-qa="answer:${q.id}">${q.status === "answered" ? "Mark unanswered" : "Mark answered"}</button>` : ""}
              <button class="btn sm ghost" data-qa="archive:${q.id}">${q.status === "archived" ? "Restore" : "Archive"}</button>
              <button class="btn sm danger" data-qa="deleteQuestion:${q.id}">Delete</button>
            </div>
          </div>
        </div>`).join("") : `<div class="empty">${{ live: "No live questions yet.", pending: "Nothing to review.", answered: "Nothing marked answered yet.", archived: "Nothing archived." }[qTab]}</div>`;

      $("#hp").innerHTML = S.polls.length ? S.polls.map((p, i) => `
        <div class="poll-item ${p.status === "active" ? "active" : ""}">
          <div class="row"><span class="status ${p.status}">${p.status === "active" ? "● Live" : p.status}</span><span class="muted small grow">${TYPE_LABEL[p.type]}</span>
            <button class="btn sm ghost" data-pa="movePoll:${p.id}:up" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
            <button class="btn sm ghost" data-pa="movePoll:${p.id}:down" ${i === S.polls.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button></div>
          <h3 style="margin:6px 0 4px;font-family:var(--sans);font-size:17px">${esc(p.title)}</h3>
          ${p.status !== "draft" ? resultsHtml(p) : `<p class="muted small">${p.options.length ? esc(p.options.join(" · ")) : ""}</p>`}
          <div class="actions">
            ${p.status === "active" ? `<button class="btn sm" data-pa="closePoll:${p.id}">Close poll</button>` : `<button class="btn sm accent" data-pa="activatePoll:${p.id}">${p.status === "closed" ? "Reopen" : "Launch"}</button>`}
            <button class="btn sm ghost" data-pa="toggleResults:${p.id}">${p.showResults ? "Hide results from audience" : "Show results to audience"}</button>
            ${p.type === "quiz" ? `<button class="btn sm ghost" data-pa="revealAnswer:${p.id}">${p.revealed ? "Hide answer" : "Reveal answer"}</button>` : ""}
            <button class="btn sm ghost" data-pa="edit:${p.id}">Edit</button>
            ${p.results?.total ? `<button class="btn sm ghost" data-pa="resetPoll:${p.id}">Reset</button>` : ""}
            <button class="btn sm danger" data-pa="deletePoll:${p.id}">Delete</button>
          </div>
        </div>`).join("") : `<div class="empty">No polls yet. Create one before class, then launch it live.</div>`;
    }

    function renderEditor() {
      const ed = $("#editor");
      if (!editing) { ed.innerHTML = ""; return; }
      const e = editing;
      const hasOpts = e.type === "multiple" || e.type === "quiz";
      ed.innerHTML = `
        <form class="poll-item stack" id="pform" style="background:#f8fafd">
          <div class="row"><b class="grow">${e.id ? "Edit poll" : "New poll"}</b>
            <select class="input" id="ptype" style="width:auto">${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${k === e.type ? "selected" : ""}>${v}</option>`).join("")}</select></div>
          <input class="input" id="ptitle" maxlength="300" placeholder="Your question" value="${esc(e.title)}" />
          ${hasOpts ? `<div id="popts">${e.options.map((o, i) => `
            <div class="row" style="margin-top:6px">
              ${e.type === "quiz" ? `<label class="check small" title="Correct answer"><input type="checkbox" data-correct="${i}" ${e.correct.includes(i) ? "checked" : ""}/>✓</label>` : ""}
              <input class="input grow" data-opt="${i}" maxlength="120" placeholder="Option ${i + 1}" value="${esc(o)}" />
              ${e.options.length > 2 ? `<button type="button" class="btn sm ghost" data-rm="${i}" aria-label="Remove option">✕</button>` : ""}
            </div>`).join("")}</div>
            <div class="row">${e.options.length < 10 ? `<button type="button" class="btn sm ghost" id="addOpt">+ Add option</button>` : ""}
            ${e.type === "multiple" ? `<label class="check small"><input type="checkbox" id="pmulti" ${e.multi ? "checked" : ""}/> Allow more than one answer</label>` : ""}
            ${e.type === "quiz" ? `<span class="muted small">Tick the correct answer(s)</span>` : ""}</div>` : ""}
          ${e.type === "rating" ? `<p class="muted small">People rate from 1 to 5 stars.</p>` : ""}
          ${e.type === "wordcloud" ? `<p class="muted small">People send short words. Popular words grow bigger.</p>` : ""}
          ${e.type === "open" ? `<p class="muted small">People type a short free-text answer.</p>` : ""}
          <div class="row"><button class="btn">Save poll</button><button type="button" class="btn ghost" id="pcancel">Cancel</button></div>
        </form>`;
      const sync = () => {
        e.title = $("#ptitle").value;
        ed.querySelectorAll("[data-opt]").forEach((x) => (e.options[+x.dataset.opt] = x.value));
        e.correct = [...ed.querySelectorAll("[data-correct]:checked")].map((x) => +x.dataset.correct);
        e.multi = !!$("#pmulti")?.checked;
      };
      $("#ptype").onchange = (ev) => { sync(); e.type = ev.target.value; if ((e.type === "multiple" || e.type === "quiz") && e.options.length < 2) e.options = ["", ""]; renderEditor(); };
      $("#addOpt") && ($("#addOpt").onclick = () => { sync(); e.options.push(""); renderEditor(); ed.querySelector(`[data-opt="${e.options.length - 1}"]`).focus(); });
      ed.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { sync(); const i = +b.dataset.rm; e.options.splice(i, 1); e.correct = e.correct.filter((c) => c !== i).map((c) => (c > i ? c - 1 : c)); renderEditor(); }));
      $("#pcancel").onclick = () => { editing = null; renderEditor(); };
      $("#pform").onsubmit = (ev) => {
        ev.preventDefault(); sync();
        if (!e.title.trim()) return toast("Add a question");
        if ((e.type === "multiple" || e.type === "quiz") && e.options.filter((o) => o.trim()).length < 2) return toast("Add at least 2 options");
        if (e.type === "quiz" && !e.correct.length) return toast("Tick the correct answer");
        send({ type: "savePoll", poll: e });
        editing = null; renderEditor();
      };
      $("#ptitle").focus();
    }
  }

  // =====================================================================
  // PRESENT (big screen)
  // =====================================================================
  async function present(code) {
    const key = decodeURIComponent(location.hash.slice(1));
    const info = await checkEvent(code);
    if (!info) return notFound(code);
    const url = joinUrl(code);
    let qrSvg = "";
    try { const qr = qrcode(0, "M"); qr.addData(url); qr.make(); qrSvg = qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true }); } catch {}
    app.innerHTML = `
      <div class="present">
        <aside>
          ${brand}
          <div><div class="small" style="opacity:.75">Join at</div><div style="font-size:22px;font-weight:700">${esc(location.host)}</div></div>
          <div><div class="small" style="opacity:.75">Event code</div><div class="big-code">${esc(code)}</div></div>
          ${qrSvg ? `<div class="qr">${qrSvg}</div>` : ""}
          <div class="small" style="opacity:.75;margin-top:auto"><span id="online">0</span> people connected</div>
        </aside>
        <main id="stage"></main>
      </div>`;
    connect(code, "present", key, (state, online) => {
      if (state) render(state);
      if (online != null) $("#online").textContent = online;
    });
    function render(S) {
      $("#online").textContent = S.online;
      document.title = `${S.title} · ${CFG.name}`;
      const poll = S.polls.find((p) => p.id === S.activePollId);
      let mode = S.presentMode;
      if (mode === "auto") mode = poll ? "poll" : "qa";
      const stage = $("#stage");
      if (mode === "code") {
        stage.innerHTML = `<div class="kicker">${esc(S.title)}</div><div class="feature" style="margin-top:20vh">Join the conversation at <b>${esc(location.host)}</b><br/>with code <b style="color:var(--link)">${esc(code)}</b></div>`;
      } else if (mode === "poll") {
        const p = poll || S.polls.filter((x) => x.status === "closed").slice(-1)[0];
        stage.innerHTML = p ? `<div class="kicker">${TYPE_LABEL[p.type]} · ${p.status === "active" ? "Live poll" : "Closed"}</div><h1 style="margin:10px 0 28px">${esc(p.title)}</h1>${resultsHtml({ ...p, correct: p.revealed ? p.correct : undefined }, { big: true })}`
          : `<div class="feature" style="margin-top:20vh">No poll running yet.</div>`;
      } else {
        const qs = sortQuestions(S.questions.filter((q) => q.status === "live"), "popular");
        const hl = qs.find((q) => q.highlighted);
        stage.innerHTML = `<div class="kicker">${esc(S.title)}</div>
          ${hl ? `<div class="q hl" style="margin-top:16px"><div class="body"><span class="tag hl">Now answering</span><div class="feature" style="font-size:clamp(28px,3vw,48px);margin-top:10px">${esc(hl.text)}</div><div class="meta" style="font-size:18px">${esc(hl.name || "Anonymous")} · ${plural(hl.votes, "vote")}</div></div></div>` : `<h1 style="margin:10px 0 18px">Questions</h1>`}
          <div style="margin-top:16px">${qs.filter((q) => !q.highlighted).slice(0, hl ? 4 : 7).map((q) => `<div class="q"><div class="vote" style="cursor:default">${ICON_UP}<span>${q.votes}</span></div><div class="body"><div class="text">${esc(q.text)}</div><div class="meta">${esc(q.name || "Anonymous")}</div></div></div>`).join("") || (hl ? "" : `<div class="feature" style="margin-top:14vh;color:var(--muted)">Ask your question at ${esc(location.host)} — code ${esc(code)}</div>`)}</div>`;
      }
    }
  }

  function notFound(code) {
    app.innerHTML = `<header class="bar">${brand}</header><div class="wrap"><div class="card stack"><h2>Event not found</h2><p class="muted">We couldn't find an event with code <b>${esc(code)}</b>. Check the code and try again.</p><a class="btn" href="/">Back to start</a></div></div>`;
  }

  // ---------- router ----------
  function go(path) { history.pushState({}, "", path); route(); }
  function route() {
    const [, a, b] = location.pathname.split("/");
    const code = (b || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (a === "e" && code) return attendee(code);
    if (a === "host" && code) return host(code);
    if (a === "present" && code) return present(code);
    if (a && /^[A-Za-z0-9]{4,8}$/.test(a) && !b) return go(`/e/${a.toUpperCase()}`); // yoursite/ABC123 shortcut
    home();
  }
  window.addEventListener("popstate", () => location.reload());
  route();
})();
