// A unit test with vitest (S5: check that testing works).
import { expect, it } from "vitest";

it("toggles a series and shows store changes", async () => {
  document.body.innerHTML = '<div id="app"></div>';
  await import("./main");
  const box = document.querySelector<HTMLInputElement>('[data-testid="series-visible-s2"]');
  box?.click();
  expect(window.__store?.getState().series[1]?.visible).toBe(false);
  window.__store?.renameSeries("s1", "Alpha");
  expect(document.querySelector<HTMLInputElement>('[data-testid="series-name-s1"]')?.value).toBe("Alpha");
  expect(document.querySelector('[data-testid="editor"] .cm-content')).not.toBeNull();
});
