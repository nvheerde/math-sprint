/* ============================================================
   Math Sprint — a Zetamac-style mental math trainer (PWA)
   Vanilla JS, no dependencies. All data stored locally.
   ============================================================ */

(() => {
  'use strict';

  // ---------- tiny DOM helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const el = (id) => document.getElementById(id);

  // ---------- storage ----------
  const K_PRESETS = 'mm_presets_v1';
  const K_SESSIONS = 'mm_sessions_v1';
  const K_LAST = 'mm_last_preset_v1';
  const MAX_SESSIONS = 1000; // generous cap; trims oldest beyond this

  const uid = () => 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

  function load(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; }
    catch { return fallback; }
  }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.warn('save failed', e); } }

  // ---------- default preset (Zetamac defaults) ----------
  function defaultPreset() {
    return {
      id: 'default',
      name: 'Default',
      duration: 120,
      add: { on: true, amin: 2, amax: 100, bmin: 2, bmax: 100 },
      sub: { on: true },                                  // uses add ranges, reversed
      mul: { on: true, amin: 2, amax: 12, bmin: 2, bmax: 100 },
      div: { on: true },                                  // uses mul ranges, reversed
    };
  }

  function getPresets() {
    let p = load(K_PRESETS, null);
    if (!p || !Array.isArray(p) || p.length === 0) {
      p = [defaultPreset()];
      save(K_PRESETS, p);
    }
    return p;
  }
  function setPresets(p) { save(K_PRESETS, p); }
  function getPreset(id) { return getPresets().find((x) => x.id === id) || getPresets()[0]; }

  function getSessions() { return load(K_SESSIONS, []); }
  function addSession(s) {
    let all = getSessions();
    all.push(s);
    if (all.length > MAX_SESSIONS) all = all.slice(all.length - MAX_SESSIONS);
    save(K_SESSIONS, all);
  }
  function sessionsForPreset(id) {
    return getSessions().filter((s) => s.presetId === id).sort((a, b) => a.startedAt - b.startedAt);
  }

  // ---------- config signature (honest comparisons) ----------
  // Two sessions are comparable only if ops+ranges+duration match.
  function sig(p) {
    const part = (o, keys) => o.on ? '1' + keys.map((k) => o[k]).join(',') : '0';
    return [
      'd' + p.duration,
      'a' + part(p.add, ['amin', 'amax', 'bmin', 'bmax']),
      's' + (p.sub.on ? '1' : '0'),
      'm' + part(p.mul, ['amin', 'amax', 'bmin', 'bmax']),
      'v' + (p.div.on ? '1' : '0'),
    ].join('|');
  }

  // ============================================================
  //  QUESTION GENERATION
  // ============================================================
  const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

  function enabledOps(p) {
    const ops = [];
    if (p.add.on) ops.push('add');
    if (p.sub.on) ops.push('sub');
    if (p.mul.on) ops.push('mul');
    if (p.div.on) ops.push('div');
    return ops;
  }

  // returns {op, a, b, text, answer}  — a,b are the *displayed* operands
  function genQuestion(p, ops, prev) {
    for (let tries = 0; tries < 30; tries++) {
      const op = ops[randInt(0, ops.length - 1)];
      let q;
      if (op === 'add') {
        const a = randInt(p.add.amin, p.add.amax);
        const b = randInt(p.add.bmin, p.add.bmax);
        q = { op, a, b, text: `${a} + ${b}`, answer: a + b };
      } else if (op === 'sub') {
        // Zetamac: (first + second) − first => second ; first,second from addition ranges
        const first = randInt(p.add.amin, p.add.amax);
        const second = randInt(p.add.bmin, p.add.bmax);
        const sum = first + second;
        q = { op, a: sum, b: first, text: `${sum} − ${first}`, answer: second };
      } else if (op === 'mul') {
        const a = randInt(p.mul.amin, p.mul.amax);
        const b = randInt(p.mul.bmin, p.mul.bmax);
        q = { op, a, b, text: `${a} × ${b}`, answer: a * b };
      } else { // div : Zetamac (first * second) ÷ first => second ; divisor is the small 2–12 factor
        const first = randInt(p.mul.amin, p.mul.amax);
        const second = randInt(p.mul.bmin, p.mul.bmax);
        if (first === 0) continue;
        const prod = first * second;
        q = { op, a: prod, b: first, text: `${prod} ÷ ${first}`, answer: second };
      }
      if (q.answer < 0) continue;
      if (prev && prev.text === q.text) continue; // avoid immediate repeat
      return q;
    }
    // fallback
    return { op: 'add', a: 1, b: 1, text: '1 + 1', answer: 2 };
  }

  // ============================================================
  //  GAME ENGINE
  // ============================================================
  const game = {
    preset: null,
    ops: [],
    timeLeft: 0,
    duration: 0,
    score: 0,
    input: '',
    current: null,
    qStart: 0,
    qKeystrokes: 0,
    log: [],
    timerId: null,
    qStartedAt: 0,
    running: false,
  };

  function startCountdown(preset) {
    game.preset = preset;
    showView('countdown');
    let n = 3;
    const numEl = el('countdown-num');
    numEl.textContent = n;
    numEl.style.animation = 'none'; numEl.offsetHeight; numEl.style.animation = '';
    const tick = () => {
      n--;
      if (n > 0) {
        numEl.textContent = n;
        numEl.style.animation = 'none'; numEl.offsetHeight; numEl.style.animation = 'pop 0.6s ease';
        setTimeout(tick, 700);
      } else if (n === 0) {
        numEl.textContent = 'Go';
        numEl.style.animation = 'none'; numEl.offsetHeight; numEl.style.animation = 'pop 0.6s ease';
        setTimeout(beginPlay, 550);
      }
    };
    setTimeout(tick, 700);
  }

  function beginPlay() {
    const p = game.preset;
    game.ops = enabledOps(p);
    game.duration = p.duration;
    game.timeLeft = p.duration;
    game.score = 0;
    game.input = '';
    game.log = [];
    game.current = null;
    game.running = true;
    game.qStartedAt = Date.now();
    el('play-score').textContent = '0';
    updateTimerDisplay();
    showView('play');
    nextQuestion();
    game.timerId = setInterval(onTick, 200);
  }

  function onTick() {
    game.timeLeft = Math.max(0, game.timeLeft - 0.2);
    updateTimerDisplay();
    if (game.timeLeft <= 0) endGame();
  }

  function updateTimerDisplay() {
    const t = Math.ceil(game.timeLeft);
    const m = Math.floor(t / 60), s = t % 60;
    const tEl = el('play-time');
    tEl.textContent = m + ':' + String(s).padStart(2, '0');
    tEl.classList.toggle('low', t <= 10);
  }

  function nextQuestion() {
    game.current = genQuestion(game.preset, game.ops, game.current);
    game.input = '';
    game.qStart = performance.now();
    game.qKeystrokes = 0;
    el('problem').textContent = game.current.text;
    renderInput();
  }

  function renderInput() {
    const disp = el('answer-display');
    if (game.input === '') {
      disp.innerHTML = '<span class="caret"></span>';
    } else {
      disp.textContent = game.input;
    }
  }

  function keyPress(k) {
    if (!game.running) return;
    if (k === 'back') {
      game.input = game.input.slice(0, -1);
      game.qKeystrokes++;
      renderInput();
      return;
    }
    if (k === 'clear') {
      game.input = '';
      game.qKeystrokes++;
      renderInput();
      return;
    }
    // digit
    if (game.input.length >= 7) return; // sanity guard
    if (game.input === '' && k === '0') return; // no leading zero
    game.input += k;
    game.qKeystrokes++;
    renderInput();
    checkMatch();
  }

  function checkMatch() {
    if (parseInt(game.input, 10) === game.current.answer) {
      // correct!
      const timeMs = Math.round(performance.now() - game.qStart);
      game.score++;
      el('play-score').textContent = game.score;
      game.log.push({
        op: game.current.op,
        a: game.current.a,
        b: game.current.b,
        answer: game.current.answer,
        timeMs,
        keystrokes: game.qKeystrokes,
        digits: String(game.current.answer).length,
      });
      nextQuestion();   // paint the next problem first so input never stalls
      flash();          // confirmation flash is non-blocking (composited)
    }
  }

  function flash() {
    const f = el('flash');
    f.classList.remove('go');
    // restart the CSS animation on the next frame without a forced sync reflow
    requestAnimationFrame(() => requestAnimationFrame(() => f.classList.add('go')));
  }

  function endGame() {
    clearInterval(game.timerId);
    game.timerId = null;
    game.running = false;
    const p = game.preset;
    const session = {
      id: 'sess' + Date.now() + '_' + game.score,
      presetId: p.id,
      sig: sig(p),
      score: game.score,
      durationSec: game.duration,
      startedAt: game.qStartedAt || Date.now(),
      questions: game.log,
    };
    addSession(session);
    showResults(session);
  }

  function quitGame() {
    if (game.timerId) clearInterval(game.timerId);
    game.timerId = null;
    game.running = false;
    showView('home');
    refreshHome();
  }

  // ============================================================
  //  STATS + ANALYSIS
  // ============================================================
  function comparableSessions(preset) {
    const s = sig(preset);
    return sessionsForPreset(preset.id).filter((x) => x.sig === s);
  }

  function summarize(preset) {
    const sess = comparableSessions(preset);
    if (sess.length === 0) return { best: null, avg: null, count: 0, sessions: [] };
    const scores = sess.map((x) => x.score);
    const recent = scores.slice(-5);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    return { best: Math.max(...scores), avg: Math.round(avg * 10) / 10, count: sess.length, sessions: sess };
  }

  const OP_LABEL = { add: 'Addition', sub: 'Subtraction', mul: 'Multiplication', div: 'Division' };
  const OP_SYM = { add: '+', sub: '−', mul: '×', div: '÷' };

  // aggregate per-question stats over the last N comparable sessions
  function aggregate(preset, lastN = 10) {
    const sess = comparableSessions(preset).slice(-lastN);
    const qs = [];
    sess.forEach((s) => (s.questions || []).forEach((q) => qs.push(q)));

    const byOp = {};
    qs.forEach((q) => {
      (byOp[q.op] = byOp[q.op] || []).push(q);
    });
    const opStats = {};
    Object.keys(byOp).forEach((op) => {
      const arr = byOp[op].map((q) => q.timeMs).sort((a, b) => a - b);
      opStats[op] = {
        n: arr.length,
        avg: arr.reduce((a, b) => a + b, 0) / arr.length,
        median: arr[Math.floor(arr.length / 2)],
        fumbleRate: byOp[op].filter((q) => q.keystrokes > q.digits).length / byOp[op].length,
      };
    });
    return { qs, byOp, opStats, sessionCount: sess.length };
  }

  // produce human tips. `mode` = 'session' uses just-played log; 'overall' uses aggregate.
  function buildTips(preset, sessionLog) {
    const tips = [];
    const agg = aggregate(preset, 12);
    const ops = Object.keys(agg.opStats);

    if (agg.qs.length < 8) {
      tips.push({ text: 'Play a few more sprints to unlock personalised analysis of your weak spots.', good: false });
      return tips;
    }

    // 1. slowest operation
    const ranked = ops.slice().sort((x, y) => agg.opStats[y].avg - agg.opStats[x].avg);
    const slowest = ranked[0], fastest = ranked[ranked.length - 1];
    if (slowest && fastest && slowest !== fastest) {
      const sAvg = (agg.opStats[slowest].avg / 1000).toFixed(1);
      const fAvg = (agg.opStats[fastest].avg / 1000).toFixed(1);
      tips.push({ text: `${OP_LABEL[slowest]} is your slowest at ${sAvg}s/question (vs ${fAvg}s for ${OP_LABEL[fastest].toLowerCase()}). Drill it.`, good: false });
    }

    // 2. hotspots within slow op
    if (slowest === 'mul' || slowest === 'div') {
      const hot = slowFactors(agg.byOp[slowest]);
      if (hot.length) tips.push({ text: `Toughest ${slowest === 'mul' ? 'times tables' : 'divisors'}: ${hot.map((h) => OP_SYM[slowest] + h.k).join(', ')} (avg ${ (hot[0].avg/1000).toFixed(1) }s). Practise these tables.`, good: false });
    }
    if (slowest === 'add' || slowest === 'sub') {
      const carry = carryCost(agg.byOp[slowest], slowest);
      if (carry) tips.push({ text: carry, good: false });
    }

    // 3. fumbles / accuracy
    const worstFumble = ops.slice().sort((x, y) => agg.opStats[y].fumbleRate - agg.opStats[x].fumbleRate)[0];
    if (worstFumble && agg.opStats[worstFumble].fumbleRate > 0.25) {
      tips.push({ text: `You backspace a lot on ${OP_LABEL[worstFumble].toLowerCase()} (${Math.round(agg.opStats[worstFumble].fumbleRate * 100)}% of answers) — slow down slightly to cut mistakes.`, good: false });
    }

    // 4. encouragement / strength
    if (fastest) {
      tips.push({ text: `Strength: ${OP_LABEL[fastest].toLowerCase()} is quick and clean. Keep it up.`, good: true });
    }

    // 5. trend
    const sum = summarize(preset);
    if (sum.sessions.length >= 4) {
      const half = Math.floor(sum.sessions.length / 2);
      const older = sum.sessions.slice(0, half).map((s) => s.score);
      const newer = sum.sessions.slice(half).map((s) => s.score);
      const oa = older.reduce((a, b) => a + b, 0) / older.length;
      const na = newer.reduce((a, b) => a + b, 0) / newer.length;
      if (na - oa >= 1) tips.push({ text: `You're trending up: recent sessions average ${na.toFixed(1)} vs ${oa.toFixed(1)} earlier. 📈`, good: true });
      else if (oa - na >= 1.5) tips.push({ text: `Recent scores dipped (${na.toFixed(1)} vs ${oa.toFixed(1)}). Warm up before sprinting for a fairer read.`, good: false });
    }

    return tips;
  }

  // slowest "tables" — group mul/div by the smaller factor (the displayed b for div, min(a,b) for mul)
  function slowFactors(qs) {
    const byK = {};
    qs.forEach((q) => {
      const k = q.op === 'div' ? q.b : Math.min(q.a, q.b);
      (byK[k] = byK[k] || []).push(q.timeMs);
    });
    const rows = Object.keys(byK)
      .filter((k) => byK[k].length >= 2)
      .map((k) => ({ k: +k, avg: byK[k].reduce((a, b) => a + b, 0) / byK[k].length, n: byK[k].length }));
    if (rows.length < 3) return [];
    rows.sort((a, b) => b.avg - a.avg);
    return rows.slice(0, 3);
  }

  // carry/borrow cost for add/sub
  function carryCost(qs, op) {
    const needsCarry = (q) => {
      if (op === 'add') return (q.a % 10) + (q.b % 10) >= 10;
      // sub: displayed a - b ; borrow if units of a < units of b
      return (q.a % 10) < (q.b % 10);
    };
    const withC = qs.filter(needsCarry).map((q) => q.timeMs);
    const without = qs.filter((q) => !needsCarry(q)).map((q) => q.timeMs);
    if (withC.length < 3 || without.length < 3) return null;
    const ca = withC.reduce((a, b) => a + b, 0) / withC.length;
    const wa = without.reduce((a, b) => a + b, 0) / without.length;
    if (ca - wa > 400) {
      const word = op === 'add' ? 'carry' : 'borrow';
      return `Problems needing a ${word} cost you ~${((ca - wa) / 1000).toFixed(1)}s extra. Practise ${word}-heavy ${OP_LABEL[op].toLowerCase()}.`;
    }
    return null;
  }

  // ============================================================
  //  VIEWS / ROUTING
  // ============================================================
  const VIEWS = ['home', 'countdown', 'play', 'results', 'stats', 'presets', 'editor'];
  function showView(name) {
    VIEWS.forEach((v) => el('view-' + v).classList.toggle('hidden', v !== name));
    window.scrollTo(0, 0);
  }

  function fmt(n) { return n == null ? '–' : n; }

  function refreshHome() {
    const presets = getPresets();
    const sel = el('preset-select');
    const lastId = load(K_LAST, presets[0].id);
    sel.innerHTML = presets.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    sel.value = presets.find((p) => p.id === lastId) ? lastId : presets[0].id;
    updateHomeSummary();
  }

  function updateHomeSummary() {
    const p = getPreset(el('preset-select').value);
    const sum = summarize(p);
    el('home-best').textContent = fmt(sum.best);
    el('home-avg').textContent = fmt(sum.avg);
    el('home-count').textContent = sum.count;
    el('home-desc').textContent = describePreset(p);
  }

  function describePreset(p) {
    const parts = [];
    if (p.add.on) parts.push(`+ (${p.add.amin}–${p.add.amax} & ${p.add.bmin}–${p.add.bmax})`);
    if (p.sub.on) parts.push('−');
    if (p.mul.on) parts.push(`× (${p.mul.amin}–${p.mul.amax} & ${p.mul.bmin}–${p.mul.bmax})`);
    if (p.div.on) parts.push('÷');
    return `${p.duration}s · ${parts.join('  ') || 'no operations enabled'}`;
  }

  function showResults(session) {
    const p = game.preset;
    const sum = summarize(p);
    el('res-score').textContent = session.score;

    // delta vs previous best (excluding this session) and recent avg
    const prior = comparableSessions(p).slice(0, -1).map((s) => s.score);
    const deltaEl = el('res-delta');
    if (prior.length === 0) {
      deltaEl.textContent = 'First session for this preset — baseline set.';
      deltaEl.classList.remove('up');
    } else {
      const prevBest = Math.max(...prior);
      if (session.score > prevBest) {
        deltaEl.textContent = `🎉 New best! +${session.score - prevBest} over your previous ${prevBest}.`;
        deltaEl.classList.add('up');
      } else {
        const d = session.score - prevBest;
        deltaEl.textContent = `${d} from your best (${prevBest}).`;
        deltaEl.classList.remove('up');
      }
    }

    el('res-best').textContent = fmt(sum.best);
    el('res-avg').textContent = fmt(sum.avg);
    const avgQ = session.questions.length
      ? (session.questions.reduce((a, q) => a + q.timeMs, 0) / session.questions.length / 1000).toFixed(1) + 's'
      : '–';
    el('res-acc').textContent = avgQ;

    const tips = buildTips(p, session.questions);
    el('res-tips').innerHTML = tips.map((t) => `<li class="${t.good ? 'good' : ''}">${escapeHtml(t.text)}</li>`).join('');

    showView('results');
  }

  // ---------- stats view ----------
  function openStats(presetId) {
    const presets = getPresets();
    const sel = el('stats-preset-select');
    sel.innerHTML = presets.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    sel.value = presetId && presets.find((p) => p.id === presetId) ? presetId : (load(K_LAST, presets[0].id));
    if (!presets.find((p) => p.id === sel.value)) sel.value = presets[0].id;
    renderStats();
    showView('stats');
  }

  function renderStats() {
    const p = getPreset(el('stats-preset-select').value);
    const sum = summarize(p);
    el('stats-best').textContent = fmt(sum.best);
    el('stats-avg').textContent = fmt(sum.avg);
    el('stats-count').textContent = sum.count;
    drawChart(sum.sessions.map((s) => s.score));
    drawOpBars(p);
    const tips = buildTips(p, null);
    el('stats-tips').innerHTML = tips.map((t) => `<li class="${t.good ? 'good' : ''}">${escapeHtml(t.text)}</li>`).join('');
  }

  function drawChart(scores) {
    const host = el('chart');
    if (!scores || scores.length < 2) {
      host.innerHTML = '<div class="empty">Play at least 2 sessions to see your trend.</div>';
      return;
    }
    const W = 320, H = 160, pad = 24;
    const max = Math.max(...scores), min = Math.min(...scores);
    const span = Math.max(1, max - min);
    const x = (i) => pad + (i / (scores.length - 1)) * (W - 2 * pad);
    const y = (v) => H - pad - ((v - min) / span) * (H - 2 * pad);
    const pts = scores.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const line = pts.map((pt, i) => (i === 0 ? 'M' : 'L') + pt).join(' ');
    const area = `M${x(0).toFixed(1)},${(H - pad).toFixed(1)} L` + pts.join(' L') + ` L${x(scores.length - 1).toFixed(1)},${(H - pad).toFixed(1)} Z`;
    const dots = scores.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" fill="var(--accent)" />`).join('');
    host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <text x="${pad}" y="14" fill="var(--text-faint)" font-size="11">${max}</text>
      <text x="${pad}" y="${H - pad + 14}" fill="var(--text-faint)" font-size="11">${min}</text>
      <path d="${area}" fill="var(--accent)" opacity="0.12" />
      <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      ${dots}
    </svg>`;
  }

  function drawOpBars(p) {
    const agg = aggregate(p, 12);
    const ops = Object.keys(agg.opStats);
    const host = el('op-bars');
    if (ops.length === 0) {
      host.innerHTML = '<div class="empty">No question data yet.</div>';
      return;
    }
    const maxAvg = Math.max(...ops.map((o) => agg.opStats[o].avg));
    const order = ['add', 'sub', 'mul', 'div'].filter((o) => ops.includes(o));
    host.innerHTML = order.map((o) => {
      const st = agg.opStats[o];
      const w = Math.round((st.avg / maxAvg) * 100);
      return `<div class="op-bar-row">
        <span>${OP_LABEL[o]}</span>
        <span class="op-bar-track"><span class="op-bar-fill" style="width:${w}%"></span></span>
        <span class="op-bar-val">${(st.avg / 1000).toFixed(1)}s</span>
      </div>`;
    }).join('');
  }

  // ============================================================
  //  PRESET LIST + EDITOR
  // ============================================================
  function openPresets() {
    const presets = getPresets();
    const list = el('preset-list');
    list.innerHTML = presets.map((p) => `
      <li data-id="${p.id}">
        <div>
          <div class="pl-name">${escapeHtml(p.name)}</div>
          <div class="pl-meta">${escapeHtml(describePreset(p))}</div>
        </div>
        <span class="pl-chevron">›</span>
      </li>`).join('');
    list.querySelectorAll('li').forEach((li) => li.addEventListener('click', () => openEditor(li.dataset.id)));
    showView('presets');
  }

  let editing = null; // {id|null, ...}
  function openEditor(id) {
    const presets = getPresets();
    const p = id ? JSON.parse(JSON.stringify(presets.find((x) => x.id === id))) : newPresetTemplate();
    editing = p;
    el('editor-title').textContent = id ? 'Edit preset' : 'New preset';
    el('ed-name').value = p.name;
    setDuration(p.duration);
    el('ed-add-on').checked = p.add.on;
    el('ed-add-amin').value = p.add.amin; el('ed-add-amax').value = p.add.amax;
    el('ed-add-bmin').value = p.add.bmin; el('ed-add-bmax').value = p.add.bmax;
    el('ed-sub-on').checked = p.sub.on;
    el('ed-mul-on').checked = p.mul.on;
    el('ed-mul-amin').value = p.mul.amin; el('ed-mul-amax').value = p.mul.amax;
    el('ed-mul-bmin').value = p.mul.bmin; el('ed-mul-bmax').value = p.mul.bmax;
    el('ed-div-on').checked = p.div.on;
    el('btn-editor-delete').style.display = (id && id !== 'default' && presets.length > 1) ? '' : 'none';
    syncRangeEnabled();
    showView('editor');
  }

  function newPresetTemplate() {
    const d = defaultPreset();
    d.id = null; d.name = '';
    return d;
  }

  function setDuration(dur) {
    el('ed-duration').querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', +b.dataset.dur === dur));
  }
  function currentDuration() {
    const a = el('ed-duration').querySelector('.seg-btn.active');
    return a ? +a.dataset.dur : 120;
  }

  function syncRangeEnabled() {
    el('ed-add-ranges').classList.toggle('disabled', !el('ed-add-on').checked);
    el('ed-mul-ranges').classList.toggle('disabled', !el('ed-mul-on').checked);
  }

  function readEditor() {
    const intv = (id, d) => { const v = parseInt(el(id).value, 10); return Number.isFinite(v) ? v : d; };
    const clampPair = (lo, hi) => { lo = Math.max(0, lo); hi = Math.max(lo, hi); return [lo, hi]; };
    let [aamin, aamax] = clampPair(intv('ed-add-amin', 2), intv('ed-add-amax', 100));
    let [abmin, abmax] = clampPair(intv('ed-add-bmin', 2), intv('ed-add-bmax', 100));
    let [mamin, mamax] = clampPair(intv('ed-mul-amin', 2), intv('ed-mul-amax', 12));
    let [mbmin, mbmax] = clampPair(intv('ed-mul-bmin', 2), intv('ed-mul-bmax', 100));
    const name = el('ed-name').value.trim() || 'Untitled';
    return {
      id: editing.id,
      name,
      duration: currentDuration(),
      add: { on: el('ed-add-on').checked, amin: aamin, amax: aamax, bmin: abmin, bmax: abmax },
      sub: { on: el('ed-sub-on').checked },
      mul: { on: el('ed-mul-on').checked, amin: mamin, amax: mamax, bmin: mbmin, bmax: mbmax },
      div: { on: el('ed-div-on').checked },
    };
  }

  function saveEditor() {
    const p = readEditor();
    if (!p.add.on && !p.sub.on && !p.mul.on && !p.div.on) {
      alert('Enable at least one operation.');
      return;
    }
    const presets = getPresets();
    if (p.id) {
      const i = presets.findIndex((x) => x.id === p.id);
      presets[i] = p;
    } else {
      p.id = uid();
      presets.push(p);
      save(K_LAST, p.id);
    }
    setPresets(presets);
    refreshHome();
    if (el('preset-select')) el('preset-select').value = p.id;
    updateHomeSummary();
    openPresets();
  }

  function deleteEditor() {
    if (!editing.id) { openPresets(); return; }
    if (!confirm('Delete this preset? Its session history will remain but become unreachable.')) return;
    let presets = getPresets().filter((x) => x.id !== editing.id);
    if (presets.length === 0) presets = [defaultPreset()];
    setPresets(presets);
    save(K_LAST, presets[0].id);
    refreshHome();
    openPresets();
  }

  // ============================================================
  //  INPUT WIRING
  // ============================================================
  function wireKeypad() {
    const pad = el('keypad');
    pad.querySelectorAll('.key').forEach((btn) => {
      const k = btn.dataset.k;
      const down = (e) => {
        e.preventDefault();
        btn.classList.add('pressed');
        keyPress(k);
      };
      const up = () => btn.classList.remove('pressed');
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointerleave', up);
      btn.addEventListener('pointercancel', up);
    });
    // physical keyboard (desktop testing)
    document.addEventListener('keydown', (e) => {
      if (el('view-play').classList.contains('hidden')) return;
      if (e.key >= '0' && e.key <= '9') keyPress(e.key);
      else if (e.key === 'Backspace') keyPress('back');
      else if (e.key === 'Escape') quitGame();
    });
  }

  // ============================================================
  //  EVENT BINDINGS
  // ============================================================
  function wire() {
    el('btn-start').addEventListener('click', () => {
      const p = getPreset(el('preset-select').value);
      save(K_LAST, p.id);
      startCountdown(p);
    });
    el('preset-select').addEventListener('change', () => { save(K_LAST, el('preset-select').value); updateHomeSummary(); });
    el('btn-edit-presets').addEventListener('click', openPresets);
    el('btn-go-stats').addEventListener('click', () => openStats(el('preset-select').value));

    el('btn-quit').addEventListener('click', () => { if (confirm('Quit this sprint? It won’t be saved.')) quitGame(); });

    el('btn-results-home').addEventListener('click', () => { showView('home'); refreshHome(); });
    el('btn-replay').addEventListener('click', () => startCountdown(game.preset));
    el('btn-change-preset').addEventListener('click', () => { showView('home'); refreshHome(); });
    el('btn-results-stats').addEventListener('click', () => openStats(game.preset.id));

    el('btn-stats-home').addEventListener('click', () => { showView('home'); refreshHome(); });
    el('stats-preset-select').addEventListener('change', renderStats);
    el('btn-clear-preset').addEventListener('click', clearPresetHistory);

    el('btn-presets-home').addEventListener('click', () => { showView('home'); refreshHome(); });
    el('btn-new-preset').addEventListener('click', () => openEditor(null));

    el('btn-editor-cancel').addEventListener('click', openPresets);
    el('btn-editor-save').addEventListener('click', saveEditor);
    el('btn-editor-delete').addEventListener('click', deleteEditor);
    el('ed-add-on').addEventListener('change', syncRangeEnabled);
    el('ed-mul-on').addEventListener('change', syncRangeEnabled);
    el('ed-duration').querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => setDuration(+b.dataset.dur)));

    wireKeypad();
  }

  function clearPresetHistory() {
    const p = getPreset(el('stats-preset-select').value);
    if (!confirm(`Delete all session history for "${p.name}"? This cannot be undone.`)) return;
    const kept = getSessions().filter((s) => s.presetId !== p.id);
    save(K_SESSIONS, kept);
    renderStats();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ============================================================
  //  BOOT
  // ============================================================
  function boot() {
    getPresets(); // ensure default exists
    wire();
    refreshHome();
    showView('home');
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
