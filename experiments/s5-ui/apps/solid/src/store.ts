// The app store: a Solid store (APP-SPEC.md section 2).

import { createStore, unwrap } from "solid-js/store";
import { initialState, type AppState, type PlotSettings, type StoreHook } from "./types";

const [state, setState] = createStore<AppState>(initialState());
export { state };

export const actions: StoreHook = {
  getState: () => structuredClone(unwrap(state)),
  setEditorText(text) {
    setState("editorText", text);
  },
  setSeriesVisible(id, visible) {
    setState("series", (s) => s.id === id, "visible", visible);
  },
  renameSeries(id, name) {
    setState("series", (s) => s.id === id, "name", name);
  },
  setPlot(patch: Partial<PlotSettings>) {
    setState("plot", patch);
  },
};

window.__store = actions;
