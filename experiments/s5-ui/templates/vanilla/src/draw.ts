// Canvas drawing outside the framework (APP-SPEC.md section 6).
// This file is the same in every candidate. Do not change it.

import type { PlotSettings, Series } from "./types";

const COLORS = ["#1f77b4", "#d62728", "#2ca02c", "#9467bd"];
const POINTS = 200;

/** The y value of series `k` at point `i`. Always positive, so log y works. */
function value(k: number, i: number): number {
  const x = (i / POINTS) * 4 * Math.PI;
  return 1.2 + Math.sin(x + k) * (1 - k * 0.15);
}

/** Draw the visible series on the canvas and record what was drawn. */
export function drawPlot(canvas: HTMLCanvasElement, series: readonly Series[], plot: PlotSettings): void {
  const count = Number(canvas.dataset["drawCount"] ?? "0") + 1;
  canvas.dataset["drawCount"] = String(count);
  const drawn = series.filter((s) => s.visible);
  canvas.dataset["drawnSeries"] = drawn.map((s) => s.id).join(",");

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  const pad = 30;
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#888";
  ctx.lineWidth = 1;
  ctx.strokeRect(pad, pad / 2, width - pad * 1.5, height - pad * 1.5);

  const yMin = plot.logY ? Math.log10(0.05) : 0;
  const yMax = plot.logY ? Math.log10(2.5) : 2.5;
  const toX = (i: number) => pad + (i / (POINTS - 1)) * (width - pad * 1.5);
  const toY = (v: number) => {
    const y = plot.logY ? Math.log10(Math.max(v, 0.05)) : v;
    return pad / 2 + (1 - (y - yMin) / (yMax - yMin)) * (height - pad * 1.5);
  };

  for (const s of drawn) {
    const k = series.indexOf(s);
    const color = COLORS[k % COLORS.length] ?? "#000";
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = plot.lineWidth;
    if (plot.style !== "markers") {
      ctx.beginPath();
      for (let i = 0; i < POINTS; i++) {
        const x = toX(i);
        const y = toY(value(k, i));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    if (plot.style !== "line") {
      for (let i = 0; i < POINTS; i += 8) {
        ctx.fillRect(toX(i) - 2, toY(value(k, i)) - 2, 4, 4);
      }
    }
  }
}
