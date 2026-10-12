// Distribution catalogue plus generic helpers (quantiles, plot ranges, sampling, overlap).
// Plain script: attaches `Dists` to the global object (works in browser and Node).
(function (root) {
  'use strict';

  const M = root.SMath;
  const { lgamma, lbeta, lchoose, gammaP, gammaQ, betaI, normalCdf } = M;
  const LN_SQRT_2PI = 0.5 * Math.log(2 * Math.PI);
  const INF = Infinity;
  const UNDEF = NaN; // moment does not exist

  // ---------------------------------------------------------------------------
  // Continuous distributions
  // ---------------------------------------------------------------------------

  const continuous = [
    {
      id: 'normal',
      name: 'Normal',
      params: [
        { key: 'mu', label: 'μ', tex: '\\mu', min: -10, max: 10, step: 0.1, value: 0, game: [-5, 5] },
        { key: 'sigma', label: 'σ', tex: '\\sigma', min: 0.1, max: 10, step: 0.1, value: 1, game: [0.3, 4] },
      ],
      support: () => [-INF, INF],
      pdf: (x, { mu, sigma }) => {
        const z = (x - mu) / sigma;
        return Math.exp(-0.5 * z * z - LN_SQRT_2PI) / sigma;
      },
      cdf: (x, { mu, sigma }) => normalCdf((x - mu) / sigma),
      mean: ({ mu }) => mu,
      variance: ({ sigma }) => sigma * sigma,
      tex: 'f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} \\exp\\!\\left(-\\frac{(x-\\mu)^2}{2\\sigma^2}\\right)',
      desc: 'The bell curve. Sums of many small independent effects tend to be normal (central limit theorem).',
    },
    {
      id: 'uniform',
      name: 'Uniform',
      params: [
        { key: 'a', label: 'a', tex: 'a', min: -10, max: 10, step: 0.1, value: 0, game: [-6, 3] },
        { key: 'b', label: 'b', tex: 'b', min: -10, max: 10, step: 0.1, value: 1, game: [-3, 6] },
      ],
      constrain(p, changed) {
        const gap = 0.1;
        if (p.b - p.a < gap) {
          if (changed === 'b') p.a = Math.max(-10, p.b - gap);
          else p.b = Math.min(10, p.a + gap);
          if (p.b - p.a < gap) p.a = p.b - gap;
        }
      },
      support: ({ a, b }) => [a, b],
      range: ({ a, b }) => {
        const pad = 0.15 * (b - a);
        return [a - pad, b + pad];
      },
      pdf: (x, { a, b }) => (x >= a && x <= b ? 1 / (b - a) : 0),
      cdf: (x, { a, b }) => (x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a)),
      mean: ({ a, b }) => (a + b) / 2,
      variance: ({ a, b }) => ((b - a) * (b - a)) / 12,
      tex: 'f(x) = \\frac{1}{b-a}, \\quad a \\le x \\le b',
      desc: 'Every value in [a, b] is equally likely.',
    },
    {
      id: 'exponential',
      name: 'Exponential',
      params: [
        { key: 'lambda', label: 'λ (rate)', tex: '\\lambda', min: 0.05, max: 5, step: 0.05, value: 1, game: [0.2, 3] },
      ],
      support: () => [0, INF],
      pdf: (x, { lambda }) => (x < 0 ? 0 : lambda * Math.exp(-lambda * x)),
      cdf: (x, { lambda }) => (x <= 0 ? 0 : 1 - Math.exp(-lambda * x)),
      mean: ({ lambda }) => 1 / lambda,
      variance: ({ lambda }) => 1 / (lambda * lambda),
      tex: 'f(x) = \\lambda e^{-\\lambda x}, \\quad x \\ge 0',
      desc: 'Waiting time between events of a Poisson process. Memoryless.',
    },
    {
      id: 'gamma',
      name: 'Gamma',
      params: [
        { key: 'k', label: 'k (shape)', tex: 'k', min: 0.1, max: 20, step: 0.1, value: 2, game: [0.8, 10] },
        { key: 'theta', label: 'θ (scale)', tex: '\\theta', min: 0.1, max: 10, step: 0.1, value: 1, game: [0.3, 3] },
      ],
      support: () => [0, INF],
      pdf: (x, { k, theta }) => gammaPdf(x, k, theta),
      cdf: (x, { k, theta }) => gammaP(k, x / theta),
      mean: ({ k, theta }) => k * theta,
      variance: ({ k, theta }) => k * theta * theta,
      tex: 'f(x) = \\frac{x^{k-1} e^{-x/\\theta}}{\\Gamma(k)\\,\\theta^k}, \\quad x > 0',
      desc: 'Waiting time until the k-th event of a Poisson process; flexible model for positive skewed data.',
    },
    {
      id: 'beta',
      name: 'Beta',
      params: [
        { key: 'alpha', label: 'α', tex: '\\alpha', min: 0.1, max: 20, step: 0.1, value: 2, game: [0.5, 12] },
        { key: 'beta', label: 'β', tex: '\\beta', min: 0.1, max: 20, step: 0.1, value: 5, game: [0.5, 12] },
      ],
      support: () => [0, 1],
      range: () => [0, 1],
      pdf: (x, { alpha, beta }) => {
        if (x < 0 || x > 1) return 0;
        if (x === 0) return alpha < 1 ? INF : alpha === 1 ? beta : 0;
        if (x === 1) return beta < 1 ? INF : beta === 1 ? alpha : 0;
        return Math.exp((alpha - 1) * Math.log(x) + (beta - 1) * Math.log(1 - x) - lbeta(alpha, beta));
      },
      cdf: (x, { alpha, beta }) => betaI(x, alpha, beta),
      mean: ({ alpha, beta }) => alpha / (alpha + beta),
      variance: ({ alpha, beta }) => (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1)),
      tex: 'f(x) = \\frac{x^{\\alpha-1}(1-x)^{\\beta-1}}{B(\\alpha,\\beta)}, \\quad 0 \\le x \\le 1',
      desc: 'Distribution of a probability. Conjugate prior for the Bernoulli/binomial p.',
    },
    {
      id: 'lognormal',
      name: 'Log-normal',
      tail: 0.005,
      params: [
        { key: 'mu', label: 'μ', tex: '\\mu', min: -3, max: 3, step: 0.05, value: 0, game: [-1, 2] },
        { key: 'sigma', label: 'σ', tex: '\\sigma', min: 0.1, max: 2.5, step: 0.05, value: 0.5, game: [0.2, 1] },
      ],
      support: () => [0, INF],
      pdf: (x, { mu, sigma }) => {
        if (x <= 0) return 0;
        const z = (Math.log(x) - mu) / sigma;
        return Math.exp(-0.5 * z * z - LN_SQRT_2PI) / (x * sigma);
      },
      cdf: (x, { mu, sigma }) => (x <= 0 ? 0 : normalCdf((Math.log(x) - mu) / sigma)),
      mean: ({ mu, sigma }) => Math.exp(mu + (sigma * sigma) / 2),
      variance: ({ mu, sigma }) => (Math.exp(sigma * sigma) - 1) * Math.exp(2 * mu + sigma * sigma),
      tex: 'f(x) = \\frac{1}{x\\sigma\\sqrt{2\\pi}} \\exp\\!\\left(-\\frac{(\\ln x-\\mu)^2}{2\\sigma^2}\\right)',
      desc: 'X such that ln X is normal. Products of many positive factors; incomes, file sizes.',
    },
    {
      id: 'chisquared',
      name: 'Chi-squared',
      params: [
        { key: 'k', label: 'k (degrees of freedom)', tex: 'k', min: 1, max: 50, step: 1, value: 3, game: [1, 25] },
      ],
      support: () => [0, INF],
      pdf: (x, { k }) => gammaPdf(x, k / 2, 2),
      cdf: (x, { k }) => gammaP(k / 2, x / 2),
      mean: ({ k }) => k,
      variance: ({ k }) => 2 * k,
      tex: 'f(x) = \\frac{x^{k/2-1} e^{-x/2}}{2^{k/2}\\,\\Gamma(k/2)}, \\quad x > 0',
      desc: 'Sum of k squared standard normals. Used in goodness-of-fit and variance tests.',
    },
    {
      id: 'studentt',
      name: "Student's t",
      tail: 0.01,
      params: [
        { key: 'nu', label: 'ν (degrees of freedom)', tex: '\\nu', min: 0.5, max: 50, step: 0.5, value: 3, game: [1, 15] },
        { key: 'mu', label: 'μ (location)', tex: '\\mu', min: -10, max: 10, step: 0.1, value: 0, game: [-4, 4] },
        { key: 'sigma', label: 'σ (scale)', tex: '\\sigma', min: 0.1, max: 10, step: 0.1, value: 1, game: [0.5, 3] },
      ],
      support: () => [-INF, INF],
      pdf: (x, { nu, mu, sigma }) => {
        const z = (x - mu) / sigma;
        return Math.exp(
          lgamma((nu + 1) / 2) - lgamma(nu / 2) - 0.5 * Math.log(nu * Math.PI) - Math.log(sigma) -
          ((nu + 1) / 2) * Math.log(1 + (z * z) / nu)
        );
      },
      cdf: (x, { nu, mu, sigma }) => {
        const t = (x - mu) / sigma;
        const tail = 0.5 * betaI(nu / (nu + t * t), nu / 2, 0.5);
        return t < 0 ? tail : 1 - tail;
      },
      mean: ({ nu, mu }) => (nu > 1 ? mu : UNDEF),
      variance: ({ nu, sigma }) => (nu > 2 ? (sigma * sigma * nu) / (nu - 2) : nu > 1 ? INF : UNDEF),
      tex: 'f(x) = \\frac{\\Gamma(\\frac{\\nu+1}{2})}{\\sigma\\sqrt{\\nu\\pi}\\,\\Gamma(\\frac{\\nu}{2})} \\left(1+\\frac{1}{\\nu}\\left(\\frac{x-\\mu}{\\sigma}\\right)^2\\right)^{-\\frac{\\nu+1}{2}}',
      desc: 'Heavier-tailed cousin of the normal; arises when estimating a mean with unknown variance. ν → ∞ gives the normal.',
    },
    {
      id: 'cauchy',
      name: 'Cauchy',
      tail: 0.03,
      params: [
        { key: 'x0', label: 'x₀ (location)', tex: 'x_0', min: -10, max: 10, step: 0.1, value: 0, game: [-4, 4] },
        { key: 'gamma', label: 'γ (scale)', tex: '\\gamma', min: 0.1, max: 10, step: 0.1, value: 1, game: [0.3, 3] },
      ],
      support: () => [-INF, INF],
      pdf: (x, { x0, gamma }) => {
        const z = (x - x0) / gamma;
        return 1 / (Math.PI * gamma * (1 + z * z));
      },
      cdf: (x, { x0, gamma }) => 0.5 + Math.atan((x - x0) / gamma) / Math.PI,
      mean: () => UNDEF,
      variance: () => UNDEF,
      tex: 'f(x) = \\frac{1}{\\pi\\gamma\\left[1+\\left(\\frac{x-x_0}{\\gamma}\\right)^2\\right]}',
      desc: 'So heavy-tailed that it has no mean or variance. Ratio of two independent standard normals.',
    },
    {
      id: 'laplace',
      name: 'Laplace',
      params: [
        { key: 'mu', label: 'μ', tex: '\\mu', min: -10, max: 10, step: 0.1, value: 0, game: [-5, 5] },
        { key: 'b', label: 'b (scale)', tex: 'b', min: 0.1, max: 10, step: 0.1, value: 1, game: [0.3, 3] },
      ],
      support: () => [-INF, INF],
      pdf: (x, { mu, b }) => Math.exp(-Math.abs(x - mu) / b) / (2 * b),
      cdf: (x, { mu, b }) => (x < mu ? 0.5 * Math.exp((x - mu) / b) : 1 - 0.5 * Math.exp(-(x - mu) / b)),
      mean: ({ mu }) => mu,
      variance: ({ b }) => 2 * b * b,
      tex: 'f(x) = \\frac{1}{2b} \\exp\\!\\left(-\\frac{|x-\\mu|}{b}\\right)',
      desc: 'Double exponential. Difference of two exponentials; the prior behind L1 / lasso.',
    },
    {
      id: 'logistic',
      name: 'Logistic',
      params: [
        { key: 'mu', label: 'μ', tex: '\\mu', min: -10, max: 10, step: 0.1, value: 0, game: [-5, 5] },
        { key: 's', label: 's (scale)', tex: 's', min: 0.1, max: 5, step: 0.05, value: 1, game: [0.3, 2] },
      ],
      support: () => [-INF, INF],
      pdf: (x, { mu, s }) => {
        const e = Math.exp(-Math.abs(x - mu) / s);
        return e / (s * (1 + e) * (1 + e));
      },
      cdf: (x, { mu, s }) => 1 / (1 + Math.exp(-(x - mu) / s)),
      mean: ({ mu }) => mu,
      variance: ({ s }) => (s * s * Math.PI * Math.PI) / 3,
      tex: 'f(x) = \\frac{e^{-(x-\\mu)/s}}{s\\left(1+e^{-(x-\\mu)/s}\\right)^2}',
      desc: 'Its CDF is the logistic (sigmoid) function used in logistic regression.',
    },
    {
      id: 'weibull',
      name: 'Weibull',
      params: [
        { key: 'k', label: 'k (shape)', tex: 'k', min: 0.2, max: 10, step: 0.1, value: 1.5, game: [0.8, 5] },
        { key: 'lambda', label: 'λ (scale)', tex: '\\lambda', min: 0.1, max: 10, step: 0.1, value: 1, game: [0.5, 5] },
      ],
      support: () => [0, INF],
      pdf: (x, { k, lambda }) => {
        if (x < 0) return 0;
        if (x === 0) return k < 1 ? INF : k === 1 ? 1 / lambda : 0;
        const r = x / lambda;
        return (k / lambda) * Math.pow(r, k - 1) * Math.exp(-Math.pow(r, k));
      },
      cdf: (x, { k, lambda }) => (x <= 0 ? 0 : 1 - Math.exp(-Math.pow(x / lambda, k))),
      mean: ({ k, lambda }) => lambda * M.gamma(1 + 1 / k),
      variance: ({ k, lambda }) => lambda * lambda * (M.gamma(1 + 2 / k) - M.gamma(1 + 1 / k) ** 2),
      tex: 'f(x) = \\frac{k}{\\lambda}\\left(\\frac{x}{\\lambda}\\right)^{k-1} e^{-(x/\\lambda)^k}, \\quad x \\ge 0',
      desc: 'Time-to-failure model. k < 1: failure rate decreases; k = 1: exponential; k > 1: wear-out.',
    },
    {
      id: 'pareto',
      name: 'Pareto',
      tail: 0.02,
      params: [
        { key: 'xm', label: 'xₘ (scale / minimum)', tex: 'x_m', min: 0.1, max: 10, step: 0.1, value: 1, game: [0.5, 4] },
        { key: 'alpha', label: 'α (shape)', tex: '\\alpha', min: 0.5, max: 10, step: 0.1, value: 3, game: [1.5, 6] },
      ],
      support: ({ xm }) => [xm, INF],
      range: (p, d) => [0, quantile(d, p, 1 - 0.02)],
      pdf: (x, { xm, alpha }) => (x < xm ? 0 : (alpha * Math.pow(xm, alpha)) / Math.pow(x, alpha + 1)),
      cdf: (x, { xm, alpha }) => (x <= xm ? 0 : 1 - Math.pow(xm / x, alpha)),
      mean: ({ xm, alpha }) => (alpha > 1 ? (alpha * xm) / (alpha - 1) : INF),
      variance: ({ xm, alpha }) => (alpha > 2 ? (xm * xm * alpha) / ((alpha - 1) ** 2 * (alpha - 2)) : INF),
      tex: 'f(x) = \\frac{\\alpha\\, x_m^{\\alpha}}{x^{\\alpha+1}}, \\quad x \\ge x_m',
      desc: 'Power-law tail: the 80/20 rule, wealth, city sizes.',
    },
    {
      id: 'f',
      name: 'F',
      tail: 0.005,
      params: [
        { key: 'd1', label: 'd₁', tex: 'd_1', min: 1, max: 100, step: 1, value: 5, game: [2, 40] },
        { key: 'd2', label: 'd₂', tex: 'd_2', min: 1, max: 100, step: 1, value: 10, game: [5, 60] },
      ],
      support: () => [0, INF],
      pdf: (x, { d1, d2 }) => {
        if (x < 0) return 0;
        if (x === 0) return d1 < 2 ? INF : d1 === 2 ? 1 : 0;
        return Math.exp(
          0.5 * (d1 * Math.log(d1 * x) + d2 * Math.log(d2) - (d1 + d2) * Math.log(d1 * x + d2)) -
          Math.log(x) - lbeta(d1 / 2, d2 / 2)
        );
      },
      cdf: (x, { d1, d2 }) => (x <= 0 ? 0 : betaI((d1 * x) / (d1 * x + d2), d1 / 2, d2 / 2)),
      mean: ({ d2 }) => (d2 > 2 ? d2 / (d2 - 2) : INF),
      variance: ({ d1, d2 }) =>
        d2 > 4 ? (2 * d2 * d2 * (d1 + d2 - 2)) / (d1 * (d2 - 2) ** 2 * (d2 - 4)) : d2 > 2 ? INF : UNDEF,
      tex: 'f(x) = \\frac{1}{x\\,B(\\frac{d_1}{2},\\frac{d_2}{2})}\\sqrt{\\frac{(d_1x)^{d_1} d_2^{d_2}}{(d_1x+d_2)^{d_1+d_2}}}',
      desc: 'Ratio of two scaled chi-squared variables. Used in ANOVA and comparing variances.',
    },
    {
      id: 'invgamma',
      name: 'Inverse-gamma',
      tail: 0.01,
      params: [
        { key: 'alpha', label: 'α (shape)', tex: '\\alpha', min: 0.5, max: 20, step: 0.1, value: 3, game: [2, 10] },
        { key: 'beta', label: 'β (scale)', tex: '\\beta', min: 0.1, max: 20, step: 0.1, value: 1, game: [0.5, 8] },
      ],
      support: () => [0, INF],
      pdf: (x, { alpha, beta }) =>
        x <= 0 ? 0 : Math.exp(alpha * Math.log(beta) - lgamma(alpha) - (alpha + 1) * Math.log(x) - beta / x),
      cdf: (x, { alpha, beta }) => (x <= 0 ? 0 : gammaQ(alpha, beta / x)),
      mean: ({ alpha, beta }) => (alpha > 1 ? beta / (alpha - 1) : INF),
      variance: ({ alpha, beta }) => (alpha > 2 ? (beta * beta) / ((alpha - 1) ** 2 * (alpha - 2)) : INF),
      tex: 'f(x) = \\frac{\\beta^\\alpha}{\\Gamma(\\alpha)} x^{-\\alpha-1} e^{-\\beta/x}, \\quad x > 0',
      desc: 'Distribution of 1/X for gamma X. Classic conjugate prior for a normal variance.',
    },
    {
      id: 'gumbel',
      name: 'Gumbel',
      params: [
        { key: 'mu', label: 'μ (location)', tex: '\\mu', min: -10, max: 10, step: 0.1, value: 0, game: [-4, 4] },
        { key: 'beta', label: 'β (scale)', tex: '\\beta', min: 0.1, max: 5, step: 0.05, value: 1, game: [0.4, 2.5] },
      ],
      support: () => [-INF, INF],
      pdf: (x, { mu, beta }) => {
        const z = (x - mu) / beta;
        return Math.exp(-(z + Math.exp(-z))) / beta;
      },
      cdf: (x, { mu, beta }) => Math.exp(-Math.exp(-(x - mu) / beta)),
      mean: ({ mu, beta }) => mu + beta * M.EULER_GAMMA,
      variance: ({ beta }) => (Math.PI * Math.PI * beta * beta) / 6,
      tex: 'f(x) = \\frac{1}{\\beta} e^{-(z + e^{-z})}, \\quad z = \\frac{x-\\mu}{\\beta}',
      desc: 'Distribution of the maximum of many samples (extreme value type I): floods, record highs.',
    },
  ];

  function gammaPdf(x, k, theta) {
    if (x < 0) return 0;
    if (x === 0) return k < 1 ? INF : k === 1 ? 1 / theta : 0;
    return Math.exp((k - 1) * Math.log(x) - x / theta - lgamma(k) - k * Math.log(theta));
  }

  // ---------------------------------------------------------------------------
  // Discrete distributions
  // ---------------------------------------------------------------------------

  const discrete = [
    {
      id: 'bernoulli',
      name: 'Bernoulli',
      params: [{ key: 'p', label: 'p', tex: 'p', min: 0, max: 1, step: 0.01, value: 0.3, game: [0.05, 0.95] }],
      support: () => [0, 1],
      pmf: (k, { p }) => (k === 0 ? 1 - p : k === 1 ? p : 0),
      mean: ({ p }) => p,
      variance: ({ p }) => p * (1 - p),
      tex: 'P(X=1) = p, \\quad P(X=0) = 1-p',
      desc: 'A single yes/no trial.',
    },
    {
      id: 'binomial',
      name: 'Binomial',
      params: [
        { key: 'n', label: 'n (trials)', tex: 'n', min: 1, max: 100, step: 1, value: 10, game: [5, 50] },
        { key: 'p', label: 'p (success prob.)', tex: 'p', min: 0, max: 1, step: 0.01, value: 0.5, game: [0.05, 0.95] },
      ],
      support: ({ n }) => [0, n],
      pmf: (k, { n, p }) => {
        if (k < 0 || k > n) return 0;
        if (p === 0) return k === 0 ? 1 : 0;
        if (p === 1) return k === n ? 1 : 0;
        return Math.exp(lchoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
      },
      mean: ({ n, p }) => n * p,
      variance: ({ n, p }) => n * p * (1 - p),
      tex: 'P(X=k) = \\binom{n}{k} p^k (1-p)^{n-k}',
      desc: 'Number of successes in n independent trials with success probability p.',
    },
    {
      id: 'poisson',
      name: 'Poisson',
      params: [
        { key: 'lambda', label: 'λ (rate)', tex: '\\lambda', min: 0.1, max: 50, step: 0.1, value: 4, game: [0.5, 25] },
      ],
      support: () => [0, INF],
      pmf: (k, { lambda }) => (k < 0 ? 0 : Math.exp(k * Math.log(lambda) - lambda - lgamma(k + 1))),
      mean: ({ lambda }) => lambda,
      variance: ({ lambda }) => lambda,
      tex: 'P(X=k) = \\frac{\\lambda^k e^{-\\lambda}}{k!}',
      desc: 'Count of rare events in a fixed interval (calls per hour, typos per page). Mean = variance.',
    },
    {
      id: 'geometric',
      name: 'Geometric',
      params: [
        { key: 'p', label: 'p (success prob.)', tex: 'p', min: 0.01, max: 1, step: 0.01, value: 0.3, game: [0.08, 0.8] },
      ],
      support: () => [0, INF],
      pmf: (k, { p }) => (k < 0 ? 0 : p === 1 ? (k === 0 ? 1 : 0) : p * Math.pow(1 - p, k)),
      mean: ({ p }) => (1 - p) / p,
      variance: ({ p }) => (1 - p) / (p * p),
      tex: 'P(X=k) = (1-p)^k\\, p, \\quad k = 0, 1, 2, \\dots',
      desc: 'Number of failures before the first success. Discrete analogue of the exponential.',
    },
    {
      id: 'negbinomial',
      name: 'Negative binomial',
      params: [
        { key: 'r', label: 'r (successes)', tex: 'r', min: 0.1, max: 50, step: 0.1, value: 3, game: [1, 20] },
        { key: 'p', label: 'p (success prob.)', tex: 'p', min: 0.01, max: 0.99, step: 0.01, value: 0.5, game: [0.15, 0.85] },
      ],
      support: () => [0, INF],
      pmf: (k, { r, p }) =>
        k < 0 ? 0 : Math.exp(lgamma(k + r) - lgamma(k + 1) - lgamma(r) + r * Math.log(p) + k * Math.log(1 - p)),
      mean: ({ r, p }) => (r * (1 - p)) / p,
      variance: ({ r, p }) => (r * (1 - p)) / (p * p),
      tex: 'P(X=k) = \\binom{k+r-1}{k} p^r (1-p)^k',
      desc: 'Failures before the r-th success. Also an over-dispersed Poisson (variance > mean); r need not be an integer.',
    },
    {
      id: 'hypergeometric',
      name: 'Hypergeometric',
      params: [
        { key: 'N', label: 'N (population)', tex: 'N', min: 1, max: 200, step: 1, value: 50, game: [20, 150] },
        { key: 'K', label: 'K (successes in pop.)', tex: 'K', min: 0, max: 200, step: 1, value: 15, game: [5, 80], maxFn: (p) => p.N },
        { key: 'n', label: 'n (draws)', tex: 'n', min: 0, max: 200, step: 1, value: 10, game: [5, 60], maxFn: (p) => p.N },
      ],
      constrain(p) {
        p.K = Math.min(p.K, p.N);
        p.n = Math.min(p.n, p.N);
      },
      support: ({ N, K, n }) => [Math.max(0, n + K - N), Math.min(n, K)],
      pmf: (k, { N, K, n }) => {
        if (k < Math.max(0, n + K - N) || k > Math.min(n, K)) return 0;
        return Math.exp(lchoose(K, k) + lchoose(N - K, n - k) - lchoose(N, n));
      },
      mean: ({ N, K, n }) => (n * K) / N,
      variance: ({ N, K, n }) => (N > 1 ? (n * K * (N - K) * (N - n)) / (N * N * (N - 1)) : 0),
      tex: 'P(X=k) = \\frac{\\binom{K}{k}\\binom{N-K}{n-k}}{\\binom{N}{n}}',
      desc: 'Successes in n draws without replacement from a population of N containing K successes.',
    },
    {
      id: 'discreteuniform',
      name: 'Discrete uniform',
      params: [
        { key: 'a', label: 'a', tex: 'a', min: -20, max: 20, step: 1, value: 1, game: [-10, 5] },
        { key: 'b', label: 'b', tex: 'b', min: -20, max: 20, step: 1, value: 6, game: [-3, 15] },
      ],
      constrain(p, changed) {
        if (p.b < p.a) {
          if (changed === 'b') p.a = p.b;
          else p.b = p.a;
        }
      },
      support: ({ a, b }) => [a, b],
      pmf: (k, { a, b }) => (k >= a && k <= b ? 1 / (b - a + 1) : 0),
      mean: ({ a, b }) => (a + b) / 2,
      variance: ({ a, b }) => ((b - a + 1) ** 2 - 1) / 12,
      tex: 'P(X=k) = \\frac{1}{b-a+1}, \\quad k = a, \\dots, b',
      desc: 'A fair die with faces a … b.',
    },
    {
      id: 'betabinomial',
      name: 'Beta-binomial',
      params: [
        { key: 'n', label: 'n (trials)', tex: 'n', min: 1, max: 100, step: 1, value: 20, game: [5, 50] },
        { key: 'alpha', label: 'α', tex: '\\alpha', min: 0.1, max: 20, step: 0.1, value: 2, game: [0.5, 10] },
        { key: 'beta', label: 'β', tex: '\\beta', min: 0.1, max: 20, step: 0.1, value: 2, game: [0.5, 10] },
      ],
      support: ({ n }) => [0, n],
      pmf: (k, { n, alpha, beta }) =>
        k < 0 || k > n ? 0 : Math.exp(lchoose(n, k) + lbeta(k + alpha, n - k + beta) - lbeta(alpha, beta)),
      mean: ({ n, alpha, beta }) => (n * alpha) / (alpha + beta),
      variance: ({ n, alpha, beta }) =>
        (n * alpha * beta * (alpha + beta + n)) / ((alpha + beta) ** 2 * (alpha + beta + 1)),
      tex: 'P(X=k) = \\binom{n}{k} \\frac{B(k+\\alpha,\\, n-k+\\beta)}{B(\\alpha,\\beta)}',
      desc: 'Binomial whose p is itself Beta(α, β) distributed — over-dispersed counts out of n.',
    },
  ];

  continuous.forEach((d) => (d.type = 'continuous'));
  discrete.forEach((d) => (d.type = 'discrete'));
  const all = continuous.concat(discrete);
  const byId = Object.fromEntries(all.map((d) => [d.id, d]));

  // ---------------------------------------------------------------------------
  // Parameter helpers
  // ---------------------------------------------------------------------------

  function defaultParams(d) {
    return Object.fromEntries(d.params.map((p) => [p.key, p.value]));
  }

  function decimalsOf(step) {
    const s = String(step);
    return s.includes('.') ? s.split('.')[1].length : 0;
  }

  function roundToStep(v, step) {
    return Number((Math.round(v / step) * step).toFixed(decimalsOf(step)));
  }

  // Clamp to slider bounds, snap to step and apply cross-parameter constraints.
  function normalizeParams(d, p, changed) {
    for (const spec of d.params) {
      p[spec.key] = roundToStep(Math.min(spec.max, Math.max(spec.min, p[spec.key])), spec.step);
    }
    if (d.constrain) d.constrain(p, changed);
    for (const spec of d.params) {
      p[spec.key] = roundToStep(p[spec.key], spec.step);
    }
    return p;
  }

  function randomParams(d, rng = Math.random) {
    const p = {};
    for (const spec of d.params) {
      const [lo, hi] = spec.game || [spec.min, spec.max];
      p[spec.key] = lo + rng() * (hi - lo);
    }
    // Hypergeometric: keep K, n meaningfully inside N.
    return normalizeParams(d, p);
  }

  // ---------------------------------------------------------------------------
  // Generic numeric helpers
  // ---------------------------------------------------------------------------

  // Inverse CDF of a continuous distribution by bracketing + bisection.
  function quantile(d, p, q) {
    let [lo, hi] = d.support(p);
    let anchor = 0;
    if (isFinite(lo)) anchor = Math.max(anchor, lo);
    if (isFinite(hi)) anchor = Math.min(anchor, hi);
    if (!isFinite(hi)) {
      let w = 1;
      for (let i = 0; i < 2000 && d.cdf(anchor + w, p) < q; i++) w *= 2;
      hi = anchor + w;
    }
    if (!isFinite(lo)) {
      let w = 1;
      for (let i = 0; i < 2000 && d.cdf(anchor - w, p) > q; i++) w *= 2;
      lo = anchor - w;
    }
    for (let i = 0; i < 100; i++) {
      const mid = 0.5 * (lo + hi);
      if (mid === lo || mid === hi) break;
      if (d.cdf(mid, p) < q) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  // Enumerate a discrete distribution: returns { ks, pmf, cdf } covering mass >= 1 - tail.
  function enumerate(d, p, tail = 1e-9) {
    const [lo, hi] = d.support(p);
    const ks = [];
    const pmf = [];
    const cdf = [];
    let acc = 0;
    const maxK = isFinite(hi) ? hi : lo + 200000;
    for (let k = lo; k <= maxK; k++) {
      const v = d.pmf(k, p);
      acc += v;
      ks.push(k);
      pmf.push(v);
      cdf.push(Math.min(1, acc));
      if (!isFinite(hi) && acc >= 1 - tail && k > lo) break;
    }
    return { ks, pmf, cdf };
  }

  // Sensible x-range to display.
  function plotRange(d, p) {
    if (d.range) return d.range(p, d);
    if (d.type === 'discrete') {
      const { ks, cdf } = enumerate(d, p, 1e-4);
      const tail = 5e-4;
      let i0 = cdf.findIndex((c) => c >= tail);
      let i1 = cdf.findIndex((c) => c >= 1 - tail);
      if (i0 < 0) i0 = 0;
      if (i1 < 0) i1 = ks.length - 1;
      let k0 = ks[i0];
      let k1 = ks[i1];
      const [slo, shi] = d.support(p);
      const width = Math.max(1, k1 - k0);
      if (k0 - slo <= 0.25 * width) k0 = slo;
      if (isFinite(shi) && shi - k1 <= 0.25 * width) k1 = shi;
      if (k1 - k0 < 4) {
        const extra = Math.ceil((4 - (k1 - k0)) / 2);
        k0 -= extra;
        k1 += extra;
      }
      return [k0 - 0.7, k1 + 0.7];
    }
    const tail = d.tail || 0.001;
    let x0 = quantile(d, p, tail);
    let x1 = quantile(d, p, 1 - tail);
    const [slo, shi] = d.support(p);
    const width = x1 - x0;
    if (isFinite(slo) && x0 - slo <= 0.2 * width) x0 = slo;
    if (isFinite(shi) && shi - x1 <= 0.2 * width) x1 = shi;
    if (!(x1 > x0)) x1 = x0 + 1;
    return [x0, x1];
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Draw n samples by inverse-transform sampling.
  function sample(d, p, n, rng = Math.random) {
    const out = new Float64Array(n);
    if (d.type === 'discrete') {
      const { ks, cdf } = enumerate(d, p, 1e-12);
      for (let i = 0; i < n; i++) {
        const u = rng() * cdf[cdf.length - 1];
        let lo = 0;
        let hi = cdf.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (cdf[mid] < u) lo = mid + 1;
          else hi = mid;
        }
        out[i] = ks[lo];
      }
      return out;
    }
    // Continuous: tabulate quantiles on a uniform u-grid, interpolate, fall back to bisection in tails.
    const G = 1024;
    const table = new Float64Array(G + 1);
    for (let j = 1; j < G; j++) table[j] = quantile(d, p, j / G);
    for (let i = 0; i < n; i++) {
      const u = rng();
      const pos = u * G;
      const j = Math.floor(pos);
      if (j < 1 || j >= G - 1) {
        out[i] = quantile(d, p, Math.min(Math.max(u, 1e-12), 1 - 1e-12));
      } else {
        const t = pos - j;
        out[i] = table[j] * (1 - t) + table[j + 1] * t;
      }
    }
    return out;
  }

  // Overlapping probability mass of two distributions (1 = identical, 0 = disjoint).
  function overlap(dt, pt, du, pu) {
    if (dt.type === 'discrete') {
      const et = enumerate(dt, pt, 1e-9);
      const eu = enumerate(du, pu, 1e-9);
      const k0 = Math.min(et.ks[0], eu.ks[0]);
      const k1 = Math.max(et.ks[et.ks.length - 1], eu.ks[eu.ks.length - 1]);
      let s = 0;
      for (let k = k0; k <= k1; k++) s += Math.min(dt.pmf(k, pt), du.pmf(k, pu));
      return Math.min(1, s);
    }
    // Continuous: compare bin probabilities (via CDFs) over the target's bulk.
    const a = quantile(dt, pt, 1e-4);
    const b = quantile(dt, pt, 1 - 1e-4);
    const B = 600;
    let s = 0;
    let ft0 = dt.cdf(a, pt);
    let fu0 = du.cdf(a, pu);
    s += Math.min(ft0, fu0);
    for (let i = 1; i <= B; i++) {
      const x = a + ((b - a) * i) / B;
      const ft1 = dt.cdf(x, pt);
      const fu1 = du.cdf(x, pu);
      s += Math.max(0, Math.min(ft1 - ft0, fu1 - fu0));
      ft0 = ft1;
      fu0 = fu1;
    }
    s += Math.min(1 - ft0, 1 - fu0);
    return Math.min(1, Math.max(0, s));
  }

  root.Dists = {
    continuous, discrete, all, byId,
    defaultParams, normalizeParams, randomParams, roundToStep, decimalsOf,
    quantile, enumerate, plotRange, sample, overlap, mulberry32,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
