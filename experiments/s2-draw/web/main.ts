// The page. Buttons for a person, and `window.s2` for scripts/measure.mjs.

import {
  type GlResult,
  type InteractionResult,
  type LoadOptions,
  type HiLoCheck,
  type PrecisionResult,
  type Session,
  type Strategy,
  benchDecimate,
  benchDraw2d,
  load,
  runGl,
  runInteraction,
  runPrecision,
  showLines,
} from "./bench";
import type { DataInfo, DecimateTiming, Method } from "./protocol";

const canvas2d = document.getElementById("c2d") as HTMLCanvasElement;
const canvasGl = document.getElementById("gl") as HTMLCanvasElement;
const status = document.getElementById("status") as HTMLPreElement;

let session: Session | null = null;

const DEFAULT: LoadOptions = { simd: false, sorted: true, n: 10_000_000, pyramidBase: 16, nanEvery: 0 };

function say(text: string): void {
  status.textContent = text;
}

function need(): Session {
  if (!session) throw new Error("load first");
  return session;
}

export interface AllResults {
  userAgent: string;
  devicePixelRatio: number;
  plot: { cssWidth: number; cssHeight: number; deviceWidth: number; deviceHeight: number };
  data: DataInfo;
  decimate: DecimateTiming[];
  decimateSimd: DecimateTiming[];
  decimateNanDense: { nanEvery: number; data: DataInfo; results: DecimateTiming[] }[];
  decimateUnsorted: DecimateTiming[];
  dataUnsorted: DataInfo;
  draw2d: Awaited<ReturnType<typeof benchDraw2d>>;
  draw2dUnsorted: Awaited<ReturnType<typeof benchDraw2d>>;
  interaction: InteractionResult[];
  gl: GlResult;
  precision: PrecisionResult[];
  hiloLo: HiLoCheck;
}

const api = {
  async load(opts: Partial<LoadOptions> = {}): Promise<DataInfo> {
    say("loading...");
    session = await load(canvas2d, { ...DEFAULT, ...opts }, session);
    say(JSON.stringify(session.info, null, 2));
    return session.info;
  },
  async decimate(only?: string[]): Promise<DecimateTiming[]> {
    const r = await benchDecimate(need(), 20, only);
    say(JSON.stringify(r, null, 2));
    return r;
  },
  async draw2d() {
    const r = await benchDraw2d(need());
    say(JSON.stringify(r, null, 2));
    return r;
  },
  async interaction(strategy: Strategy, method: Method = 1): Promise<InteractionResult> {
    const s = need();
    showLines(s, canvasGl);
    say(`running ${strategy}...`);
    const r = await runInteraction(s, strategy, method);
    say(JSON.stringify(r, null, 2));
    return r;
  },
  async gl(): Promise<GlResult> {
    say("WebGL markers...");
    const r = await runGl(need(), canvasGl);
    say(JSON.stringify(r, null, 2));
    return r;
  },
  async precision(): Promise<{ results: PrecisionResult[]; hiloLo: HiLoCheck }> {
    say("precision check...");
    const r = await runPrecision(need(), canvasGl);
    say(JSON.stringify(r, null, 2));
    return r;
  },
  /// Everything that scripts/measure.mjs records, in one call.
  async all(): Promise<AllResults> {
    const data = await api.load({});
    const decimate = await api.decimate();
    const draw2d = await api.draw2d();
    const interaction: InteractionResult[] = [];
    for (const strategy of ["every-frame", "transform", "hybrid"] as Strategy[]) {
      for (const method of [0, 1] as Method[]) {
        interaction.push(await api.interaction(strategy, method));
      }
    }
    const gl = await api.gl();
    const { results: precision, hiloLo } = await api.precision();
    showLines(need(), canvasGl);
    await api.load({ simd: true });
    const decimateSimd = await api.decimate();
    const decimateNanDense = [];
    for (const nanEvery of [1000, 100, 10]) {
      const d = await api.load({ nanEvery });
      decimateNanDense.push({ nanEvery, data: d, results: await api.decimate(["full", "10%"]) });
    }
    const dataUnsorted = await api.load({ sorted: false });
    const decimateUnsorted = await api.decimate();
    const draw2dUnsorted = await api.draw2d();
    interaction.push(await api.interaction("hybrid", 2));
    const all: AllResults = {
      userAgent: navigator.userAgent,
      devicePixelRatio: window.devicePixelRatio,
      plot: { cssWidth: 1600, cssHeight: 600, deviceWidth: 3200, deviceHeight: 1200 },
      data,
      decimate,
      decimateSimd,
      decimateNanDense,
      decimateUnsorted,
      dataUnsorted,
      draw2d,
      draw2dUnsorted,
      interaction,
      gl,
      precision,
      hiloLo,
    };
    say(JSON.stringify(all, null, 2));
    return all;
  },
};

declare global {
  interface Window {
    s2: typeof api;
  }
}
window.s2 = api;

for (const b of document.querySelectorAll<HTMLButtonElement>("button[data-run]")) {
  b.onclick = async () => {
    try {
      switch (b.dataset["run"]) {
        case "load":
          await api.load();
          break;
        case "decimate":
          await api.decimate();
          break;
        case "every-frame":
        case "transform":
        case "hybrid":
          await api.interaction(b.dataset["run"]);
          break;
        case "gl":
          await api.gl();
          break;
        case "precision":
          await api.precision();
          break;
        case "all":
          await api.all();
          break;
      }
    } catch (e) {
      say(String(e));
    }
  };
}
