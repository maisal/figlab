<script lang="ts">
  import { untrack } from "svelte";
  import { mountEditor, type EditorHandle } from "./editor";
  import { actions, app } from "./store.svelte";

  let parent: HTMLDivElement;
  // $state.raw: the handle must not be wrapped in a deep proxy.
  let editor = $state.raw<EditorHandle>();

  $effect(() => {
    const handle = mountEditor(parent, untrack(() => app.editorText), (text) => {
      actions.setEditorText(text);
    });
    editor = handle;
    return () => {
      handle.destroy();
      editor = undefined;
    };
  });

  // Show changes made from outside. setText does nothing if the editor already has the text.
  $effect(() => {
    editor?.setText(app.editorText);
  });
</script>

<div bind:this={parent} class="editor" data-testid="editor"></div>
