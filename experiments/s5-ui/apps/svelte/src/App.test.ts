// A unit test with vitest and Testing Library (S5: check that testing works).
import { fireEvent, render, screen } from "@testing-library/svelte";
import { flushSync } from "svelte";
import { expect, it } from "vitest";
import App from "./App.svelte";

it("toggles a series and shows store changes", async () => {
  render(App);
  await fireEvent.click(screen.getByTestId("series-visible-s2"));
  expect(window.__store?.getState().series[1]?.visible).toBe(false);
  window.__store?.renameSeries("s1", "Alpha");
  flushSync();
  expect(screen.getByTestId<HTMLInputElement>("series-name-s1").value).toBe("Alpha");
  expect(document.querySelector('[data-testid="editor"] .cm-content')).not.toBeNull();
});
