// A unit test with vitest and Testing Library (S5: check that testing works).
import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { App } from "./App";

it("toggles a series and shows store changes", () => {
  render(<App />);
  fireEvent.click(screen.getByTestId("series-visible-s2"));
  expect(window.__store?.getState().series[1]?.visible).toBe(false);
  act(() => {
    window.__store?.renameSeries("s1", "Alpha");
  });
  expect(screen.getByTestId<HTMLInputElement>("series-name-s1").value).toBe("Alpha");
  expect(document.querySelector('[data-testid="editor"] .cm-content')).not.toBeNull();
});
