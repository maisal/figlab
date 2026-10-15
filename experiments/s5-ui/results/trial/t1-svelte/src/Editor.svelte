<script lang="ts">
  import { untrack } from "svelte";
  import { EditorView } from "@codemirror/view";
  import { editorExtensions } from "./extensions";
  import { store } from "./store.svelte";

  let host: HTMLDivElement | undefined = $state();
  let view: EditorView | undefined;

  $effect(() => {
    if (!host) return;
    const v = new EditorView({
      parent: host,
      doc: untrack(() => store.editorText),
      extensions: [
        ...editorExtensions(),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) store.editorText = u.state.doc.toString();
        }),
      ],
    });
    view = v;
    return () => {
      v.destroy();
      view = undefined;
    };
  });

  $effect(() => {
    const text = store.editorText;
    if (view && view.state.doc.toString() !== text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    }
  });
</script>

<div class="editor" data-testid="editor" bind:this={host}></div>
