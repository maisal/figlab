// State types of the S5 reference app (APP-SPEC.md section 2).
// This file is the same in every candidate. Do not change it.

export type PlotStyle = "line" | "markers" | "both";

export interface Series {
  /** Never changes. */
  id: string;
  name: string;
  visible: boolean;
}

export interface PlotSettings {
  style: PlotStyle;
  /** 0.5 to 10. */
  lineWidth: number;
  logY: boolean;
}

export interface AppState {
  series: Series[];
  plot: PlotSettings;
  editorText: string;
}

/** The test hook, set on `window.__store` (APP-SPEC.md 2.1). */
export interface StoreHook {
  /** A plain JSON copy of the current state. */
  getState(): AppState;
  setEditorText(text: string): void;
  setSeriesVisible(id: string, visible: boolean): void;
  renameSeries(id: string, name: string): void;
  setPlot(patch: Partial<PlotSettings>): void;
}

declare global {
  interface Window {
    __store?: StoreHook;
  }
}

export const PLOT_STYLES: readonly { value: PlotStyle; label: string }[] = [
  { value: "line", label: "Line" },
  { value: "markers", label: "Markers" },
  { value: "both", label: "Line and markers" },
];

export function initialState(): AppState {
  return {
    series: [1, 2, 3, 4].map((n) => ({ id: `s${String(n)}`, name: `Series ${String(n)}`, visible: true })),
    plot: { style: "line", lineWidth: 1.5, logY: false },
    editorText: "plot s1 s2 style=line\n",
  };
}

/** The line width typed in the input, or null if it is not a valid number in range. */
export function parseLineWidth(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0.5 && value <= 10 ? value : null;
}

/** Whether a string is one of the plot styles. */
export function isPlotStyle(value: string): value is PlotStyle {
  return PLOT_STYLES.some((s) => s.value === value);
}
