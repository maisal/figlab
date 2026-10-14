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

`docs/roadmap.md` says in which order the work is done. It does not change what to build.

## Commands

- `mise run check`: run all checks. It must pass before you push.
- `figlab check <file>`: check command files (once the CLI exists).

## Version control

- Use jj for all history operations. Do not use `git commit`, `git rebase`, or similar commands.
- One task is one jj change. Stack several changes if needed.
- Describe changes in Conventional Commits form, for example `feat(lang): add for blocks`.
- Name the branch (jj bookmark) of each PR as in `docs/development.md` 6.1, for example `feat/lang-for-blocks`. Do not use `jj git push -c`.
- If you change behavior, update the documents and the tests in the same change.
- Merge a PR only when every CI check passes, including checks that are not required.

## Subagents

Claude Code subagents are defined in `.claude/agents/`. Pick one by the kind of task. Each file sets its own model and effort.

| Kind of task | Agent |
|---|---|
| Typos, links, and wording that keep the meaning | `doc-proofreader` |
| Document updates checked against the code and the contracts | `doc-sync` |
| Local implementation or tests, with fixed conditions and scope | `implementer-local` |
| Normal implementation that follows the adopted contracts | `implementer` |
| Hard implementation across workers, state transitions, stopping and restarting, or ownership of data | `implementer-hard` |
| Review | `reviewer` and `critic` (see "Review") |

- The contracts are the documents listed in "Documents" and the accepted ADRs in `docs/adr/`.
- Give each subagent its goal, the files it owns, the scope it may change, and its done condition.
- Subagents do not push and do not open PRs. The agent that started them does.
- Subagents that write files at the same time each get their own jj workspace (`docs/development.md` 4.5).

## Review

Review changes to code, tests, `spec/`, or `docs/language.md` before you open the PR. Small document fixes do not need it.

1. Fix the target. Pick the jj revisions to review and note their commit IDs. Do not change them during the review.
2. The Reviewer (`reviewer`) reads the diff and writes provisional findings with evidence.
3. The Critic (`critic`) checks each finding on its own. It also looks for problems the Reviewer missed.
4. The Reviewer reads the Critic's results. It keeps, revises, or withdraws each finding.
5. Fix the findings that are kept. If you do not fix one, say why in the PR description.

The Reviewer and the Critic do not change files. Look at these points:

- The change follows the documents in "Documents". The language matches `spec/*.json` and `docs/language.md`.
- Boundary values, malformed input, and error codes.
- Results are the same on native and wasm builds. Computing crates do not use the standard float functions (`docs/roadmap.md` M0).
- Tests and documents change in the same change as the behavior.
- New dependencies have allowed licenses.
- Text follows "Language" and "Writing style".

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
