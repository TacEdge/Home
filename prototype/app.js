/* HOME prototype — rendering and interaction. Throwaway. No backend, no AI. */

(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const PLACES = [
    { id: 'today', name: 'Today', primary: true },
    { id: 'forward', name: 'Forward', primary: true },
    { id: 'people', name: 'People', quiet: true, note: 'V0.1, via tapping a person' },
    { id: 'home', name: 'Home', quiet: true, note: 'V0.1 projects' },
    { id: 'family', name: 'Family', quiet: true, note: 'later' },
    { id: 'us', name: 'Us', quiet: true, note: 'later' },
    { id: 'admin', name: 'Life admin', quiet: true, note: 'later' },
  ];

  const state = {
    si: 0, s: null, place: 'today', horizon: 'week',
    kev: 'closed', thread: [], focus: null, dismissed: new Set(), done: new Set(), usualOpen: false,
  };

  /* ---------- scenario ---------- */
  function loadScenario(i) {
    state.si = i;
    state.s = JSON.parse(JSON.stringify(SCENARIOS[i]));   // fresh copy: approvals mutate it
    state.thread = []; state.focus = null; state.dismissed = new Set(); state.done = new Set(); state.usualOpen = false;
    $('scenario').value = i;
    render(); renderKev();
  }

  /* ---------- navigation ---------- */
  function renderNav() {
    const sw = $('switch'); sw.innerHTML = '';
    PLACES.filter(p => p.primary).forEach(p => {
      const b = el('button', p.id === state.place ? 'on' : '', p.name);
      b.onclick = () => { state.place = p.id; render(); };
      sw.appendChild(b);
    });
    const rail = $('rail'); rail.innerHTML = '<div class="menu-title">Places</div>';
    const ul = el('ul');
    PLACES.forEach((p, i) => {
      if (i === 2) ul.appendChild(el('li', 'sep'));
      const li = el('li', (p.primary ? 'primary' : 'quiet') + (p.id === state.place ? ' on' : ''), esc(p.name) + (p.note ? `<small>${esc(p.note)}</small>` : ''));
      if (p.primary) li.onclick = () => { state.place = p.id; render(); };
      ul.appendChild(li);
    });
    rail.appendChild(ul);
    const ml = $('menu-list'); ml.innerHTML = '';
    PLACES.forEach(p => {
      const li = el('li', p.primary ? 'primary' : 'quiet', esc(p.name) + (p.note ? `<small>${esc(p.note)}</small>` : ''));
      if (p.primary) li.onclick = () => { state.place = p.id; closeOverlays(); render(); };
      ml.appendChild(li);
    });
  }

  /* ---------- shared blocks ---------- */
  function dot(name) { return `<span class="dot" style="background:${PEOPLE[name] ? PEOPLE[name].color : '#bbb'}"></span>`; }

  function insightRow(ins, key) {
    const d = el('div', `insight ${ins.kind === 'needs' ? 'needs' : 'know'}`);
    d.innerHTML = `<span class="mark">${ins.kind === 'needs' ? '●' : '○'}</span>
      <span class="text">${esc(ins.text)}<div class="facts">${esc(ins.facts || '')}</div>
      <button class="dismiss">Dismiss</button></span>
      ${ins.action ? `<button class="act">${esc(ins.action.label)} ›</button>` : ''}`;
    d.querySelector('.text').onclick = (e) => { if (e.target.classList.contains('dismiss')) return; d.classList.toggle('open'); };
    d.querySelector('.dismiss').onclick = () => { state.dismissed.add(key); render(); };
    if (ins.action) d.querySelector('.act').onclick = () => openKev(ins.action.focus, ins.text);
    return d;
  }

  function runRow(r) {
    if (r.group) return el('div', 'subgroup', esc(r.group));
    const d = el('div', 'row' + (r.clash ? ' clash' : '') + (r.past ? ' past' : ''));
    d.innerHTML = `<span class="time">${esc(r.time)}</span><span class="title">${esc(r.title)}</span>
      <span class="who ${r.gap ? 'gap' : ''}">${r.gap ? '' : r.who.split(' · ').map(n => dot(n) + esc(n)).join(' ')}</span>`;
    d.querySelector('.title').onclick = () => itemSheet(r);
    d.querySelector('.who').onclick = () => r.gap ? gapSheet(r) : itemSheet(r);
    return d;
  }

  function section(label, nodes) {
    const s = el('section', 'section'); s.appendChild(el('div', 'label', esc(label)));
    nodes.forEach(n => s.appendChild(n)); return s;
  }

  /* ---------- TODAY ---------- */
  function renderToday(c) {
    const s = state.s;
    c.appendChild(el('div', 'date', `${esc(s.date)} <span style="opacity:.6">· ${esc(s.clock)}</span>`));

    if (s.mode === 'evening') return renderEvening(c);

    c.appendChild(el('h1', 'headline', esc(s.headline)));
    if (s.weather) c.appendChild(el('p', 'weather', esc(s.weather)));

    const grid = el('div', 'today-grid'); const col1 = el('div', 'col'); const col2 = el('div', 'col');
    grid.appendChild(col1); grid.appendChild(col2); c.appendChild(grid);

    // Worth knowing — or healthy quiet
    const live = s.insights.map((ins, i) => ({ ins, key: 'i' + i })).filter(x => !state.dismissed.has(x.key));
    if (live.length) {
      const nodes = live.slice(0, 3).map(x => insightRow(x.ins, x.key));
      const extra = (s.more || 0) + Math.max(0, live.length - 3);
      if (extra) nodes.push(el('div', 'quiet', `${extra} more ›`));
      col1.appendChild(section('Worth knowing', nodes));
    } else {
      col1.appendChild(section('Worth knowing', [el('p', 'quiet', 'Nothing needs sorting.')]));
    }

    if (s.runs.length) col1.appendChild(section('Getting everyone there', s.runs.map(runRow)));

    // Everyone's day — list on phones, calm cards when wide
    if (s.people.length) {
      const narrow = el('div', 'people narrow');
      s.people.forEach(p => {
        const d = el('div', 'person'); d.innerHTML = `<span class="name">${dot(p.name)}${esc(p.name)}</span><span class="day">${p.day.map(l => `<div>${esc(l)}</div>`).join('')}</span>`;
        d.querySelector('.name').onclick = () => personSheet(p.name); narrow.appendChild(d);
      });
      const wide = el('div', 'people wide cards');
      s.people.forEach(p => {
        const d = el('div', 'card'); d.innerHTML = `<div class="name">${dot(p.name)}${esc(p.name)}</div><div class="day">${p.day.map(l => `<div>${esc(l)}</div>`).join('')}</div>`;
        d.onclick = () => personSheet(p.name); wide.appendChild(d);
      });
      col2.appendChild(section("Everyone's day", [narrow, wide]));
    }

    if (s.todos.length) col2.appendChild(section('To do', s.todos.map((t, i) => todoRow(t, i))));

    if (s.toSort) {
      const d = el('div', 'tosort', `<span>${s.toSort} thing${s.toSort > 1 ? 's' : ''} to sort</span><span>›</span>`);
      d.onclick = () => toSortSheet(); col2.appendChild(d);
    }
  }

  function todoRow(t, i) {
    const d = el('div', 'todo' + (state.done.has(i) ? ' done' : ''));
    d.innerHTML = `<span class="tick"></span><span>${esc(t)}</span>${state.done.has(i) ? '<button class="undo">Undo</button>' : ''}`;
    d.querySelector('.tick').onclick = () => { state.done.add(i); render(); };
    const u = d.querySelector('.undo'); if (u) u.onclick = () => { state.done.delete(i); render(); };
    return d;
  }

  function renderEvening(c) {
    const s = state.s;
    c.appendChild(el('div', 'label', 'Tonight'));
    c.appendChild(el('h1', 'headline', esc(s.headline)));
    const grid = el('div', 'today-grid'); const col1 = el('div', 'col'); const col2 = el('div', 'col');
    grid.appendChild(col1); grid.appendChild(col2); c.appendChild(grid);

    const t = s.tomorrow;
    const tm = section(`Tomorrow morning · ${t.label}`, [el('p', 'quiet', esc(t.headline) + ' ' + esc(t.weather)), ...t.runs.map(runRow), el('p', 'quiet', esc(t.leaveBy))]);
    col1.appendChild(tm);
    const live = s.insights.map((ins, i) => ({ ins, key: 'i' + i })).filter(x => !state.dismissed.has(x.key));
    if (live.length) col1.appendChild(section('Worth knowing', live.map(x => insightRow(x.ins, x.key))));

    if (s.todos.length) col2.appendChild(section('Before tomorrow', s.todos.map((x, i) => todoRow(x, i))));
    col2.appendChild(section('Earlier today', s.earlier.map(r => runRow({ ...r, past: true }))));
    if (s.toSort) { const d = el('div', 'tosort', `<span>${s.toSort} things to sort</span><span>›</span>`); d.onclick = toSortSheet; col2.appendChild(d); }
  }

  /* ---------- FORWARD ---------- */
  function renderForward(c) {
    const f = state.s.forward; const h = state.horizon;
    const hz = el('div', 'horizon');
    [['week', 'Week'], ['month', 'Month'], ['season', 'Season']].forEach(([k, n]) => {
      const b = el('button', k === h ? 'on' : '', n); b.onclick = () => { state.horizon = k; render(); }; hz.appendChild(b);
    });
    c.appendChild(hz);
    const data = f[h];
    c.appendChild(el('h1', 'headline', esc(data.headline)));
    if (h === 'week') { const l = el('div', 'link', '<span>Read the week ahead</span><span>›</span>'); l.onclick = () => openKev(null, null, 'Read the week ahead'); c.appendChild(l); }
    if (h === 'season') {
      c.appendChild(el('div', 'texture', esc(data.texture)));
      c.appendChild(el('div', 'texture-axis', data.months.map(m => `<span>${esc(m.u.slice(0, 3))}</span>`).join('')));
    }

    const grid = el('div', 'forward-grid'); const col1 = el('div'); const col2 = el('div'); grid.appendChild(col1); grid.appendChild(col2); c.appendChild(grid);

    const live = data.needs.map((ins, i) => ({ ins, key: h + i })).filter(x => !state.dismissed.has(x.key));
    const lbl = h === 'season' ? 'Worth deciding early' : 'Needs sorting';
    col1.appendChild(section(lbl, live.length ? live.map(x => insightRow(x.ins, x.key)) : [el('p', 'quiet', 'Nothing needs sorting.')]));

    const units = h === 'season' ? data.months : data.units;
    const list = units.map(u => {
      const d = el('div', 'unit');
      d.innerHTML = `<span class="u">${esc(u.u)}${u.sub ? `<small>${esc(u.sub)}</small>` : ''}${u.note ? `<small>${esc(u.note)}</small>` : ''}</span>
        ${u.load != null ? `<span class="load">${esc(u.load)}</span>` : ''}
        <span class="items">${u.items.slice(0, 3).map(i => `<div>${esc(i)}</div>`).join('')}${u.items.length > 3 ? `<div class="more">+${u.items.length - 3}</div>` : ''}${u.more ? `<div class="more">+${u.more}</div>` : ''}${u.wx ? `<div class="wx">${esc(u.wx)}</div>` : ''}</span>`;
      d.onclick = () => unitSheet(u, h);
      return d;
    });
    col2.appendChild(section(h === 'week' ? 'The shape of the week' : h === 'month' ? 'Week by week' : 'Month by month', list));

    const usual = el('div', 'usual', `<span>The usual</span><span>${state.usualOpen ? '⌄' : '›'}</span>`);
    usual.onclick = () => { state.usualOpen = !state.usualOpen; render(); };
    col2.appendChild(usual);
    if (state.usualOpen) col2.appendChild(el('div', 'usual-list', esc(USUAL)));
  }

  /* ---------- sheets ---------- */
  function openSheet(html) { $('sheet-body').innerHTML = html; $('sheet').hidden = false; $('scrim').classList.add('on'); }
  function closeOverlays() { $('sheet').hidden = true; $('menu').hidden = true; $('scrim').classList.remove('on'); if (!isDesktop() && state.kev !== 'closed') { state.kev = 'closed'; applyKev(); } }

  function itemSheet(r) {
    openSheet(`<h3>${esc(r.title)}</h3><div class="meta">${esc(state.s.date)} · ${esc(r.time)}</div>
      <div class="kv"><span>Who</span><span>${r.gap ? 'Nobody yet' : esc(r.who)}</span></div>
      <div class="kv"><span>Calendar</span><span>${/school|pickup|drop/i.test(r.title) ? 'Family calendar' : /board|site|airport/i.test(r.title) ? "Sam's work (Google)" : 'Family calendar'}</span></div>
      <div class="kv"><span>Where</span><span>${/school|pickup|drop/i.test(r.title) ? 'Hillcrest School' : /swim/i.test(r.title) ? 'Aquatic centre' : '—'}</span></div>
      <div class="kv"><span>Updated</span><span>7:00 this morning</span></div>
      <button class="sheet-act" id="sheet-ask">Ask Kev about this ›</button>`);
    $('sheet-ask').onclick = () => { closeOverlays(); openKev(null, r.title, `What's the story with ${r.title.toLowerCase()}?`); };
  }

  function gapSheet(r) {
    openSheet(`<h3>Who's doing ${esc(r.title.replace(' — ', ' ').toLowerCase())}?</h3><div class="meta">${esc(r.time)} · pick someone, or ask Kev</div>
      ${['Sam', 'Alex', 'Nana Jo'].map(n => `<div class="kv pick" data-n="${n}"><span></span><span>${dot(n)}${n}</span></div>`).join('')}
      <button class="sheet-act" id="sheet-ask">Ask Kev who's free ›</button>`);
    $('sheet-body').querySelectorAll('.pick').forEach(p => p.onclick = () => { r.gap = false; r.who = p.dataset.n; closeOverlays(); render(); });
    $('sheet-ask').onclick = () => { closeOverlays(); openKev(state.s.id === 'chaos' ? 'pickups' : 'isla-pickup', r.title); };
  }

  function personSheet(name) {
    const P = {
      Sam: ['Parent', '', 'Office Mon–Thu, client sites some days · Board meeting monthly', 'Doing the fence this month · Prefers early starts'],
      Alex: ['Parent', '', 'Works 9–2:30 weekdays · Pilates Wed 6:15', 'Wants to try the new Thai place · Likes a plan for the weekend by Thursday'],
      Milo: ['Child', '9', 'School · Swimming Wed 3:30 · Football Sat 9', 'Into dinosaurs at the moment (last I heard, March) · Goes to bed better after a bath'],
      Isla: ['Child', '6', 'School', 'Loves drawing · Has a nut allergy (sensitive — only shown here)'],
    }[name] || ['', '', '', ''];
    openSheet(`<h3>${dot(name)}${esc(name)}</h3><div class="meta">${esc(P[0])}${P[1] ? ' · ' + P[1] : ''}</div>
      <div class="kv"><span>Regular week</span><span>${esc(P[2])}</span></div>
      <div class="kv"><span>Things to know</span><span>${esc(P[3])}</span></div>
      <div class="kv"><span>Coming up</span><span>${name === 'Milo' ? 'Dentist Mon 19 · turns 10 on 28 Dec' : name === 'Sam' ? 'Wellington Fri 16' : 'Nothing unusual'}</span></div>
      <div class="meta" style="margin-top:12px">Profiles are lightweight context, not records. Edit anything in Settings.</div>`);
  }

  function unitSheet(u, h) {
    openSheet(`<h3>${esc(u.u)}${u.sub ? ' ' + esc(u.sub) : ''}</h3><div class="meta">${h === 'week' ? 'That day' : h === 'month' ? 'That week' : 'That month'}${u.note ? ' · ' + esc(u.note) : ''}</div>
      ${u.items.map(i => `<div class="kv"><span></span><span>${esc(i)}</span></div>`).join('') || '<p class="quiet">Just the usual.</p>'}
      ${u.wx ? `<div class="kv"><span>Weather</span><span>${esc(u.wx)}</span></div>` : ''}
      <button class="sheet-act" id="sheet-ask">Ask Kev about this ›</button>`);
    $('sheet-ask').onclick = () => { closeOverlays(); openKev(null, `${u.u} ${u.sub || ''}`.trim(), `What's on ${u.u}${u.sub ? ' ' + u.sub : ''}?`); };
  }

  function toSortSheet() {
    const items = ['"we need to sort the bike"', '"school says lunch order Fridays"', '"ask Nana Jo about Christmas"', '"tyres — car pulling left"'].slice(0, state.s.toSort);
    openSheet(`<h3>To sort</h3><div class="meta">Things you've said, kept as they were. Kev has a suggestion for each.</div>
      ${items.map(i => `<div class="kv"><span></span><span>${esc(i)}<div class="meta">Kev: probably a task · tap to sort</div></span></div>`).join('')}`);
  }

  /* ---------- KEV ---------- */
  const isDesktop = () => window.matchMedia('(min-width: 1200px)').matches && !$('shell').classList.contains('phone');
  const isWide = () => window.matchMedia('(min-width: 768px)').matches && !$('shell').classList.contains('phone');

  function applyKev() {
    const k = $('kev'); k.classList.remove('open', 'full');
    if (state.kev === 'open') k.classList.add('open'); if (state.kev === 'full') k.classList.add('full');
    $('scrim').classList.toggle('on', state.kev !== 'closed' && !isDesktop() && $('sheet').hidden && $('menu').hidden);
  }

  function openKev(focus, focusLabel, autoText) {
    state.kev = 'open'; applyKev();
    if (focusLabel) { state.focus = focusLabel; $('kev-focus').hidden = false; $('kev-focus').textContent = 'About: ' + focusLabel; }
    if (focus) { ask(null, focus); }
    else if (autoText) { ask(autoText); }
    else setTimeout(() => $('kev-text').focus(), 250);
  }

  function ask(text, focus) {
    const s = state.s;
    if (text) state.thread.push({ role: 'you', text });
    const { blocks } = KEV.reply(s, text || '', focus);
    const kept = blocks.some(b => b.kept);
    if (kept) state.thread[state.thread.length - 1].kept = true;      // captured instantly, before Kev "thinks"
    renderKev();
    const rest = blocks.filter(b => !b.kept && !b.waiting);
    const waiting = blocks.find(b => b.waiting);
    const turn = { role: 'kev', blocks: [] };
    state.thread.push(turn);
    if (waiting) { turn.blocks = [waiting]; renderKev(); }
    setTimeout(() => { turn.blocks = rest; renderKev(); }, waiting ? 1400 : 350);
  }

  function renderKev() {
    const th = $('kev-thread'); th.innerHTML = '';
    if (!state.focus) $('kev-focus').hidden = true;
    state.thread.forEach((t, ti) => {
      const d = el('div', 'turn ' + (t.role === 'kev' ? 'from-kev' : 'you'));
      if (t.role === 'you') { d.innerHTML = esc(t.text) + (t.kept ? '<span class="kept">✓ Kept</span>' : ''); th.appendChild(d); return; }
      t.blocks.forEach((b, bi) => {
        if (b.waiting) d.appendChild(el('div', 'waiting', esc(b.waiting)));
        if (b.say) d.appendChild(el('p', 'say', esc(b.say)));
        if (b.detail) d.appendChild(el('p', 'detail', esc(b.detail)));
        if (b.text) d.appendChild(el('p', 'detail', esc(b.text)));
        if (b.cite) b.cite.forEach(([a, m]) => { const c = el('div', 'cite', `<span>${esc(a)}</span><span>${esc(m || '')}</span>`); c.onclick = () => itemSheet({ title: a.replace(/^\d+:\d+\s*/, ''), time: (a.match(/^\d+:\d+/) || [''])[0], who: m || '' }); d.appendChild(c); });
        if (b.plan) { const p = el('div', 'plan'); b.plan.forEach(([a, m]) => p.appendChild(el('div', '', `<span>${esc(a)}</span><span>${esc(m)}</span>`))); d.appendChild(p); }
        if (b.section) { d.appendChild(el('div', 'label', esc(b.section))); b.lines.forEach(l => d.appendChild(el('p', 'detail', esc(l)))); }
        if (b.basis) d.appendChild(el('div', 'basis', esc(b.basis)));
        if (b.proposal) d.appendChild(proposalCard(b, ti, bi));
        if (b.yesall) { const y = el('button', 'yes-all', 'Yes to all'); y.onclick = () => { t.blocks.forEach((x) => x.proposal && !x.state && approve(x)); renderKev(); }; if (t.blocks.some(x => x.proposal && !x.state)) d.appendChild(y); }
        if (b.result) d.appendChild(el('p', 'result', esc(b.result)));
      });
      th.appendChild(d);
    });
    const sg = $('kev-suggest'); sg.innerHTML = '';
    if (!state.thread.length) {
      (state.thread.length ? [] : (state.s.suggestions)).forEach(q => { const b = el('button', '', esc(q)); b.onclick = () => ask(q); sg.appendChild(b); });
    }
    $('kev-body').scrollTop = 1e6;
  }

  function proposalCard(b, ti, bi) {
    const p = b.proposal;
    const d = el('div', 'proposal' + (b.state ? ' done' : '') + (b.editing ? ' editing' : ''));
    d.innerHTML = `<div class="p-title">${esc(p.title)}</div><div class="p-meta">${esc(p.meta)}</div>
      <div class="p-edit"><input value="${esc(p.title)}" /><select><option>${esc(p.meta.split(' · ')[0])}</option><option>Home · Garage</option><option>Home · Back fence</option><option>Family</option><option>To do</option></select>
        <select><option>${/Just you/.test(p.meta) ? 'Just you' : 'Shared'}</option><option>${/Just you/.test(p.meta) ? 'Shared' : 'Just you'}</option></select></div>
      <div class="p-actions"><button class="yes">${esc(b.editing ? 'Yes' : p.yes)}</button><button class="chg">${b.editing ? 'Cancel' : 'Change'}</button><button class="no">Not now</button></div>
      ${b.state === 'yes' ? `<div class="result">${esc(p.action === 'task' ? 'Added.' : 'Done.')}<button class="undo">Undo</button></div>` : b.state === 'no' ? '<div class="result">Kept in To sort.</div>' : ''}`;
    d.querySelector('.yes').onclick = () => { if (b.editing) { p.title = d.querySelector('input').value; b.editing = false; } approve(b); renderKev(); };
    d.querySelector('.chg').onclick = () => { b.editing = !b.editing; renderKev(); };
    d.querySelector('.no').onclick = () => { b.state = 'no'; state.s.toSort += 1; render(); renderKev(); };
    const u = d.querySelector('.undo'); if (u) u.onclick = () => { undo(b); renderKev(); };
    return d;
  }

  function approve(b) {
    const p = b.proposal; b.state = 'yes'; const s = state.s;
    if (p.action === 'task') { s.todos.push(p.title); b.added = s.todos.length - 1; }
    if (p.action === 'schedule') { s.todos.push(p.title.replace(/^Put "(.+)" in (.+)\?$/, '$1 — $2')); b.added = s.todos.length - 1; state.dismissed.add('i1'); }
    if (p.action === 'assign') {
      s.runs.forEach(r => { if (r.gap && /pickup/i.test(r.title) && /pickup/i.test(p.title)) { r.gap = false; r.who = /Nana/.test(p.title) ? 'Nana Jo' : 'Alex'; } });
      if (/interviews/.test(p.title)) { const r = s.runs.find(x => /interviews/i.test(x.title)); if (r) { r.who = 'Alex'; r.clash = false; } }
      if (/dentist/.test(p.title)) { const r = s.runs.find(x => /dentist/i.test(x.title)); if (r) { r.time = '4:15'; r.clash = false; } }
      s.insights.forEach((ins, i) => { if (ins.kind === 'needs' && ins.action && ((/pickup/i.test(ins.text) && /pickup/i.test(p.title)) || (/two places/.test(ins.text) && /interviews|dentist/.test(p.title)))) state.dismissed.add('i' + i); });
      if (s.id === 'normal' && !s.insights.some((ins, i) => ins.kind === 'needs' && !state.dismissed.has('i' + i))) s.headline = 'Easy day. Nothing needs sorting.';
      if (s.id === 'conflict' && state.dismissed.has('i0')) s.headline = 'Straightforward. Sam flies out at 6.';
    }
    render();
  }
  function undo(b) { b.state = null; const s = state.s; if (b.added != null) { s.todos.splice(b.added, 1); b.added = null; } render(); }

  /* ---------- wiring ---------- */
  function render() {
    renderNav();
    const c = $('content'); c.innerHTML = '';
    if (state.place === 'today') renderToday(c); else renderForward(c);
    let bar = document.querySelector('.kev-bar-wide');
    if (!bar) { bar = el('div', 'kev-bar-wide', '<button>Ask or tell Kev…</button>'); document.body.appendChild(bar); bar.querySelector('button').onclick = () => openKev(); }
  }

  $('kev-form').onsubmit = (e) => { e.preventDefault(); const t = $('kev-text').value.trim(); if (!t) return; $('kev-text').value = ''; if (state.kev === 'closed') { state.kev = 'open'; applyKev(); } ask(t); };
  $('kev-text').onfocus = () => { if (state.kev === 'closed') { state.kev = 'open'; applyKev(); renderKev(); } };
  $('kev-handle').onclick = () => { state.kev = state.kev === 'open' ? 'full' : 'closed'; applyKev(); };
  $('scrim').onclick = closeOverlays;
  $('menu-btn').onclick = () => { $('menu').hidden = false; $('scrim').classList.add('on'); };
  const closeBtn = el('button', 'kev-close', '‹ Back'); closeBtn.onclick = () => { state.kev = 'closed'; applyKev(); }; $('kev').insertBefore(closeBtn, $('kev-body'));

  const sel = $('scenario'); SCENARIOS.forEach((s, i) => sel.appendChild(new Option(s.name, i)));
  sel.onchange = () => loadScenario(+sel.value);
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (/^[1-6]$/.test(e.key)) loadScenario(+e.key - 1);
    if (e.key === 'p' || e.key === 'P') { $('shell').classList.toggle('phone'); applyKev(); render(); renderKev(); }
    if (e.key === 'Escape') closeOverlays();
  });
  window.addEventListener('resize', () => { applyKev(); });

  const params = new URLSearchParams(location.search);
  if (params.get('phone') === '1') $('shell').classList.add('phone');
  loadScenario(+(params.get('s') || 0));
})();
