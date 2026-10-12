// Minimal canvas plotter: curves, bars, lollipops, step functions, histograms, hover crosshair.
(function (root) {
  'use strict';

  function niceStep(span, target) {
    const raw = span / Math.max(1, target);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / mag;
    const nice = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    return nice * mag;
  }

  function ticks(lo, hi, target, integer) {
    let step = niceStep(hi - lo, target);
    if (integer) step = Math.max(1, Math.round(step));
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) {
      out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    }
    return { values: out, step };
  }

  function fmtTick(v, step) {
    const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    if (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0)) return v.toExponential(1);
    return v.toFixed(Math.min(dec, 6));
  }

  function cssVar(el, name) {
    return getComputedStyle(el).getPropertyValue(name).trim();
  }

  function withAlpha(color, alpha) {
    // Accepts #rrggbb.
    if (color.startsWith('#') && color.length === 7) {
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      return `rgba(${r},${g},${b},${alpha})`;
    }
    return color;
  }

  class Plot {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.spec = null;
      this.hoverX = null;
      this.onHover = opts.onHover || null; // (x) => [lines] | null
      this.margin = { top: 16, right: 16, bottom: 32, left: 64 };
      this.tooltip = document.createElement('div');
      this.tooltip.className = 'plot-tooltip';
      this.tooltip.hidden = true;
      canvas.parentElement.appendChild(this.tooltip);

      const ro = new ResizeObserver(() => this.draw());
      ro.observe(canvas.parentElement);
      canvas.addEventListener('pointermove', (e) => this._hover(e));
      canvas.addEventListener('pointerleave', () => {
        this.hoverX = null;
        this.tooltip.hidden = true;
        this.draw();
      });
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.draw());
      if (document.fonts) document.fonts.ready.then(() => this.draw());
    }

    set(spec) {
      this.spec = spec;
      this.draw();
      if (this.hoverX != null) this._updateTooltip();
    }

    _xToPx(x) {
      const { xRange } = this.spec;
      return this.margin.left + ((x - xRange[0]) / (xRange[1] - xRange[0])) * this.plotW;
    }

    _yToPx(y) {
      return this.margin.top + this.plotH * (1 - y / this.spec.yMax);
    }

    _pxToX(px) {
      const { xRange } = this.spec;
      return xRange[0] + ((px - this.margin.left) / this.plotW) * (xRange[1] - xRange[0]);
    }

    _hover(e) {
      if (!this.spec || !this.onHover) return;
      const rect = this.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      if (px < this.margin.left || px > this.margin.left + this.plotW) {
        this.hoverX = null;
        this.tooltip.hidden = true;
        this.draw();
        return;
      }
      let x = this._pxToX(px);
      if (this.spec.discrete) x = Math.round(x);
      this.hoverX = x;
      this._hoverPy = e.clientY - rect.top;
      this.draw();
      this._updateTooltip();
    }

    _updateTooltip() {
      const lines = this.onHover && this.hoverX != null ? this.onHover(this.hoverX) : null;
      if (!lines) {
        this.tooltip.hidden = true;
        return;
      }
      this.tooltip.innerHTML = lines.join('<br>');
      this.tooltip.hidden = false;
      const px = this._xToPx(this.hoverX);
      const w = this.tooltip.offsetWidth;
      const left = px + 12 + w > this.width ? px - 12 - w : px + 12;
      this.tooltip.style.left = `${Math.max(0, left)}px`;
      this.tooltip.style.top = `${this.margin.top + 4}px`;
    }

    draw() {
      const canvas = this.canvas;
      const parent = canvas.parentElement;
      const dpr = window.devicePixelRatio || 1;
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      if (!width || !height) return;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
      this.width = width;
      this.height = height;
      const ctx = this.ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (!this.spec) return;

      const m = this.margin;
      this.plotW = width - m.left - m.right;
      this.plotH = height - m.top - m.bottom;
      const { xRange, yMax, series, discrete } = this.spec;

      const colors = {
        grid: cssVar(canvas, '--grid'),
        axis: cssVar(canvas, '--axis'),
        text: cssVar(canvas, '--text-muted'),
        crosshair: cssVar(canvas, '--text-secondary'),
        surface: cssVar(canvas, '--surface'),
      };
      ctx.font = "11px 'Martian Mono', ui-monospace, monospace";

      // Grid + ticks
      const yt = ticks(0, yMax, Math.max(3, Math.floor(this.plotH / 50)), false);
      ctx.strokeStyle = colors.grid;
      ctx.lineWidth = 1;
      ctx.fillStyle = colors.text;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (const v of yt.values) {
        const y = Math.round(this._yToPx(v)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(m.left, y);
        ctx.lineTo(m.left + this.plotW, y);
        ctx.stroke();
        ctx.fillText(fmtTick(v, yt.step), m.left - 8, y);
      }
      const xt = ticks(xRange[0], xRange[1], Math.max(3, Math.floor(this.plotW / 80)), discrete);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const v of xt.values) {
        const x = Math.round(this._xToPx(v)) + 0.5;
        ctx.strokeStyle = colors.axis;
        ctx.beginPath();
        ctx.moveTo(x, m.top + this.plotH);
        ctx.lineTo(x, m.top + this.plotH + 5);
        ctx.stroke();
        ctx.fillText(fmtTick(v, xt.step), x, m.top + this.plotH + 8);
      }

      // Series (clipped to plot area)
      ctx.save();
      ctx.beginPath();
      ctx.rect(m.left, m.top - 2, this.plotW, this.plotH + 2);
      ctx.clip();
      for (const s of series) this._drawSeries(s, colors);
      ctx.restore();

      // Baseline axis
      ctx.strokeStyle = colors.axis;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const by = Math.round(m.top + this.plotH) + 0.5;
      ctx.moveTo(m.left, by);
      ctx.lineTo(m.left + this.plotW, by);
      ctx.stroke();

      // Crosshair
      if (this.hoverX != null) {
        const x = Math.round(this._xToPx(this.hoverX)) + 0.5;
        ctx.strokeStyle = colors.crosshair;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, m.top);
        ctx.lineTo(x, m.top + this.plotH);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    _drawSeries(s, colors) {
      const ctx = this.ctx;
      const base = this._yToPx(0);
      const cap = (y) => Math.min(y, this.spec.yMax * 1.2);
      const color = s.color;
      ctx.setLineDash(s.dash || []);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      if (s.kind === 'curve') {
        const { xs, ys } = s;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < xs.length; i++) {
          const px = this._xToPx(xs[i]);
          const py = this._yToPx(cap(ys[i]));
          if (!started) {
            ctx.moveTo(px, py);
            started = true;
          } else ctx.lineTo(px, py);
        }
        if (s.fill) {
          ctx.save();
          ctx.lineTo(this._xToPx(xs[xs.length - 1]), base);
          ctx.lineTo(this._xToPx(xs[0]), base);
          ctx.closePath();
          ctx.fillStyle = withAlpha(color, s.fill);
          ctx.fill();
          ctx.restore();
          // Re-stroke only the curve itself.
          ctx.beginPath();
          for (let i = 0; i < xs.length; i++) {
            const px = this._xToPx(xs[i]);
            const py = this._yToPx(cap(ys[i]));
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = s.width || 2;
        ctx.stroke();
      } else if (s.kind === 'step') {
        // Right-continuous step function: xs ascending, ys value from xs[i] to xs[i+1].
        const { xs, ys } = s;
        const [x0, x1] = this.spec.xRange;
        ctx.beginPath();
        ctx.moveTo(this._xToPx(x0), this._yToPx(s.start || 0));
        let prevY = s.start || 0;
        for (let i = 0; i < xs.length; i++) {
          const px = this._xToPx(xs[i]);
          ctx.lineTo(px, this._yToPx(prevY));
          ctx.lineTo(px, this._yToPx(ys[i]));
          prevY = ys[i];
        }
        ctx.lineTo(this._xToPx(x1), this._yToPx(prevY));
        ctx.strokeStyle = color;
        ctx.lineWidth = s.width || 2;
        ctx.stroke();
      } else if (s.kind === 'bars' || s.kind === 'hist') {
        // bars: xs centers with fixed width (in data units); hist: edges + heights
        ctx.setLineDash([]);
        const n = s.kind === 'bars' ? s.xs.length : s.heights.length;
        for (let i = 0; i < n; i++) {
          let l, r, h;
          if (s.kind === 'bars') {
            l = s.xs[i] - s.barWidth / 2;
            r = s.xs[i] + s.barWidth / 2;
            h = s.ys[i];
          } else {
            l = s.edges[i];
            r = s.edges[i + 1];
            h = s.heights[i];
          }
          if (!(h > 0)) continue;
          let pl = this._xToPx(l);
          let pr = this._xToPx(r);
          if (s.gap) {
            pl += 1;
            pr -= 1;
          }
          if (pr - pl < 1) {
            const c = (pl + pr) / 2;
            pl = c - 0.5;
            pr = c + 0.5;
          }
          const pt = this._yToPx(cap(h));
          const rad = Math.min(3, (pr - pl) / 2, base - pt);
          ctx.beginPath();
          ctx.moveTo(pl, base);
          ctx.lineTo(pl, pt + rad);
          ctx.quadraticCurveTo(pl, pt, pl + rad, pt);
          ctx.lineTo(pr - rad, pt);
          ctx.quadraticCurveTo(pr, pt, pr, pt + rad);
          ctx.lineTo(pr, base);
          if (s.fill != null) {
            ctx.fillStyle = withAlpha(color, s.fill);
            ctx.fill();
          }
          if (s.stroke) {
            ctx.setLineDash(s.dash || []);
            ctx.strokeStyle = color;
            ctx.lineWidth = s.width || 1.5;
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      } else if (s.kind === 'lollipop') {
        const { xs, ys } = s;
        const r = s.radius || 4;
        for (let i = 0; i < xs.length; i++) {
          if (!(ys[i] > 0)) continue;
          const px = this._xToPx(xs[i]);
          const py = this._yToPx(cap(ys[i]));
          ctx.setLineDash(s.dash || []);
          ctx.strokeStyle = color;
          ctx.lineWidth = s.width || 2;
          ctx.beginPath();
          ctx.moveTo(px, base);
          ctx.lineTo(px, py);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.arc(px, py, r, 0, 2 * Math.PI);
          ctx.fillStyle = s.hollow ? colors.surface : color;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = s.hollow ? color : colors.surface;
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
    }
  }

  root.Plot = Plot;
})(typeof globalThis !== 'undefined' ? globalThis : this);
