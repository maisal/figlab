// The same UI with React (no JSX, so no build plugin is needed).

import { createElement as h, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { boot } from "./boot";

function App() {
  const editor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void boot("react", editor.current!);
  }, []);
  return h("div", { style: { display: "contents" } }, [
    h("div", { id: "top", key: "top" }, [
      h("b", { key: 0 }, "figlab"),
      h("button", { key: 1 }, "Open"),
      h("button", { key: 2 }, "Export PDF"),
      h("button", { key: 3 }, "Export PNG"),
    ]),
    h("div", { id: "side", key: "side" }, h("ul", null, Array.from({ length: 20 }, (_, i) => h("li", { key: i }, `sample${i + 1}`)))),
    h("div", { id: "main", key: "main" }, [h("canvas", { key: 0 }), h("div", { id: "status", key: 1 }, "ready")]),
    h("div", { id: "cmd", key: "cmd", ref: editor }),
  ]);
}

const root = document.getElementById("app")!;
root.style.display = "contents";
createRoot(root).render(h(App));
