/* On-Call Log — everything is stored on this device only (localStorage). */
(() => {
  'use strict';

  const KEY = 'oncall-log-v1';
  const TYPES = { phone: 'Phone call', recall: 'Recall to hospital' };

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

  function callRow(c) {
    const meta = [c.from, c.reason].filter(Boolean).join(' · ') || 'No details';
    const dur = c.duration ? ` · ${c.duration} min` : '';
    return `<button class="row" data-act="edit-call" data-id="${esc(c.id)}">
      <span class="time">${fmtTime(c.time)}</span>
      <span class="body">
        <span class="line1">${c.urn ? 'URN ' + esc(c.urn) : 'No URN'}${
          c.type === 'recall' ? '<span class="badge recall">Recall</span>' : ''}</span>
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

  function homeView() {
    const s = activeShift();
    const standalone = window.navigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches;
    const tip = standalone ? '' : `<div class="card tip"><b>Put this on your Home Screen</b>
      In Safari tap the Share button, then “Add to Home Screen”. It then opens like a normal app and works without signal.</div>`;

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
    return `<button class="btn soft" data-act="range-pdf">PDF for a date range</button>
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
          <button class="btn primary" data-act="shift-pdf" data-id="${esc(id)}">Create PDF to send</button>
          <div class="btn-row" style="margin-top:10px">
            <button class="btn soft" data-act="new-call" data-shift="${esc(id)}">+ Add call</button>
            <button class="btn outline" data-act="edit-shift" data-id="${esc(id)}">Edit times</button>
          </div>
        </div>
      </section>
      <h2 class="section-title">Calls</h2>
      ${callList(calls, 'No calls logged for this period.')}
      <button class="btn danger" data-act="delete-shift" data-id="${esc(id)}">Delete this on-call period</button>`;
  }

  function settingsView() {
    const st = state.settings;
    const f = (key, label, extra = '') => `<label class="field"><span>${label}</span>
      <input data-setting="${key}" value="${esc(st[key])}" autocomplete="off" ${extra}></label>`;
    return `<p class="muted small" style="margin:0 4px 14px">These details are printed at the top of every PDF.</p>
      ${f('name', 'Full name', 'autocapitalize="words"')}
      ${f('position', 'Position', 'placeholder="e.g. Registrar" autocapitalize="words"')}
      ${f('employeeId', 'Employee / payroll number')}
      ${f('department', 'Department / unit', 'autocapitalize="words"')}
      ${f('hospital', 'Hospital', 'autocapitalize="words"')}
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
    const c = call || { time: new Date().toISOString(), type: 'phone', urn: '', from: '', reason: '', duration: '', notes: '' };
    const shift = state.shifts.find((s) => s.id === shiftId);
    // Adding to a finished period: default the time to that period, not to "now".
    if (isNew && shift && shift.end) c.time = shift.start;
    const chips = recentFroms();
    const html = `
      <label class="field"><span>Patient URN</span>
        <input class="urn" name="urn" value="${esc(c.urn)}" inputmode="numeric" autocomplete="off" autocorrect="off" autocapitalize="characters" spellcheck="false" placeholder="e.g. 1234567"></label>
      <div class="seg" role="radiogroup" aria-label="Type of call">
        ${Object.entries(TYPES).map(([k, v]) => `<label><input type="radio" name="type" value="${k}" ${c.type === k ? 'checked' : ''}><span>${v}</span></label>`).join('')}
      </div>
      <div class="two">
        <label class="field"><span>Time of call</span>
          <input type="datetime-local" name="time" value="${toInput(c.time)}" required></label>
        <label class="field"><span>Time spent (min)</span>
          <input name="duration" value="${esc(c.duration)}" inputmode="numeric" pattern="[0-9]*" placeholder="e.g. 10"></label>
      </div>
      <label class="field"><span>Called by / ward</span>
        <input name="from" id="from-input" value="${esc(c.from)}" autocomplete="off" autocapitalize="words" placeholder="e.g. ED, Ward 4B, RN Smith"></label>
      ${chips.length ? `<div class="chips">${chips.map((v) => `<button type="button" class="chip" data-act="chip" data-value="${esc(v)}">${esc(v)}</button>`).join('')}</div>` : ''}
      <label class="field"><span>Reason for call</span>
        <input name="reason" value="${esc(c.reason)}" autocomplete="off" placeholder="e.g. Hypotension, review requested"></label>
      <label class="field"><span>Advice / action (optional)</span>
        <textarea name="notes" rows="3">${esc(c.notes)}</textarea></label>
      ${isNew ? '' : `<button type="button" class="btn danger" data-act="delete-call" data-id="${esc(c.id)}">Delete this call</button>`}`;

    openSheet(isNew ? 'Log a call' : 'Edit call', html, (d) => {
      const time = fromInput(d.time);
      if (!time) { toast('Please enter the time of the call'); return false; }
      const fields = {
        time,
        urn: d.urn.trim().toUpperCase(),
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
    const html = `<p class="muted small" style="margin:0 4px 14px">Makes one PDF covering every on-call period that started between these dates — handy for a pay fortnight.</p>
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

  // ---------- PDF ----------
  function makePdf(shifts) {
    if (!window.jspdf) { toast('PDF tools did not load — reopen the app with signal once'); return; }
    shifts = [...shifts].sort((a, b) => a.start.localeCompare(b.start));
    const st = state.settings;
    const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 14;
    const teal = [11, 110, 105];

    doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(20);
    doc.text('On-Call Log', M, 18);
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(90);
    const first = shifts[0], last = shifts[shifts.length - 1];
    const periodTxt = shifts.length === 1
      ? fmtDate(first.start, true)
      : `${fmtDate(first.start, true)} to ${fmtDate(last.end || last.start, true)}`;
    doc.text(periodTxt, W - M, 18, { align: 'right' });
    doc.setDrawColor(...teal).setLineWidth(0.6).line(M, 21.5, W - M, 21.5);

    const details = [
      ['Name', st.name], ['Position', st.position], ['Employee no.', st.employeeId],
      ['Department', st.department], ['Hospital', st.hospital],
    ];
    let x = M;
    const colW = (W - 2 * M) / details.length;
    details.forEach(([label, value]) => {
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(110).text(label.toUpperCase(), x, 27.5);
      doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(20)
        .text(doc.splitTextToSize(value || '—', colW - 4)[0], x, 32.5);
      x += colW;
    });

    let y = 41;
    let totalCalls = 0, totalRecalls = 0, totalMin = 0, n = 0;

    shifts.forEach((s) => {
      const calls = shiftCalls(s.id);
      if (y > H - 45) { doc.addPage(); y = 18; }
      doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...teal);
      const dur = s.end ? `  (${fmtDur(new Date(s.end) - new Date(s.start))})` : '  (in progress)';
      doc.text(`On call: ${fmtDateTime(s.start, true)}  to  ${s.end ? fmtDateTime(s.end, true) : 'ongoing'}${dur}`, M, y);
      y += 3;

      const body = calls.map((c) => {
        n += 1; totalCalls += 1;
        if (c.type === 'recall') totalRecalls += 1;
        totalMin += Number(c.duration) || 0;
        return [n, fmtDate(c.time), fmtTime(c.time), c.urn || '—', TYPES[c.type] || TYPES.phone,
          c.from || '', [c.reason, c.notes].filter(Boolean).join(' — '), c.duration === '' || c.duration == null ? '' : String(c.duration)];
      });

      doc.autoTable({
        startY: y,
        margin: { left: M, right: M, bottom: 16 },
        head: [['#', 'Date', 'Time', 'Patient URN', 'Type', 'Called by / ward', 'Reason / action', 'Min']],
        body: body.length ? body : [[{ content: 'No calls received during this on-call period.', colSpan: 8, styles: { halign: 'center', textColor: 110, fontStyle: 'italic' } }]],
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 9, cellPadding: 1.8, textColor: 20, lineColor: 200, lineWidth: 0.2, overflow: 'linebreak' },
        headStyles: { fillColor: teal, textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 248, 248] },
        columnStyles: {
          0: { cellWidth: 9, halign: 'right' }, 1: { cellWidth: 26 }, 2: { cellWidth: 15 },
          3: { cellWidth: 28, fontStyle: 'bold' }, 4: { cellWidth: 34 }, 5: { cellWidth: 42 },
          6: { cellWidth: 'auto' }, 7: { cellWidth: 13, halign: 'right' },
        },
      });
      y = doc.lastAutoTable.finalY + 10;
    });

    if (y > H - 42) { doc.addPage(); y = 18; }
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(20);
    const hrs = totalMin ? `     Total time: ${fmtDur(totalMin * 60000)}` : '';
    doc.text(`Total calls: ${totalCalls}     Phone calls: ${totalCalls - totalRecalls}     Recalls to hospital: ${totalRecalls}${hrs}`, M, y);
    y += 16;
    doc.setDrawColor(120).setLineWidth(0.3);
    doc.line(M, y, M + 80, y); doc.line(M + 95, y, M + 140, y);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(110);
    doc.text('Signature', M, y + 4); doc.text('Date', M + 95, y + 4);

    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(130);
      doc.text('CONFIDENTIAL — contains patient identifiers', M, H - 8);
      doc.text(`Generated ${fmtDateTime(new Date(), true)}  ·  Page ${p} of ${pages}`, W - M, H - 8, { align: 'right' });
    }

    const who = (st.name || '').trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const name = `OnCall-Log${who ? '_' + who : ''}_${toDateInput(first.start)}${shifts.length > 1 ? '_to_' + toDateInput(last.start) : ''}.pdf`;
    shareFile(doc.output('blob'), name, 'application/pdf');
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
    if (key) { state.settings[key] = e.target.value; save(); }
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
