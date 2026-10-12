// Special functions needed for densities, CDFs and quantiles.
// Plain script: attaches `SMath` to the global object (works in browser and Node).
(function (root) {
  'use strict';

  const LANCZOS_G = 7;
  const LANCZOS_C = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  const EPS = 1e-15;
  const FPMIN = 1e-300;
  const MAX_ITER = 1000;

  function lgamma(x) {
    if (x < 0.5) {
      // Reflection formula
      return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
    }
    x -= 1;
    let a = LANCZOS_C[0];
    const t = x + LANCZOS_G + 0.5;
    for (let i = 1; i < 9; i++) a += LANCZOS_C[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }

  function gamma(x) {
    if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
    return Math.exp(lgamma(x));
  }

  function lbeta(a, b) {
    return lgamma(a) + lgamma(b) - lgamma(a + b);
  }

  function lchoose(n, k) {
    return lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
  }

  // Regularized lower incomplete gamma P(a, x): series expansion.
  function gammaSeries(a, x) {
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < MAX_ITER; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * EPS) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }

  // Regularized upper incomplete gamma Q(a, x): continued fraction (Lentz).
  function gammaCF(a, x) {
    let b = x + 1 - a;
    let c = 1 / FPMIN;
    let d = 1 / b;
    let h = d;
    for (let i = 1; i < MAX_ITER; i++) {
      const an = -i * (i - a);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
  }

  function gammaP(a, x) {
    if (x <= 0) return 0;
    if (!isFinite(x)) return 1;
    return x < a + 1 ? gammaSeries(a, x) : 1 - gammaCF(a, x);
  }

  function gammaQ(a, x) {
    if (x <= 0) return 1;
    if (!isFinite(x)) return 0;
    return x < a + 1 ? 1 - gammaSeries(a, x) : gammaCF(a, x);
  }

  function betaCF(x, a, b) {
    const qab = a + b;
    const qap = a + 1;
    const qam = a - 1;
    let c = 1;
    let d = 1 - (qab * x) / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m < MAX_ITER; m++) {
      const m2 = 2 * m;
      let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      h *= d * c;
      aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c;
      if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c;
      h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }

  // Regularized incomplete beta I_x(a, b).
  function betaI(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const lbt = a * Math.log(x) + b * Math.log(1 - x) - lbeta(a, b);
    const bt = Math.exp(lbt);
    if (x < (a + 1) / (a + b + 2)) return (bt * betaCF(x, a, b)) / a;
    return 1 - (bt * betaCF(1 - x, b, a)) / b;
  }

  function normalCdf(z) {
    if (z < 0) return 0.5 * gammaQ(0.5, (z * z) / 2);
    return 0.5 * (1 + gammaP(0.5, (z * z) / 2));
  }

  const EULER_GAMMA = 0.5772156649015329;

  root.SMath = {
    lgamma, gamma, lbeta, lchoose, gammaP, gammaQ, betaI, normalCdf, EULER_GAMMA,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
