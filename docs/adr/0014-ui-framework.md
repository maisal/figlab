# 0014. Use Preact with signals for the web UI

- Status: Accepted
- Date: 2026-10-14

## Context

spec.md 4.1 says the UI is TypeScript and Vite, and leaves the UI framework open.
roadmap.md D2 asks experiment S5 to choose it by three criteria:

- the download size (spec.md Section 13 asks for a start within 2 seconds from the second visit, with the cache)
- how well it works with CodeMirror 6, the editor of the command line and the editor panel (spec.md 12.1)
- how well AI agents know it, because agents write most of the code in this repository

The UI has many panels, forms, a data browser, tables, and dialogs (spec.md Section 12).
Graphs are drawn on Canvas and WebGL from the draw data of the Rust render module (spec.md 9.1), not by the framework.

Experiment S5 (`experiments/s5-ui/`) built the same small app in each candidate.
The app has a series list, a Quick Plot form bound to a store, a CodeMirror 6 editor with two-way sync,
a modal dialog, a canvas drawn outside the framework, and a virtualized table of 100,000 rows.
`experiments/s5-ui/APP-SPEC.md` defines the app, and one smoke test checks every build.
The measurements, the setup, and the limits are in `experiments/s5-ui/README.md`.

## Options

Sizes are of the production build (Vite 8, minified), in kB of 1000 bytes.
"Over CodeMirror" is the JavaScript beyond a build that has only the CodeMirror editor (393.0 kB raw, 125.1 kB gzip).
Times are medians of 15 warm loads in headless Chrome 155 with 4x CPU slowdown, on an M1 Max. They come from a run on 2026-10-15 with no other builds running (normal desktop apps were open). With 15 loads, p95 is the largest value.
"First render" is the first element of the app in the page. "Editor ready" is the CodeMirror content element in the page.

| Option | Version | JS gzip | Over CodeMirror, gzip | Framework code, raw | First render, warm 4x | Editor ready, warm 4x |
|---|---|---|---|---|---|---|
| 1. No framework (own helper, 46 lines) | — | 127.4 | 2.3 | 0 | 103 ms | 103 ms |
| 2. Preact with `@preact/signals` | 10.29.8, signals 2.11.3 | 135.5 | 10.4 | 21.8 | 74 ms | 170 ms (*) |
| 3. Solid | 1.9.17 | 133.5 | 8.3 | 16.2 | 155 ms | 155 ms |
| 4. Svelte 5 (runes) | 5.57.2 | 142.6 | 17.5 | 39.6 | 198 ms | 198 ms |
| 5. React 19 | 19.3.0 | 194.5 | 69.4 | 218.9 | 160 ms | 274 ms (*) |

(*) Preact and React mount the editor in `useEffect`, which runs after the first paint. So their "editor ready" includes one frame.
It compares Preact with React, but not with the other three, which mount everything in one task.
The CodeMirror-only build has its editor ready at 116 ms.

All five reference apps pass the type check (the repository's strict tsconfig), ESLint with `strictTypeChecked`, the build, and all 11 smoke test behaviors, on the production build and on the Vite dev server.

Preact 11 (11.0.0 released on 2026-09-30, 11.0.1 on 2026-10-08) gives the same size as Preact 10 (135.7 kB gzip).
The Preact app passes the type check, lint, and build on 11.0.1 unchanged, but the virtualized table breaks ("table-virtual: scroll height is 296"):
Preact 11 no longer adds `px` to numbers in `style`, and TypeScript does not catch it.
`experiments/s5-ui/harness/variants.mjs` reproduces this (`results/variants.json`).

CodeMirror 6 works the same way in every option: create an `EditorView` in a mount hook, destroy it in the cleanup,
and sync with the store through a small bridge (`experiments/s5-ui/shared/editor.ts`, about 40 lines).
The bridge skips text the editor already has and marks store changes with an annotation, so there is no loop.
No option needs a wrapper package.
Differences:

- No framework: no lifecycle problems, but every store field needs hand-written update code. This grows with the UI.
- Preact: `useEffect` mounts the view. A signals `effect()` pushes store changes into it. With one signal per part of the state, the canvas effect (`useSignalEffect`) runs only when the series or the plot settings change.
- Solid: `onMount` plus `createEffect`. Components run once, so there is nothing to guard against. ESLint 10's `no-unassigned-vars` rule falsely flags Solid's `let ref!: T` pattern, so the template turns it off.
- Svelte 5: `$effect` mounts the view. The effect that creates the view must not read reactive state (use `untrack`), or it re-creates the editor on every change. The trial agent made this mistake. The reference app keeps the editor handle in `$state.raw`. Plain `$state` would deeply proxy the handle, because it is a plain object. It does not proxy class instances such as `EditorView`.
- React: `useEffect` with cleanup, because StrictMode mounts twice in development. The store is read with `useSyncExternalStore`. Selectors must return parts of the state, not new objects, or React loops.

Build tools and licenses: every runtime package is MIT (two Apache-2.0 compiler dependencies of Svelte do not ship).
`vite-plugin-solid`, `@preact/preset-vite`, and `eslint-plugin-react-hooks` pull in Babel and `caniuse-lite` (CC-BY-4.0, browser support data).
That license is not on the tools allow list in `tools/check-npm-licenses.mjs`.
Preact without the preset, plain TypeScript, and Svelte do not need it.

Agent knowledge, public signals (2026-10-14):

| Option | npm downloads per week | Current major API since | Notes |
|---|---|---|---|
| Preact | 38.9 million (preact) | 2019 (10.x); 11.0 since 2026-09-30 | Same JSX and hooks as React. Small differences, for example native `onInput`/`onChange` events. Preact 11 no longer adds `px` to numeric styles |
| Solid | 7.4 million | 2021 (1.x) | Solid 2.0 is at release candidate 15. Its API changes |
| Svelte | 6.8 million | 2024 (5.x, runes) | Much of the public code and many answers use Svelte 3/4 syntax |
| React | 188 million | 2024 (19.x); hooks since 2019 | The most training data. Types come from `@types/react` |

### Lint and dev tooling for Preact

The owner chose option (a) on 2026-10-15. Both options give the same production bundle.

- (a) Add CC-BY-4.0 to `allowedForTools` in `tools/check-npm-licenses.mjs`, with a reason: `caniuse-lite` is browser support data used only by build tools, and it never ships.
  Then use `@preact/preset-vite` (component hot reload with Prefresh, `preact/debug` in development) and `eslint-plugin-react-hooks` with only `rules-of-hooks` and `exhaustive-deps`.
- (b) Keep the license list as it is. Use Vite's own JSX transform (`"jsxImportSource": "preact"`), no hooks lint, and no component hot reload (the page reloads on every edit).
  Import `preact/debug` by hand under `import.meta.env.DEV`.

Evidence (`results/variants.json`; the build times are from an earlier run on a busier machine and were not repeated):

- The preset makes a build slower: median 566 ms against 284 ms without it. Both are small. The bundle is the same (420.4 kB raw, 135.5 kB gzip).
- The two classic hooks rules give no errors on the Preact and React reference apps and trial apps.
  The v7 `recommended` preset gives two false errors on the Preact reference app (`react-hooks/immutability` on `signal.value = …`) and one real error on the Preact trial app (`react-hooks/refs`).

## Decision

Use Preact with `@preact/signals` for the web UI.

- Start with Preact 10 (10.29.8 was tested). Move to Preact 11 in its own change, after checking its breaking changes, such as numeric `style` values.
- Lint and dev tooling: option (a) above. CC-BY-4.0 is allowed for build tools only. Use `@preact/preset-vite` and `eslint-plugin-react-hooks` with only `rules-of-hooks` and `exhaustive-deps`.
- Keep the state in one signal per part (for example the series, the plot settings, and the editor text), or derive inputs with `computed`. Do not keep the whole state in one signal.
- Keep CodeMirror outside the components, behind a small bridge like the one in the experiment.

The agent trial below found no clear disadvantage for Preact against React. React stays the fallback if Preact causes problems later.

## Reasons

- Size: Preact with signals adds 10.4 kB gzip over CodeMirror. React adds 69.4 kB gzip, almost seven times as much.
  React's runtime is 219 kB of minified JavaScript.
  The first visit downloads all of it, together with the wasm modules (S4). Every visit parses and runs it. The V8 code cache lowers the compile cost on warm loads.
  In the timing, at 4x CPU slowdown, the first render comes about 85 ms later with React than with Preact, and the editor is ready about 105 ms later.
- Agent knowledge: Preact uses the same JSX, components, and hooks as React, which agents know best.
  In the trial, the React agent passed on the first scorer run and the Preact agent on the second. The Preact failure in run 1 came from a gap in `APP-SPEC.md`.
  The Preact agent kept the whole state in one signal, so the canvas was drawn again on every keystroke. The trial scorer did not check this yet. The stricter scorer used later does.
  This is a design mistake with signals, not a version mix-up. A short rule for agents prevents it (see Consequences).
  Svelte 5 and Solid are used less. Both have API breaks that agents can mix up (Svelte 4 vs 5, Solid 1 vs 2). The trial agents did not mix them up, but the Svelte agent hit the `$effect` pitfall above.
- CodeMirror: the integration is the same small bridge in every option.
  Preact has no StrictMode double mount, and a signals `effect()` is a clear way to push store changes into the editor.
- Canvas and WebGL: when the state is split into one signal per part, the drawing code subscribes to the state it uses, and components do not render again.
  This fits spec.md 9.1, where the screen drawing is TypeScript code outside the UI. It needs the rule above, because one signal for the whole state wakes every subscriber on every change.
- Escape hatch: `preact/compat` runs most React libraries (for example a dock layout library), if we ever need one.
- No framework is the smallest, but the UI of spec.md Section 12 is large. Hand-written update code for every panel costs more than 8 kB gzip saves.
- Solid is a little smaller than Preact and works as well in the experiment. It loses on agent knowledge and on the coming 2.0 API change.

## Agent trial

Fresh agents wrote the app from `experiments/s5-ui/APP-SPEC.md`, starting from `experiments/s5-ui/templates/<framework>/`.
Each app was scored with `node harness/score.mjs <app folder>` (type check, lint, build, and the smoke test on the production build and on the dev server).
After the review, the scorer got stricter checks: the canvas must not be drawn again while typing, the fixed files must equal the template, and dev licenses are checked.
Every trial app was then scored again ("Recheck").
The results and the code are in `experiments/s5-ui/README.md` ("Agent trial") and `experiments/s5-ui/results/trial/`.

| Framework | Scorer runs to pass | Errors before the first run (from the agent's report) | Failed behaviors in run 1 (of 11) | Recheck with the stricter scorer |
|---|---|---|---|---|
| No framework | 1 | none | 0 | pass |
| React | 1 | 1 lint error (`react-hooks/refs`: a ref written during render), from the React template's hooks plugin | 0 | pass |
| Preact | 2 | none (the Preact template has no hooks plugin) | 1 (`plot-controls`: wrapping label) | fail: `canvas-stable`, the canvas is drawn again on every keystroke and after `setEditorText` |
| Solid | 2 | 1 lint error (`no-confusing-void-expression` in an event handler), a repository rule | 1 (`plot-controls`: wrapping label) | pass |
| Svelte 5 | 3 | 4 lint errors (3 `no-confusing-void-expression`, 1 needless type assertion), repository rules | 3 (`plot-controls`: wrapping label; `editor-to-store` and `store-to-editor`: the editor was re-created on every keystroke) | pass |

- One fresh agent per framework (Claude Sonnet 5.5, through Claude Code), on 2026-10-14. Each saw only `APP-SPEC.md` and its template, with no web access, and could run the scorer up to 5 times.
- The lint errors and the other errors before the first run come from the agents' reports, not from the scorer.
- Every app passed all 11 behaviors of the trial scorer in the end, on the production build and on the dev server.
- The run 1 results of Solid and Svelte also show `canvas-stable` as failed. That was a side effect: `plot-controls` stopped early, and the old `canvas-stable` check wanted at least 8 draws in total. The stricter scorer no longer has that lower bound.
- No agent mixed up framework versions. The Svelte agent used runes, the Solid agent used the 1.x API, and the Preact agent used `preact/hooks` and `@preact/signals`.
- The Preact agent kept the whole state in one `signal<AppState>`. Draw counts after a rename, `setEditorText`, 5 keystrokes, and a table scroll:
  - Preact trial: 1, 2, 3, 8, 8
  - Solid and Svelte trials: 1, 1, 1, 1, 1
  - React and no-framework trials, and the Preact and React reference apps: 1, 2, 2, 2, 2 (they draw again after a rename, which is allowed)

  `APP-SPEC.md` section 6 now states the rule. It was not clear during the trial.
- The `plot-controls` failure in Preact, Solid, and Svelte was a gap in `APP-SPEC.md`, not a framework problem. These agents wrapped each control in its `<label>`. The label's text then includes the control's value, so the exact-name lookup of the smoke test failed. `APP-SPEC.md` now says to use `for` and `id`. The trial ran before that note.
- The Svelte editor failure was caused by the framework: reading reactive state inside the `$effect` that creates the editor made the effect run again on every change. This is a known pitfall of runes.
- The lint rule sets were not the same. The React template has `eslint-plugin-react-hooks` 7 (`recommended`). The Preact template has no hooks plugin. The React agent's only error came from that plugin.
  With the same plugin preset on Preact, the Preact trial app also gets one `react-hooks/refs` error (the same kind), and the Preact reference app gets two false `react-hooks/immutability` errors. So with equal rules, Preact and React tie.
- This is one agent per framework, so it is weak evidence. It shows no clear disadvantage for Preact against React, a signals design mistake that a short rule can prevent, and some disadvantage for Svelte.

## Consequences

- This change updates spec.md 4.1 (the UI framework) and roadmap.md D2 to point to this record.
- web/: add `preact` and `@preact/signals`. Set `"jsx": "react-jsx"` and `"jsxImportSource": "preact"` in `web/tsconfig.json`. Lint and format `web/**/*.tsx` too (`eslint.config.js` lints only `web/**/*.ts` today).
- This change adds CC-BY-4.0 to `allowedForTools` in `tools/check-npm-licenses.mjs`, with its reason. When web/ adopts Preact, add `@preact/preset-vite` and `eslint-plugin-react-hooks` (only `rules-of-hooks` and `exhaustive-deps`).
- Unit tests can use vitest with `@testing-library/preact` (MIT), as the experiment shows. Its last release was in 2024-05.
- jsdom pulls in packages under MIT-0 and CC0-1.0. Either add them to the tools allow list, or use the vitest browser mode instead of jsdom.
- CodeMirror needs real layout. Test the editor integration in Playwright (web/e2e), not in jsdom.
- Agents must write Preact, not React. AGENTS.md or development.md should say this in a few lines:
  - import from `preact` and `preact/hooks`
  - use `onInput` for text inputs
  - keep shared state in one signal per part, or derive it with `computed`. Never use one signal for the whole state
  - give units in `style` values
- Some React libraries need `preact/compat`. Each one must be checked before use.
- Preact 10 may get fewer fixes now that Preact 11 is out. Plan the move to 11 early, while the UI is still small.
- If Preact stops being maintained, moving to React is mostly mechanical, because the component model is the same.
