# Import tests

Files for the tests of automatic detection on import (docs/spec.md 10.1).
The import test runner comes with the import code (roadmap.md M3).
Until then, `mise run check:lang` checks that the expected results are well formed.

## Source and license

All files here are synthetic. `generate_files.py` makes them with the Python 3 standard library and a fixed random seed.
They imitate the layouts that measurement instruments commonly write, but they contain no real measurement data.
They are part of figlab and use its license (MIT OR Apache-2.0).

Real instrument files may be added later, but only if they may be published.
List each one in the table below with its source and its license (docs/development.md Section 7).

Some files contain non-English text on purpose (for example Japanese column names in Shift_JIS).
This folder is excluded from `check:english` (docs/development.md 6.4).

## Files

Each data file has a `<file>.expected.json` file in the format of `expected.schema.json`.
It lists what detection must find (docs/spec.md 10.1), using the words of the `load` options (`sep=comma`, `header=2`, and so on). `bom` is not an option, because a byte order mark is always skipped. Each column also has the number of its missing values.

| File | What it tests | Source |
|---|---|---|
| `simple.csv` | Comma-separated, UTF-8, one header row | Synthetic |
| `metadata_units.csv` | Metadata lines before the table, a unit row, and a column label that is not a valid name (`2theta`) | Synthetic |
| `tab_units.txt` | Tab-separated, with a unit row | Synthetic |
| `shift_jis.csv` | Shift_JIS, Japanese column labels, a unit row | Synthetic |
| `utf8_bom.csv` | UTF-8 with a byte order mark | Synthetic |
| `semicolon_decimal_comma.csv` | Semicolons, decimal commas, a non-ASCII column label | Synthetic |
| `whitespace_aligned.dat` | Columns aligned with spaces, `#` comment lines | Synthetic |
| `percent_comment_no_header.txt` | `%` comment lines, no header row | Synthetic |
| `missing_values.csv` | Missing values: an empty field, `NaN`, `NA`, `-` | Synthetic |
| `crlf.csv` | CRLF line endings | Synthetic |
| `datetime.csv` | A date-time column (ISO 8601) | Synthetic |
| `categories.csv` | A string column with repeated categories | Synthetic |
| `scientific_semicolon_comment.txt` | E notation, leading spaces, `;` comment lines, no header row | Synthetic |

## Column labels and array names

The expected results list the column labels as they appear in the file.
How a label that is not a valid name (such as `2theta`, or a Japanese label) becomes an array name is an open question (docs/spec.md Section 15). So is the naming of the columns of a file without a header row.

## Byte-exact files

`.gitattributes` marks everything in this folder as `-text`, so Git never changes the bytes (CRLF, Shift_JIS, the byte order mark).
Change the files by changing `generate_files.py` and running it:

```sh
python3 tests/import/generate_files.py
```
