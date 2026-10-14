// CodeMirror 6 extensions of the editor (APP-SPEC.md 4.4).
// This file is the same in every candidate. Do not change it.

import { basicSetup } from "codemirror";
import { StreamLanguage } from "@codemirror/language";
import { linter, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";

const KEYWORDS = new Set(["plot", "let", "fit", "export"]);

/** A tiny stand-in for the figlab command language: keywords and numbers. */
export const figlabLanguage = StreamLanguage.define<null>({
  name: "figlab",
  startState: () => null,
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^\d+(\.\d+)?/)) return "number";
    if (stream.match(/^[A-Za-z_]\w*/)) {
      return KEYWORDS.has(stream.current()) ? "keyword" : "variableName";
    }
    stream.next();
    return null;
  },
});

/** Reports every whole word `bad` as an error. */
export const badWordLinter = linter(
  (view) => {
    const diagnostics: Diagnostic[] = [];
    for (const match of view.state.doc.toString().matchAll(/\bbad\b/g)) {
      diagnostics.push({
        from: match.index,
        to: match.index + match[0].length,
        severity: "error",
        message: "Unknown name: bad",
      });
    }
    return diagnostics;
  },
  { delay: 100 },
);

/** All extensions of the editor: basic setup, the language, and the linter. */
export function editorExtensions(): Extension[] {
  return [basicSetup, figlabLanguage, badWordLinter];
}
