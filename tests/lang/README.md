# Language conformance tests

These tests define how an implementation of the figlab command language must behave (docs/language.md 10.4).
`figlab test tests/lang` runs them once the `figlab` command exists.
Until then, `mise run check:lang` checks that the files are well formed: the format, the folder rules below, known error codes, and lines that exist.

## Files

Each test is a source file and its expected result:

- `<name>.figc` (command file) or `<name>.figf` (function file)
- `<name>.expected.json`, in the format of `expected.schema.json`

```json
{
  "doc": "A tab at the start of a line.",
  "mode": "parse",
  "errors": [{ "code": "E1002", "line": 2, "column": 1 }]
}
```

- `mode` says how far the file is processed:
  - `parse`: lexing and parsing only (language.md Sections 2 and 3). Only E1xxx and E2xxx errors can occur. Names are not looked up, so undefined names are fine. Command names come from `spec/commands.json`.
  - `check`: also names and types, without running (E1xxx to E4xxx).
  - `run`: the file runs. Expected values are added to the format when the first run tests are written.
- `errors` lists every error that the file must report, in order. An empty list means the file must be accepted with no errors.
- Only the code and the position are compared. Messages may change.
- Positions follow language.md 8: lines and columns start at 1, and columns count code points. `at` in `spec/errors.json` says where each E1xxx and E2xxx error points.

## Folders

| Folder | Content |
|---|---|
| `syntax/accept/` | Files that must parse with no errors |
| `syntax/reject/` | Files with exactly one error each, so that the tests do not depend on how a parser recovers after an error |

## Byte-exact files

Some files test line endings, a byte order mark, or invalid UTF-8.
`.gitattributes` marks everything in this folder as `-text`, so Git never changes the bytes.
Edit these files with a script, not with an editor that may change line endings.

## Adding a test

1. Write the source file and its `.expected.json` file.
2. If the test is about a rule that language.md does not state clearly, make the rule clear in language.md in the same change.
3. Run `mise run check:lang`.
