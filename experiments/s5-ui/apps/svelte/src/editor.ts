// A small bridge between a CodeMirror view and a store (S5 reference apps only).
// Each framework calls it from its own lifecycle. Trial agents write their own.

import { EditorView } from "@codemirror/view";
import { Annotation } from "@codemirror/state";
import { editorExtensions } from "./extensions";

/** Marks transactions that come from the store, so they are not written back. */
const fromStore = Annotation.define<boolean>();

export interface EditorHandle {
  /** Show text set from outside. Does nothing if the editor already has it. */
  setText(text: string): void;
  destroy(): void;
}

/** Mount an editor in `parent`. `onUserChange` gets the text after each user edit. */
export function mountEditor(parent: HTMLElement, text: string, onUserChange: (text: string) => void): EditorHandle {
  const view = new EditorView({
    parent,
    doc: text,
    extensions: [
      editorExtensions(),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !update.transactions.some((tr) => tr.annotation(fromStore))) {
          onUserChange(update.state.doc.toString());
        }
      }),
    ],
  });
  return {
    setText(next) {
      if (next === view.state.doc.toString()) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
        annotations: fromStore.of(true),
      });
    },
    destroy() {
      view.destroy();
    },
  };
}
