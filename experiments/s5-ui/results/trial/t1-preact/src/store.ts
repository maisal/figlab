import { signal } from "@preact/signals";
import { initialState, type AppState, type PlotSettings, type StoreHook } from "./types";

export const state = signal<AppState>(initialState());

export function setEditorText(text: string): void {
  state.value = { ...state.value, editorText: text };
}

export function setSeriesVisible(id: string, visible: boolean): void {
  state.value = {
    ...state.value,
    series: state.value.series.map((s) => (s.id === id ? { ...s, visible } : s)),
  };
}

export function renameSeries(id: string, name: string): void {
  state.value = {
    ...state.value,
    series: state.value.series.map((s) => (s.id === id ? { ...s, name } : s)),
  };
}

export function setPlot(patch: Partial<PlotSettings>): void {
  state.value = { ...state.value, plot: { ...state.value.plot, ...patch } };
}

export const hook: StoreHook = {
  getState: () => JSON.parse(JSON.stringify(state.peek())) as AppState,
  setEditorText,
  setSeriesVisible,
  renameSeries,
  setPlot,
};
