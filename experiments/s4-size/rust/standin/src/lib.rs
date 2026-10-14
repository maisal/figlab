//! Stand-ins for figlab's own code.
//!
//! These modules are not figlab. They are rough copies of the kind of code
//! figlab will have, so that the wasm modules of S4 contain some code of
//! their own next to the libraries. The README explains how their size is
//! scaled to an allowance for the real code.

pub mod check;
pub mod detect;
pub mod eval;
pub mod layout;
pub mod lex;
pub mod parse;
pub mod svg;

/// A position in the source text, in bytes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct Span {
    /// Start, inclusive.
    pub start: u32,
    /// End, exclusive.
    pub end: u32,
}

/// A problem found in the source text.
#[derive(Clone, Debug, PartialEq)]
pub struct Diagnostic {
    /// The error code, such as `E1001`.
    pub code: &'static str,
    /// The message shown to the user.
    pub message: String,
    /// Where the problem is.
    pub span: Span,
}

impl Diagnostic {
    /// Makes a diagnostic.
    pub fn new(code: &'static str, message: String, span: Span) -> Self {
        Diagnostic {
            code,
            message,
            span,
        }
    }
}
