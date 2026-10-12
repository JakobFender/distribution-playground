// UI wiring: Explore mode (one tab per distribution) and the Fit game.
(function () {
  'use strict';

  const D = window.Dists;
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : fallback;
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        /* storage unavailable: ignore */
      }
    },
  };

  const cssColor = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function fmt(v, digits = 4) {
    if (Number.isNaN(v)) return 'undefined';
    if (v === Infinity) return '∞';
    if (v === -Infinity) return '−∞';
    if (v !== 0 && (Math.abs(v) >= 1e6 || Math.abs(v) < 1e-4)) return v.toExponential(2);
    return String(Number(v.toFixed(digits)));
  }

  function renderTex(el, tex) {
    if (window.katex) {
      try {
        window.katex.render(tex, el, { displayMode: true, throwOnError: false });
        el.classList.remove('raw');
        return;
      } catch (e) {
        /* fall through to raw text */
      }
    }
    el.textContent = tex;
    el.classList.add('raw');
  }

  function rafThrottle(fn) {
    let queued = false;
    return () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        fn();
      });
    };
  }

  function paramString(d, p) {
    return `${d.name}(${d.params.map((s) => `${s.label.split(' ')[0]} = ${fmt(p[s.key], 3)}`).join(', ')})`;
  }

  function median(d, p) {
    if (d.type === 'continuous') return D.quantile(d, p, 0.5);
    const e = D.enumerate(d, p, 1e-12);
    return e.ks[e.cdf.findIndex((c) => c >= 0.5)];
  }

  // Robust y-limit for densities that may spike to infinity at a boundary.
  function densityYMax(ys) {
    const finite = Array.from(ys).filter((v) => isFinite(v) && v > 0).sort((a, b) => a - b);
    if (!finite.length) return 1;
    const max = finite[finite.length - 1];
    const p95 = finite[Math.floor(0.95 * (finite.length - 1))];
    return Math.min(max, 3 * p95);
  }

  function densityGrid(d, p, x0, x1, n = 600) {
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const x = x0 + ((i + 0.5) / n) * (x1 - x0);
      xs[i] = x;
      ys[i] = d.pdf(x, p);
    }
    return { xs, ys };
  }

  function integersIn(x0, x1) {
    const ks = [];
    for (let k = Math.ceil(x0); k <= Math.floor(x1); k++) ks.push(k);
    return ks;
  }

  function discreteCdfAt(d, p) {
    const e = D.enumerate(d, p, 1e-12);
    const lo = e.ks[0];
    return (k) => (k < lo ? 0 : k - lo >= e.cdf.length ? 1 : e.cdf[k - lo]);
  }

  function legendHtml(items) {
    return items
      .map(({ label, color, dashed }) =>
        `<span><i class="${dashed ? 'dashed' : ''}" style="background:${color};border-color:${color}"></i>${label}</span>`)
      .join('');
  }

  function swatch(color) {
    return `<span class="sw" style="background:${color}"></span>`;
  }

  // Slider + number input per parameter.
  function buildParamControls(container, d, params, onChange) {
    container.innerHTML = '';
    const inputs = {};
    for (const spec of d.params) {
      const wrap = document.createElement('div');
      const label = document.createElement('label');
      label.className = 'param-label';
      label.textContent = spec.label;
      const row = document.createElement('div');
      row.className = 'param-row';
      const range = document.createElement('input');
      range.type = 'range';
      const num = document.createElement('input');
      num.type = 'number';
      for (const el of [range, num]) {
        el.min = spec.min;
        el.max = spec.max;
        el.step = spec.step;
      }
      range.setAttribute('aria-label', spec.label);
      num.setAttribute('aria-label', `${spec.label} value`);
      range.addEventListener('input', () => update(spec.key, Number(range.value)));
      num.addEventListener('input', () => {
        if (num.value !== '' && isFinite(Number(num.value))) update(spec.key, Number(num.value), true);
      });
      num.addEventListener('change', () => sync());
      row.append(range, num);
      wrap.append(label, row);
      container.append(wrap);
      inputs[spec.key] = { range, num, spec };
    }

    function sync(skipFocused) {
      for (const { range, num, spec } of Object.values(inputs)) {
        const max = spec.maxFn ? spec.maxFn(params) : spec.max;
        range.max = max;
        num.max = max;
        range.value = params[spec.key];
        if (!(skipFocused && document.activeElement === num)) num.value = params[spec.key];
      }
    }

    function update(key, value, fromNumber) {
      params[key] = value;
      D.normalizeParams(d, params, key);
      sync(fromNumber);
      onChange();
    }

    sync();
    return { sync };
  }

  // ---------------------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------------------

  const plots = [];
  function applyTheme(theme) {
    if (theme) document.documentElement.setAttribute('data-theme', theme);
    else document.documentElement.removeAttribute('data-theme');
    plots.forEach((p) => p.draw());
    renderExplore();
    renderGame();
  }
  $('theme-toggle').addEventListener('click', () => {
    const current =
      document.documentElement.getAttribute('data-theme') ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    store.set('dp-theme', next);
    applyTheme(next);
  });

  // ---------------------------------------------------------------------------
  // Explore mode
  // ---------------------------------------------------------------------------

  const ex = {
    d: null,
    params: store.get('dp-params', {}),
    view: 'pdf',
    autozoom: true,
    range: null,
    samples: null,
    controls: null,
  };

  const exPlot = new window.Plot($('ex-canvas'), { onHover: exHover });
  plots.push(exPlot);

  function buildTabs() {
    for (const [group, list] of [['continuous', D.continuous], ['discrete', D.discrete]]) {
      const row = $(`tabs-${group}`);
      for (const d of list) {
        const b = document.createElement('button');
        b.setAttribute('role', 'tab');
        b.textContent = d.name;
        b.dataset.id = d.id;
        b.addEventListener('click', () => {
          selectDist(d.id);
          history.replaceState(null, '', `#${d.id}`);
        });
        row.append(b);
      }
    }
  }

  function selectDist(id) {
    const d = D.byId[id] || D.continuous[0];
    ex.d = d;
    ex.samples = null;
    ex.range = null;
    if (!ex.params[d.id]) ex.params[d.id] = D.defaultParams(d);
    D.normalizeParams(d, ex.params[d.id]);
    document.querySelectorAll('.tab-row button').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.id === d.id));
    });
    $('ex-name').textContent = d.name;
    $('ex-type').textContent = d.type;
    $('ex-desc').textContent = d.desc;
    renderTex($('ex-formula'), d.tex);
    $('ex-view-pdf').textContent = d.type === 'discrete' ? 'PMF' : 'PDF';
    ex.controls = buildParamControls($('ex-params'), d, ex.params[d.id], onExParamChange);
    renderExplore();
  }

  const onExParamChange = (() => {
    const draw = rafThrottle(renderExplore);
    return () => {
      ex.samples = null; // samples belong to the old parameters
      store.set('dp-params', ex.params);
      draw();
    };
  })();

  function exRange() {
    const d = ex.d;
    const p = ex.params[d.id];
    if (!ex.range || ex.autozoom) ex.range = D.plotRange(d, p);
    return ex.range;
  }

  function renderExplore() {
    if (!ex.d) return;
    const d = ex.d;
    const p = ex.params[d.id];
    const [x0, x1] = exRange();
    const c1 = cssColor('--series-1');
    const c3 = cssColor('--series-3');
    const series = [];
    let yMax;
    const s = ex.samples;

    if (d.type === 'discrete') {
      const ks = integersIn(x0, x1);
      if (ex.view === 'pdf') {
        const ys = ks.map((k) => d.pmf(k, p));
        let hmax = 0;
        if (s) {
          const freq = ks.map((k) => (s.counts.get(k) || 0) / s.n);
          hmax = Math.max(...freq);
          series.push({ kind: 'bars', xs: ks, ys: freq, barWidth: 0.8, fill: 0.4, color: c3 });
        }
        series.push({ kind: 'lollipop', xs: ks, ys, color: c1, radius: ks.length > 60 ? 2.5 : 4.5 });
        yMax = Math.max(Math.max(...ys), hmax) * 1.12 || 1;
      } else {
        const e = D.enumerate(d, p, 1e-12);
        series.push({ kind: 'step', xs: e.ks, ys: e.cdf, color: c1, width: 2 });
        if (s) series.push({ kind: 'step', xs: s.ecdfX, ys: s.ecdfY, color: c3, width: 1.5, dash: [5, 4] });
        yMax = 1.05;
      }
    } else if (ex.view === 'pdf') {
      const { xs, ys } = densityGrid(d, p, x0, x1);
      yMax = densityYMax(ys);
      if (s) {
        const bins = Math.max(20, Math.min(80, Math.round(Math.sqrt(s.n) * 1.5)));
        const w = (x1 - x0) / bins;
        const heights = new Float64Array(bins);
        for (const v of s.values) {
          const i = Math.floor((v - x0) / w);
          if (i >= 0 && i < bins) heights[i] += 1 / (s.n * w);
        }
        const edges = Array.from({ length: bins + 1 }, (_, i) => x0 + i * w);
        series.push({ kind: 'hist', edges, heights, fill: 0.4, color: c3, gap: true });
        yMax = Math.max(yMax, Math.min(Math.max(...heights), yMax * 1.5));
      }
      yMax *= 1.08;
      series.push({ kind: 'curve', xs, ys, color: c1, fill: 0.14, width: 2 });
    } else {
      const n = 600;
      const xs = new Float64Array(n);
      const ys = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        xs[i] = x0 + (i / (n - 1)) * (x1 - x0);
        ys[i] = d.cdf(xs[i], p);
      }
      series.push({ kind: 'curve', xs, ys, color: c1, width: 2 });
      if (s) series.push({ kind: 'step', xs: s.ecdfX, ys: s.ecdfY, color: c3, width: 1.5, dash: [5, 4] });
      yMax = 1.05;
    }

    exPlot.set({ xRange: [x0, x1], yMax, series, discrete: d.type === 'discrete' });

    const fname = d.type === 'discrete' ? (ex.view === 'pdf' ? 'PMF' : 'CDF') : ex.view.toUpperCase();
    $('ex-legend').innerHTML = s
      ? legendHtml([
          { label: fname, color: c1 },
          { label: `Samples (n = ${s.n.toLocaleString()})`, color: c3, dashed: ex.view === 'cdf' },
        ])
      : '';
    renderStats();
  }

  function renderStats() {
    const d = ex.d;
    const p = ex.params[d.id];
    const s = ex.samples;
    const mean = d.mean(p);
    const variance = d.variance(p);
    const rows = [
      ['Mean', mean, s && s.mean],
      ['Median', median(d, p), s && s.median],
      ['Variance', variance, s && s.variance],
      ['Std. dev.', isNaN(variance) ? NaN : Math.sqrt(variance), s && Math.sqrt(s.variance)],
    ];
    const head = s ? '<thead><tr><th></th><th>Theory</th><th>Sample</th></tr></thead>' : '';
    $('ex-stats').innerHTML =
      head +
      '<tbody>' +
      rows
        .map(([name, t, sv]) => `<tr><th>${name}</th><td>${fmt(t)}</td>${s ? `<td>${fmt(sv)}</td>` : ''}</tr>`)
        .join('') +
      '</tbody>';
  }

  function exHover(x) {
    const d = ex.d;
    const p = ex.params[d.id];
    const c1 = cssColor('--series-1');
    const c3 = cssColor('--series-3');
    if (d.type === 'discrete') {
      const k = x;
      const lines = [
        `<b>k = ${k}</b>`,
        `${swatch(c1)}P(X = k) = ${fmt(d.pmf(k, p))}`,
        `${swatch(c1)}P(X ≤ k) = ${fmt(discreteCdfAt(d, p)(k))}`,
      ];
      if (ex.samples) lines.push(`${swatch(c3)}sample freq. = ${fmt((ex.samples.counts.get(k) || 0) / ex.samples.n)}`);
      return lines;
    }
    return [
      `<b>x = ${fmt(x, 3)}</b>`,
      `${swatch(c1)}f(x) = ${fmt(d.pdf(x, p))}`,
      `${swatch(c1)}F(x) = ${fmt(d.cdf(x, p))}`,
    ];
  }

  function drawSamples() {
    const d = ex.d;
    const p = ex.params[d.id];
    const n = Number($('ex-n').value);
    const values = D.sample(d, p, n);
    const sorted = Float64Array.from(values).sort();
    let sum = 0;
    for (const v of values) sum += v;
    const mean = sum / n;
    let ss = 0;
    for (const v of values) ss += (v - mean) * (v - mean);
    const counts = new Map();
    if (d.type === 'discrete') for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
    // ECDF, thinned to at most ~2000 steps for drawing.
    const stride = Math.max(1, Math.floor(n / 2000));
    const ecdfX = [];
    const ecdfY = [];
    for (let i = 0; i < n; i++) {
      const last = i === n - 1 || sorted[i + 1] !== sorted[i];
      if (last && (i % stride === 0 || i === n - 1 || d.type === 'discrete')) {
        ecdfX.push(sorted[i]);
        ecdfY.push((i + 1) / n);
      }
    }
    ex.samples = {
      n, values, counts, ecdfX, ecdfY, mean,
      variance: n > 1 ? ss / (n - 1) : 0,
      median: n % 2 ? sorted[(n - 1) / 2] : 0.5 * (sorted[n / 2 - 1] + sorted[n / 2]),
    };
    renderExplore();
  }

  $('ex-sample').addEventListener('click', drawSamples);
  $('ex-clear').addEventListener('click', () => {
    ex.samples = null;
    renderExplore();
  });
  $('ex-reset').addEventListener('click', () => {
    ex.params[ex.d.id] = D.defaultParams(ex.d);
    store.set('dp-params', ex.params);
    selectDist(ex.d.id);
  });
  $('ex-random').addEventListener('click', () => {
    ex.params[ex.d.id] = D.randomParams(ex.d);
    store.set('dp-params', ex.params);
    selectDist(ex.d.id);
  });
  document.querySelectorAll('.segmented button').forEach((b) =>
    b.addEventListener('click', () => {
      ex.view = b.dataset.view;
      document.querySelectorAll('.segmented button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
      renderExplore();
    })
  );
  $('ex-autozoom').addEventListener('change', (e) => {
    ex.autozoom = e.target.checked;
    if (ex.autozoom) ex.range = null;
    renderExplore();
  });

  // ---------------------------------------------------------------------------
  // Game mode
  // ---------------------------------------------------------------------------

  const g = {
    settings: Object.assign({ difficulty: 'easy', pool: 'all', threshold: '0.95' }, store.get('dp-game-settings', {})),
    stats: Object.assign({ score: 0, won: 0, streak: 0, best: 0 }, store.get('dp-game-stats', {})),
    target: null, // { d, p }
    guess: null, // { d, p }
    range: null,
    targetYMax: 1,
    start: 0,
    elapsed: 0,
    over: false,
    hintUsed: false,
    overlap: 0,
  };

  const gPlot = new window.Plot($('g-canvas'), { onHover: gHover });
  plots.push(gPlot);

  for (const key of ['difficulty', 'pool', 'threshold']) {
    const el = $(`g-${key}`);
    el.value = g.settings[key];
    el.addEventListener('change', () => {
      g.settings[key] = el.value;
      store.set('dp-game-settings', g.settings);
      if (key === 'threshold') {
        updateGameStatus();
      } else {
        newRound();
      }
    });
  }

  function poolList() {
    if (g.settings.pool === 'continuous') return D.continuous;
    if (g.settings.pool === 'discrete') return D.discrete;
    return D.all;
  }

  function newRound() {
    const list = poolList();
    const prevId = g.target && g.target.d.id;
    let d;
    do {
      d = list[Math.floor(Math.random() * list.length)];
    } while (list.length > 1 && d.id === prevId);

    const hard = g.settings.difficulty === 'hard';
    let guessD = d;
    if (hard) {
      // Keep the previous guess family if it is of the right type.
      guessD = g.guess && g.guess.d.type === d.type ? g.guess.d : d.type === 'discrete' ? D.byId.poisson : D.byId.normal;
    }
    const guessP = D.defaultParams(guessD);

    // Pick a target that is visibly different from the starting guess.
    let p;
    for (let i = 0; i < 40; i++) {
      p = D.randomParams(d);
      if (D.overlap(d, p, guessD, guessP) < 0.6) break;
    }

    g.target = { d, p };
    g.guess = { d: guessD, p: guessP };
    g.range = D.plotRange(d, p);
    if (d.type === 'discrete') {
      const ks = integersIn(g.range[0], g.range[1]);
      g.targetYMax = Math.max(...ks.map((k) => d.pmf(k, p)));
    } else {
      g.targetYMax = densityYMax(densityGrid(d, p, g.range[0], g.range[1]).ys);
    }
    g.start = performance.now();
    g.elapsed = 0;
    g.over = false;
    g.hintUsed = false;
    $('g-hint').disabled = false;
    $('g-giveup').disabled = false;
    $('g-hint-box').hidden = true;
    $('g-result').hidden = true;
    buildGuessUi();
    renderGame();
    updateGameStatus();
  }

  function buildGuessUi() {
    const wrap = $('g-family-wrap');
    wrap.innerHTML = '';
    const hard = g.settings.difficulty === 'hard';
    if (!hard) {
      wrap.innerHTML = `<p class="family-known">${g.target.d.name} <small>— match its parameters</small></p>`;
    } else {
      const label = document.createElement('label');
      label.className = 'param-label';
      label.textContent = `Family (target is ${g.target.d.type})`;
      const sel = document.createElement('select');
      sel.className = 'family-select';
      const list = g.target.d.type === 'discrete' ? D.discrete : D.continuous;
      for (const d of list) {
        const o = document.createElement('option');
        o.value = d.id;
        o.textContent = d.name;
        sel.append(o);
      }
      sel.value = g.guess.d.id;
      sel.addEventListener('change', () => {
        const d = D.byId[sel.value];
        g.guess = { d, p: D.defaultParams(d) };
        buildGuessParams();
        onGuessChange();
      });
      wrap.append(label, sel);
    }
    buildGuessParams();
  }

  function buildGuessParams() {
    buildParamControls($('g-params'), g.guess.d, g.guess.p, onGuessChange);
  }

  const onGuessChange = rafThrottle(() => {
    renderGame();
    updateGameStatus();
  });

  function renderGame() {
    if (!g.target) return;
    const { d: dt, p: pt } = g.target;
    const { d: du, p: pu } = g.guess;
    const [x0, x1] = g.range;
    const c1 = cssColor('--series-1');
    const c2 = cssColor('--series-2');
    const series = [];
    let yMax;
    if (dt.type === 'discrete') {
      const ks = integersIn(x0, x1);
      const yt = ks.map((k) => dt.pmf(k, pt));
      const yu = ks.map((k) => du.pmf(k, pu));
      const umax = Math.max(...yu);
      yMax = Math.max(g.targetYMax, Math.min(umax, 2 * g.targetYMax)) * 1.15;
      series.push({ kind: 'bars', xs: ks, ys: yu, barWidth: 0.72, fill: 0.55, color: c1 });
      series.push({ kind: 'lollipop', xs: ks, ys: yt, color: c2, hollow: true, dash: [4, 3], radius: ks.length > 60 ? 2.5 : 4.5 });
    } else {
      const t = densityGrid(dt, pt, x0, x1);
      const u = densityGrid(du, pu, x0, x1);
      yMax = Math.max(g.targetYMax, Math.min(densityYMax(u.ys), 2 * g.targetYMax)) * 1.12;
      series.push({ kind: 'curve', xs: u.xs, ys: u.ys, color: c1, fill: 0.2, width: 2 });
      series.push({ kind: 'curve', xs: t.xs, ys: t.ys, color: c2, width: 2.5, dash: [7, 5] });
    }
    gPlot.set({ xRange: [x0, x1], yMax, series, discrete: dt.type === 'discrete' });
    $('g-legend').innerHTML = legendHtml([
      { label: 'Target', color: c2, dashed: true },
      { label: 'Your guess', color: c1 },
    ]);
  }

  function gHover(x) {
    if (!g.target) return null;
    const { d: dt, p: pt } = g.target;
    const { d: du, p: pu } = g.guess;
    const c1 = cssColor('--series-1');
    const c2 = cssColor('--series-2');
    if (dt.type === 'discrete') {
      return [`<b>k = ${x}</b>`, `${swatch(c2)}target ${fmt(dt.pmf(x, pt))}`, `${swatch(c1)}guess ${fmt(du.pmf(x, pu))}`];
    }
    return [`<b>x = ${fmt(x, 3)}</b>`, `${swatch(c2)}target ${fmt(dt.pdf(x, pt))}`, `${swatch(c1)}guess ${fmt(du.pdf(x, pu))}`];
  }

  function updateGameStatus() {
    if (!g.target) return;
    const { d: dt, p: pt } = g.target;
    const { d: du, p: pu } = g.guess;
    const ov = D.overlap(dt, pt, du, pu);
    g.overlap = ov;
    const threshold = Number(g.settings.threshold);
    $('g-overlap').textContent = `${(ov * 100).toFixed(1)}%`;
    const fill = $('g-meter');
    fill.style.width = `${(ov * 100).toFixed(1)}%`;
    fill.classList.toggle('win', ov >= threshold);
    $('g-goal').style.left = `calc(${threshold * 100}% - 1px)`;

    // Feedback text
    let msg = '';
    if (!g.over) {
      if (ov >= threshold) msg = 'Got it!';
      else if (ov >= threshold - 0.05) msg = 'So close — fine-tune it.';
      else if (ov >= 0.75) msg = 'Getting warm.';
      else if (ov < 0.05) {
        const mu = median(du, pu);
        const [x0, x1] = g.range;
        msg = mu > x1 ? 'Your guess is off to the right of the view.' : mu < x0 ? 'Your guess is off to the left of the view.' : 'Not much overlap yet.';
      } else msg = 'Keep adjusting the sliders.';
    }
    $('g-feedback').textContent = msg;

    if (g.hintUsed) renderHint();
    if (!g.over && ov >= threshold) win();
  }

  function renderHint() {
    const { d: dt, p: pt } = g.target;
    const { d: du, p: pu } = g.guess;
    const sd = (d, p) => Math.sqrt(d.variance(p));
    $('g-hint-box').innerHTML = `
      <table class="stats">
        <thead><tr><th></th><th>Target</th><th>Yours</th></tr></thead>
        <tbody>
          <tr><th>Mean</th><td>${fmt(dt.mean(pt), 3)}</td><td>${fmt(du.mean(pu), 3)}</td></tr>
          <tr><th>Median</th><td>${fmt(median(dt, pt), 3)}</td><td>${fmt(median(du, pu), 3)}</td></tr>
          <tr><th>Std. dev.</th><td>${fmt(sd(dt, pt), 3)}</td><td>${fmt(sd(du, pu), 3)}</td></tr>
        </tbody>
      </table>`;
    $('g-hint-box').hidden = false;
  }

  function seconds() {
    return Math.floor((g.over ? g.elapsed : performance.now() - g.start) / 1000);
  }

  function finishRound() {
    g.elapsed = performance.now() - g.start;
    g.over = true;
    $('g-hint').disabled = true;
    $('g-giveup').disabled = true;
  }

  function win() {
    finishRound();
    const secs = seconds();
    const hard = g.settings.difficulty === 'hard';
    const thresholdBonus = { '0.9': 0, '0.95': 20, '0.98': 50 }[g.settings.threshold] || 0;
    const points = Math.max(10, 100 + (hard ? 50 : 0) + thresholdBonus + Math.max(0, 60 - secs) - (g.hintUsed ? 25 : 0));
    const st = g.stats;
    st.score += points;
    st.won += 1;
    st.streak += 1;
    st.best = Math.max(st.best, st.streak);
    saveStats();
    const familyNote =
      hard && g.guess.d.id !== g.target.d.id
        ? `<p>Nice — you matched it with a <b>${g.guess.d.name}</b>; the target was a ${g.target.d.name}.</p>`
        : '';
    showResult(
      'win',
      `<h3>Solved in ${secs}s! +${points}</h3>
       <p>Target: <b>${paramString(g.target.d, g.target.p)}</b></p>
       <p>Yours: ${paramString(g.guess.d, g.guess.p)}</p>${familyNote}`
    );
    $('g-feedback').textContent = '';
  }

  function giveUp() {
    if (g.over) return;
    finishRound();
    g.stats.streak = 0;
    saveStats();
    showResult(
      'lose',
      `<h3>The answer was</h3>
       <p><b>${paramString(g.target.d, g.target.p)}</b></p>
       <p>Your best overlap: ${(g.overlap * 100).toFixed(1)}%</p>`,
      true
    );
    $('g-feedback').textContent = '';
  }

  function showResult(kind, html, withReveal) {
    const box = $('g-result');
    box.className = `result ${kind}`;
    box.innerHTML = html;
    const btns = document.createElement('div');
    btns.className = 'row-btns';
    if (withReveal) {
      const reveal = document.createElement('button');
      reveal.className = 'btn ghost';
      reveal.textContent = 'Show answer on plot';
      reveal.addEventListener('click', () => {
        g.guess = { d: g.target.d, p: { ...g.target.p } };
        buildGuessUi();
        renderGame();
        updateGameStatus();
        reveal.disabled = true;
      });
      btns.append(reveal);
    }
    const next = document.createElement('button');
    next.className = 'btn';
    next.textContent = 'Next round →';
    next.addEventListener('click', newRound);
    btns.append(next);
    box.append(btns);
    box.hidden = false;
    next.focus({ preventScroll: true });
  }

  function saveStats() {
    store.set('dp-game-stats', g.stats);
    renderStatsBoard();
  }

  function renderStatsBoard() {
    $('g-score').textContent = g.stats.score.toLocaleString();
    $('g-won').textContent = g.stats.won;
    $('g-streak').textContent = g.stats.streak;
    $('g-best').textContent = g.stats.best;
  }

  $('g-new').addEventListener('click', () => {
    if (g.target && !g.over) {
      g.stats.streak = 0; // skipping a round breaks the streak
      saveStats();
    }
    newRound();
  });
  $('g-giveup').addEventListener('click', giveUp);
  $('g-hint').addEventListener('click', () => {
    if (g.over || g.hintUsed) return;
    g.hintUsed = true;
    $('g-hint').disabled = true;
    renderHint();
  });

  setInterval(() => {
    if (!g.target || $('game').hidden) return;
    const s = seconds();
    $('g-timer').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 250);

  // ---------------------------------------------------------------------------
  // Mode switching + routing
  // ---------------------------------------------------------------------------

  function setMode(mode) {
    $('explore').hidden = mode !== 'explore';
    $('game').hidden = mode !== 'game';
    document.querySelectorAll('.mode-switch button').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.mode === mode));
    });
    if (mode === 'game') {
      if (!g.target) newRound();
      else {
        renderGame();
        updateGameStatus();
      }
      gPlot.draw();
    } else {
      exPlot.draw();
    }
  }

  document.querySelectorAll('.mode-switch button').forEach((b) =>
    b.addEventListener('click', () => {
      const mode = b.dataset.mode;
      setMode(mode);
      history.replaceState(null, '', mode === 'game' ? '#game' : `#${ex.d.id}`);
    })
  );

  function route() {
    const hash = location.hash.replace(/^#\/?/, '');
    if (hash === 'game') {
      if (!ex.d) selectDist(D.continuous[0].id);
      setMode('game');
    } else {
      selectDist(D.byId[hash] ? hash : (ex.d && ex.d.id) || 'normal');
      setMode('explore');
    }
  }
  window.addEventListener('hashchange', route);

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  const savedTheme = store.get('dp-theme', null);
  if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
  buildTabs();
  renderStatsBoard();
  route();
})();
