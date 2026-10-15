# S5 reference app: specification

This file describes the small app that experiment S5 builds once per UI framework.
Someone who has not seen the reference apps must be able to write the app from this file alone.
The smoke test (`harness/smoke.mjs`) checks only what this file says.

The app has the parts of the figlab UI that matter when we choose a framework:
a side panel, a form bound to a store, a CodeMirror 6 editor, a modal dialog,
a canvas drawn outside the framework, and a virtualized table.

## 1. Rules

- Start from the template folder of your framework (`templates/<framework>/`). Copy it to a new folder (for example `trial/<name>/`, which git ignores) and fill in `src/`.
- The template's `src/` already has these files. Use them and do not change them (the scorer checks this):
  - `types.ts`: the state types (section 2), `initialState()`, the `StoreHook` type and the `window.__store` declaration, `PLOT_STYLES`, `parseLineWidth()`, and `isPlotStyle()`
  - `draw.ts`: the canvas drawing function (section 6)
  - `extensions.ts`: the CodeMirror extensions (4.4), as `editorExtensions()`
  - `table.ts`: the table data and geometry (4.6): `ROW_COUNT`, `ROW_HEIGHT`, `COLUMNS`, `cellValues()`, and `visibleRange()`
  - `styles.css`: the layout. You may add rules at the end
- Do not change `tsconfig.json`, `eslint.config.js`, or `vite.config.ts` (the scorer checks this too).
- The template's entry (`src/main.ts` or `src/main.tsx`, plus `App.*` where the framework has components) only mounts an empty app. Replace it.
- Do not add runtime dependencies (`dependencies` in `package.json`). The template already has the framework and CodeMirror. Write the table virtualization yourself.
- You may add dev dependencies. Their licenses must be MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, Zlib, or Unicode-3.0. The scorer also allows the licenses that the templates' own tools bring in (README.md "Licenses").
- Keep the scripts `typecheck`, `lint`, and `build` in `package.json`. They must pass with no errors. Do not weaken the TypeScript or ESLint settings of the template.
- Write idiomatic code for the framework: use its components, its reactivity, and its lifecycle.
- The canvas must be drawn by a plain function outside the framework (section 6).
- Use the global stylesheet `src/styles.css` of the template. It sets the layout. You may add rules at its end.
- Do not use `localStorage` or the network.

## 2. Store

The app keeps its state in one store. Use the store mechanism that is natural for the framework
(for example signals, a store object, or `useSyncExternalStore`).

The state has this shape:

```ts
type PlotStyle = "line" | "markers" | "both";

interface Series {
  id: string; // never changes
  name: string;
  visible: boolean;
}

interface PlotSettings {
  style: PlotStyle;
  lineWidth: number; // 0.5 to 10
  logY: boolean;
}

interface AppState {
  series: Series[];
  plot: PlotSettings;
  editorText: string;
}
```

The initial state is:

```json
{
  "series": [
    { "id": "s1", "name": "Series 1", "visible": true },
    { "id": "s2", "name": "Series 2", "visible": true },
    { "id": "s3", "name": "Series 3", "visible": true },
    { "id": "s4", "name": "Series 4", "visible": true }
  ],
  "plot": { "style": "line", "lineWidth": 1.5, "logY": false },
  "editorText": "plot s1 s2 style=line\n"
}
```

### 2.1 Test hook

The app sets `window.__store` before or during its first render. The smoke test uses only this object to read and change the store.

```ts
interface StoreHook {
  /** A plain JSON copy of the current state. Changing it must not change the store. */
  getState(): AppState;
  setEditorText(text: string): void;
  setSeriesVisible(id: string, visible: boolean): void;
  renameSeries(id: string, name: string): void;
  setPlot(patch: Partial<PlotSettings>): void;
}
```

Each call changes the store at once, the same way the UI does.
The screen must show the change by the next animation frame.
`getState()` must return the new value right after a call, and right after a UI event handler has run.

## 3. Layout

The template's `index.html` has `<div id="app"></div>`. Render the app into it.
The template's `styles.css` has classes for the layout. Use them like this (the class names are a suggestion, the test does not read them):

```
+---------------+-----------------------------------------+
| side panel    | Quick Plot panel (controls, About)      |
| (series list) +-----------------------------------------+
|               | canvas                                  |
|               +--------------------+--------------------+
|               | editor             | table              |
+---------------+--------------------+--------------------+
```

## 4. Elements

The test finds elements by `data-testid`, by label, or by role. Names in quotes must match exactly.

### 4.1 Side panel: series list

- A list with `data-testid="series-list"`. It has one item per series, in store order.
- Each item has:
  - a checkbox with `data-testid="series-visible-<id>"` (for example `series-visible-s1`). It is checked when the series is visible. Its accessible name is the series name (use a `<label>` or `aria-label`). Clicking it sets `visible` in the store.
  - a text input with `data-testid="series-name-<id>"` and `aria-label="Name of <id>"` (for example `Name of s1`). It shows the series name. Typing in it renames the series in the store, at the latest on the `change` event (Enter or leaving the field). When the store changes from outside, the input shows the new name.

### 4.2 Quick Plot panel

Three controls bound to `plot` in the store. Each has a visible `<label>` with exactly this text.
Connect each label to its control with `for` and `id`. Do not put the control inside the label: the label's text would then include the control's value, and the test looks up the control by the exact label text.
Each control changes the store when the user changes it.
Each control shows the store value when the store changes from outside.

| Label | Control | Store field | Values |
|---|---|---|---|
| `Plot style` | `<select>` | `plot.style` | options with values `line`, `markers`, `both` and texts `Line`, `Markers`, `Line and markers` |
| `Line width` | `<input type="number" min="0.5" max="10" step="0.5">` | `plot.lineWidth` | a number. Update the store on `input` when the value is a valid number in range. Ignore other values |
| `Log y` | `<input type="checkbox">` | `plot.logY` | true when checked |

The panel also has a button with the text `About`. It opens the dialog (4.5).

### 4.3 Canvas

- One `<canvas data-testid="plot-canvas" width="600" height="300">`.
- The framework creates it once. It must stay the same DOM element for the life of the app. Do not re-create it when the store changes (no `key` changes, no conditional rendering around it).
- It is drawn by the function in section 6.

### 4.4 Editor

- An element with `data-testid="editor"`. A CodeMirror 6 `EditorView` is mounted inside it, so it contains the `.cm-editor` and `.cm-content` elements of CodeMirror.
- Extensions: `editorExtensions()` from `src/extensions.ts`. It returns `basicSetup` from the `codemirror` package, plus:
  - a `StreamLanguage` (from `@codemirror/language`) that marks the words `plot`, `let`, `fit`, and `export` as keywords and numbers as numbers;
  - a linter (`linter` from `@codemirror/lint`) that reports every whole word `bad` as an error with the message `Unknown name: bad`, with `delay: 100`.
- Write the mounting and the sync yourself. Two-way sync with `editorText` in the store:
  - When the user types, the store gets the new text.
  - When the store changes from outside (`setEditorText`), the editor shows the new text.
  - There must be no loop. Typing must not move the cursor or lose characters. When the store is set from outside, the editor must not write the same text back as a new change.
- When the editor's component is removed, destroy the view (`view.destroy()`). Mount it only once (watch out for double mounting in development modes).

### 4.5 Dialog

- The button `About` opens a modal dialog.
- The dialog has `role="dialog"` (a native `<dialog>` has it) and the accessible name `About figlab` (for example a heading with that text and `aria-labelledby`).
- It is modal: either a native `<dialog>` opened with `showModal()`, or an element with `aria-modal="true"`.
- It has a button with the text `Close` that closes it. The Escape key also closes it.
- When it is closed, it is hidden (not in the DOM, or not displayed).
- The dialog's open state does not have to be in the store.

### 4.6 Table

- A table of 100,000 rows. Row `i` (0 to 99,999) has three cells, in this order (`cellValues(i)` in `src/table.ts` returns them):
  1. `i`
  2. `i * 2`
  3. `(i * 7919) % 10007`

  Each cell shows the decimal integer as text, with no thousands separators.
- The column headers `index`, `x`, and `y` are outside the scroll container.
- The scroll container has `data-testid="table-scroll"`. Its height is between 200 and 600 pixels. It scrolls vertically.
- Every row is exactly 24 pixels high (`ROW_HEIGHT`). `visibleRange()` gives the rows to render for a scroll position, with overscan. The scroll height of the container is `100000 * 24` pixels (a spacer element gives it this height). The row with index `i` is at `i * 24` pixels from the top of the scrolled content.
- Only the rows that are visible, plus a few more above and below (overscan), are in the DOM. There must never be more than 100 rows in the DOM.
- Each rendered row has `data-testid="table-row"` and `data-row-index="<i>"`. Its child elements are the three cells, in order.
- When the container scrolls, the rows update by the next animation frame.
- Using roles (`role="table"`, `role="row"`, `role="cell"`) is good but not required.

## 5. Behavior in short

| Action | Result |
|---|---|
| Uncheck `series-visible-s2` | `s2.visible` is false in the store. The canvas is drawn again without `s2` |
| Type a name in `series-name-s1`, press Enter | `s1.name` is the new name |
| `renameSeries("s1", …)` | The input shows the new name. The canvas may be drawn again, but does not have to be |
| Change `Plot style`, `Line width`, or `Log y` | `plot` changes in the store. The canvas is drawn again |
| `setPlot({...})` | The controls show the new values. The canvas is drawn again |
| Type in the editor | `editorText` is the editor text |
| `setEditorText(…)` | The editor shows the text. The text is not written back. The canvas is not drawn again |
| Text with the word `bad` | The linter marks it within about a second |
| Click `About` | The dialog opens. `Close` or Escape closes it |
| Scroll the table | The visible rows are rendered, and only a few more. The canvas is not drawn again |

## 6. Canvas drawing

The canvas is drawn by a plain TypeScript function that does not use the framework.
The framework calls it after the first render. It must call it again after every change that `drawPlot` reads:

- the visibility of a series (`series[i].visible`), and the list of series
- the plot settings (`plot`)

It may also run after a rename, because `drawPlot` gets the whole series list. It must not run after a change that `drawPlot` does not read: a change to `editorText` (typing or `setEditorText`), or scrolling the table.
For example, if the whole state is one signal or one object, every keystroke in the editor draws the canvas again. Keep `editorText` apart from `series` and `plot`, or derive the drawing inputs so that they change only when they must.

The template has this function in `src/draw.ts`:

```ts
export function drawPlot(canvas: HTMLCanvasElement, series: readonly Series[], plot: PlotSettings): void
```

It draws one curve per visible series and sets two attributes on the canvas that the test reads:

- `data-draw-count`: how many times the canvas has been drawn
- `data-drawn-series`: the ids of the drawn series, joined by commas (for example `s1,s3`)

## 7. How the test checks the app

`node harness/score.mjs <app folder>` (run in `experiments/s5-ui/`) installs the packages if needed, checks the runtime dependencies, the files that must not change (section 1), and the licenses of all packages, runs `typecheck`, `lint`, and `build`, and runs the smoke test in headless Chrome twice:
once on the production build (`dist/`), and once on the Vite dev server (development mode, for example React StrictMode).
The smoke test checks these behaviors, each on its own:

| Behavior | What it checks |
|---|---|
| `loads` | `window.__store` exists, the initial state matches section 2, and the parts in section 4 are on the page |
| `series-toggle` | Unchecking and checking a series updates the store and `data-drawn-series` |
| `series-rename` | Typing a name updates the store. `renameSeries` updates the input |
| `plot-controls` | The three controls update the store. `setPlot` updates the controls and draws the canvas again |
| `editor-to-store` | Typing in the editor updates `editorText`, with no lost or reordered characters |
| `store-to-editor` | `setEditorText` updates the editor. Typing after that still works, also in the middle of the text. The store keeps the editor text |
| `editor-lint` | The word `bad` gets a lint error mark. The mark goes away when the word is removed |
| `dialog` | `About` opens a modal dialog named `About figlab`. Escape closes it. `Close` closes it |
| `canvas-stable` | The canvas is the same DOM element after all the other behaviors. It was drawn again after each change to visibility and plot settings, and not drawn again while typing in the editor, after `setEditorText`, or while scrolling the table (section 6) |
| `table-virtual` | At most 100 rows are in the DOM. After scrolling to row 50,000 and to the end, the right rows are rendered at the right place with the right cells |
| `no-errors` | No uncaught errors and no `console.error` messages during the test |

The test cannot see whether the editor writes text set from outside back to the store as a new change, because UI changes do not go through `window.__store`.
It only checks that the store keeps the text, that the cursor does not jump, and that nothing loops.
