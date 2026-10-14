import { useSyncExternalStore } from "react";
import { initialState, type AppState, type PlotSettings, type StoreHook } from "./types";

let state: AppState = initialState();
const listeners = new Set<() => void>();

function update(next: AppState): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): AppState {
  return state;
}

export function setEditorText(text: string): void {
  if (text === state.editorText) return;
  update({ ...state, editorText: text });
}

export function setSeriesVisible(id: string, visible: boolean): void {
  update({ ...state, series: state.series.map((s) => (s.id === id ? { ...s, visible } : s)) });
}

export function renameSeries(id: string, name: string): void {
  update({ ...state, series: state.series.map((s) => (s.id === id ? { ...s, name } : s)) });
}

export function setPlot(patch: Partial<PlotSettings>): void {
  update({ ...state, plot: { ...state.plot, ...patch } });
}

export function useStore(): AppState {
  return useSyncExternalStore(subscribe, getSnapshot);
}

const hook: StoreHook = {
  getState: () => structuredClone(state),
  setEditorText,
  setSeriesVisible,
  renameSeries,
  setPlot,
};
window.__store = hook;
