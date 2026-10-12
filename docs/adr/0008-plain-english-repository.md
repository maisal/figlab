# 0008. Write everything in the repository in plain English

- Status: Accepted
- Date: 2026-10-09

## Context

The repository is public.
People and AI agents both write documents, code, and commit messages.
Instructions to agents are sometimes given in Japanese.

## Options

1. Japanese
2. Both English and Japanese
3. English only, in a plain style

## Decision

Option 3 (development.md 6.4, 6.5).

- Documents, comments, rustdoc, docstrings, messages, commit messages, Issues, and PR text are in English.
- This holds even when instructions are given in another language.
- Exceptions: test fixtures that need non-English text, and files under `local/`, which are not tracked.
- `mise run check:english` fails if CJK text appears outside these exceptions.
- The style is plain: short sentences, few linking words, common words. The rules are in AGENTS.md.

## Reasons

- Anyone can read and contribute, whatever their first language.
- One language means no translations that drift apart.
- Plain English is easier for readers whose first language is not English. It also translates well by machine.
- The UI is English only (0006), so the code and the UI use the same words.

## Consequences

- Japanese reference copies of the documents may be kept under `local/`. They are personal and are not kept in sync.
- Writing takes a little more effort for authors whose first language is not English.
