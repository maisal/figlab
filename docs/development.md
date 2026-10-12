# figlab Development Process (draft)

- Purpose: the repository layout, workflow, and automation for implementing figlab with GitHub (public repository) and Jujutsu (jj).
- Related documents: draft.md (requirements), spec.md (specification), language.md (command language definition)
- Status: Draft. Points that need the owner's confirmation are marked **[To confirm]** and collected in Section 11. jj commands are written for jj 0.46.

## 1. Principles

1. **main always works.** Every change to main goes through a PR. Only changes that pass CI are merged. Everything on main is published to GitHub Pages as is.
2. **All local work is done with jj.** Small changes are stacked, and each is submitted as a PR. History is rewritten freely with jj (split, squash, reorder) before submitting.
3. **Specification first, implementation second.** To change behavior, change spec.md, language.md, `commands.json`, and the tests first (or in the same PR).
4. **People and AI verify the same way.** Locally with `mise run check`; on GitHub, CI runs the same checks. jj does not run Git hooks (pre-commit, etc.), so hooks are not relied on.
5. **The repository is public.** No secrets. Test data is limited to data that may be published.
6. **Everything in the repository is written in plain English.** This covers documents, code comments, rustdoc, docstrings, commit messages, and Issue and PR text (6.4, 6.5).

## 2. Repository layout

A single repository (monorepo) holds the Rust crates, the web app, the documents, and the tests.

```
figlab/
├── README.md              overview, usage, license and contribution terms (6.6)
├── LICENSE-MIT            MIT license text (6.6)
├── LICENSE-APACHE         Apache License 2.0 text (6.6)
├── SECURITY.md            how to report vulnerabilities
├── AGENTS.md              working rules for AI agents (Section 8)
├── CLAUDE.md              a single line that imports AGENTS.md
├── .claude/settings.json  Claude Code project settings (6.1)
├── docs/
│   ├── draft.md           requirements
│   ├── spec.md            specification
│   ├── language.md        command language definition
│   ├── development.md     this document
│   └── adr/               architecture decision records (ADR, 6.3)
├── spec/                  machine-readable definitions (part of the formal language definition)
│   ├── commands.json      definitions of commands, functions, and fit models
│   ├── errors.json        list of error codes
│   └── schema/            JSON Schemas for the two files above
├── crates/                Rust
│   ├── figlab-core/       arrays, coordinates, arithmetic, fitting (no I/O)
│   ├── figlab-lang/       lexing, parsing, checking, canonical formatting (reads spec/commands.json at build time)
│   ├── figlab-io/         CSV detection and import, .npy, project storage format
│   ├── figlab-render/     layout, text measurement, draw data, SVG/PDF/PNG export (spec.md 9.1)
│   ├── figlab-wasm/       boundary with the browser (compute worker, language service, render module)
│   ├── figlab-lsp/        LSP language server (v1)
│   └── figlab-cli/        the `figlab` command
├── web/                   TypeScript + Vite (UI, screen drawing, file I/O)
│   ├── src/
│   └── e2e/               Playwright tests
├── tests/
│   ├── lang/              language conformance tests (.figc and expected results)
│   ├── numeric/           numerical verification (NIST StRD, etc.)
│   ├── import/            test files for import detection (sources and licenses listed in README)
│   └── figures/           acceptance figures (scripts and expected SVG/PNG)
├── fuzz/                  fuzzing of the parser and CSV detection
├── .github/               workflows, Issue and PR templates, etc. (Section 5)
├── Cargo.toml             Rust workspace
├── deny.toml              allowed licenses and sources of Rust dependencies (cargo-deny, 6.6)
├── about.toml             settings for the third-party license notices (cargo-about, 6.6)
├── package.json           web dependencies (pnpm)
├── mise.toml              pinned tool versions and task definitions (Section 3)
├── mise-tasks/            longer tasks as scripts (3.2)
├── tools/                 helper files for developers, such as the jj repository config template (4.1)
└── .gitignore             ignores local/ (personal, untracked files) and mise.local.toml
```

- The cores of computation, language, and rendering all live in Rust crates; `figlab-wasm` (browser) and `figlab-cli` (command line) are thin entry points. This makes it possible to verify with Rust tests alone that the browser and the command line give the same results.
- The JSON files in `spec/` are read by the parser, completion, help, and the web reference. Changing them updates everything.

## 3. Development environment

### 3.1 Pinned tool versions (mise)

Tool versions and task definitions are both kept in mise's `mise.toml`. No separate task runner is used.

- The configuration file is the non-hidden `mise.toml` (mise's standard name, easy to find in a public repository).
- Personal settings (local paths, etc.) go in `mise.local.toml`, which is excluded by `.gitignore`.
- Versions are pinned down to the patch version. jj changes command options between versions (e.g. the destination of `jj rebase` changed from `-d` to `-o`), so pinning is especially important.
- To upgrade, upgrade everything together (`mise upgrade --bump`) and pass CI.
- The Rust version is also pinned only in `mise.toml`; there is no `rust-toolchain.toml` (the same information is not kept in two places). Only if an editor does not pick up the mise environment, add a `rust-toolchain.toml` with the same version.

```toml
[tools]
jj = "0.46.0"
jjui = "0.10.11"
rust = { version = "1.99.0", components = "rustfmt,clippy", targets = "wasm32-unknown-unknown" }
node = "24.14.1"       # LTS
pnpm = "10.25.0"
ripgrep = "15.1.0"     # used by check:english (6.4)
# wasm-bindgen-cli is added with the same version as wasm-bindgen when it is added to Cargo.toml
# cargo-deny and cargo-about are added together with the Cargo workspace (6.6)
```

### 3.2 Tasks (mise run)

Run with `mise run <task>`. A task always uses the tool versions pinned in 3.1. So tasks run with the same versions locally and in CI.

| Task | Description |
|---|---|
| `mise run check` | Must pass before opening a PR. Rust format check, clippy, tests; language conformance tests; English-only check (6.4); license check of dependencies (6.6); web type check, lint, unit tests |
| `mise run fix` | Runs `jj fix` to format every change in the stack (4.1) |
| `mise run wasm` | Builds the wasm modules |
| `mise run dev` | Starts the web app locally |
| `mise run e2e` | End-to-end tests in browsers (Playwright) |
| `mise run figures` | Exports the acceptance figures and compares them with the expected ones |
| `mise run push <BOOKMARK>` | Passes `check`, then pushes the bookmark with `jj git push -b BOOKMARK`. Replaces a pre-push hook. Name bookmarks as in 6.1 |

Example definitions:

```toml
[tasks.check]
description = "Checks to pass before opening a PR"
depends = ["check:rust", "check:lang", "check:english", "check:deps", "check:web"]   # dependencies run in parallel

[tasks."check:rust"]
run = [
  "cargo fmt --all --check",
  "cargo clippy --workspace --all-targets -- -D warnings",
  "cargo test --workspace",
]

[tasks."check:english"]
description = "Fail if CJK text appears outside test fixtures"
run = "rg -n '[\\p{Han}\\p{Hiragana}\\p{Katakana}\\p{Hangul}]' --glob '!tests/import/**' --glob '!tests/**/fixtures/**' . && exit 1 || test $? -eq 1"   # rg exits 0 on a match, 1 on no match, 2 on an error. Tasks run with errexit, so use && and ||

[tasks."check:deps"]
description = "Check the licenses and sources of dependencies (6.6)"
run = "cargo deny check licenses bans sources"

[tasks.wasm]
run = "wasm-bindgen …"
sources = ["crates/**/*.rs", "Cargo.toml", "Cargo.lock"]   # skipped if nothing changed
outputs = ["web/src/wasm/**"]
```

- Short tasks go in `[tasks]` in `mise.toml`; longer ones (such as `push`) go in `mise-tasks/` as scripts. A description and arguments written in the comments at the top of a script appear in the `mise tasks` list and in completion.
- Example `mise-tasks/push`:

```sh
#!/usr/bin/env bash
#MISE description="Run checks, then push a bookmark with jj"
#MISE depends=["check"]
set -euo pipefail
bookmark="${1:?usage: mise run push <bookmark>}"
jj git push -b "$bookmark"
```

## 4. Using jj

### 4.1 Initial setup

This folder is already a colocated jj + Git repository. Create an empty repository on GitHub (no README, license, or .gitignore, so the histories do not split). Then:

```sh
jj commit                              # describe the current change and start a new one on top
jj git remote add origin git@github.com:<owner>/figlab.git
jj bookmark create main -r @-          # make the described change main (first time only)
jj git push --bookmark main            # a new bookmark is tracked automatically
```

Example user configuration (`jj config edit --user`):

```toml
[user]
name = "…"     # also used in the copyright line of LICENSE-MIT (6.6)
email = "…"    # the GitHub noreply address keeps your email private

# Commit signing (shown as "Verified" on GitHub). Check the setting names for your jj version
[signing]
behavior = "drop"
backend = "ssh"
key = "~/.ssh/id_ed25519.pub"

[git]
sign-on-push = true    # sign only when pushing
```

If changes were made before `user.name` and `user.email` were set, their author is empty. Fix them with `jj metaedit --update-author -r 'mutable()'`.

Example repository configuration (`jj config edit --repo`). This configuration is not part of the repository, so a template is kept in `tools/jj-repo-config.toml` for each developer to copy.

```toml
[revset-aliases]
"trunk()" = "main@origin"
"stack()" = "trunk()..@"              # the changes currently stacked

[aliases]
# Rebase all work in progress onto the latest main, dropping changes that have already been merged
sync = ["rebase", "-s", "roots(trunk()..mutable())", "-o", "trunk()", "--skip-emptied"]

[fix.tools.rustfmt]
command = ["rustfmt", "--emit", "stdout", "--edition", "2024"]
patterns = ["glob:'**/*.rs'"]

[fix.tools.prettier]
command = ["pnpm", "exec", "prettier", "--stdin-filepath=$path"]
patterns = ["glob:'web/**/*.ts'", "glob:'web/**/*.css'", "glob:'**/*.json'", "glob:'**/*.md'"]

# Once figlab fmt exists, also format command and user function files
# [fix.tools.figlab]
# command = ["figlab", "fmt", "--stdin-filepath=$path", "-"]
# patterns = ["glob:'**/*.figc'", "glob:'**/*.figf'"]
```

`jj fix` formats every change in the stack, not only the working copy. Formatting that was missed can be fixed in bulk later, so hooks are not needed.

### 4.2 Daily workflow

```sh
jj git fetch                      # fetch the latest from GitHub
jj sync                           # rebase work in progress onto the latest main (alias from 4.1)
jj new trunk() -m "feat(lang): parse for blocks"   # start a new change on top of main
#   … edit. jj records changes automatically, so there is no add or commit …
jj new -m "test(lang): tests for for blocks"       # stack the next change on top
jj split                          # split a change that mixes several things
jj absorb                         # move fixups into the changes they belong to
jj fix -s 'roots(stack())'        # format the whole stack
jj bookmark create feat/lang-parse-for-blocks -r @-   # name the branch for the PR (6.1)
mise run push feat/lang-parse-for-blocks              # check, then push
gh pr create --head feat/lang-parse-for-blocks --fill
```

- To undo a mistake, use `jj undo`. To go back further, inspect the operation log with `jj op log` and use `jj op restore`.
- jjui (TUI) makes reordering and editing stacked changes easy.

### 4.3 Stacked changes and PRs

- **One PR is one logical change.** Large work is split into small stacked changes with jj, and each becomes a PR.
- A stacked PR uses the bookmark of the change below it as its base. When the PR below is merged and its branch is deleted, GitHub retargets the PR above to main automatically.
- After the PR below is merged, rebase the rest with `jj git fetch && jj sync` and push them all again with `jj git push --tracked`. This is safe. jj only overwrites the remote if it is still in the state last fetched (like `--force-with-lease`).
- **Always do this before you merge the PR above.** A squash merge puts a new commit on main. The branch of the PR above still holds the original commits of the PR below. Until it is rebased and pushed, the PR shows those changes again or has conflicts.
- GitHub retargets the PR above only when the branch below is deleted. So keep "Automatically delete head branches" turned on (5.1).

### 4.4 Merging

- On GitHub, **Squash and merge is the only merge method**. One commit on main is one PR, which keeps the history and release notes readable.
- After a squash merge, the local change remains as a separate commit. `jj sync` removes it. Its content is already on main, so the rebased change is empty. `--skip-emptied` then drops it.

### 4.5 Parallel work and AI agents

- `jj workspace add ../figlab-ws-<task> -r 'trunk()'` adds another working copy of the same repository. When AI agents work on tasks, give each agent its own workspace.
- Changes in every workspace are visible from the main folder with `jj log` and can be reviewed with `jj diff -r <change>`. Remove a workspace with `jj workspace forget` when it is no longer needed.
- If an agent's changes go wrong, the state before its operations can be restored from `jj op log`.

### 4.6 Things to watch out for with jj

| Item | Notes |
|---|---|
| Git hooks | jj does not run them. Checks run with `mise run check` and in CI |
| Git LFS | jj does not support it. Large test data is not stored in the repository; it is generated by scripts in CI |
| Git commands | In a colocated repository, read-only commands such as `git log` work, but do not use `git commit` or `git rebase` (they get out of sync with jj). `gh` is fine |
| Version differences | Option names change between versions, so pin the version with mise (3.1) |

## 5. GitHub settings

### 5.1 Repository settings and rulesets

- Public repository. The default branch is `main`.
- Squash and merge is the only merge method. Branches are deleted automatically after merging.
- The default message for squash merging is "Pull request title and description". The PR title becomes the subject line on main, and the description becomes the body. This keeps the `Assisted-by:` line (6.1).
- Ruleset for main:
  - Changes must go through a PR
  - CI (the required jobs of the `ci` workflow) must pass
  - Force pushes and deletion are blocked
  - Linear history is required
  - Approvals (reviews) are not required, since there is a single developer
- Ruleset for tags `v*`: deletion and updates are blocked.

### 5.2 Actions (CI)

Standard runners are free for public repositories. Every workflow sets up the tools in `mise.toml` with `jdx/mise-action`. It then runs tasks with `mise run …`. So CI uses the same tool versions and the same steps as local work.

| Workflow | Trigger | Content |
|---|---|---|
| `ci.yml` | PRs, pushes to main | "CI jobs" below |
| `pages.yml` | Pushes to main | Builds the web app and the reference generated from `spec/commands.json`, and publishes them to Pages |
| `release.yml` | Publishing a Release (tag `v*`) | Builds the `figlab` command for macOS (arm64, x86_64), Linux, and Windows. Attaches the binaries to the Release with artifact attestations (build provenance) |
| `bench.yml` | Pushes to main | Measures the performance targets (spec.md Section 13) and records their trends |
| `fuzz.yml` | Weekly | Fuzzes the parser and CSV detection |
| `audit.yml` | Weekly, and PRs that change `Cargo.lock` | Checks Rust dependencies for known vulnerabilities (RustSec) with `cargo deny check advisories`. Dependabot covers npm (5.6). This is not a required check, so a new advisory does not block unrelated PRs |
| `pr-title.yml` | PRs | Checks that the PR title follows the conventions (6.1) |

CI jobs (`ci.yml`):

| Job | Content |
|---|---|
| rust | Format check, clippy (warnings are errors), unit tests |
| lang | Language conformance tests (`tests/lang`); runs the code examples in the documents (docs/) through `figlab check`; schema validation of `spec/*.json` |
| english | Fails if CJK text appears outside test fixtures (6.4) |
| deps | `mise run check:deps`: the licenses of Rust and npm dependencies are on the allow list, and crates come only from crates.io (6.6) |
| determinism | Runs the same conformance tests and acceptance figures on Linux (x86_64), macOS (arm64), and wasm (on Node). Checks that the result hashes match (spec.md Section 13, "Reproducibility") |
| numeric | Comparison with the certified values of NIST StRD |
| web | Type check, lint, unit tests, check of the initial download size limit |
| e2e | Playwright. All features in Chromium; Quick Plot and export in Firefox and WebKit. Includes graph interactions (zoom, tooltips, showing/hiding series from the legend, the view-state export dialog) |
| figures | Exports the acceptance figures and compares them with the expected SVG/PNG. On differences, diff images are kept as artifacts |

- Actions are pinned by commit hash, not by version tag. A tag can be moved to other code, but a hash cannot.

### 5.3 Pages

- The web app is published on every merge to main, at `https://<owner>.github.io/figlab/` (the Service Worker and paths are configured for this).
- The same site hosts the reference of commands, functions, and fit models generated from `spec/commands.json`. It has the same content as `help` in the app.
- The site has a page with the third-party license notices (6.6). The About dialog in the app links to it.
- Pages cannot host per-PR previews. If needed, keep the build output as an artifact or consider another host [To confirm].

### 5.4 Releases

- Versions follow Semantic Versioning (0.x for now). The storage format version (`manifest.json`) is managed separately from the app version.
- Releases are created with `gh release create v0.1.0 --target main --generate-notes`. The tag is created on GitHub, which triggers `release.yml`.
- Release notes are generated automatically, grouped by label (5.5) (`.github/release.yml`).
- Each binary archive contains `LICENSE-MIT`, `LICENSE-APACHE`, and `THIRD-PARTY-NOTICES.html` (6.6).

### 5.5 Issues, Projects, milestones, labels

- **Milestones**: match the phases in spec.md Section 14 (MVP, v1).
- **Projects**: a single board tracks Issues and PRs as "To do / In progress / In review / Done".
- **Labels**:
  - Area: `area:lang`, `area:core`, `area:io`, `area:render`, `area:web`, `area:fit`, `area:docs`, `area:ci`
  - Kind: `kind:bug`, `kind:feature`, `kind:spec` (specification changes), `kind:chore`
- **Issue templates** (Issue forms):
  - Bug: figlab version, browser, OS, commands that reproduce the problem (part of `history.figc`), files that reproduce it (only if they may be published). That commands serve directly as reproduction steps is an advantage of figlab's design
  - Feature request
  - Specification change proposal: the document and section to change, the reason, the impact
- **Discussions**: enabled for usage questions (optional).
- Open questions in the documents are tracked as Issues labeled `kind:spec`. The documents refer to them by Issue number, and an Issue is closed by the PR that updates the specification.

### 5.6 Security

- Dependabot: opens PRs for updates and security fixes of cargo, npm, and GitHub Actions dependencies.
- Code scanning (CodeQL): for JavaScript/TypeScript. Check the status of Rust support when setting it up.
- Secret scanning and push protection: enabled by default for public repositories.
- `SECURITY.md`: how to report vulnerabilities (enable Private vulnerability reporting).

### 5.7 Templates

- `.github/PULL_REQUEST_TEMPLATE.md`:
  - Related Issue
  - Whether the specification (spec.md, language.md, `spec/*.json`) changes, and if so, whether it changed in the same PR
  - Whether tests were added (including conformance tests and figure comparisons)
  - Whether `mise run check` passed
  - Screenshots if the UI changes

## 6. Conventions

### 6.1 Commit messages, PR titles, and branch names

Use Conventional Commits. PRs are squash-merged, so the PR title becomes the subject line of the commit on main (5.1).

```
<type>(<area>): <summary>

feat(lang): add for blocks
fix(io): detect Shift_JIS files without BOM
docs(spec): describe category axes
```

- Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `build`, `ci`, `chore`
- Areas: the same as the area labels (5.5)
- Written in English (6.4)
- Changes made with AI help end with an `Assisted-by:` line that names the tool (for example `Assisted-by: Claude Code`). PR descriptions end with the same line, so it stays on main after a squash merge. The rule is in AGENTS.md.
- Claude Code's own attribution and built-in git instructions are turned off in `.claude/settings.json` (`attribution.commit` and `attribution.pr` are empty, `includeGitInstructions` is `false`). This avoids two different attribution rules, and avoids git-based commit steps that conflict with jj. The file is committed, so it also applies to Claude Code sessions in the cloud.

Branch names:

One PR is one jj change (4.3). So each PR has its own branch, named after that change. In jj, the branch is a bookmark.

```
<type>/<area>-<summary>

feat/lang-for-blocks
fix/io-shift-jis-without-bom
docs/spec-category-axes
```

- `<type>` and `<area>` are the same as in the PR title. If the title has no area, the name is `<type>/<summary>`.
- `<summary>` is 2–5 words from the summary in the PR title. Leave out words that add nothing, such as "add", and words that repeat the area.
- Use only lowercase ASCII letters, digits, and `-` after the `/`. Keep the whole name under 50 characters.
- Create the bookmark yourself with `jj bookmark create <name> -r <change>`. Do not use `jj git push -c`. It makes names like `push-xxxx` that say nothing about the change.
- Keep the name while the PR is open. GitHub cannot change the branch of an open PR. Do not reuse a name after its PR is merged or closed.

### 6.2 Updating documents and tests

- A PR that changes behavior also changes the relevant documents (spec.md, language.md, `spec/*.json`) and tests in the same PR.
- Code examples in the documents are checked in CI (5.2), so CI fails if the documents and the implementation differ.

### 6.3 Architecture decision records (ADR)

Significant decisions are recorded one per file in `docs/adr/` (context, options, decision, rationale). Since the repository is public, anyone can later see why things are the way they are. The rules and a template are in `docs/adr/README.md`. The first records, from the decisions made so far:

| Number | Decision |
|---|---|
| 0001 | Computation uses a custom command language and Rust/wasm, not Python |
| 0002 | The command language has a strict syntax: each statement can be read in only one way (language.md) |
| 0003 | The storage format is a folder of JSON and .npy files, with zip to bundle it into one file |
| 0004 | The only loop is `for` over a collection of known size |
| 0005 | The name is figlab |
| 0006 | The UI language is English only |
| 0007 | Rendering and export are done in Rust (spec.md 9.1) |
| 0008 | Everything in the repository is written in plain English (6.4, 6.5) |
| 0009 | The license is MIT OR Apache-2.0 (6.6) |

### 6.4 Language of the repository

Everything in the repository is written in English:

- Documents (docs/, README, AGENTS.md, ADRs, `tests/**/README.md`)
- Code comments, rustdoc, and docstrings (TSDoc/JSDoc)
- Identifiers, test names, log messages, and user-facing strings (the UI language is English as well, spec.md Section 13)
- The descriptions in `spec/*.json` (shown as help in the app)
- Commit messages, PR titles and descriptions, Issues, review comments, and release notes

Exceptions:

- Test fixtures that must contain non-English text. Examples: Japanese files in Shift_JIS or UTF-8 for import tests (`tests/import/`), and labels with CJK characters for text rendering tests (`tests/**/fixtures/`). Explain each fixture in English in the README of its folder
- Files under `local/`, which is ignored by `.gitignore` and never committed (personal notes, etc.)

Check: `mise run check:english` (also run in CI) fails if tracked files outside the fixture folders contain CJK characters (Han, Hiragana, Katakana, Hangul). Symbols such as `√`, `χ²`, `Å`, `×`, and `…` are allowed.

### 6.5 Writing style

Write plain English: short sentences, few linking words, and common words. Technical terms are fine. This does not need to be strict. The rules are in AGENTS.md.

### 6.6 License

figlab is dual-licensed under MIT OR Apache-2.0, like most Rust projects. Users may choose either license.

- The license texts are `LICENSE-MIT` and `LICENSE-APACHE` at the root. `LICENSE-APACHE` has the official terms, unchanged. It leaves out the appendix on how to apply the license, as the Rust project does.
- The copyright line in `LICENSE-MIT` names the maintainer and "figlab contributors". The maintainer name is the same as `user.name` in jj (4.1). Contributors keep the copyright to their own work.
- `Cargo.toml` sets `license = "MIT OR Apache-2.0"` once in `[workspace.package]`, and each crate uses `license.workspace = true`. `package.json` has `"license": "MIT OR Apache-2.0"`.
- Source files do not need license headers.
- The README ends with a License section that links to both files, followed by this contribution text (the usual text in Rust projects):

  > Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in the work by you, as defined in the Apache-2.0 license, shall be dual licensed as above, without any additional terms or conditions.

  No CLA and no DCO sign-off are required.

Dependencies and bundled files:

- Allowed licenses: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, Zlib, Unicode-3.0, and OFL-1.1 (fonts only). Public domain data is also fine (e.g. NIST StRD in `tests/numeric`).
- GPL, LGPL, AGPL, and other copyleft licenses are not allowed. Adding another license to the list needs a reason, written as a comment in `deny.toml`.
- Rust: `deny.toml` holds the allow list. `cargo deny check licenses bans sources` runs in `mise run check` and in CI (5.2).
- npm: the same list is checked against `pnpm licenses list --json` in `check:deps` [To confirm: a small script or an existing tool].
- Bundled fonts (spec.md 9.2) are shipped with their own license files.
- Code copied from other projects must use an allowed license. A comment at the copied code names the source and the license.

Third-party notices:

- `cargo about generate` makes `THIRD-PARTY-NOTICES.html` from the Rust dependencies (settings in `about.toml`). The notices of npm dependencies and fonts are added to the same file at build time [To confirm: tool].
- The file is included in each Release archive (5.4) and published on Pages (5.3).

## 7. Test layout

| Kind | Location | What it checks | How to run |
|---|---|---|---|
| Unit tests | Each crate, web/src | Single functions and components | `mise run check`, CI |
| Language conformance tests | tests/lang | Grammar, semantics, error codes (language.md 10.4) | `figlab test`, CI |
| Numerical verification | tests/numeric | Correctness of built-in functions and fitting | CI |
| Import tests | tests/import | Automatic CSV detection (spec.md 10.1) | CI |
| Figure comparison | tests/figures | The acceptance figures have not changed | `mise run figures`, CI |
| Determinism tests | (uses the results above) | Bit-identical results across OS, CPU, and wasm | CI |
| End-to-end tests | web/e2e | The flow from dropping a file to exporting, differences between browsers | `mise run e2e`, CI |
| Fuzzing | fuzz/ | No crashes on malformed input | Weekly CI |
| Performance | Benchmarks in crates, web | Targets in spec.md Section 13 | Pushes to main |

- Expected figures are primarily SVG, so diffs are readable. PNGs are few and small (Git LFS is not used).
- Instrument files used in import tests are limited to files that may be published (self-made, or redistributable), with their sources and licenses listed in `tests/import/README.md`.

## 8. Working with AI agents

- **AGENTS.md** (`CLAUDE.md` only imports it) is the single place for these rules. It states:
  - Which documents to follow: `spec/*.json` and language.md are the formal definition of the language. spec.md is the specification. draft.md holds the requirements
  - The documents to read before starting work, and the commands to use (`mise run check`, `figlab check`)
  - History is manipulated with jj only; never use `git commit` and similar commands
  - One task is one jj change (stacked if needed), described as in 6.1
  - Changes and PR descriptions made with AI help end with an `Assisted-by:` line that names the tool
  - When behavior changes, the documents and tests are updated in the same change
  - Everything written to the repository is in plain English (6.4, 6.5), even when instructions are given in another language. It also lists the writing style rules
- **Workspaces**: each agent gets its own working copy with `jj workspace add` (4.5).
- **Agents on GitHub**: the Claude Code GitHub Action can start work from Issues or PRs. If it is used, only repository maintainers can start it, because anyone can comment on a public repository. The API key is kept in Actions secrets [To confirm].
- **Language verification**: commands and examples written by AI are checked with `figlab check` and the conformance tests. This is where the strict definition of the language pays off.

## 9. Specification changes found while designing this process

While designing this process, some places were found where spec.md did not fit. Both changes below have been applied.

- **Move rendering and export to Rust.** spec.md Section 4 originally placed layout, draw data, and export on the main thread in TypeScript. That would make it impossible for `figlab run` to export figures, or to verify that the browser and the command line produce the same figures. The change:
  - Layout, text measurement, draw data, and SVG/PDF/PNG export live in `figlab-render` (Rust) and run as wasm in the browser
  - Screen display (Canvas/WebGL) is drawn by TypeScript from the same draw data
  - Candidate Rust libraries (all pure Rust, and all work in wasm):
    - text shaping: rustybuzz (a Rust port of HarfBuzz)
    - font loading and subsetting: ttf-parser, subsetter
    - PDF export: krilla or pdf-writer
    - PNG export: tiny-skia
  - Making PNGs with tiny-skia instead of Canvas gives the same images in the browser and on the command line
- **Location of documents**: the documents are in `docs/`. `commands.json` and `errors.json` will be in `spec/` when they are written.

## 10. First steps

1. Create the public repository `figlab` on GitHub and push the first commit (4.1). It has the documents in `docs/`, README, the license files, SECURITY.md, AGENTS.md, CLAUDE.md, and `mise.toml`.
2. Set the merge settings and the ruleset for main (5.1). Required CI checks are added in step 4. Then add ADRs 0001–0009 as the first PR.
3. Add the remaining tasks to `mise.toml`, the Cargo workspace with empty crates, and the `web/` skeleton.
4. Set up `ci.yml` (at first only the rust, english, and web jobs), and make its jobs required checks. Also set up Dependabot, PR and Issue templates, labels, and milestones.
5. Write `spec/commands.json`, its schema, and the first conformance tests in `tests/lang`. Then start implementing `figlab-lang`.
6. Build a minimal `figlab-render` (xy lines and markers, axes, SVG) and add the first figure comparison test in `tests/figures`.
7. Publish the web app with `pages.yml`.

## 11. Open questions

| # | Question | Current answer |
|---|---|---|
| 1 | Repository owner (personal account or organization) | Personal account |
| 2 | Commit signing | SSH key, signing on push |
| 3 | Per-PR preview deployments | Not for now |
| 4 | Whether to run AI agents on GitHub | If so, only maintainers can start them |
| 6 | Moving rendering and export to Rust (Section 9) | Yes (applied to spec.md) |
