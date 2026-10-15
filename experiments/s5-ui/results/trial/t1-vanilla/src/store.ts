// A small observable store. State is replaced immutably, so subscribers can compare references.
import { initialState, type AppState, type PlotSettings, type StoreHook } from "./types";

type Listener = (state: AppState, prev: AppState) => void;

export interface Store extends StoreHook {
  subscribe(listener: Listener): () => void;
  get(): AppState;
}

export function createStore(): Store {
  let state = initialState();
  const listeners = new Set<Listener>();

  function set(next: AppState): void {
    const prev = state;
    state = next;
    for (const l of [...listeners]) l(state, prev);
  }

  return {
    get: () => state,
    getState: () => structuredClone(state),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setEditorText(text) {
      if (text === state.editorText) return;
      set({ ...state, editorText: text });
    },
    setSeriesVisible(id, visible) {
      set({ ...state, series: state.series.map((s) => (s.id === id ? { ...s, visible } : s)) });
    },
    renameSeries(id, name) {
      set({ ...state, series: state.series.map((s) => (s.id === id ? { ...s, name } : s)) });
    },
    setPlot(patch: Partial<PlotSettings>) {
      set({ ...state, plot: { ...state.plot, ...patch } });
    },
  };
}
