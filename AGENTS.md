# AGENTS.md

Rules for AI agents (and people) working in this repository.

## Project

figlab is a browser app (SPA) for quick plots of measurement data and for publication figures.
The core is written in Rust (built to wasm and to a native CLI). The UI is TypeScript.

## Documents

Read these before you start. If they disagree, follow them in this order:

1. `spec/*.json` and `docs/language.md`: the formal definition of the command language
2. `docs/spec.md`: the specification
3. `docs/draft.md`: the requirements
4. `docs/development.md`: how we work (layout, tools, jj, GitHub, tests)

## Commands

- `mise run check`: run all checks. It must pass before you push.
- `figlab check <file>`: check command files (once the CLI exists).

## Version control

- Use jj for all history operations. Do not use `git commit`, `git rebase`, or similar commands.
- One task is one jj change. Stack several changes if needed.
- Describe changes in Conventional Commits form, for example `feat(lang): add for blocks`.
- If you change behavior, update the documents and the tests in the same change.

## Dependencies and licenses

- figlab is licensed under MIT OR Apache-2.0. Do not edit the license files.
- Add a dependency only if its license is on the allow list in `docs/development.md` 6.6. `mise run check` checks this.
- Do not copy code from other projects unless its license is on that list. If you copy code, add a comment with the source and the license.

## AI attribution

- End each change description with an `Assisted-by:` line. Name the tool you run in, not the model. Examples: `Assisted-by: Claude Code`, `Assisted-by: Codex CLI`.
- Add the same line at the end of PR descriptions you write. PRs are squash-merged, and the PR description keeps the line on main.
- Do not add the line if a person wrote the change without AI help.

## Language

- Write everything in the repository in English: documents, comments, rustdoc, docstrings, messages, commit messages, and PR text.
- Do this even when you get instructions in another language.

## Writing style

Write plain English. This does not need to be strict.

- Keep sentences short. One idea per sentence.
- Do not chain many clauses with "and", "but", "so", or "which". Split them, or use a list.
- Use common words. Technical terms are fine without explanation.
- Do not use formal words when a simple word works. For example, write "use" not "utilize", "before" not "prior to", "start" not "invoke", and "current" not "tentative".
