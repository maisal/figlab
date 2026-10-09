# 0003. Store projects as a folder of JSON and .npy files, with zip to bundle them

- Status: Accepted
- Date: 2026-10-09

## Context

The draft asks for "something like the Excel file format" (draft.md, Decision 4).
It also asks for:

- projects of up to 10 GB on disk
- formats that other tools and AI can read, not a proprietary binary format

Saving is done in Chrome and Edge with the File System Access API.

## Options

1. Always a single zip file, like `.xlsx`
2. A folder, with numeric data as CSV
3. A folder, with numeric data as `.npy`
4. A folder, with numeric data as Parquet

## Decision

- While working, a project is a folder (`*.figlab`). The layout is in spec.md 11.1.
- Structure and metadata are JSON. User functions and the history are plain text.
- Numeric data is `.npy`. String arrays are JSON.
- To make one file for sharing or archiving, the same contents are exported as an uncompressed zip (`.figz`).
  Opening a `.figz` extracts it into a folder.

## Reasons

- With a single zip file, every save rewrites the whole file. That is too slow for 10 GB.
  With a folder, a save writes only the files that changed.
- `.npy` keeps exact values. It has the type and shape as text at the start. Many tools can read it.
- CSV loses precision and is much larger than binary data.
- Parquet needs a larger library to write, and is not needed for plain numeric arrays.
- JSON and plain text can be read by people and AI, and can be diffed with jj or git.

## Consequences

- Saving needs the File System Access API, so it works only in Chrome and Edge.
  Quick Plot still works in other browsers, because it needs no project.
- The format version is stored in `manifest.json`. Older projects are converted when opened.
- Reading and writing `.figz` is planned for v1 (spec.md Section 14).
