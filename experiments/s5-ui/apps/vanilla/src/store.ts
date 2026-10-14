// The app store and its actions (APP-SPEC.md section 2).

import { createStore } from "./dom";
import { initialState, type AppState, type PlotSettings, type StoreHook } from "./types";

export const store = createStore<AppState>(initialState());

function updateSeries(id: string, change: (s: AppState["series"][number]) => AppState["series"][number]): void {
  store.update((state) => ({ ...state, series: state.series.map((s) => (s.id === id ? change(s) : s)) }));
}

export const actions: StoreHook = {
  getState: () => structuredClone(store.get()),
  setEditorText(text) {
    store.update((state) => (state.editorText === text ? state : { ...state, editorText: text }));
  },
  setSeriesVisible(id, visible) {
    updateSeries(id, (s) => ({ ...s, visible }));
  },
  renameSeries(id, name) {
    updateSeries(id, (s) => ({ ...s, name }));
  },
  setPlot(patch: Partial<PlotSettings>) {
    store.update((state) => ({ ...state, plot: { ...state.plot, ...patch } }));
  },
};
