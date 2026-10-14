# S5: UI framework

## Question

Which UI framework should the figlab web app use?
roadmap.md M1 names three criteria:

- the download size (the app must start within 2 seconds, spec.md Section 13)
- how well it works with CodeMirror 6 (spec.md 4.1, 12.1)
- how well AI agents know it (agents write most of the code here)

Candidates: no framework (plain TypeScript with a small helper), Preact with `@preact/signals`, Solid, Svelte 5, and React 19.
Vue 3 and Lit were not built. Nothing in the criteria pointed to them: Vue is larger than Preact and Solid, and Lit's web components do not help with agent knowledge or with CodeMirror.

## Short answer

All five candidates can build the figlab UI. Each reference app passes the strict type check, ESLint, the build, and all 11 smoke test behaviors, on the production build and on the dev server.
CodeMirror 6 works the same way in all of them: a 40-line bridge mounts the view and syncs it with the store. No wrapper package is needed.

The real differences are size and agent knowledge:

- React adds 69.4 kB gzip of JavaScript over CodeMirror alone. Preact with signals adds 10.4 kB, Solid 8.3 kB, Svelte 17.5 kB, no framework 2.3 kB.
- React is what agents know best. Preact uses the same JSX and hooks. Svelte 5 and Solid have API breaks that agents can mix up.

Recommendation: Preact 10 with `@preact/signals`, with one signal per part of the state.
The lint and dev tooling (the Preact Vite preset and the hooks lint plugin) is an owner choice, because both bring in a CC-BY-4.0 data package for build tools. See the ADR.
React is the fallback. The agent trial showed no clear disadvantage for Preact against React, but the Preact agent kept the whole state in one signal (see "Agent trial").
See [ADR 0014](../../docs/adr/0014-ui-framework.md).

## Setup

| Item | Version |
|---|---|
| Machine | Apple M1 Max, 64 GB |
| OS | macOS 27.0.1 |
| Browser | Google Chrome 155.0.8059.79, headless, through Playwright 1.64.0 |
| Node, pnpm | 24.14.1, 10.25.0 (from the repository's `mise.toml`) |
| Build | Vite 8.3.4, TypeScript 6.0.3, ESLint 10.12.0, typescript-eslint 8.71.2 |
| CodeMirror | codemirror 6.0.2, @codemirror/view 6.43.14, state 6.7.6, language 6.13.1, lint 6.9.7 |
| No framework | own helper `apps/vanilla/src/dom.ts` (46 lines) |
| Preact | preact 10.29.8, @preact/signals 2.11.3. JSX through Vite's own transform (`jsxImportSource: "preact"`) |
| Solid | solid-js 1.9.17, vite-plugin-solid 2.11.14, eslint-plugin-solid 0.18.1 |
| Svelte | svelte 5.57.2, @sveltejs/vite-plugin-svelte 7.3.1, svelte-check 4.7.6, eslint-plugin-svelte 3.23.1 |
| React | react and react-dom 19.3.0, @vitejs/plugin-react 6.1.2, eslint-plugin-react-hooks 7.1.1 |
| Unit tests | vitest 5.0.4, jsdom 30.1.2, @testing-library/preact 3.2.4, @solidjs/testing-library 0.8.10, @testing-library/svelte 5.4.2, @testing-library/react 16.3.3 |

The versions were the latest on 2026-10-14, except Preact.
Preact 11.0.0 came out on 2026-09-30. The app was built on Preact 10.29.8 and also tried on 11.0.1 (see "Preact 11" below).

## Layout

| Path | What |
|---|---|
| `APP-SPEC.md` | The reference app, precise enough that someone else can write it. The smoke test checks only what it says |
| `shared/` | Framework-neutral files: state types, canvas drawing, CodeMirror extensions, table geometry, CSS, and the editor bridge. `harness/sync-shared.mjs` copies them into the apps and templates |
| `apps/<candidate>/` | The reference app per candidate. Each is its own pnpm project with a lock file. `apps/cm-only/` has only the editor: the size baseline |
| `templates/<candidate>/` | A starting folder for the agent trial: pinned `package.json` and lock file, Vite, TypeScript and ESLint config, the shared files, and an empty entry |
| `harness/` | `smoke.mjs` (Playwright smoke test), `score.mjs` (score one app folder), `size.mjs`, `measure.mjs` (timing), `variants.mjs` (Preact variants and hooks lint), `signals.mjs` (npm data), `serve.mjs` (static server) |
| `results/` | `size.json`, `timing.json`, `variants.json`, `signals.json`, `scores/<app>.json`, and `trial/<name>/` (the agent trial) |

The type check and lint settings of each template are the repository's (`web/tsconfig.json`, `eslint.config.js`: `strict`, `noUncheckedIndexedAccess`, `strictTypeChecked`).
The Solid, Svelte, and React templates add the framework's lint plugin (`eslint-plugin-solid`, `eslint-plugin-svelte`, `eslint-plugin-react-hooks` with its v7 `recommended` preset).
The Preact and no-framework templates have no extra plugin. So the rule sets are not the same (see "TypeScript and lint").

## How to run

```sh
cd experiments/s5-ui
pnpm install                    # Playwright and source-map-js for the harness
pnpm run install-apps           # pnpm install --frozen-lockfile in every app and template
pnpm run size                   # bundle sizes -> results/size.json (final numbers)
pnpm run measure                # build time and page timing -> results/timing.json (about 6 minutes)
pnpm run score -- apps/preact   # type check, lint, build, smoke test of one app
pnpm run variants               # Preact 10/11 and preset variants, hooks lint with equal rules -> results/variants.json
pnpm run signals                # npm downloads and release dates -> results/signals.json
```

Run these with the repository's Node and pnpm (`mise exec -- pnpm …`, or inside the repository, where mise activates them).
Playwright uses the installed Google Chrome (`channel: "chrome"`). It does not download a browser.
`measure` takes options: `--runs N` (page loads per case, default 15), `--builds N` (default 5), and app names.

## Results

### Download size

Production build, minified, one JavaScript file per app. kB = 1000 bytes. gzip level 9, brotli quality 11.
"Over CM-only" is the difference from the build with only the editor.
The split comes from a second build with source maps: every byte of the minified file is counted for its source file.
"Framework" is every package that is not CodeMirror. "App" is the app's own code.

| App | JS raw | JS gzip | JS brotli | Over CM-only, raw | Over CM-only, gzip | Over CM-only, brotli | Framework, raw | CodeMirror, raw | App, raw |
|---|---|---|---|---|---|---|---|---|---|
| CM-only | 393.0 | 125.1 | 107.1 | 0 | 0 | 0 | 0 | 391.5 | 0.6 |
| No framework | 398.9 | 127.4 | 109.1 | 5.9 | 2.3 | 2.0 | 0 | 391.6 | 6.5 |
| Preact + signals | 420.4 | 135.5 | 116.3 | 27.4 | 10.4 | 9.2 | 21.8 | 391.8 | 6.1 |
| Solid | 415.4 | 133.5 | 114.2 | 22.4 | 8.3 | 7.1 | 16.2 | 391.7 | 6.7 |
| Svelte 5 | 438.4 | 142.6 | 122.7 | 45.4 | 17.5 | 15.6 | 39.6 | 391.8 | 6.2 |
| React 19 | 618.6 | 194.5 | 165.9 | 225.6 | 69.4 | 58.8 | 218.9 | 391.9 | 6.9 |

- Framework code by package (raw): Preact: preact 13.5, @preact/signals-core 4.7, @preact/signals 3.6. Solid: solid-js 16.2. Svelte: svelte 39.6. React: react-dom 207.1, react 8.2, scheduler 3.5.
- CSS is the same file in every app: 1.2 kB raw, 0.6 kB gzip.
- The Preact app with `@preact/preset-vite` 2.10.6 (Babel) instead of Vite's own JSX transform: 420.4 kB raw, 135.5 kB gzip. The same (`pnpm run variants`, `results/variants.json`).
- The Preact app on Preact 11.0.1: 420.5 kB raw, 135.7 kB gzip. The same (also in `results/variants.json`).

### Page timing

Time from the start of the navigation, in milliseconds, median / p95 of 15 loads per case.
The numbers are from `pnpm run measure` on 2026-10-15 (`results/timing.json`), with no other builds or measurements running. Normal desktop apps were open (load average about 4 to 9).
With 15 loads, the p95 (nearest rank) is the largest value.
The pages are served from a local server with gzip, so the network adds almost nothing.
"Cold": a new browser context with an empty cache. "Warm": the same context after two loads.
CPU 4x: `Emulation.setCPUThrottlingRate` through CDP.
"First render": the first element in `#app` appears. "Editor ready": the CodeMirror `.cm-content` element appears. "FCP": first contentful paint.

Editor ready:

| App | Cold, CPU 1x | Warm, CPU 1x | Cold, CPU 4x | Warm, CPU 4x |
|---|---|---|---|---|
| CM-only | 38 / 52 | 38 / 55 | 116 / 138 | 116 / 134 |
| No framework | 33 / 39 | 32 / 43 | 103 / 127 | 103 / 121 |
| Preact + signals | 52 / 69 | 50 / 57 | 178 / 222 | 170 / 217 |
| Solid | 43 / 58 | 47 / 64 | 163 / 212 | 155 / 188 |
| Svelte 5 | 60 / 119 | 54 / 67 | 196 / 240 | 198 / 236 |
| React 19 | 70 / 96 | 65 / 75 | 259 / 300 | 274 / 306 |

First render:

| App | Cold, CPU 1x | Warm, CPU 1x | Cold, CPU 4x | Warm, CPU 4x |
|---|---|---|---|---|
| CM-only | 38 / 52 | 38 / 55 | 116 / 138 | 116 / 134 |
| No framework | 33 / 39 | 32 / 43 | 103 / 127 | 103 / 121 |
| Preact + signals | 31 / 48 | 28 / 37 | 75 / 86 | 74 / 98 |
| Solid | 43 / 58 | 47 / 64 | 163 / 212 | 155 / 188 |
| Svelte 5 | 60 / 119 | 54 / 67 | 196 / 240 | 198 / 236 |
| React 19 | 51 / 77 | 45 / 52 | 156 / 168 | 160 / 181 |

First contentful paint:

| App | Cold, CPU 1x | Warm, CPU 1x | Cold, CPU 4x | Warm, CPU 4x |
|---|---|---|---|---|
| CM-only | 48 / 60 | 48 / 76 | 144 / 168 | 148 / 172 |
| No framework | 60 / 72 | 64 / 108 | 188 / 224 | 188 / 228 |
| Preact + signals | 52 / 64 | 48 / 64 | 140 / 156 | 136 / 172 |
| Solid | 64 / 84 | 72 / 84 | 204 / 276 | 208 / 244 |
| Svelte 5 | 76 / 144 | 72 / 84 | 244 / 288 | 244 / 284 |
| React 19 | 88 / 108 | 84 / 100 | 252 / 320 | 292 / 352 |

Notes:

- The desktop apps that were open add some noise. Differences under about 20 ms at 1x are within it. The 4x results are steadier.
- Preact and React run `useEffect` after the first paint, so their editor is ready one frame after the first render. That is why their first render is early and their "editor ready" is late. A `useLayoutEffect` would mount the editor before the first paint. So "editor ready" compares Preact with React, but not with the other three.
- Solid, Svelte, and no framework mount everything in one task, so first render and editor ready are the same.
- CM-only is a little slower than the app without a framework at 4x, although it runs less code. The cause was not found. It was the same in an earlier run on a busier machine, and in this one (116 ms against 103 ms warm).

### Build time

`vite build` of one app, median / p95 of 5 builds, in milliseconds, measured at the same time as the page timing (2026-10-15, no other builds running). With 5 builds, p95 is the largest value.

| App | Median | p95 (= max) | Builds |
|---|---|---|---|
| CM-only | 246 | 332 | 5 |
| No framework | 250 | 371 | 5 |
| Preact + signals | 266 | 331 | 5 |
| Solid | 587 | 841 | 5 |
| Svelte 5 | 665 | 1023 | 5 |
| React 19 | 283 | 384 | 5 |

Solid's Vite plugin compiles JSX with Babel. Svelte runs its compiler. React's plugin (6.x) and Preact (without the preset) use Vite's own fast transform.
With `@preact/preset-vite` (Babel), the Preact build takes 566 ms against 284 ms without it (median of 5, `results/variants.json`, from the earlier run on a busier machine, not repeated).

### Smoke test and checks

`node harness/score.mjs apps/<candidate>` for each reference app, on 2026-10-14, with the final scorer.
The scorer also checks that the runtime dependencies, the fixed files, and the configs equal the template, and the licenses of all packages. All five pass these steps.

| App | Type check | Lint | Build | Smoke, production build | Smoke, dev server | App code (non-empty lines) |
|---|---|---|---|---|---|---|
| No framework | pass | pass | pass | 11/11 | 11/11 | 260 in 4 files |
| Preact | pass | pass | pass | 11/11 | 11/11 | 280 in 4 files |
| Solid | pass | pass | pass | 11/11 | 11/11 | 263 in 4 files |
| Svelte | pass | pass | pass | 11/11 | 11/11 | 209 in 7 files |
| React | pass | pass | pass | 11/11 | 11/11 | 307 in 4 files |

App code includes the 39-line editor bridge (`editor.ts`) in every app, and the 46-line helper in the app without a framework.

The smoke test was checked against broken copies of the React app. Each was caught:

| Bug put in | Failed behaviors |
|---|---|
| Dialog open state kept in React state, with `showModal()` in an effect (Escape closes the native dialog, but the state stays true) | `dialog`: "the dialog did not open again after Escape" |
| `key` on the canvas that changes with the plot settings | `plot-controls`, `canvas-stable` |
| Editor sync without the equality check and the annotation | `store-to-editor`: typing in the middle of the text loses the cursor |
| Table rows one row too low | `table-virtual` |
| `getState()` returns the store object, not a copy | `loads` and later behaviors |
| The whole state in one signal (found in the Preact trial app, not put in by hand) | `canvas-stable`: drawn again while typing and after `setEditorText` |
| Editor mounted in `useEffect` without cleanup | passes on the production build, fails 4 behaviors on the dev server (StrictMode mounts twice, two editors) |

### Unit tests

Each reference app also has one unit test with vitest, jsdom, and the framework's Testing Library (`pnpm run test` in the app folder).
It renders the whole app, clicks a checkbox, renames a series from the store, and checks that the editor exists.
All five pass. Notes:

- jsdom has no `ResizeObserver` and no canvas. A small stub (`src/test-setup.ts`) is enough. CodeMirror mounts in jsdom, but jsdom has no layout. Test the editor behavior in a real browser (Playwright), as the smoke test does.
- Preact: `act()` of `@testing-library/preact` returns a promise, so with `strictTypeChecked` it must be awaited (`no-floating-promises`). `@testing-library/preact` had its last release in 2024-05.
- Svelte: needs the `svelteTesting()` Vite plugin (browser export conditions), and `flushSync()` after a store change.
- Solid: works with no extra settings. vite-plugin-solid sets the conditions for vitest.

### CodeMirror 6 integration

The same bridge (`shared/editor.ts`) is used by every app:

- `mountEditor(parent, text, onUserChange)` creates the `EditorView` with the extensions and an update listener.
- The listener calls `onUserChange` only for document changes that do not carry the `fromStore` annotation.
- `setText(text)` does nothing if the editor already has the text. Otherwise it replaces the document and marks the transaction with `fromStore`.
- So typing writes the store once, the store's effect calls `setText` with the same text, and nothing more happens. A change from the store is shown but never written back.

| Candidate | Mount and destroy | Store to editor | Problems found | Wrapper |
|---|---|---|---|---|
| No framework | create once at start | `store.subscribe` | none. But every other part of the UI needs its own hand-written update code | not needed |
| Preact | `useEffect(() => { mount; return destroy }, [])` | a signals `effect()` created in the same `useEffect` and stopped in its cleanup | none | none exists. Not needed |
| Solid | `onMount` plus `onCleanup` | `createEffect` inside `onMount` | ESLint 10's `no-unassigned-vars` flags Solid's `let el!: T; <div ref={el}>` pattern. The template turns the rule off | `solid-codemirror` 2.3.3 (11,863 downloads per week). Not needed |
| Svelte 5 | `$effect` that returns the destroy function, `untrack` for the first text | a second `$effect` | the effect that creates the view must not read reactive state, or it re-creates the editor on every change (the trial agent hit this). The handle is kept in `$state.raw`: plain `$state` deeply proxies plain objects and arrays, such as this handle. It does not proxy class instances such as `EditorView` | `svelte-codemirror-editor` 2.1.0 (40,592 per week, last release 2025-10). Not needed |
| React | `useEffect` with cleanup. StrictMode mounts, destroys, and mounts again in development | a second `useEffect` on the text | the cleanup is required (shown by the dev-server smoke test). `useSyncExternalStore` selectors must return parts of the state, not new objects | `@uiw/react-codemirror` 4.25.12 (4.8 million per week). Not needed, and it pulls `@babel/runtime` and a theme as peers |

The canvas is drawn the same way: a plain `drawPlot()` function called from the framework's effect (`useSignalEffect`, `createEffect`, `$effect`, `useEffect`, or `subscribe`).
In Solid and Svelte, the effect tracks exactly the fields that `drawPlot()` reads, so a rename does not draw again.
In Preact, the effect tracks the signals it reads. The reference app has one signal per part of the state, so typing does not draw again, but a rename does (the series signal changes).
With one signal for the whole state, as in the Preact trial app, every keystroke draws again. The canvas component never renders again in any of the three.
In React, the canvas component renders again on every change to the series or the plot settings, but React keeps the same element.

### Agent knowledge

#### Problems while writing the reference apps

One agent (Claude Code) wrote all five apps from the spec, one after another, in about the same time each.
The list below is every problem found. It is short, so it is weak evidence. The agent trial gives more.

| Candidate | Problems |
|---|---|
| No framework | None. More code to write: each store field needs a subscription that updates the DOM by hand |
| Preact | None in the app. In the unit test, an `act()` call needed `await` (see "Unit tests") |
| Solid | One lint error, 4 places: `no-unassigned-vars` on `let ref!: HTMLElement` (an ESLint 10 rule against a Solid idiom). Fixed in the template's ESLint config |
| Svelte | None in the app. In the template, a `.svelte` file without `<script lang="ts">` made `svelte-check` report "implicitly has an 'any' type" for its import. `eslint-plugin-svelte` is slow: 19 s for the first lint, against 3 to 6 s for the others |
| React | None. Patterns that need care: StrictMode cleanup, stable selectors for `useSyncExternalStore`, and derived state for the number input |

#### Preact 11

Preact 11.0.0 came out on 2026-09-30, and 11.0.1 on 2026-10-08.
The Preact app passes the type check, lint, and build on Preact 11.0.1 unchanged.
But the smoke test fails `table-virtual` ("scroll height is 296"): the spacer has no height. `pnpm run variants` reproduces it (`results/variants.json`).
Preact 11 no longer adds `px` to numbers in `style` (`style={{ height: 2400000 }}`). React and Preact 10 do.
TypeScript does not catch this. Agents write React-style numeric styles by habit, so Preact 11 needs a rule: always give units in styles (`"2400000px"`).
This is why the recommendation starts with Preact 10.

#### Public signals

Looked up on 2026-10-14 with `pnpm run signals` (`results/signals.json`).

| Package | Latest | npm downloads, last week | Current major since | License | Types |
|---|---|---|---|---|---|
| react | 19.3.0 | 188.0 million | 2024-12-05 (hooks API since 2019) | MIT | `@types/react` |
| preact | 11.0.1 (10.29.8 used) | 38.9 million | 11: 2026-09-30 (11.0.1: 2026-10-08). 10: 2019-10-01 | MIT | own |
| @preact/signals | 2.11.3 | 2.8 million | 2024-12-17 | MIT | own |
| vue | 3.5.44 | 17.6 million | 2020-09-18 | MIT | own |
| solid-js | 1.9.17 | 7.4 million | 2021-06-28. 2.0.0 is at rc.15 | MIT | own |
| lit | 3.3.3 | 7.0 million | 2023-10-10 | BSD-3-Clause | own |
| svelte | 5.57.2 | 6.8 million | 2024-10-19 (runes) | MIT | own |

Download counts include use as a dependency of other packages, so they say more about how much code exists than about how many apps use a framework.

### TypeScript and lint

- All templates use the repository's strict tsconfig and `strictTypeChecked`. None needed a rule turned off, except `no-unassigned-vars` for Solid.
- Svelte is type-checked with `svelte-check --fail-on-warnings`, which also reports accessibility warnings.
- The framework lint plugins differ. The React template uses `eslint-plugin-react-hooks` 7 with its `recommended` preset, which includes React Compiler-based rules (`refs`, `immutability`, and others). The Preact template has no hooks plugin.
- Equal rules (`pnpm run variants`, `results/variants.json`):

| Target | `recommended` preset of eslint-plugin-react-hooks 7 | Only `rules-of-hooks` and `exhaustive-deps` |
|---|---|---|
| Preact reference app | 2 errors, `react-hooks/immutability` on `signal.value = …` (false: signals are meant to be set) | 0 |
| React reference app | 0 | 0 |
| Preact trial app | 1 error, `react-hooks/refs` (a ref written during render, the same kind the React agent had) | 0 |
| React trial app (final code) | 0 | 0 |

So with equal rules, Preact and React tie. For Preact, the two classic rules fit. The v7 preset gives false errors with signals.

### Licenses

experiments/README.md says that dependencies follow the allow list in docs/development.md 6.6.

- Every runtime package of every candidate is MIT, except two Apache-2.0 compiler dependencies of `svelte` that do not ship. All are on the allow list (`score.mjs` checks this).
- Dev-only exceptions in this experiment. They are not on the tools allow list in `tools/check-npm-licenses.mjs`, and `score.mjs` reports them as known exceptions:
  - `caniuse-lite` (CC-BY-4.0, browser support data). It comes through Babel from `vite-plugin-solid`, `eslint-plugin-react-hooks`, and `@preact/preset-vite`, so it is in the lock files of the Solid and React apps and templates.
  - `@csstools/color-helpers` and `@csstools/css-syntax-patches-for-csstree` (MIT-0), and `mdn-data` (CC0-1.0). They come with `jsdom`, used only by the unit tests of the reference apps.
- The Preact template (without the preset) and the Svelte and no-framework templates have none of these. With the unit tests, every reference app has the jsdom packages.

## Agent trial

Fresh agents write the app from `APP-SPEC.md`.

1. Copy a template: `cp -R templates/<candidate> trial/<name>` (`trial/` is ignored by git).
2. The agent reads `APP-SPEC.md` and writes `trial/<name>/src/`.
3. Score it: `node harness/score.mjs trial/<name>` (in `experiments/s5-ui/`).

`score.mjs` installs the packages if needed. It checks that the runtime dependencies are the template's, that the fixed files and configs equal the template (APP-SPEC.md 1), and the licenses of all packages.
Then it runs `typecheck`, `lint`, and `build`, and the smoke test on the production build and on the dev server.
It prints PASS or FAIL per step and per behavior, and writes `results/scores/<name>.json` (or `--out <file>`).
The exit code is 0 only if everything passed. `--no-dev` skips the dev-server run.

### Results

One fresh agent per framework (Claude Sonnet 5.5, through Claude Code), on 2026-10-14.
Each saw only `APP-SPEC.md` and its template, with no web access, and could run the scorer up to 5 times.
After the review, the scorer got stricter (see below), and every trial app was scored again: `results/trial/<name>/score-recheck.json`.

| Framework | Scorer runs to pass | Errors before the first run (from the agent's report) | Failed behaviors in run 1 (of 11) | Recheck with the stricter scorer |
|---|---|---|---|---|
| No framework | 1 | none | 0 | pass, 11/11 on both runs |
| React | 1 | 1 lint error (`react-hooks/refs`: a ref written during render), from the React template's hooks plugin | 0 | pass, 11/11 on both runs |
| Preact | 2 | none (the Preact template has no hooks plugin) | 1 (`plot-controls`: wrapping label) | fail, 10/11 on both runs: `canvas-stable`, drawn again while typing (draw count 11 to 30) and after `setEditorText` (30 to 39) |
| Solid | 2 | 1 lint error (`no-confusing-void-expression` in an event handler), a repository rule | 1 (`plot-controls`: wrapping label) | pass, 11/11 on both runs |
| Svelte 5 | 3 | 4 lint errors (3 `no-confusing-void-expression`, 1 needless type assertion), repository rules | 3 (`plot-controls`: wrapping label; `editor-to-store` and `store-to-editor`: the editor was re-created on every keystroke) | pass, 11/11 on both runs |

- The errors before the first run come from the agents' reports, not from the scorer.
- Every app passed all 11 behaviors of the trial scorer in the end, on the production build and on the dev server.
- `score-run-1.json` of Solid and Svelte also shows `canvas-stable` as failed. That was a side effect: `plot-controls` stopped early, and the old `canvas-stable` check wanted at least 8 draws in total. The stricter scorer has no lower bound.
- No agent mixed up framework versions. The Svelte agent used runes, the Solid agent used the 1.x API, and the Preact agent used `preact/hooks` and `@preact/signals`.
- The Preact agent kept the whole state in one `signal<AppState>`, so the canvas effect runs on every change. Draw counts after a rename, `setEditorText`, 5 keystrokes, and a table scroll:
  - Preact trial: 1, 2, 3, 8, 8
  - Solid and Svelte trials: 1, 1, 1, 1, 1
  - React and no-framework trials, and the Preact and React reference apps: 1, 2, 2, 2, 2 (they draw again after a rename, which is allowed)

  During the trial, APP-SPEC.md section 6 said the drawing "may also run after other changes". It now says that typing, `setEditorText`, and scrolling must not draw. So the recheck failure is against a rule that the agent did not have. It is still a real design mistake: in figlab, it would redraw every graph on every keystroke.
- The `plot-controls` failure in Preact, Solid, and Svelte was a gap in `APP-SPEC.md`, not a framework problem. These agents wrapped each control in its `<label>`. The label's text then includes the control's value, so the exact-name lookup of the smoke test failed. `APP-SPEC.md` now says to use `for` and `id`. The trial ran before that note.
- The Svelte editor failure was caused by the framework: the `$effect` that creates the `EditorView` read `editorText`, so it ran again on every change and re-created the editor. The fix was `untrack()`. This is a known pitfall of runes.
- The lint rule sets were not the same (see "TypeScript and lint"). With equal rules, the Preact trial app gets the same `react-hooks/refs` error as the React agent had, so Preact and React tie.
- This is one agent per framework, so it is weak evidence. It shows no clear disadvantage for Preact against React, a signals design mistake that a short rule can prevent, and some disadvantage for Svelte.

Stricter scorer, after the review:

- `canvas-stable` no longer wants a minimum number of draws. It fails if typing in the editor, `setEditorText`, or scrolling the table draws the canvas again.
- New steps: the fixed files (`types.ts`, `draw.ts`, `extensions.ts`, `table.ts`, the start of `styles.css`) and the configs (`tsconfig.json`, `eslint.config.js`, `vite.config.ts`) must equal the template, ignoring comment lines. Dev package licenses must be on the tools allow list or a known dev-only exception.
- The smoke test cannot see whether the editor writes text set from outside back to the store as a new change, because UI changes do not go through `window.__store`. It checks that the store keeps the text, that the cursor does not jump, and that nothing loops.

The app code each agent wrote (only the files it changed) and every scorer result are in `results/trial/<name>/`.

## Limits

- One machine, one browser. Firefox and Safari were not measured.
- The timing is from one run on one machine (normal desktop apps open), and it has no network delay. With a real network, the size difference matters more on the first visit and less on later visits (spec.md Section 13 asks for 2 seconds from the second visit).
- The reference app is small. It does not show how each framework scales to dockable panels, a tree, a property panel, and many dialogs.
- One agent wrote all reference apps, with the spec in mind. The problem list is not a measure of agent knowledge. The agent trial is, with one agent per framework.
- The trial ran with an older APP-SPEC.md (no note on labels, a looser rule on redraws) and the older scorer. The recheck uses the new scorer on the same code.
- The editor bridge is shared, so the apps do not compare different ways of syncing CodeMirror. Trial agents write their own.
- The wasm modules (S4) are not part of these bundles.

## ADR

[ADR 0014: Use Preact with signals for the web UI](../../docs/adr/0014-ui-framework.md) (Proposed).
