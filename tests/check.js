// Sanity checks for the distribution math. Run with: node tests/check.js
'use strict';
require('../js/math.js');
require('../js/distributions.js');
const { Dists } = globalThis;

let failures = 0;
function check(cond, msg) {
  if (!cond) {
    failures++;
    console.error('FAIL:', msg);
  }
}
const close = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

const rng = Dists.mulberry32(12345);

for (const d of Dists.all) {
  // Defaults plus a few random parameter sets.
  const sets = [Dists.defaultParams(d)];
  for (let i = 0; i < 4; i++) sets.push(Dists.randomParams(d, rng));

  for (const p of sets) {
    const tag = `${d.id} ${JSON.stringify(p)}`;
    const [x0, x1] = Dists.plotRange(d, p);
    check(isFinite(x0) && isFinite(x1) && x1 > x0, `${tag}: bad plot range ${x0}, ${x1}`);

    if (d.type === 'continuous') {
      // CDF increments should match the integral of the pdf (Simpson on interior intervals).
      const a = Dists.quantile(d, p, 0.05);
      const b = Dists.quantile(d, p, 0.95);
      const n = 2000;
      const h = (b - a) / n;
      let s = d.pdf(a, p) + d.pdf(b, p);
      for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * d.pdf(a + i * h, p);
      s *= h / 3;
      check(close(s, 0.9, 2e-3), `${tag}: ∫pdf over [q05,q95] = ${s}`);
      check(close(d.cdf(a, p), 0.05, 1e-6), `${tag}: cdf(q05) = ${d.cdf(a, p)}`);
    } else {
      const e = Dists.enumerate(d, p, 1e-12);
      const total = e.pmf.reduce((u, v) => u + v, 0);
      check(close(total, 1, 1e-6), `${tag}: Σpmf = ${total}`);
      const mean = e.ks.reduce((u, k, i) => u + k * e.pmf[i], 0);
      const varc = e.ks.reduce((u, k, i) => u + (k - mean) ** 2 * e.pmf[i], 0);
      check(close(mean, d.mean(p), 1e-5), `${tag}: mean ${mean} vs ${d.mean(p)}`);
      check(close(varc, d.variance(p), 1e-4), `${tag}: var ${varc} vs ${d.variance(p)}`);
    }

    // Sample mean vs theoretical mean when the variance is finite.
    const v = d.variance(p);
    if (isFinite(v)) {
      const N = 20000;
      const xs = Dists.sample(d, p, N, rng);
      const m = xs.reduce((u, x) => u + x, 0) / N;
      const se = Math.sqrt(v / N);
      check(Math.abs(m - d.mean(p)) < 5 * se + 1e-9, `${tag}: sample mean ${m} vs ${d.mean(p)} (se ${se})`);
    }

    // Overlap with itself is 1.
    const o = Dists.overlap(d, p, d, p);
    check(o > 0.999, `${tag}: self-overlap ${o}`);
  }
}

// Cross-family identities.
{
  const B = Dists.byId;
  const o1 = Dists.overlap(B.chisquared, { k: 4 }, B.gamma, { k: 2, theta: 2 });
  check(o1 > 0.999, `chi2(4) vs gamma(2,2) overlap ${o1}`);
  const o2 = Dists.overlap(B.geometric, { p: 0.3 }, B.negbinomial, { r: 1, p: 0.3 });
  check(o2 > 0.999, `geometric vs negbin(r=1) overlap ${o2}`);
  const o3 = Dists.overlap(B.normal, { mu: 0, sigma: 1 }, B.normal, { mu: 10, sigma: 1 });
  check(o3 < 1e-3, `disjoint normals overlap ${o3}`);
  const o4 = Dists.overlap(B.studentt, { nu: 1, mu: 0, sigma: 1 }, B.cauchy, { x0: 0, gamma: 1 });
  check(o4 > 0.999, `t(1) vs cauchy overlap ${o4}`);
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log(`All checks passed for ${Dists.all.length} distributions.`);
