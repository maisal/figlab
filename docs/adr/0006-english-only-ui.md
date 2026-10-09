# 0006. Use English as the only UI language

- Status: Accepted
- Date: 2026-10-09

## Context

The app shows menus, dialogs, error messages, help, and completion descriptions.
The command language uses English words for commands and options.
We had to choose the language of the UI.

## Options

1. Japanese only
2. English and Japanese, with a localization mechanism
3. English only

## Decision

Option 3 (spec.md Section 13).

- Menus, buttons, dialogs, error messages, warnings, help, completion descriptions, and the output of the `figlab` command are all in English.
- There is no localization mechanism and no translation files.
- User content may be in any language. This covers labels, `///` comments, and strings other than names.

## Reasons

- Command names and options are English words already. A UI in the same language is consistent.
- Help text comes from `spec/commands.json`. One language keeps it in one place, with no translations to keep in sync.
- Most scientific publishing is in English.
- The repository is public and open to contributors who do not read Japanese.

## Consequences

- Users who prefer Japanese must read an English UI.
- Text in labels must still render correctly in any script, including CJK. Fonts and rendering tests must cover this.
