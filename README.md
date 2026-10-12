# Distribution Playground

An interactive, dependency-free web app for building intuition about common probability distributions.

**Live demo:** https://jakobfender.github.io/distribution-playground/ (after enabling Pages, see below)

## Features

### Explore mode
One tab per distribution, each with sliders for its parameters, the PDF/PMF formula, mean / median / variance, a PDF ↔ CDF toggle, hover read-outs, and a sampler that overlays a histogram (or empirical CDF) of 100 – 100,000 random draws.

- **Continuous:** Normal, Uniform, Exponential, Gamma, Beta, Log-normal, Chi-squared, Student's t, Cauchy, Laplace, Logistic, Weibull, Pareto, F, Inverse-gamma, Gumbel
- **Discrete:** Bernoulli, Binomial, Poisson, Geometric, Negative binomial, Hypergeometric, Discrete uniform, Beta-binomial

Each tab is linkable, e.g. `#beta`, `#poisson`.

### Fit game (`#game`)
A hidden target distribution is drawn; move the sliders until your distribution overlaps it.
Overlap is the shared probability mass, ∑ min(p, q) — 100% means identical.

- **Easy:** the family is shown, you find the parameters.
- **Hard:** you also choose the family (any family that matches counts — e.g. a Chi-squared target can be hit with a Gamma).
- Win threshold of 90 / 95 / 98%, score, streaks, an optional hint (target mean / median / SD), and give-up-and-reveal.

## Running locally

No build step. Serve the folder with any static server:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Run the math sanity checks (PDF/CDF consistency, PMF normalisation, moments, sampling):

```sh
node tests/check.js
```

## Deploying to GitHub Pages

The workflow in `.github/workflows/pages.yml` runs the checks and deploys on every push to `main`.
One-time setup: in the repository go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.

## Layout

| File | Purpose |
|---|---|
| `js/math.js` | Special functions: log-gamma, regularized incomplete gamma & beta |
| `js/distributions.js` | Distribution catalogue + quantiles, plot ranges, sampling, overlap |
| `js/plot.js` | Small canvas plotter (curves, bars, lollipops, steps, histograms, hover) |
| `js/app.js` | Explore and game UI |
| `tests/check.js` | Node sanity checks |

Formulas are typeset with [KaTeX](https://katex.org/) from a CDN; if it can't load, the raw TeX is shown instead.
