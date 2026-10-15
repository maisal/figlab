import { initialState, type AppState, type PlotSettings } from "./types";

export const store: AppState = $state(initialState());

export function setEditorText(text: string): void {
  store.editorText = text;
}

export function setSeriesVisible(id: string, visible: boolean): void {
  const s = store.series.find((x) => x.id === id);
  if (s) s.visible = visible;
}

export function renameSeries(id: string, name: string): void {
  const s = store.series.find((x) => x.id === id);
  if (s) s.name = name;
}

export function setPlot(patch: Partial<PlotSettings>): void {
  Object.assign(store.plot, patch);
}

window.__store = {
  getState: () => $state.snapshot(store),
  setEditorText,
  setSeriesVisible,
  renameSeries,
  setPlot,
};
