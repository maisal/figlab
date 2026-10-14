// The app store: a plain external store read with useSyncExternalStore (APP-SPEC.md section 2).

import { useSyncExternalStore } from "react";
import { initialState, type AppState, type PlotSettings, type Series, type StoreHook } from "./types";

let state: AppState = initialState();
const listeners = new Set<() => void>();

function setState(next: AppState): void {
  if (next === state) return;
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getState(): AppState {
  return state;
}

/** Read a part of the state. The selector must return a part of the state, not a new object. */
export function useAppState<T>(selector: (state: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

function updateSeries(id: string, change: (s: Series) => Series): void {
  setState({ ...state, series: state.series.map((s) => (s.id === id ? change(s) : s)) });
}

export const actions: StoreHook = {
  getState: () => structuredClone(state),
  setEditorText(text) {
    if (text !== state.editorText) setState({ ...state, editorText: text });
  },
  setSeriesVisible(id, visible) {
    updateSeries(id, (s) => ({ ...s, visible }));
  },
  renameSeries(id, name) {
    updateSeries(id, (s) => ({ ...s, name }));
  },
  setPlot(patch: Partial<PlotSettings>) {
    setState({ ...state, plot: { ...state.plot, ...patch } });
  },
};

window.__store = actions;
