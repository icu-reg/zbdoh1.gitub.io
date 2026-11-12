/* Overtime Claims — everything is stored on this device only (localStorage). */
(() => {
  'use strict';

  const KEY = 'overtime-log-v1';
  const FORM_URL = 'form/unrostered-overtime-claim.pdf';
  const DEFAULT_TO = 'medicalrosters@alfred.org.au';
  const ROWS_PER_FORM = 6;
  const FIRST_HOURS = 2; // first 2 hours of each overtime occasion at 150%, the rest at 200%

  // Weekly rates, Victorian Doctors in Training Agreement 2022-2026 (AMA Victoria/ASMOF), as at the first
  // full pay period on or after 1 March 2025. Hourly rate = weekly rate / ordinary weekly hours.
  const RATES_FROM = '1 March 2025';
  const LEVELS = [
    ['intern', 'Intern (HMO Year 1)', 1638.49, 38],
    ['hmo2', 'HMO Year 2', 1742.45, 38],
    ['hmo3', 'HMO Year 3', 1888.94, 38],
    ['reg1', 'Registrar Year 1', 2481.70, 43],
    ['reg2', 'Registrar Year 2', 2623.33, 43],
    ['reg3', 'Registrar Year 3', 2723.30, 43],
    ['reg4', 'Registrar Year 4', 2859.75, 43],
    ['reg5', 'Registrar Year 5', 3253.02, 43],
    ['reg6', 'Registrar Year 6 and above', 3415.81, 43],
  ];
  const level = (id) => LEVELS.find((l) => l[0] === id);

  // Endorsed reasons, as numbered on the Alfred Health Unrostered Overtime Claim Form.
  const REASONS = {
    1: { short: 'Sick leave cover', long: 'Covering JMS sick leave or another unscheduled absence', approval: false },
    2: { short: 'Deteriorating patient', long: 'Clinically deteriorating patient (MET, Code Blue, ICU transfer, urgent family meeting)', approval: true },
    3: { short: 'Round / theatre / clinic', long: 'Early or late ward round, theatre list or clinic requested by the consultant', approval: true },
    4: { short: 'Unit activity', long: 'Compulsory unit activity outside rostered hours (audit, M&M, radiology meeting)', approval: true },
    5: { short: 'Urgent admit / discharge', long: 'Urgent admission or discharge that could not be handed over', approval: true },
    6: { short: 'Other', long: 'Other (must be authorised under the JMS unrostered overtime guideline)', approval: true },
  };

  // ---------- state ----------
  let state = load();
  let route = { tab: 'log' };
  let draft = null;

  function load() {
    const base = { settings: {}, entries: [] };
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      return saved && typeof saved === 'object' ? { ...base, ...saved } : base;
    } catch {
      return base;
    }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch { toast('Could not save — phone storage is full'); }
  }

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const pad = (n) => String(n).padStart(2, '0');
  const isoDate = (d) => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const hhmm = (d) => { d = new Date(d); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const parseDate = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtDay = (s) => parseDate(s).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
  const ddmm = (s) => { const d = parseDate(s); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
  const money = (n) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtMins = (m) => {
    m = Math.max(0, Math.round(m));
    const h = Math.floor(m / 60), r = m % 60;
    return h ? (r ? `${h} h ${r} min` : `${h} h`) : `${r} min`;
  };
  const hrs = (m) => { const h = m / 60; return (Math.round(h * 100) / 100).toString(); };

  // Minutes of overtime: from rostered finish to the time they left; a finish earlier than the
  // start means they left after midnight.
  function minutesOf(e) {
    if (!e || !e.date || !/^\d\d:\d\d$/.test(e.start || '') || !/^\d\d:\d\d$/.test(e.finish || '')) return 0;
    const [sh, sm] = e.start.split(':').map(Number);
    const [fh, fm] = e.finish.split(':').map(Number);
    let m = (fh * 60 + fm) - (sh * 60 + sm);
    if (m <= 0) m += 24 * 60;
    return m;
  }
  function hourlyRate() {
    const custom = parseFloat(state.settings.customRate);
    if (custom > 0) return custom;
    const l = level(state.settings.level);
    return l ? l[2] / l[3] : 0;
  }
  function payOf(mins) {
    const first = Math.min(mins, FIRST_HOURS * 60), rest = Math.max(0, mins - FIRST_HOURS * 60);
    const rate = hourlyRate();
    return { first, rest, paidHours: (first * 1.5 + rest * 2) / 60, amount: Math.round(rate * (first * 1.5 + rest * 2) / 60 * 100) / 100 };
  }
  function sumOf(entries) {
    return entries.reduce((t, e) => {
      const m = minutesOf(e), p = payOf(m);
      t.mins += m; t.first += p.first; t.rest += p.rest; t.amount += p.amount; t.count += 1;
      return t;
    }, { mins: 0, first: 0, rest: 0, amount: 0, count: 0 });
  }
  const byWhen = (a, b) => (a.date + a.start).localeCompare(b.date + b.start);
  const unsent = () => state.entries.filter((e) => !e.sentAt).sort(byWhen);

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  // ---------- install & share ----------
  const APP_URL = new URL('./', location.href).href;
  const SHARE_ICON = '<svg class="inline-ico" viewBox="0 0 24 24" aria-label="Share"><path d="M12 3v12M8 6.5 12 3l4 3.500M6 10.500H5a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8.500a1 1 0 0 0-1-1h-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const standalone = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  function installCard() {
    if (standalone() || state.settings.hideInstall) return '';
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const body = ios
      ? `<ol class="steps">
          <li>Tap ${SHARE_ICON} <b>Share</b> ${/CriOS|FxiOS|EdgiOS/.test(ua) ? 'at the top right, next to the address' : 'at the bottom of Safari'}</li>
          <li>Scroll down and tap <b>Add to Home Screen</b></li>
          <li>Tap <b>Add</b>, then open it from the new icon</li>
        </ol>`
      : `<p>On an iPhone, open this page in Safari, tap ${SHARE_ICON} <b>Share</b>, then <b>Add to Home Screen</b>.</p>`;
    return `<div class="card tip"><b class="tip-title">Add Overtime to your Home Screen</b>${body}
      <button class="link small" data-act="hide-install" style="padding:8px 0 0">Not now</button></div>`;
  }
  function qrSvg(text) {
    if (!window.qrcode) return '';
    try { const q = window.qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); }
    catch { return ''; }
  }

  // ---------- rendering ----------
  function render() {
    const view = $('#view');
    const welcoming = !state.settings.onboarded;
    document.body.classList.toggle('welcoming', welcoming);
    $('#back').hidden = true;
    document.querySelectorAll('.tabbar button').forEach((b) => {
      if (b.dataset.tab === route.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (welcoming) {
      $('#title').textContent = 'Set up';
      view.innerHTML = welcomeView();
      if (welcomeStep === 2) mountPad($('#sigpad'));
      return;
    }
    if (route.tab === 'log') { $('#title').textContent = 'Log overtime'; view.innerHTML = logView(); refreshLog(); }
    else if (route.tab === 'claims') { $('#title').textContent = 'Claims'; view.innerHTML = claimsView(); }
    else { $('#title').textContent = 'My details'; view.innerHTML = meView(); }
  }

  function freshDraft() {
    const now = new Date();
    return {
      date: isoDate(now),
      start: state.settings.lastStart || '17:00',
      finish: hhmm(now),
      reason: state.settings.lastReason || '1',
      details: '',
    };
  }

  // The fields shared by the Log page and the edit sheet.
  function entryFields(e, opts = {}) {
    const startChips = [...new Set([e.start, state.settings.lastStart, ...recentStarts(), '17:00', '17:30', '18:00', '22:00', '08:00'].filter(Boolean))].slice(0, 6);
    return `
      <div class="ot-field">
        <div class="ot-line">
          <input type="date" name="date" value="${esc(e.date)}" required aria-label="Date">
          <div class="scroller">
            <button type="button" class="chip" data-act="set-date" data-days="0">Today</button>
            <button type="button" class="chip" data-act="set-date" data-days="-1">Yesterday</button>
          </div>
        </div>
      </div>
      <div class="ot-times">
        <div class="ot-field"><span>Rostered finish</span>
          <input type="time" name="start" value="${esc(e.start)}" required>
          <div class="scroller ot-under">${startChips.slice(0, 3).map((t) => `<button type="button" class="chip" data-act="set-field" data-target="start" data-value="${t}">${t}</button>`).join('')}</div>
        </div>
        <div class="ot-field"><span>Left at</span>
          <input type="time" name="finish" value="${esc(e.finish)}" required>
          <div class="ot-under">
            <button type="button" class="chip" data-act="set-now">Now</button>
            <button type="button" class="chip" data-act="nudge" data-min="-15">−15</button>
            <button type="button" class="chip" data-act="nudge" data-min="15">+15</button>
          </div>
        </div>
      </div>
      <div class="result" id="result"></div>
      <div class="ot-field"><span>Reason (number on the form)</span>
        <div class="scroller reasons">${Object.entries(REASONS).map(([n, r]) => `<button type="button" class="reason ${String(e.reason) === n ? 'on' : ''}" data-act="set-reason" data-reason="${n}"><b>${n}</b> ${esc(r.short)}</button>`).join('')}</div>
        <input type="hidden" name="reason" value="${esc(e.reason)}">
      </div>
      <p class="note" id="approval-note" hidden></p>
      <input name="details" id="details-input" value="${esc(e.details)}" autocomplete="off" maxlength="60" placeholder="Details (optional), e.g. covering Dr Smith" aria-label="Details">
      ${opts.covid ? `<label class="ot-field"><span>COVID related</span>
        <select name="covid"><option ${e.covid !== 'Yes' ? 'selected' : ''}>No</option><option ${e.covid === 'Yes' ? 'selected' : ''}>Yes</option></select></label>` : ''}`;
  }

  function recentStarts() {
    return [...state.entries].sort(byWhen).reverse().map((e) => e.start);
  }

  function logView() {
    if (!draft) draft = freshDraft();
    const u = unsent(), t = sumOf(u);
    return `${installCard()}
      <form class="ot" id="log-form" novalidate>
        ${entryFields(draft)}
        <div class="ot-actions">
          <button type="button" class="btn soft" data-act="save-later">Save for later</button>
          <button type="button" class="btn primary" data-act="save-send">Save &amp; email</button>
        </div>
      </form>
      ${u.length ? `<div class="pending" style="margin-top:14px">
        <p><b>${u.length} unsent</b> · ${fmtMins(t.mins)}${hourlyRate() ? ` · ${money(t.amount)}` : ''}</p>
        <button class="btn primary" data-act="send-all">Email all</button></div>` : ''}`;
  }

  // Keeps the live total, chip highlights and reason note in step with what has been entered.
  function refreshLog(form = $('#log-form') || $('#sheet-form')) {
    if (!form || !form.querySelector('#result')) return;
    const d = Object.fromEntries(new FormData(form).entries());
    const m = minutesOf(d);
    const r = form.querySelector('#result');
    if (!m) {
      r.className = 'result none';
      r.innerHTML = '<div><div class="hrs">—</div><div class="split">Enter your rostered finish and when you left</div></div>';
    } else {
      const p = payOf(m), rate = hourlyRate();
      const split = `${hrs(p.first)} h at 150%${p.rest ? ` + ${hrs(p.rest)} h at 200%` : ''}`;
      r.className = 'result';
      r.innerHTML = `<div><div class="hrs">${fmtMins(m)}</div><div class="split">${split}</div></div>
        <div class="amt">${rate ? money(p.amount) : '—'}<small>${rate ? 'before tax' : 'set your level'}</small></div>`;
    }
    form.querySelectorAll('.chip[data-target]').forEach((el) => el.classList.toggle('on', d[el.dataset.target] === el.dataset.value));
    const reason = REASONS[d.reason];
    const note = form.querySelector('#approval-note');
    note.hidden = !reason || !reason.approval;
    if (reason && reason.approval) note.textContent = `Reason ${d.reason} needs your Head of Unit or consultant to sign the form. Reason 1 does not.`;
    form.querySelector('#details-input').placeholder = d.reason === '6' ? 'Details — required for Other' : 'Details (optional), e.g. covering Dr Smith';
    if (form.id === 'log-form') draft = { ...draft, ...d };
  }

  function claimsView() {
    const u = unsent(), t = sumOf(u);
    const since = isoDate(Date.now() - 13 * 864e5);
    const fort = sumOf(state.entries.filter((e) => e.date >= since));
    const sent = state.entries.filter((e) => e.sentAt).sort(byWhen).reverse().slice(0, 30);
    const row = (e) => {
      const m = minutesOf(e), p = payOf(m);
      return `<button class="row" data-act="edit" data-id="${esc(e.id)}">
        <span class="time">${esc(ddmm(e.date))}</span>
        <span class="body"><span class="line1">${esc(e.start)} – ${esc(e.finish)} · ${fmtMins(m)}</span>
        <span class="line2">${e.reason}. ${esc(REASONS[e.reason]?.short || '')}${e.details ? ' · ' + esc(e.details) : ''}${e.sentAt ? ` · sent ${esc(fmtDay(isoDate(e.sentAt)))}` : ''}</span></span>
        ${hourlyRate() ? `<span class="small" style="font-weight:600">${money(p.amount)}</span>` : ''}
        <span class="chev" aria-hidden="true">›</span></button>`;
    };
    return `
      <h2 class="section-title" style="margin-top:4px">Not sent yet</h2>
      ${u.length ? `<div class="totals" style="margin-bottom:12px">
          <div><b>${u.length}</b><span>day${u.length === 1 ? '' : 's'}</span></div>
          <div><b>${hrs(t.mins)} h</b><span>overtime</span></div>
          <div><b>${hourlyRate() ? money(t.amount) : '—'}</b><span>before tax</span></div>
        </div>
        <div class="list">${u.map(row).join('')}</div>
        <button class="btn primary" data-act="send-all">Email all ${u.length} as one claim</button>`
        : '<div class="list"><div class="empty">Nothing waiting to be sent.</div></div>'}
      <h2 class="section-title">Last 14 days</h2>
      <div class="card">
        <p><b>${fmtMins(fort.mins)}</b> overtime over ${fort.count} day${fort.count === 1 ? '' : 's'}</p>
        <p class="muted small" style="margin-top:4px">${hrs(fort.first)} h at 150% + ${hrs(fort.rest)} h at 200% = ${hrs((fort.first * 1.5 + fort.rest * 2))} paid hours${hourlyRate() ? ` · <b>${money(fort.amount)}</b> before tax` : ''}</p>
      </div>
      ${sent.length ? `<h2 class="section-title">Sent</h2><div class="list">${sent.map(row).join('')}</div>` : ''}`;
  }

  function meView() {
    const st = state.settings;
    const f = (key, label, extra = '') => `<label class="field"><span>${label}</span>
      <input data-setting="${key}" value="${esc(st[key])}" autocomplete="off" ${extra}></label>`;
    return `<p class="muted small" style="margin:0 4px 14px">These details go on your claim form.</p>
      ${f('name', 'Full name', 'autocapitalize="words"')}
      ${f('employeeId', 'Employee number (optional)', 'inputmode="numeric"')}
      ${f('department', 'Department / unit', 'autocapitalize="words"')}
      <h2 class="section-title">Pay</h2>
      <label class="field"><span>Level</span>
        <select data-setting="level"><option value="">Choose…</option>${LEVELS.map(([id, name, wk, h]) => `<option value="${id}" ${st.level === id ? 'selected' : ''}>${esc(name)} — ${money(wk / h)}/h</option>`).join('')}</select></label>
      ${f('customRate', 'Your own hourly rate (optional, overrides level)', 'inputmode="decimal" placeholder="e.g. 63.33"')}
      <p class="muted small" style="margin:-6px 4px 0">Rates from the AMA Victoria Doctors in Training Agreement 2022–2026, as at ${RATES_FROM}. Each day: first 2 hours at 150%, then 200%.</p>
      <h2 class="section-title">Email</h2>
      ${f('emailTo', 'Send claims to', `type="email" inputmode="email" autocapitalize="off" placeholder="${DEFAULT_TO}"`)}
      <h2 class="section-title">Signature</h2>
      <div class="card center">
        ${st.signature ? `<img class="sigpreview" src="${esc(st.signature)}" alt="Your signature">
        <div class="btn-row" style="margin-top:12px"><button class="btn soft" data-act="draw-signature">Redo</button><button class="btn danger" data-act="remove-signature">Remove</button></div>`
        : `<p class="small muted" style="margin-bottom:12px">Without one, your typed name goes in the signature box.</p>
        <button class="btn soft" data-act="draw-signature">Add my signature</button>`}
      </div>
      <h2 class="section-title">Share with a colleague</h2>
      <div class="card center">
        <div class="qr">${qrSvg(APP_URL)}</div>
        <p class="small muted" style="margin:10px 0 12px">They scan this with their iPhone camera, or you send them the link.</p>
        <button class="btn soft" data-act="share-app">Send the link</button>
      </div>
      <h2 class="section-title">Backup</h2>
      <div class="card">
        <p class="small muted" style="margin-bottom:12px">Everything is stored only on this phone.</p>
        <button class="btn soft" data-act="backup">Save a backup file</button>
        <button class="btn outline" data-act="restore">Restore from a backup file</button>
        <input type="file" id="restore-file" accept="application/json,.json" hidden>
      </div>
      <button class="btn danger" data-act="wipe">Erase all data on this phone</button>`;
  }

  // ---------- first-run setup ----------
  let welcomeStep = 0;
  function welcomeView() {
    const st = state.settings;
    const dots = `<div class="dots" aria-hidden="true">${[0, 1, 2].map((i) => `<i class="${i === welcomeStep ? 'on' : ''}"></i>`).join('')}</div>`;
    const back = welcomeStep ? '<button class="link" data-act="welcome-back">‹ Back</button>' : '';
    if (welcomeStep === 0) {
      const f = (key, label, extra = '') => `<label class="field"><span>${label}</span>
        <input data-setting="${key}" value="${esc(st[key])}" autocomplete="off" ${extra}></label>`;
      return `<div class="welcome">
        <img src="icons/icon-180.png" alt="" class="welcome-icon">
        <h2>Overtime claims, done in seconds</h2>
        <p class="muted">Set up once. After that: enter when you were rostered to finish and when you left, and the claim form fills itself in.</p>
        ${dots}
        ${f('name', 'Your full name', 'autocapitalize="words" autocomplete="name"')}
        ${f('employeeId', 'Employee number (optional)', 'inputmode="numeric" placeholder="Skip if you prefer"')}
        ${f('department', 'Department / unit', 'autocapitalize="words" placeholder="e.g. General Medicine"')}
        <button class="btn primary huge" data-act="welcome-next">Continue</button>
        <button class="link small" data-act="restore">Moving phones? Restore a backup file</button>
        <input type="file" id="restore-file" accept="application/json,.json" hidden>
      </div>`;
    }
    if (welcomeStep === 1) {
      return `<div class="welcome">
        <h2>Your level</h2>
        <p class="muted">Used to work out what each overtime claim pays.</p>
        ${dots}
        <div class="list">${LEVELS.map(([id, name, wk, h]) => `<button class="row" data-act="pick-level" data-level="${id}">
          <span class="body"><span class="line1">${esc(name)}</span><span class="line2">${money(wk / h)} an hour · overtime ${money(wk / h * 1.5)} then ${money(wk / h * 2)}</span></span>
          <span class="chev" aria-hidden="true">${st.level === id ? '✓' : '›'}</span></button>`).join('')}</div>
        <button class="btn outline" data-act="welcome-next">Skip for now</button>
        ${back}
      </div>`;
    }
    return `<div class="welcome">
      <h2>Your signature</h2>
      <p class="muted">Sign once with your finger. It goes in the signature box on every claim form.</p>
      ${dots}
      <canvas id="sigpad" class="sigpad"></canvas>
      <button class="btn outline" data-act="clear-pad" style="margin-top:10px">Clear</button>
      <button class="btn primary huge" data-act="welcome-finish">Save and finish</button>
      <button class="btn outline" data-act="welcome-skip-sign">Skip for now</button>
      ${back}
    </div>`;
  }
  function finishWelcome() {
    state.settings.onboarded = true; save();
    route = { tab: 'log' }; draft = null; render(); window.scrollTo(0, 0);
    toast('All set');
  }
  // Someone who already uses On-Call Log in this browser gets their details filled in for them.
  function borrowOnCallDetails() {
    if (state.settings.onboarded || state.settings.name) return;
    try {
      const o = JSON.parse(localStorage.getItem('oncall-log-v1'));
      const s = o && o.settings;
      if (!s) return;
      ['name', 'employeeId', 'department', 'signature'].forEach((k) => { if (s[k] && !state.settings[k]) state.settings[k] = s[k]; });
      if (s.year && !state.settings.level) state.settings.level = 'reg' + s.year;
      if (parseFloat(s.customRate) > 0 && !state.settings.customRate) state.settings.customRate = s.customRate;
    } catch { /* nothing to borrow */ }
  }

  // ---------- signature pad ----------
  let sigPad = null;
  function mountPad(canvas) {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * ratio; canvas.height = h * ratio;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0a1a3a';
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const grow = ([x, y]) => { box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y); box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y); };
    sigPad = {
      drawn: false,
      clear() { ctx.clearRect(0, 0, w, h); this.drawn = false; box.x0 = box.y0 = Infinity; box.x1 = box.y1 = -Infinity; },
      // Crop to the ink so the signature fills its box on the form.
      export() {
        const m = 4;
        const x = Math.max(0, box.x0 - m), y = Math.max(0, box.y0 - m);
        const cw = Math.min(w, box.x1 + m) - x, ch = Math.min(h, box.y1 + m) - y;
        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(cw * ratio)); out.height = Math.max(1, Math.round(ch * ratio));
        out.getContext('2d').drawImage(canvas, x * ratio, y * ratio, cw * ratio, ch * ratio, 0, 0, out.width, out.height);
        return out.toDataURL('image/png');
      },
    };
    let last = null;
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); canvas.setPointerCapture(e.pointerId); last = pos(e); grow(last); });
    canvas.addEventListener('pointermove', (e) => {
      if (!last) return;
      const p = pos(e);
      ctx.beginPath(); ctx.moveTo(...last); ctx.lineTo(...p); ctx.stroke();
      last = p; grow(p); sigPad.drawn = true;
    });
    const stop = () => { last = null; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointercancel', stop);
  }

  // ---------- bottom sheet ----------
  let sheetSubmit = null;
  function openSheet(title, html, onSubmit, saveLabel = 'Save') {
    $('#sheet-title').textContent = title;
    $('#sheet-body').innerHTML = html;
    $('#sheet-save').textContent = saveLabel;
    $('#sheet-save').hidden = !onSubmit;
    sheetSubmit = onSubmit;
    const dlg = $('#sheet');
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
    $('#sheet-body').scrollTop = 0;
  }
  function closeSheet() {
    const dlg = $('#sheet');
    if (dlg.close) dlg.close(); else dlg.removeAttribute('open');
    sheetSubmit = null; pendingSend = null;
  }
  $('#sheet-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!sheetSubmit) return;
    const data = Object.fromEntries(new FormData(e.target).entries());
    if (sheetSubmit(data) !== false) { closeSheet(); render(); }
  });
  $('#sheet').addEventListener('cancel', () => { sheetSubmit = null; pendingSend = null; });

  function editSheet(entry) {
    openSheet('Edit overtime', `<div class="ot">${entryFields(entry, { covid: true })}
        ${entry.sentAt ? `<button type="button" class="btn outline" data-act="unsend" data-id="${esc(entry.id)}">Mark as not sent</button>` : ''}
        <button type="button" class="btn danger" data-act="delete" data-id="${esc(entry.id)}">Delete</button></div>`, (d) => {
      const err = validate(d);
      if (err) { toast(err); return false; }
      Object.assign(entry, clean(d), { covid: d.covid === 'Yes' ? 'Yes' : 'No' });
      save(); toast('Updated');
    });
    refreshLog($('#sheet-form'));
  }

  function validate(d) {
    if (!d.date) return 'Choose the date';
    if (!d.start || !d.finish) return 'Enter both times';
    if (!minutesOf(d)) return 'Check the times';
    if (minutesOf(d) > 16 * 60) return 'That is over 16 hours — check the times';
    if (d.reason === '6' && !String(d.details || '').trim()) return 'Add details for “Other”';
    return '';
  }
  const clean = (d) => ({ date: d.date, start: d.start, finish: d.finish, reason: String(d.reason || '1'), details: String(d.details || '').trim() });

  function saveDraft() {
    const form = $('#log-form');
    const d = Object.fromEntries(new FormData(form).entries());
    const err = validate(d);
    if (err) { toast(err); return null; }
    const entry = { id: uid(), ...clean(d), covid: 'No', sentAt: null };
    state.entries.push(entry);
    state.settings.lastStart = entry.start;
    state.settings.lastReason = entry.reason;
    save();
    draft = null;
    return entry;
  }

  // ---------- the claim form ----------
  let templateBytes = null;
  async function template() {
    if (!templateBytes) {
      const res = await fetch(FORM_URL);
      if (!res.ok) throw new Error('form');
      templateBytes = await res.arrayBuffer();
    }
    return templateBytes;
  }

  // Fills the Alfred Health form (6 rows per page) and returns the finished PDF bytes.
  async function buildPdf(entries) {
    const { PDFDocument, StandardFonts } = window.PDFLib;
    const st = state.settings;
    const sorted = [...entries].sort(byWhen);
    const out = await PDFDocument.create();
    out.setTitle('Unrostered Overtime Claim Form');
    for (let i = 0; i < sorted.length; i += ROWS_PER_FORM) {
      const doc = await PDFDocument.load(await template());
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const form = doc.getForm();
      // The form's fields carry no font of their own, so give each one Helvetica at the size we want.
      const sized = (f, size) => f.acroField.setDefaultAppearance(`/Helv ${size} Tf 0 g`);
      const text = (name, value, size = 10) => {
        const f = form.getTextField(name);
        sized(f, size);
        f.setText(String(value || ''));
      };
      const pick = (name, value) => {
        const f = form.getDropdown(name);
        sized(f, 11);
        f.select(value);
      };
      const chunk = sorted.slice(i, i + ROWS_PER_FORM);
      const unused = [];
      for (let r = 1; r <= ROWS_PER_FORM; r++) {
        const e = chunk[r - 1];
        if (e) {
          text(`DateRow${r}`, ddmm(e.date), 11);
          pick(`Dropdown${r}`, String(e.reason));
          text(`Patient UR NumberRow${r}`, e.details, 8);
          text(`Start timeRow${r}`, e.start, 11);
          text(`Finish timeRow${r}`, e.finish, 11);
          pick(`Dropdown${r + 6}`, e.covid === 'Yes' ? 'Yes' : 'No');
        } else {
          unused.push(`Dropdown${r}`, `Dropdown${r + 6}`);
        }
      }
      const other = chunk.filter((e) => String(e.reason) === '6' && e.details).map((e) => `${ddmm(e.date)}: ${e.details}`).join('; ');
      text('Other must be authorised as per the JMS unrostered overtime guideline Please specify', other, 9);
      text('Name', st.name, 11);
      text('Employee1', st.employeeId, 11);
      text('Department', st.department, 11);
      const page = doc.getPage(0);
      if (st.signature) {
        text('Employee2', '');
        try {
          const img = await doc.embedPng(st.signature);
          const box = { x: 348, y: 102, w: 205, h: 24 };
          const k = Math.min(box.w / img.width, box.h / img.height);
          page.drawImage(img, { x: box.x + 2, y: box.y + (box.h - img.height * k) / 2, width: img.width * k, height: img.height * k });
        } catch { text('Employee2', st.name, 11); }
      } else {
        text('Employee2', st.name, 11);
      }
      form.updateFieldAppearances(font);
      // Unused rows: drop the "*please select*" boxes so the row prints blank.
      unused.forEach((name) => form.removeField(form.getDropdown(name)));
      form.flatten();
      const [copy] = await out.copyPages(doc, [0]);
      out.addPage(copy);
    }
    return out.save();
  }

  function claimMeta(entries) {
    const st = state.settings;
    const sorted = [...entries].sort(byWhen);
    const first = sorted[0].date, last = sorted[sorted.length - 1].date;
    const range = first === last ? ddmm(first) : `${ddmm(first)}–${ddmm(last)}`;
    const t = sumOf(sorted);
    const who = (st.name || '').trim();
    const subject = `Unrostered overtime claim – ${who || 'Doctor'}${st.employeeId ? ` (${st.employeeId})` : ''} – ${range}`;
    const lines = sorted.map((e) => `• ${fmtDay(e.date)}: ${e.start}–${e.finish} (${fmtMins(minutesOf(e))}), reason ${e.reason}${e.details ? ` – ${e.details}` : ''}`);
    const body = `Hi Medical Workforce,\n\nPlease find attached my unrostered overtime claim form for ${range}.\n\n${lines.join('\n')}\n\nTotal: ${fmtMins(t.mins)}\n\nThanks,\n${who}${st.employeeId ? `\nEmployee number: ${st.employeeId}` : ''}${st.department ? `\n${st.department}` : ''}`;
    const safe = who.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const filename = `Overtime-Claim${safe ? '_' + safe : ''}_${first}${first === last ? '' : '_to_' + last}.pdf`;
    return { subject, body, filename, range, total: t };
  }

  // ---------- sending ----------
  let pendingSend = null;
  const recipient = () => (state.settings.emailTo || '').trim() || DEFAULT_TO;

  async function openSend(entries) {
    if (!entries.length) { toast('Nothing to send'); return; }
    const meta = claimMeta(entries);
    const needsSign = entries.some((e) => REASONS[e.reason]?.approval);
    openSheet('Email claim', `
      <p><b>${entries.length} day${entries.length === 1 ? '' : 's'}</b> · ${fmtMins(meta.total.mins)}${hourlyRate() ? ` · ${money(meta.total.amount)}` : ''}</p>
      <div class="to-box"><span>To: ${esc(recipient())}</span><button type="button" class="chip" data-act="copy-to">Copy</button></div>
      <ol class="steps-list">
        <li>Tap <b>Open email</b> and choose <b>Gmail</b> (or Outlook / Mail). The form is attached.</li>
        <li>In <b>To</b>, paste the address — it is copied for you.</li>
        <li>Tap <b>Send</b>.</li>
      </ol>
      ${needsSign ? '<p class="note" style="margin-bottom:12px">Some days use reasons 2–6, which need your Head of Unit or consultant to sign before sending.</p>' : ''}
      <button type="button" class="btn primary huge" data-act="share-claim" id="share-btn" disabled>Preparing form…</button>
      <button type="button" class="btn outline" data-act="preview-claim" id="preview-btn" disabled>Preview the form</button>`, null);
    pendingSend = { entries, meta, file: null };
    try {
      const bytes = await buildPdf(entries);
      if (!pendingSend || pendingSend.meta !== meta) return;
      pendingSend.file = new File([bytes], meta.filename, { type: 'application/pdf' });
      const btn = $('#share-btn');
      if (btn) { btn.disabled = false; btn.textContent = 'Open email'; }
      const pv = $('#preview-btn'); if (pv) pv.disabled = false;
    } catch (e) {
      console.error(e);
      const btn = $('#share-btn');
      if (btn) btn.textContent = 'Could not build the form — check your signal and try again';
    }
  }

  function askIfSent() {
    if (!pendingSend) return;
    openSheet('Did it send?', `<p style="margin-bottom:16px">Mark ${pendingSend.entries.length === 1 ? 'this day' : `these ${pendingSend.entries.length} days`} as sent so they move out of “Not sent yet”?</p>
      <button type="button" class="btn primary huge" data-act="mark-sent">Yes, mark as sent</button>
      <button type="button" class="btn outline" data-act="sheet-cancel">Not yet</button>`, null);
  }

  function copyText(text) {
    try { navigator.clipboard.writeText(text).catch(() => {}); return true; } catch { return false; }
  }

  // Called straight from the tap so iOS allows the share sheet.
  function shareClaim() {
    const p = pendingSend;
    if (!p || !p.file) return;
    copyText(recipient());
    if (navigator.canShare && navigator.canShare({ files: [p.file] })) {
      navigator.share({ files: [p.file], title: p.meta.subject, text: p.meta.body })
        .then(() => askIfSent())
        .catch((e) => { if (e && e.name !== 'AbortError') fallbackEmail(p); });
    } else {
      fallbackEmail(p);
    }
  }
  // Computers and browsers that cannot attach: save the PDF and open a pre-addressed email.
  function fallbackEmail(p) {
    download(p.file, p.meta.filename);
    const url = `mailto:${encodeURIComponent(recipient())}?subject=${encodeURIComponent(p.meta.subject)}&body=${encodeURIComponent(p.meta.body + '\n\n(The claim form PDF has been saved to your downloads — please attach it.)')}`;
    setTimeout(() => { location.href = url; }, 400);
    setTimeout(askIfSent, 1200);
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  // ---------- backup ----------
  function restore(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.entries)) throw new Error('bad');
        if (!confirm(`Replace everything on this phone with the backup (${data.entries.length} overtime days)?`)) return;
        state = { settings: { ...(data.settings || {}), onboarded: true }, entries: data.entries };
        save(); draft = null; render(); toast('Backup restored');
      } catch { toast('That file is not an Overtime backup'); }
    };
    reader.readAsText(file);
  }

  // ---------- actions ----------
  const formOf = (el) => el.closest('form');
  const actions = {
    'set-date'(el) {
      const f = formOf(el).querySelector('[name=date]');
      f.value = isoDate(Date.now() + Number(el.dataset.days) * 864e5); refreshLog(formOf(el));
    },
    'set-field'(el) { formOf(el).querySelector(`[name="${el.dataset.target}"]`).value = el.dataset.value; refreshLog(formOf(el)); },
    'set-now'(el) { formOf(el).querySelector('[name=finish]').value = hhmm(new Date()); refreshLog(formOf(el)); },
    nudge(el) {
      const f = formOf(el).querySelector('[name=finish]');
      const [h, m] = (f.value || hhmm(new Date())).split(':').map(Number);
      const t = ((h * 60 + m + Number(el.dataset.min)) % 1440 + 1440) % 1440;
      f.value = `${pad(Math.floor(t / 60))}:${pad(t % 60)}`; refreshLog(formOf(el));
    },
    'set-reason'(el) {
      const form = formOf(el);
      form.querySelector('[name=reason]').value = el.dataset.reason;
      form.querySelectorAll('.reason').forEach((b) => b.classList.toggle('on', b === el));
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      refreshLog(form);
    },
    'save-later'() { if (saveDraft()) { render(); toast('Saved — email it any time from Claims'); } },
    'save-send'() { const e = saveDraft(); if (e) { render(); openSend([e]); } },
    'send-all'() { openSend(unsent()); },
    'share-claim'() { shareClaim(); },
    'preview-claim'() { if (pendingSend && pendingSend.file) download(pendingSend.file, pendingSend.meta.filename); },
    'copy-to'() { toast(copyText(recipient()) ? 'Address copied' : recipient()); },
    'mark-sent'() {
      if (!pendingSend) return;
      const now = new Date().toISOString();
      pendingSend.entries.forEach((e) => { const x = state.entries.find((y) => y.id === e.id); if (x) x.sentAt = now; });
      save(); closeSheet(); render(); toast('Marked as sent');
    },
    edit(el) { const e = state.entries.find((x) => x.id === el.dataset.id); if (e) editSheet(e); },
    unsend(el) {
      const e = state.entries.find((x) => x.id === el.dataset.id);
      if (e) { e.sentAt = null; save(); closeSheet(); render(); toast('Moved back to Not sent yet'); }
    },
    delete(el) {
      if (!confirm('Delete this overtime entry?')) return;
      state.entries = state.entries.filter((x) => x.id !== el.dataset.id);
      save(); closeSheet(); render(); toast('Deleted');
    },
    'sheet-cancel'() { closeSheet(); },
    'hide-install'() { state.settings.hideInstall = true; save(); render(); },
    async 'share-app'() {
      const data = { title: 'Overtime Claims', text: 'Overtime Claims — log unrostered overtime and email the claim form in seconds. Open in Safari, then Share → Add to Home Screen.', url: APP_URL };
      if (navigator.share) { try { await navigator.share(data); return; } catch (e) { if (e.name === 'AbortError') return; } }
      toast(copyText(APP_URL) ? 'Link copied' : APP_URL);
    },
    'draw-signature'() {
      openSheet('Signature', `<p class="muted small" style="margin:0 4px 10px">Sign inside the box with your finger.</p>
        <canvas id="sigpad" class="sigpad"></canvas>
        <button type="button" class="btn outline" data-act="clear-pad" style="margin-top:10px">Clear</button>`, () => {
        if (!sigPad || !sigPad.drawn) { toast('Sign in the box first'); return false; }
        state.settings.signature = sigPad.export(); sigPad = null; save(); toast('Signature saved');
      });
      mountPad($('#sigpad'));
    },
    'clear-pad'() { if (sigPad) sigPad.clear(); },
    'remove-signature'() { if (confirm('Remove your saved signature?')) { delete state.settings.signature; save(); render(); } },
    'welcome-next'() {
      if (welcomeStep === 0 && !(state.settings.name || '').trim()) { toast('Please enter your name'); $('[data-setting=name]')?.focus(); return; }
      welcomeStep += 1; render(); window.scrollTo(0, 0);
    },
    'welcome-back'() { welcomeStep = Math.max(0, welcomeStep - 1); render(); window.scrollTo(0, 0); },
    'pick-level'(el) { state.settings.level = el.dataset.level; save(); welcomeStep = 2; render(); window.scrollTo(0, 0); },
    'welcome-finish'() {
      if (!sigPad || !sigPad.drawn) { toast('Sign in the box, or tap Skip'); return; }
      state.settings.signature = sigPad.export(); sigPad = null; finishWelcome();
    },
    'welcome-skip-sign'() { sigPad = null; finishWelcome(); },
    backup() {
      const blob = new Blob([JSON.stringify({ app: 'overtime-claims', exported: new Date().toISOString(), ...state }, null, 2)], { type: 'application/json' });
      const file = new File([blob], `Overtime-backup_${isoDate(new Date())}.json`, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file] }).catch(() => {});
      else download(file, file.name);
    },
    restore() { $('#restore-file').click(); },
    wipe() {
      if (!confirm('Erase ALL overtime entries and details from this phone?')) return;
      if (!confirm('Are you sure? This cannot be undone.')) return;
      state = { settings: {}, entries: [] }; save(); welcomeStep = 0; draft = null; render(); toast('All data erased');
    },
  };

  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { if (!state.settings.onboarded) return; route = { tab: tab.dataset.tab }; render(); window.scrollTo(0, 0); return; }
    const el = e.target.closest('[data-act]');
    if (el && actions[el.dataset.act]) { e.preventDefault(); actions[el.dataset.act](el); }
  });
  document.addEventListener('input', (e) => {
    const key = e.target.dataset && e.target.dataset.setting;
    if (key) { state.settings[key] = e.target.value; save(); return; }
    const form = e.target.closest('form');
    if (form && form.querySelector('#result')) refreshLog(form);
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'restore-file' && e.target.files[0]) restore(e.target.files[0]);
    const key = e.target.dataset && e.target.dataset.setting;
    if (key === 'level' && state.settings.onboarded) render();
    const form = e.target.closest('form');
    if (form && form.querySelector('#result')) refreshLog(form);
  });
  // Coming back to the app later: start a fresh entry with "left at" set to now.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !state.settings.onboarded || route.tab !== 'log' || $('#sheet').open) return;
    const f = $('#log-form [name=finish]');
    if (f && document.activeElement !== f && draft && draft.date === isoDate(new Date())) { f.value = hhmm(new Date()); refreshLog(); }
  });

  // ---------- boot ----------
  borrowOnCallDetails();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!state.settings.onboarded && state.entries.length) { state.settings.onboarded = true; save(); }
  render();
})();
