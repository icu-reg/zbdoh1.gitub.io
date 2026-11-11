/* On-Call Log — everything is stored on this device only (localStorage). */
(() => {
  'use strict';

  const KEY = 'oncall-log-v1';
  const TYPES = { phone: 'Remote', recall: 'Physical' };
  const TYPE_LABELS = { phone: 'Remote (phone)', recall: 'Went in (physical)' };
  const HOUR = 3600000;
  // Registrar weekly rates, Victorian Doctors in Training Agreement 2022-2026 (AMA Victoria/ASMOF),
  // as at the first full pay period on or after 1 March 2025. Update here when a new agreement lands.
  const RATES_FROM = '1 March 2025';
  const WEEKLY = { 1: 2481.70, 2: 2623.33, 3: 2723.30, 4: 2859.75, 5: 3253.02, 6: 3415.81 };
  const WEEK_HOURS = 43; // registrar hourly rate for overtime = weekly rate / 43
  const money = (n) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ---------- state ----------
  let state = load();
  let route = { tab: 'home', shiftId: null };
  let ticker = null;

  function load() {
    const base = { settings: {}, shifts: [], calls: [] };
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      return saved && typeof saved === 'object' ? { ...base, ...saved } : base;
    } catch {
      return base;
    }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      toast('Could not save — phone storage is full');
    }
  }

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const pad = (n) => String(n).padStart(2, '0');

  const toInput = (d) => {
    d = new Date(d);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const toDateInput = (d) => toInput(d).slice(0, 10);
  const fromInput = (v) => { const d = new Date(v); return isNaN(d) ? null : d.toISOString(); };
  const fmtTime = (d) => { d = new Date(d); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtDate = (d, withYear) => new Date(d).toLocaleDateString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
  const fmtDateTime = (d, withYear) => `${fmtDate(d, withYear)}, ${fmtTime(d)}`;
  const fmtDur = (ms) => {
    const m = Math.max(0, Math.round(ms / 60000));
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${pad(m % 60)} min`;
  };

  const activeShift = () => state.shifts.find((s) => !s.end) || null;
  const shiftCalls = (id) => state.calls.filter((c) => c.shiftId === id)
    .sort((a, b) => a.time.localeCompare(b.time));
  // Clause 39A: remote recall is paid a minimum of 1 hour, and further calls within the hour of a paid
  // call attract no extra payment. A call exactly 60 minutes after a paid call is paid again.
  // Physical recalls are always claimable.
  function paidIds() {
    const paid = new Set();
    let last = -Infinity;
    [...state.calls].sort((a, b) => a.time.localeCompare(b.time)).forEach((c) => {
      if (c.type === 'recall') { paid.add(c.id); return; }
      const t = Math.floor(new Date(c.time).getTime() / 60000) * 60000;
      if (t - last >= HOUR) { paid.add(c.id); last = t; }
    });
    return paid;
  }
  function hourlyRate() {
    const st = state.settings;
    const custom = parseFloat(st.customRate);
    if (custom > 0) return custom;
    return WEEKLY[st.year] ? WEEKLY[st.year] / WEEK_HOURS : 0;
  }
  function payFor(calls) {
    const paid = paidIds();
    const remote = calls.filter((c) => c.type !== 'recall');
    const paidCalls = remote.filter((c) => paid.has(c.id));
    const hours = paidCalls.reduce((sum, c) => sum + Math.max(1, (Number(c.duration) || 0) / 60), 0);
    const rate = hourlyRate();
    const mult = parseFloat(state.settings.multiplier) || 1.5;
    return { paid: paidCalls.length, unpaid: remote.length - paidCalls.length,
      physical: calls.length - remote.length, hours, rate, mult, total: hours * rate * mult };
  }
  const sortedShifts = () => [...state.shifts].sort((a, b) => b.start.localeCompare(a.start));
  const shiftRange = (s) => {
    const sameDay = s.end && new Date(s.start).toDateString() === new Date(s.end).toDateString();
    if (!s.end) return `${fmtDateTime(s.start)} – now`;
    return sameDay
      ? `${fmtDate(s.start)}, ${fmtTime(s.start)} – ${fmtTime(s.end)}`
      : `${fmtDateTime(s.start)} – ${fmtDateTime(s.end)}`;
  };

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------- rendering ----------
  function render() {
    clearInterval(ticker);
    const view = $('#view');
    paidCache = paidIds();
    const inShift = route.tab === 'history' && route.shiftId;
    $('#back').hidden = !inShift;
    document.querySelectorAll('.tabbar button').forEach((b) => {
      if (b.dataset.tab === route.tab) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });

    if (route.tab === 'home') { $('#title').textContent = 'On-Call Log'; view.innerHTML = homeView(); startTicker(); }
    else if (inShift) { $('#title').textContent = 'On-call period'; view.innerHTML = shiftView(route.shiftId); }
    else if (route.tab === 'history') { $('#title').textContent = 'History'; view.innerHTML = historyView(); }
    else { $('#title').textContent = 'My details'; view.innerHTML = settingsView(); }
  }

  let paidCache = new Set();
  function callRow(c) {
    const meta = [c.from, c.reason].filter(Boolean).join(' · ') || 'No details';
    const dur = c.duration ? ` · ${c.duration} min` : '';
    return `<button class="row" data-act="edit-call" data-id="${esc(c.id)}">
      <span class="time">${fmtTime(c.time)}</span>
      <span class="body">
        <span class="line1">${esc([c.urn ? 'URN ' + c.urn : '', c.patient].filter(Boolean).join(' · ') || 'No patient details')}${
          c.type === 'recall' ? '<span class="badge recall">Went in</span>' : (paidCache.has(c.id) ? '<span class="badge">Paid</span>' : '<span class="badge none">No pay</span>')}</span>
        <span class="line2">${esc(meta)}${dur}</span>
      </span>
      <span class="chev" aria-hidden="true">›</span>
    </button>`;
  }

  function callList(calls, emptyMsg) {
    return calls.length
      ? `<div class="list">${calls.map(callRow).join('')}</div>`
      : `<div class="list"><div class="empty">${emptyMsg}</div></div>`;
  }

  // ---------- install & share ----------
  const APP_URL = new URL('./', location.href).href;
  const SHARE_ICON = '<svg class="inline-ico" viewBox="0 0 24 24" aria-label="Share"><path d="M12 3v12M8 6.5 12 3l4 3.500M6 10.500H5a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8.500a1 1 0 0 0-1-1h-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; if (route.tab === 'home') render(); });
  window.addEventListener('appinstalled', () => { installPrompt = null; render(); });

  function installCard() {
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const otherIosBrowser = ios && /CriOS|FxiOS|EdgiOS/.test(ua);
    let body;
    if (installPrompt) {
      body = `<p>Install it so it opens like a normal app and works without signal.</p>
        <button class="btn primary" data-act="install" style="margin-top:12px">Install app</button>`;
    } else if (ios) {
      body = `<ol class="steps">
          <li>Tap ${SHARE_ICON} <b>Share</b> ${otherIosBrowser ? 'at the top right, next to the address' : 'at the bottom of Safari'}</li>
          <li>Scroll down and tap <b>Add to Home Screen</b></li>
          <li>Tap <b>Add</b>, then open it from the new icon</li>
        </ol>
        <p class="small">Do this first — calls you log are kept by the Home Screen app.</p>`;
    } else {
      body = `<p>On an iPhone, open this page in Safari, tap ${SHARE_ICON} <b>Share</b>, then <b>Add to Home Screen</b>.</p>`;
    }
    return `<div class="card tip"><b class="tip-title">Add On-Call Log to your Home Screen</b>${body}
      <button class="link small" data-act="hide-install" style="padding:8px 0 0">Not now</button></div>`;
  }

  function qrSvg(text) {
    if (!window.qrcode) return '';
    try {
      const q = window.qrcode(0, 'M');
      q.addData(text); q.make();
      return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch { return ''; }
  }

  function homeView() {
    const s = activeShift();
    const standalone = window.navigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches;
    const tip = standalone || state.settings.hideInstall ? '' : installCard();

    if (!s) {
      const last = sortedShifts()[0];
      return `${tip}
        <section class="card status">
          <span class="pill">NOT ON CALL</span>
          <p class="big">Ready when you are</p>
          <p class="sub">Start an on-call period to begin logging calls.</p>
          <button class="btn primary huge" data-act="start-shift">Start on-call</button>
        </section>
        ${last ? `<h2 class="section-title">Last on-call</h2>
        <div class="list"><button class="row" data-act="open-shift" data-id="${esc(last.id)}">
          <span class="body"><span class="line1">${esc(shiftRange(last))}</span>
          <span class="line2">${shiftCalls(last.id).length} call(s) · tap to review or make the PDF</span></span>
          <span class="chev" aria-hidden="true">›</span></button></div>` : ''}`;
    }

    const calls = shiftCalls(s.id);
    return `${tip}
      <section class="card status on">
        <span class="pill">ON CALL</span>
        <p class="big">Since ${esc(fmtDateTime(s.start))}</p>
        <p class="sub" id="elapsed"></p>
        <button class="btn primary huge" data-act="new-call" data-shift="${esc(s.id)}">+ Log a call</button>
        <button class="btn outline" data-act="end-shift">End on-call</button>
      </section>
      <h2 class="section-title">Calls this period</h2>
      ${callList([...calls].reverse(), 'No calls yet. Fingers crossed for a quiet one.')}`;
  }

  function startTicker() {
    const s = activeShift();
    const el = $('#elapsed');
    if (!s || !el) return;
    const tick = () => {
      const n = shiftCalls(s.id).length;
      el.textContent = `${fmtDur(Date.now() - new Date(s.start))} · ${n} call${n === 1 ? '' : 's'}`;
    };
    tick();
    ticker = setInterval(tick, 30000);
  }

  function historyView() {
    const shifts = sortedShifts();
    if (!shifts.length) {
      return `<div class="list"><div class="empty">Nothing here yet. On-call periods appear here once you start one.</div></div>`;
    }
    return `<button class="btn soft" data-act="range-pdf">Recall form for a date range</button>
      <h2 class="section-title">On-call periods</h2>
      <div class="list">${shifts.map((s) => {
        const n = shiftCalls(s.id).length;
        return `<button class="row" data-act="open-shift" data-id="${esc(s.id)}">
          <span class="body">
            <span class="line1">${esc(shiftRange(s))}${s.end ? '' : '<span class="badge">Active</span>'}</span>
            <span class="line2">${n} call${n === 1 ? '' : 's'}${s.end ? ' · ' + fmtDur(new Date(s.end) - new Date(s.start)) : ''}</span>
          </span><span class="chev" aria-hidden="true">›</span></button>`;
      }).join('')}</div>`;
  }

  function shiftView(id) {
    const s = state.shifts.find((x) => x.id === id);
    if (!s) { route.shiftId = null; return historyView(); }
    const calls = shiftCalls(id);
    const recalls = calls.filter((c) => c.type === 'recall').length;
    return `<section class="card">
        <p class="muted small">On-call period</p>
        <p style="font-size:20px;font-weight:700;margin:2px 0 4px">${esc(shiftRange(s))}</p>
        <p class="muted">${calls.length} call${calls.length === 1 ? '' : 's'}${recalls ? ` · ${recalls} recall${recalls === 1 ? '' : 's'}` : ''}${
          s.end ? ' · ' + fmtDur(new Date(s.end) - new Date(s.start)) : ' · still active'}</p>
        <div style="margin-top:16px">
          <button class="btn primary" data-act="shift-pdf" data-id="${esc(id)}">Create recall form (PDF)</button>
          <div class="btn-row" style="margin-top:10px">
            <button class="btn soft" data-act="new-call" data-shift="${esc(id)}">+ Add call</button>
            <button class="btn outline" data-act="edit-shift" data-id="${esc(id)}">Edit times</button>
          </div>
        </div>
      </section>
      ${payCard(calls)}
      <h2 class="section-title">Calls</h2>
      ${callList(calls, 'No calls logged for this period.')}
      <button class="btn danger" data-act="delete-shift" data-id="${esc(id)}">Delete this on-call period</button>`;
  }

  function payCard(calls) {
    if (!calls.length) return '';
    const p = payFor(calls);
    const counts = `${p.paid} paid call${p.paid === 1 ? '' : 's'}${p.unpaid ? ` · ${p.unpaid} not paid (within the hour of a paid call)` : ''}`;
    const phys = p.physical ? `<p class="muted small" style="margin-top:6px">${p.physical} physical recall${p.physical === 1 ? '' : 's'} not included — claim those on the form as well.</p>` : '';
    if (!p.rate) {
      return `<section class="card"><p class="muted small">Estimated recall pay</p>
        <p style="font-weight:600;margin:4px 0">${counts}</p>
        <p class="muted small">Choose your registrar year in My details to see the dollar amount.</p>${phys}</section>`;
    }
    const st = state.settings;
    const who = parseFloat(st.customRate) > 0 ? 'Your rate' : `Registrar Year ${st.year}${st.year === '6' ? '+' : ''}`;
    return `<section class="card">
      <p class="muted small">Estimated recall pay (before tax)</p>
      <p style="font-size:30px;font-weight:700;margin:2px 0 4px">${money(p.total)}</p>
      <p>${counts}</p>
      <p class="muted small" style="margin-top:6px">${who}: ${p.hours % 1 ? p.hours.toFixed(2) : p.hours} h × ${money(p.rate)}/h × ${p.mult}. On-call allowance not included. An estimate only — payroll has the final say.</p>${phys}
    </section>`;
  }

  function settingsView() {
    const st = state.settings;
    const f = (key, label, extra = '') => `<label class="field"><span>${label}</span>
      <input data-setting="${key}" value="${esc(st[key])}" autocomplete="off" ${extra}></label>`;
    const sel = (key, label, opts) => `<label class="field"><span>${label}</span>
      <select data-setting="${key}">${opts.map(([v, t]) => `<option value="${esc(v)}" ${String(st[key] ?? opts[0][0]) === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
    return `<p class="muted small" style="margin:0 4px 14px">These details are printed on the recall claim form.</p>
      ${f('name', 'Full name', 'autocapitalize="words"')}
      ${f('position', 'Position', 'placeholder="e.g. Registrar" autocapitalize="words"')}
      ${f('employeeId', 'Employee / payroll number')}
      ${f('department', 'Department / unit', 'autocapitalize="words"')}
      ${sel('form', 'Claim form', [['alfred', 'Alfred Health — Recall Claim Form'], ['monash', 'Monash Health — Recall Form (without return)']])}
      ${st.form === 'monash' ? f('costCentre', 'Cost centre (if you know it)') : sel('cylinders', 'Car (for travel claims)', [['', 'Not set'], ['4', '4 cylinder'], ['6', '6 cylinder']])}
      ${sel('include', 'Remote calls to put on the form', [['paid', 'Paid calls only (one per hour)'], ['all', 'All calls']])}
      <h2 class="section-title">Pay</h2>
      ${sel('year', 'Registrar year level', [['', 'Choose…'], ...[1, 2, 3, 4, 5, 6].map((y) => [String(y), `Registrar Year ${y}${y === 6 ? ' and above' : ''} — ${money(WEEKLY[y] / WEEK_HOURS)}/h`])])}
      ${sel('multiplier', 'Overtime rate for remote recall', [['1.5', 'Time and a half (1.5×)'], ['2', 'Double time (2×)']])}
      ${f('customRate', 'Your own hourly rate (optional, overrides year level)', 'inputmode="decimal" placeholder="e.g. 63.33"')}
      <p class="muted small" style="margin:-6px 4px 0">Rates from the AMA Victoria Doctors in Training Agreement 2022–2026, as at ${RATES_FROM}: weekly rate ÷ ${WEEK_HOURS}. Each paid remote call is a minimum of 1 hour at the overtime rate.</p>
      <h2 class="section-title">Share with a colleague</h2>
      <div class="card center">
        <div class="qr">${qrSvg(APP_URL)}</div>
        <p class="small muted" style="margin:10px 0 12px">They point their iPhone camera at this code, or you send them the link. Everyone's calls stay on their own phone.</p>
        <button class="btn soft" data-act="share-app">Send the link</button>
      </div>
      <h2 class="section-title">Backup</h2>
      <div class="card">
        <p class="small muted" style="margin-bottom:12px">Everything is stored only on this phone — nothing is uploaded anywhere. Save a backup file now and then in case the phone is lost or replaced.</p>
        <button class="btn soft" data-act="backup">Save a backup file</button>
        <button class="btn outline" data-act="restore">Restore from a backup file</button>
        <input type="file" id="restore-file" accept="application/json,.json" hidden>
      </div>
      <button class="btn danger" data-act="wipe">Erase all data on this phone</button>
      <p class="muted small center" style="margin-top:18px">Contains patient identifiers — keep this phone passcode-locked.</p>`;
  }

  // ---------- bottom sheet ----------
  let sheetSubmit = null;
  function openSheet(title, html, onSubmit, saveLabel = 'Save') {
    $('#sheet-title').textContent = title;
    $('#sheet-body').innerHTML = html;
    $('#sheet-save').textContent = saveLabel;
    sheetSubmit = onSubmit;
    const dlg = $('#sheet');
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    $('#sheet-body').scrollTop = 0;
  }
  function closeSheet() {
    const dlg = $('#sheet');
    if (dlg.close) dlg.close(); else dlg.removeAttribute('open');
    sheetSubmit = null;
  }
  $('#sheet-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!sheetSubmit) return;
    const data = Object.fromEntries(new FormData(e.target).entries());
    if (sheetSubmit(data) !== false) { closeSheet(); render(); }
  });
  $('#sheet').addEventListener('cancel', () => { sheetSubmit = null; });

  // ---------- call form ----------
  function recentFroms() {
    const seen = new Set();
    return [...state.calls].sort((a, b) => b.time.localeCompare(a.time))
      .map((c) => (c.from || '').trim()).filter((v) => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()))
      .slice(0, 5);
  }

  function callForm(shiftId, call) {
    const isNew = !call;
    const c = call || { time: new Date().toISOString(), type: 'phone', urn: '', patient: '', travel: '', from: '', reason: '', duration: 5, notes: '' };
    const shift = state.shifts.find((s) => s.id === shiftId);
    // Adding to a finished period: default the time to that period, not to "now".
    if (isNew && shift && shift.end) c.time = shift.start;
    const chips = recentFroms();
    const html = `
      <label class="field"><span>Patient UR number</span>
        <input class="urn" name="urn" value="${esc(c.urn)}" inputmode="numeric" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" placeholder="e.g. 1234567"></label>
      <label class="field"><span>Patient initials</span>
        <input name="patient" value="${esc(c.patient)}" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" placeholder="e.g. NH"></label>
      <div class="seg" role="radiogroup" aria-label="Type of call">
        ${Object.entries(TYPE_LABELS).map(([k, v]) => `<label><input type="radio" name="type" value="${k}" ${c.type === k ? 'checked' : ''}><span>${v}</span></label>`).join('')}
      </div>
      <div class="two">
        <label class="field"><span>Start time</span>
          <input type="datetime-local" name="time" value="${toInput(c.time)}" required></label>
        <label class="field"><span>Time spent (min)</span>
          <input name="duration" value="${esc(c.duration)}" inputmode="numeric" pattern="[0-9]*" placeholder="e.g. 10"></label>
      </div>
      <label class="field"><span>Called by / ward</span>
        <input name="from" id="from-input" value="${esc(c.from)}" autocomplete="off" autocapitalize="words" placeholder="e.g. HMO (Ward), Reg (ED)"></label>
      ${chips.length ? `<div class="chips">${chips.map((v) => `<button type="button" class="chip" data-act="chip" data-value="${esc(v)}">${esc(v)}</button>`).join('')}</div>` : ''}
      <label class="field"><span>Reason (optional — the form shows UR + initials)</span>
        <input name="reason" value="${esc(c.reason)}" autocomplete="off" placeholder="e.g. external hospital name"></label>
      <label class="field"><span>Travel time &amp; km (only if you went in)</span>
        <input name="travel" value="${esc(c.travel)}" autocomplete="off" placeholder="e.g. 40 min, 28 km"></label>
      <label class="field"><span>Private notes (not on the form)</span>
        <textarea name="notes" rows="2">${esc(c.notes)}</textarea></label>
      ${isNew ? '' : `<button type="button" class="btn danger" data-act="delete-call" data-id="${esc(c.id)}">Delete this call</button>`}`;

    openSheet(isNew ? 'Log a call' : 'Edit call', html, (d) => {
      const time = fromInput(d.time);
      if (!time) { toast('Please enter the time of the call'); return false; }
      const fields = {
        time,
        urn: d.urn.trim().toUpperCase(),
        patient: d.patient.trim().toUpperCase(),
        travel: d.travel.trim(),
        type: TYPES[d.type] ? d.type : 'phone',
        from: d.from.trim(),
        reason: d.reason.trim(),
        duration: d.duration.trim() ? Math.max(0, parseInt(d.duration, 10) || 0) : '',
        notes: d.notes.trim(),
      };
      if (isNew) state.calls.push({ id: uid(), shiftId, ...fields });
      else Object.assign(call, fields);
      save();
      toast(isNew ? 'Call logged' : 'Call updated');
    });
    if (isNew) setTimeout(() => $('#sheet-body .urn')?.focus(), 50);
  }

  function shiftForm(shift) {
    const html = `
      <label class="field"><span>On-call started</span>
        <input type="datetime-local" name="start" value="${toInput(shift.start)}" required></label>
      <label class="field"><span>On-call ended ${shift.end ? '' : '(leave empty if still on call)'}</span>
        <input type="datetime-local" name="end" value="${shift.end ? toInput(shift.end) : ''}"></label>`;
    openSheet('Edit times', html, (d) => {
      const start = fromInput(d.start);
      const end = d.end ? fromInput(d.end) : null;
      if (!start) { toast('Please enter a start time'); return false; }
      if (end && end <= start) { toast('End must be after the start'); return false; }
      if (!end && state.shifts.some((s) => !s.end && s.id !== shift.id)) {
        toast('Another on-call period is already active'); return false;
      }
      shift.start = start; shift.end = end; save();
    });
  }

  function rangeForm() {
    const to = new Date();
    const from = new Date(Date.now() - 13 * 864e5);
    const html = `<p class="muted small" style="margin:0 4px 14px">Makes one recall form covering every on-call period that started between these dates — handy for a pay fortnight.</p>
      <div class="two">
        <label class="field"><span>From</span><input type="date" name="from" value="${toDateInput(from)}" required></label>
        <label class="field"><span>To</span><input type="date" name="to" value="${toDateInput(to)}" required></label>
      </div>`;
    openSheet('Date range', html, (d) => {
      const a = new Date(d.from + 'T00:00'), b = new Date(d.to + 'T23:59:59');
      if (isNaN(a) || isNaN(b) || b < a) { toast('Check the dates'); return false; }
      const shifts = state.shifts.filter((s) => { const t = new Date(s.start); return t >= a && t <= b; });
      if (!shifts.length) { toast('No on-call periods in that range'); return false; }
      makePdf(shifts);
    }, 'Create');
  }

  // ---------- PDF: Recall Form (without return to Hospital) ----------
  const ROWS_PER_PAGE = 15;
  const fmtDmy = (d) => { d = new Date(d); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };

  // One row per claim: phone calls that fall within an hour of the first call are grouped together.
  function claimRows(shifts) {
    const ids = new Set(shifts.map((s) => s.id));
    const calls = state.calls.filter((c) => ids.has(c.shiftId) && c.type !== 'recall')
      .sort((a, b) => a.time.localeCompare(b.time));
    const groups = [];
    calls.forEach((c) => {
      const t = new Date(c.time).getTime();
      const g = groups[groups.length - 1];
      if (g && t - g.start < 3600000) g.calls.push(c);
      else groups.push({ start: t, calls: [c] });
    });
    return groups.map((g) => {
      const mins = g.calls.reduce((sum, c) => sum + (Number(c.duration) || 0), 0);
      const uniq = (k) => [...new Set(g.calls.map((c) => (c[k] || '').trim()).filter(Boolean))].join(', ');
      return [fmtDmy(g.start), fmtTime(g.start) + (mins ? `   (${mins} min)` : ''), String(g.calls.length), uniq('patient'), uniq('urn')];
    });
  }

  function makeMonashPdf(shifts) {
    if (!window.jspdf) { toast('PDF tools did not load — reopen the app with signal once'); return; }
    shifts = [...shifts].sort((a, b) => a.start.localeCompare(b.start));
    const rows = claimRows(shifts);
    if (!rows.length) { toast('No phone-only calls to put on the form'); return; }
    while (rows.length % ROWS_PER_PAGE) rows.push(['', '', '', '', '']);

    const st = state.settings;
    const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 16;

    const pageFrame = () => {
      doc.setTextColor(0);
      doc.setFont('helvetica', 'bold').setFontSize(15).text('Monash Health', M, 15);
      doc.setFont('helvetica', 'normal').setFontSize(20).text('Recall Form (without return to Hospital)', M, 27);
      doc.setFont('helvetica', 'italic').setFontSize(8);
      doc.text('Doctors in Training (Victorian Public Health Sector) (AMA Victoria/ASMOF)', M, 33);
      doc.text('Agreement 2022-2026 (and its successor Enterprise Agreements)', M, 37);
      doc.setFont('helvetica', 'normal').setFontSize(11);
      doc.text('Name :', M, 46);
      doc.text('Employee Number:', M + 120, 46);
      doc.setFont('helvetica', 'bold');
      doc.text(st.name || '', M + 16, 46);
      doc.text(st.employeeId || '', M + 156, 46);
      doc.setFont('helvetica', 'normal').setFontSize(10);
      doc.text('EACH CLAIM must be authorised by your Consultant or Unit Head.', M, 53);

      doc.setFont('helvetica', 'bold').setFontSize(11);
      doc.text('Doctors Signature:', M, H - 16);
      doc.text('Authorised Manager:', M + 100, H - 16);
      doc.text('Cost Centre:', M + 195, H - 16);
      if (st.costCentre) doc.setFont('helvetica', 'normal').text(st.costCentre, M + 221, H - 16);
      doc.setFont('helvetica', 'normal').setFontSize(9)
        .text(String(doc.getCurrentPageInfo().pageNumber), W / 2, H - 7, { align: 'center' });
    };

    doc.autoTable({
      startY: 57,
      margin: { top: 57, left: M, right: M, bottom: 24 },
      head: [['Date', 'Time of Recall & Duration', 'Number of calls in Single Hour', 'Patient Names (s)', 'Patient UR number(s)']],
      body: rows,
      theme: 'grid',
      rowPageBreak: 'avoid',
      styles: { font: 'helvetica', fontSize: 10, cellPadding: { top: 1.6, bottom: 1.6, left: 2, right: 2 }, minCellHeight: 7.4, valign: 'middle', textColor: 0, lineColor: 60, lineWidth: 0.2, overflow: 'linebreak' },
      headStyles: { fillColor: [170, 170, 170], textColor: 0, fontStyle: 'bold', halign: 'center' },
      columnStyles: { 0: { cellWidth: 28 }, 1: { cellWidth: 50 }, 2: { cellWidth: 56, halign: 'center' }, 3: { cellWidth: 'auto' }, 4: { cellWidth: 55 } },
      didDrawPage: pageFrame,
    });

    const first = shifts[0], last = shifts[shifts.length - 1];
    const who = (st.name || '').trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const name = `Recall-Form${who ? '_' + who : ''}_${toDateInput(first.start)}${shifts.length > 1 ? '_to_' + toDateInput(last.start) : ''}.pdf`;
    shareFile(doc.output('blob'), name, 'application/pdf');
  }

  // ---------- PDF: Alfred Health Recall Claim Form ----------
  const ALFRED_ROWS = 11;
  function makeAlfredPdf(shifts) {
    if (!window.jspdf) { toast('PDF tools did not load — reopen the app with signal once'); return; }
    shifts = [...shifts].sort((a, b) => a.start.localeCompare(b.start));
    const st = state.settings;
    const ids = new Set(shifts.map((s) => s.id));
    const paid = paidIds();
    const calls = state.calls
      .filter((c) => ids.has(c.shiftId) && (c.type === 'recall' || st.include === 'all' || paid.has(c.id)))
      .sort((a, b) => a.time.localeCompare(b.time));
    if (!calls.length) { toast('No calls to put on the form'); return; }

    const rows = calls.map((c) => {
      const d = new Date(c.time);
      const mins = Number(c.duration) || 0;
      const who = [c.urn ? 'URN ' + c.urn : '', c.patient].filter(Boolean).join(' - ');
      return [`${d.getDate()}/${d.getMonth() + 1}`, TYPES[c.type] || TYPES.phone, c.from || '',
        [who, c.reason].filter(Boolean).join('\n'), fmtTime(d), mins ? fmtTime(d.getTime() + mins * 60000) : '',
        c.type === 'recall' ? (c.travel || '') : ''];
    });
    while (rows.length % ALFRED_ROWS) rows.push(['', '', '', '', '', '', '']);

    const doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 14, IW = W - 2 * M;
    const maroon = [134, 22, 54], grey = [217, 217, 217];
    const TOP = 80, FOOT = H - 58;

    const bar = (y, h, label) => {
      doc.setFillColor(...maroon).rect(M, y, IW, h, 'F');
      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(255).text(label, M + 2, y + h / 2 + 1.1);
      doc.setTextColor(0);
    };
    const cell = (x, y, w, h, text, opts = {}) => {
      if (opts.fill) doc.setFillColor(...grey);
      doc.setDrawColor(0).setLineWidth(0.2).rect(x, y, w, h, opts.fill ? 'FD' : 'S');
      if (text) doc.setFont('helvetica', opts.bold ? 'bold' : 'normal').setFontSize(opts.size || 8).text(String(text), x + 2, y + h / 2 + 1.2);
    };

    const pageFrame = () => {
      doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(200, 30, 45).text('Alfred Health', M - 4, 13);
      doc.setTextColor(0).setFontSize(13).text('Recall Claim Form', W / 2, 21, { align: 'center' });
      bar(27, 6, 'INSTRUCTIONS');
      doc.setDrawColor(0).setLineWidth(0.2).rect(M, 33, IW, 41);
      doc.setFont('helvetica', 'normal').setFontSize(7.6);
      [
        [2, 'Please use this form if you are on-call and recalled to duty, to complete either:'],
        [8, '•     Remote work by electronic means from off-site  i.e. telephone and/or computer'],
        [8, '•     Physical return to the health service'],
        [2, 'Please ensure the following:'],
        [6, '1.    Select whether you remotely worked electronically or whether you physically went into the health service'],
        [6, '2.    Record the reason for recall, the start and end time of the recall, and enter travel details if applicable'],
        [6, '3.    Ask your Head of Unit or supervising consultant to approve. Contact Medical Workforce Unit if you need support'],
        [6, '4.    Email the approved form to medicalrosters@alfred.org.au or hand deliver it to the Medical Workforce Unit by 0900'],
        [11.5, 'Monday of the pay period end'],
      ].forEach(([indent, line], i) => doc.text(line, M + indent, 37.5 + i * 4.25));
      bar(74, 6, 'RECALL INFORMATION');

      // footer
      let y = FOOT;
      doc.rect(M, y, IW, 7);
      doc.setFont('helvetica', 'bold').setFontSize(7.5).text('For travel, *tick* number of cylinders in vehicle:', M + 2, y + 4.4);
      [['4cyl', 68, '4'], ['6cyl', 84, '6']].forEach(([label, x, v]) => {
        doc.text(label, M + x, y + 4.4);
        doc.rect(M + x + 7, y + 1, 5, 5);
        if (st.cylinders === v) { doc.setLineWidth(0.5).line(M + x + 8, y + 3.6, M + x + 9.4, y + 5).line(M + x + 9.4, y + 5, M + x + 11.2, y + 1.8); doc.setLineWidth(0.2); }
      });
      y += 7; bar(y, 6, 'EMPLOYEE DECLARATION'); y += 6;
      const a = 24, b = 76, c = 26, d = IW - a - b - c;
      cell(M, y, a, 8, 'Name', { fill: true, bold: true }); cell(M + a, y, b, 8, st.name, { size: 11 });
      cell(M + a + b, y, c, 8, 'Employee #', { fill: true, bold: true }); cell(M + a + b + c, y, d, 8, st.employeeId, { size: 11 });
      y += 8;
      cell(M, y, a, 8, 'Department', { fill: true, bold: true }); cell(M + a, y, b, 8, st.department, { size: 11 });
      cell(M + a + b, y, c, 8, 'Signature', { fill: true, bold: true }); cell(M + a + b + c, y, d, 8, '');
      y += 8; bar(y, 6, 'SUPERVISING CONSULTANT / UNIT HEAD APPROVAL'); y += 6;
      cell(M, y, a, 9, 'Name', { fill: true, bold: true }); cell(M + a, y, b, 9, '');
      cell(M + a + b, y, c, 9, 'Signature', { fill: true, bold: true }); cell(M + a + b + c, y, d, 9, '');
    };

    doc.autoTable({
      startY: TOP,
      margin: { top: TOP, left: M, right: M, bottom: H - FOOT },
      head: [['Date', 'Recall Type (e.g. physical, remote)', 'Called by (e.g. ED, wards, external hospital)',
        'Reason for Recall\n(if called by an external hospital, please specify which hospital)',
        'Recall Start time\n(not including travel)', 'Recall Finish time\n(not including travel)',
        'Travel Time & Distance travelled (kms)\n(physical recall only)']],
      body: rows,
      theme: 'grid',
      rowPageBreak: 'avoid',
      styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 1.2, minCellHeight: 12.4, valign: 'middle', textColor: 0, lineColor: 0, lineWidth: 0.2, overflow: 'linebreak' },
      headStyles: { fillColor: 255, textColor: 0, fontStyle: 'bold', halign: 'center', fontSize: 7.5, minCellHeight: 18 },
      columnStyles: {
        0: { cellWidth: 17, halign: 'center', fontSize: 12 }, 1: { cellWidth: 20, halign: 'center' }, 2: { cellWidth: 31 },
        3: { cellWidth: 'auto', halign: 'center' }, 4: { cellWidth: 20, halign: 'center', fontSize: 12 },
        5: { cellWidth: 20, halign: 'center', fontSize: 12 }, 6: { cellWidth: 28, halign: 'center' },
      },
      didDrawPage: pageFrame,
    });

    const first = shifts[0], last = shifts[shifts.length - 1];
    const who = (st.name || '').trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const name = `Recall-Claim${who ? '_' + who : ''}_${toDateInput(first.start)}${shifts.length > 1 ? '_to_' + toDateInput(last.start) : ''}.pdf`;
    shareFile(doc.output('blob'), name, 'application/pdf');
  }

  function makePdf(shifts) {
    return state.settings.form === 'monash' ? makeMonashPdf(shifts) : makeAlfredPdf(shifts);
  }

  async function shareFile(blob, name, type) {
    const file = new File([blob], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    toast('PDF saved');
  }

  // ---------- backup ----------
  function restore(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.shifts) || !Array.isArray(data.calls)) throw new Error('bad');
        if (!confirm(`Replace everything on this phone with the backup (${data.shifts.length} on-call periods, ${data.calls.length} calls)?`)) return;
        state = { settings: data.settings || {}, shifts: data.shifts, calls: data.calls };
        save(); render(); toast('Backup restored');
      } catch { toast('That file is not an On-Call Log backup'); }
    };
    reader.readAsText(file);
  }

  // ---------- actions ----------
  const actions = {
    'start-shift'() {
      if (activeShift()) return;
      state.shifts.push({ id: uid(), start: new Date().toISOString(), end: null });
      save(); render(); toast('On-call started');
    },
    'end-shift'() {
      const s = activeShift();
      if (!s || !confirm('End this on-call period now?')) return;
      s.end = new Date().toISOString(); save();
      route = { tab: 'history', shiftId: s.id }; render();
    },
    'new-call'(el) { callForm(el.dataset.shift, null); },
    'edit-call'(el) {
      const c = state.calls.find((x) => x.id === el.dataset.id);
      if (c) callForm(c.shiftId, c);
    },
    'delete-call'(el) {
      if (!confirm('Delete this call?')) return;
      state.calls = state.calls.filter((c) => c.id !== el.dataset.id);
      save(); closeSheet(); render(); toast('Call deleted');
    },
    chip(el) { const i = $('#from-input'); if (i) i.value = el.dataset.value; },
    'open-shift'(el) { route = { tab: 'history', shiftId: el.dataset.id }; render(); window.scrollTo(0, 0); },
    'edit-shift'(el) { const s = state.shifts.find((x) => x.id === el.dataset.id); if (s) shiftForm(s); },
    'delete-shift'(el) {
      const n = shiftCalls(el.dataset.id).length;
      if (!confirm(`Delete this on-call period${n ? ` and its ${n} call(s)` : ''}? This cannot be undone.`)) return;
      state.shifts = state.shifts.filter((s) => s.id !== el.dataset.id);
      state.calls = state.calls.filter((c) => c.shiftId !== el.dataset.id);
      save(); route.shiftId = null; render();
    },
    'shift-pdf'(el) { const s = state.shifts.find((x) => x.id === el.dataset.id); if (s) makePdf([s]); },
    'range-pdf'() { rangeForm(); },
    back() { route.shiftId = null; render(); },
    'sheet-cancel'() { closeSheet(); },
    'hide-install'() { state.settings.hideInstall = true; save(); render(); },
    async install() {
      if (!installPrompt) return;
      installPrompt.prompt();
      await installPrompt.userChoice.catch(() => {});
      installPrompt = null; render();
    },
    async 'share-app'() {
      const data = { title: 'On-Call Log', text: 'On-Call Log — log on-call recalls and make the claim form. Open in Safari, then Share → Add to Home Screen.', url: APP_URL };
      if (navigator.share) {
        try { await navigator.share(data); return; } catch (e) { if (e.name === 'AbortError') return; }
      }
      try { await navigator.clipboard.writeText(APP_URL); toast('Link copied'); }
      catch { prompt('Copy this link', APP_URL); }
    },
    backup() {
      const blob = new Blob([JSON.stringify({ app: 'oncall-log', exported: new Date().toISOString(), ...state }, null, 2)], { type: 'application/json' });
      shareFile(blob, `OnCall-Log-backup_${toDateInput(new Date())}.json`, 'application/json');
    },
    restore() { $('#restore-file').click(); },
    wipe() {
      if (!confirm('Erase ALL on-call periods, calls and details from this phone?')) return;
      if (!confirm('Are you sure? This cannot be undone.')) return;
      state = { settings: {}, shifts: [], calls: [] }; save(); render(); toast('All data erased');
    },
  };

  document.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) { route = { tab: tab.dataset.tab, shiftId: null }; render(); window.scrollTo(0, 0); return; }
    const el = e.target.closest('[data-act]');
    if (el && actions[el.dataset.act]) actions[el.dataset.act](el);
  });
  document.addEventListener('input', (e) => {
    const key = e.target.dataset && e.target.dataset.setting;
    if (key) { state.settings[key] = e.target.value; save(); if (key === 'form') render(); }
  });
  document.addEventListener('change', (e) => {
    if (e.target.id === 'restore-file' && e.target.files[0]) restore(e.target.files[0]);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && route.tab === 'home' && !$('#sheet').open) render();
  });

  // ---------- boot ----------
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  render();
})();
