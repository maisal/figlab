// The same UI with Preact 10 and @preact/signals, as S5 (ADR 0014) recommends.
// No JSX, so no build plugin is needed.

import { h, render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { signal } from "@preact/signals";
import { boot } from "./boot";

// The UI state lives in signals. The status line shows one.
const status = signal("starting");

function App() {
  const editor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void boot("preact", editor.current!).then(() => (status.value = "ready"));
  }, []);
  return h("div", { style: { display: "contents" } }, [
    h("div", { id: "top" }, [h("b", null, "figlab"), h("button", null, "Open"), h("button", null, "Export PDF"), h("button", null, "Export PNG")]),
    h("div", { id: "side" }, h("ul", null, Array.from({ length: 20 }, (_, i) => h("li", { key: i }, `sample${i + 1}`)))),
    h("div", { id: "main" }, [h("canvas", null), h("div", { id: "status" }, status)]),
    h("div", { id: "cmd", ref: editor }),
  ]);
}

const root = document.getElementById("app")!;
root.style.display = "contents";
render(h(App, null), root);
