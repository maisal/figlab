// Plain TypeScript UI: the DOM is built by hand.

import { boot } from "./boot";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string>, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

const app = document.getElementById("app")!;
const editor = el("div", { id: "cmd" });
const items = Array.from({ length: 20 }, (_, i) => el("li", {}, `sample${i + 1}`));
app.replaceWith(
  el("div", { id: "top" }, el("b", {}, "figlab"), el("button", {}, "Open"), el("button", {}, "Export PDF"), el("button", {}, "Export PNG")),
  el("div", { id: "side" }, el("ul", {}, ...items)),
  el("div", { id: "main" }, el("canvas", {}), el("div", { id: "status" }, "ready")),
  editor,
);
void boot("plain", editor);
