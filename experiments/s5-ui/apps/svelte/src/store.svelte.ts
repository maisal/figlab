// The app store: one deeply reactive $state object (APP-SPEC.md section 2).

import { initialState, type AppState, type PlotSettings, type StoreHook } from "./types";

export const app: AppState = $state(initialState());

export const actions: StoreHook = {
  getState: () => $state.snapshot(app),
  setEditorText(text) {
    app.editorText = text;
  },
  setSeriesVisible(id, visible) {
    const series = app.series.find((s) => s.id === id);
    if (series) series.visible = visible;
  },
  renameSeries(id, name) {
    const series = app.series.find((s) => s.id === id);
    if (series) series.name = name;
  },
  setPlot(patch: Partial<PlotSettings>) {
    Object.assign(app.plot, patch);
  },
};

window.__store = actions;
