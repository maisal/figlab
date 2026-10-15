// The graph layer on Canvas 2D (spec.md 9.1): the decimated line is drawn
// into an off-screen layer canvas and copied to the screen. During zoom and
// pan, the layer is drawn again with a transform (drawImage), so the screen
// responds at once without new data.

import { HEIGHT, WIDTH, type View } from "./view";

export class Plot2D {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly layer: HTMLCanvasElement;
  private readonly lctx: CanvasRenderingContext2D;
  /// The view that the layer was drawn for, or null before the first draw.
  layerView: View | null = null;

  constructor(private readonly screen: HTMLCanvasElement) {
    screen.width = WIDTH;
    screen.height = HEIGHT;
    this.ctx = screen.getContext("2d") as CanvasRenderingContext2D;
    this.layer = document.createElement("canvas");
    this.layer.width = WIDTH;
    this.layer.height = HEIGHT;
    this.lctx = this.layer.getContext("2d") as CanvasRenderingContext2D;
  }

  /// Draws decimated points (x, y pairs, NaN pairs are breaks) for `view`
  /// into the layer, then copies the layer to the screen. Returns the time
  /// of the path and stroke in ms (without the copy).
  drawExact(points: Float64Array, view: View): { pathMs: number; copyMs: number } {
    const t0 = performance.now();
    const c = this.lctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = "#fff";
    c.fillRect(0, 0, WIDTH, HEIGHT);
    c.strokeStyle = "#1f5fbf";
    c.lineWidth = 1;
    c.lineJoin = "round";
    const sx = WIDTH / (view.x1 - view.x0);
    const sy = HEIGHT / (view.y1 - view.y0);
    c.beginPath();
    let pen = false;
    for (let i = 0; i < points.length; i += 2) {
      const x = points[i] as number;
      const y = points[i + 1] as number;
      if (Number.isNaN(x) || Number.isNaN(y)) {
        pen = false;
        continue;
      }
      const px = (x - view.x0) * sx;
      const py = HEIGHT - (y - view.y0) * sy;
      if (pen) c.lineTo(px, py);
      else c.moveTo(px, py);
      pen = true;
    }
    c.stroke();
    const t1 = performance.now();
    this.layerView = view;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.drawImage(this.layer, 0, 0);
    const t2 = performance.now();
    return { pathMs: t1 - t0, copyMs: t2 - t1 };
  }

  /// Draws the layer (made for `layerView`) on the screen, scaled and moved
  /// so that it shows `view`. Returns the time in ms.
  drawTransformed(view: View): number {
    const L = this.layerView;
    if (!L) return 0;
    const t0 = performance.now();
    const ax = (L.x1 - L.x0) / (view.x1 - view.x0);
    const bx = ((L.x0 - view.x0) * WIDTH) / (view.x1 - view.x0);
    const ay = (L.y1 - L.y0) / (view.y1 - view.y0);
    const by = HEIGHT - ((L.y0 - view.y0) * HEIGHT) / (view.y1 - view.y0) - HEIGHT * ay;
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = "#fff";
    c.fillRect(0, 0, WIDTH, HEIGHT);
    c.setTransform(ax, 0, 0, ay, bx, by);
    c.drawImage(this.layer, 0, 0);
    c.setTransform(1, 0, 0, 1, 0, 0);
    return performance.now() - t0;
  }

  /// Forces the deferred drawing to finish (reads one pixel of the layer).
  flush(): void {
    this.lctx.getImageData(0, 0, 1, 1);
  }

  clear(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, WIDTH, HEIGHT);
    this.layerView = null;
  }

  get element(): HTMLCanvasElement {
    return this.screen;
  }
}
