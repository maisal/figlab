// Data and geometry of the virtualized table (APP-SPEC.md 4.6).
// This file is the same in every candidate. Do not change it.

export const ROW_COUNT = 100_000;
/** The height of every row, in CSS pixels. */
export const ROW_HEIGHT = 24;
/** Rows rendered above and below the visible ones. */
export const OVERSCAN = 6;
export const COLUMNS = ["index", "x", "y"] as const;

/** The texts of the three cells of row `i`. */
export function cellValues(i: number): [string, string, string] {
  return [String(i), String(i * 2), String((i * 7919) % 10007)];
}

/** The rows to render for a scroll position: `start` included, `end` excluded. */
export function visibleRange(scrollTop: number, viewportHeight: number): { start: number; end: number } {
  const first = Math.floor(scrollTop / ROW_HEIGHT);
  const count = Math.ceil(viewportHeight / ROW_HEIGHT) + 1;
  return {
    start: Math.max(0, first - OVERSCAN),
    end: Math.min(ROW_COUNT, first + count + OVERSCAN),
  };
}
