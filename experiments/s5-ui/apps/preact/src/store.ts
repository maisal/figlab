// The app store: one signal per part of the state (APP-SPEC.md section 2).

import { signal } from "@preact/signals";
import { initialState, type PlotSettings, type Series, type StoreHook } from "./types";

const initial = initialState();
export const series = signal<Series[]>(initial.series);
export const plot = signal<PlotSettings>(initial.plot);
export const editorText = signal<string>(initial.editorText);

function updateSeries(id: string, change: (s: Series) => Series): void {
  series.value = series.value.map((s) => (s.id === id ? change(s) : s));
}

export const actions: StoreHook = {
  getState: () => structuredClone({ series: series.value, plot: plot.value, editorText: editorText.value }),
  setEditorText(text) {
    editorText.value = text;
  },
  setSeriesVisible(id, visible) {
    updateSeries(id, (s) => ({ ...s, visible }));
  },
  renameSeries(id, name) {
    updateSeries(id, (s) => ({ ...s, name }));
  },
  setPlot(patch: Partial<PlotSettings>) {
    plot.value = { ...plot.value, ...patch };
  },
};

window.__store = actions;
