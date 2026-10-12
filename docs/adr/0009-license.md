# 0009. License figlab under MIT OR Apache-2.0

- Status: Accepted
- Date: 2026-10-09

## Context

The repository is public and needs a license.
figlab depends on many Rust crates and npm packages, and it bundles fonts.

## Options

1. MIT only
2. Apache-2.0 only
3. MIT OR Apache-2.0 (the user chooses)
4. A copyleft license such as GPL

## Decision

Option 3 (development.md 6.6).

- The license texts are `LICENSE-MIT` and `LICENSE-APACHE`.
- Contributions are dual licensed in the same way. No CLA and no DCO sign-off are required.
- Dependencies must use a license on the allow list in development.md 6.6. Copyleft licenses are not allowed.

## Reasons

- It is the usual license of Rust projects, so it fits the ecosystem we depend on.
- Apache-2.0 includes an explicit patent grant.
- MIT is short and is compatible with GPLv2 projects, which Apache-2.0 is not.
- A permissive license lets anyone use figlab and the `figlab` command without restrictions.

## Consequences

- Every new dependency must have an allowed license. `mise run check:deps` checks this (cargo-deny for Rust).
- Third-party notices are generated and shipped with releases and on Pages.
- Code from other projects can be copied only if its license is on the allow list.
