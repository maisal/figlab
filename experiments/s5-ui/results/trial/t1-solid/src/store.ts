import { createStore, unwrap } from "solid-js/store";
import { initialState, type AppState, type PlotSettings, type StoreHook } from "./types";

export const [state, setState] = createStore<AppState>(initialState());

export function setEditorText(text: string): void {
  setState("editorText", text);
}

export function setSeriesVisible(id: string, visible: boolean): void {
  setState("series", (s) => s.id === id, "visible", visible);
}

export function renameSeries(id: string, name: string): void {
  setState("series", (s) => s.id === id, "name", name);
}

export function setPlot(patch: Partial<PlotSettings>): void {
  setState("plot", patch);
}

export function installHook(): void {
  const hook: StoreHook = {
    getState: () => JSON.parse(JSON.stringify(unwrap(state))) as AppState,
    setEditorText,
    setSeriesVisible,
    renameSeries,
    setPlot,
  };
  window.__store = hook;
}
