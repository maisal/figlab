// Baseline for S5: only the CodeMirror editor with the same extensions as the
// reference apps. Its bundle size is the CodeMirror part of every candidate.
import { EditorView } from "@codemirror/view";
import { editorExtensions } from "./extensions";

const app = document.querySelector<HTMLElement>("#app");
if (app) {
  const parent = document.createElement("div");
  parent.dataset["testid"] = "editor";
  app.append(parent);
  new EditorView({ parent, doc: "plot s1 s2 style=line\n", extensions: editorExtensions() });
}
