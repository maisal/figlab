//! Lexer stand-in for the command language.

use crate::{Diagnostic, Span};

/// The kind of a token.
#[derive(Clone, Debug, PartialEq)]
pub enum Tok {
    /// A name such as `energy`.
    Name(String),
    /// A number literal.
    Number(f64),
    /// A length literal such as `60mm`.
    Length(f64, LengthUnit),
    /// A string literal, without quotes.
    Str(String),
    /// A color literal such as `#ff0000`.
    Color(u32),
    /// A reserved word.
    Keyword(Keyword),
    /// An operator or punctuation.
    Punct(Punct),
    /// The end of a logical line.
    Newline,
    /// The end of the input.
    Eof,
}

/// Units of length literals.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LengthUnit {
    /// Millimeters.
    Mm,
    /// Centimeters.
    Cm,
    /// Inches.
    In,
    /// Points.
    Pt,
}

impl LengthUnit {
    /// The size of one unit in points.
    pub fn to_pt(self) -> f64 {
        match self {
            LengthUnit::Mm => 72.0 / 25.4,
            LengthUnit::Cm => 72.0 / 2.54,
            LengthUnit::In => 72.0,
            LengthUnit::Pt => 1.0,
        }
    }
}

/// Reserved words.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Keyword {
    /// `let`
    Let,
    /// `array`
    Array,
    /// `for`
    For,
    /// `in`
    In,
    /// `do`
    Do,
    /// `end`
    End,
    /// `fn`
    Fn,
    /// `if`
    If,
    /// `then`
    Then,
    /// `else`
    Else,
    /// `and`
    And,
    /// `or`
    Or,
    /// `not`
    Not,
    /// `true`
    True,
    /// `false`
    False,
    /// `nan`
    Nan,
    /// `inf`
    Inf,
    /// `pi`
    Pi,
    /// `root`
    Root,
    /// `vs`
    Vs,
}

/// Operators and punctuation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Punct {
    /// `+`
    Plus,
    /// `-`
    Minus,
    /// `*`
    Star,
    /// `/`
    Slash,
    /// `^`
    Caret,
    /// `=`
    Assign,
    /// `+=`
    PlusAssign,
    /// `-=`
    MinusAssign,
    /// `*=`
    StarAssign,
    /// `/=`
    SlashAssign,
    /// `==`
    Eq,
    /// `!=`
    Ne,
    /// `<`
    Lt,
    /// `<=`
    Le,
    /// `>`
    Gt,
    /// `>=`
    Ge,
    /// `(`
    LParen,
    /// `)`
    RParen,
    /// `[`
    LBracket,
    /// `]`
    RBracket,
    /// `,`
    Comma,
    /// `.`
    Dot,
    /// `..`
    DotDot,
    /// `|`
    Bar,
}

/// A token with its place in the source.
#[derive(Clone, Debug, PartialEq)]
pub struct Token {
    /// The kind.
    pub tok: Tok,
    /// The place.
    pub span: Span,
}

fn keyword(s: &str) -> Option<Keyword> {
    Some(match s {
        "let" => Keyword::Let,
        "array" => Keyword::Array,
        "for" => Keyword::For,
        "in" => Keyword::In,
        "do" => Keyword::Do,
        "end" => Keyword::End,
        "fn" => Keyword::Fn,
        "if" => Keyword::If,
        "then" => Keyword::Then,
        "else" => Keyword::Else,
        "and" => Keyword::And,
        "or" => Keyword::Or,
        "not" => Keyword::Not,
        "true" => Keyword::True,
        "false" => Keyword::False,
        "nan" => Keyword::Nan,
        "inf" => Keyword::Inf,
        "pi" => Keyword::Pi,
        "root" => Keyword::Root,
        "vs" => Keyword::Vs,
        _ => return None,
    })
}

/// Splits the source into tokens. Lines that end inside brackets are joined.
pub fn lex(src: &str) -> (Vec<Token>, Vec<Diagnostic>) {
    let bytes = src.as_bytes();
    let mut out = Vec::new();
    let mut diags = Vec::new();
    let mut i = 0usize;
    let mut depth = 0i32;
    while i < bytes.len() {
        let c = bytes[i];
        let start = i;
        let span = |e: usize| Span {
            start: start as u32,
            end: e as u32,
        };
        match c {
            b' ' | b'\t' | b'\r' => i += 1,
            b'\\' if bytes.get(i + 1) == Some(&b'\n') => i += 2,
            b'\n' => {
                i += 1;
                if depth == 0
                    && !matches!(
                        out.last(),
                        Some(Token {
                            tok: Tok::Newline,
                            ..
                        }) | None
                    )
                {
                    out.push(Token {
                        tok: Tok::Newline,
                        span: span(i),
                    });
                }
            }
            b'#' if i + 1 < bytes.len() && bytes[i + 1].is_ascii_hexdigit() && depth >= 0 => {
                let mut j = i + 1;
                while j < bytes.len() && bytes[j].is_ascii_hexdigit() {
                    j += 1;
                }
                let hex = &src[i + 1..j];
                if hex.len() == 6 {
                    let v = u32::from_str_radix(hex, 16).unwrap_or(0);
                    out.push(Token {
                        tok: Tok::Color(v),
                        span: span(j),
                    });
                } else {
                    diags.push(Diagnostic::new(
                        "E1003",
                        format!("A color needs 6 hex digits, not {}", hex.len()),
                        span(j),
                    ));
                }
                i = j;
            }
            b'#' => {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            b'"' => {
                let mut j = i + 1;
                let mut s = String::new();
                let mut closed = false;
                while j < bytes.len() {
                    match bytes[j] {
                        b'"' => {
                            closed = true;
                            j += 1;
                            break;
                        }
                        b'\\' if j + 1 < bytes.len() => {
                            let e = bytes[j + 1];
                            s.push(match e {
                                b'n' => '\n',
                                b't' => '\t',
                                b'"' => '"',
                                b'\\' => '\\',
                                _ => {
                                    diags.push(Diagnostic::new(
                                        "E1004",
                                        format!("Unknown escape \\{}", e as char),
                                        span(j + 2),
                                    ));
                                    '?'
                                }
                            });
                            j += 2;
                        }
                        b'\n' => break,
                        _ => {
                            let ch = src[j..].chars().next().unwrap_or('?');
                            s.push(ch);
                            j += ch.len_utf8();
                        }
                    }
                }
                if !closed {
                    diags.push(Diagnostic::new(
                        "E1002",
                        "The string is not closed".into(),
                        span(j),
                    ));
                }
                out.push(Token {
                    tok: Tok::Str(s),
                    span: span(j),
                });
                i = j;
            }
            b'0'..=b'9' => {
                let mut j = i;
                while j < bytes.len() && (bytes[j].is_ascii_digit() || bytes[j] == b'_') {
                    j += 1;
                }
                if j + 1 < bytes.len() && bytes[j] == b'.' && bytes[j + 1].is_ascii_digit() {
                    j += 1;
                    while j < bytes.len() && bytes[j].is_ascii_digit() {
                        j += 1;
                    }
                }
                if j < bytes.len() && (bytes[j] == b'e' || bytes[j] == b'E') {
                    let mut k = j + 1;
                    if k < bytes.len() && (bytes[k] == b'+' || bytes[k] == b'-') {
                        k += 1;
                    }
                    if k < bytes.len() && bytes[k].is_ascii_digit() {
                        j = k;
                        while j < bytes.len() && bytes[j].is_ascii_digit() {
                            j += 1;
                        }
                    }
                }
                let text: String = src[i..j].chars().filter(|&c| c != '_').collect();
                let v = parse_number(&text);
                let mut k = j;
                while k < bytes.len() && bytes[k].is_ascii_alphabetic() {
                    k += 1;
                }
                let unit = match &src[j..k] {
                    "" => None,
                    "mm" => Some(LengthUnit::Mm),
                    "cm" => Some(LengthUnit::Cm),
                    "in" => Some(LengthUnit::In),
                    "pt" => Some(LengthUnit::Pt),
                    other => {
                        diags.push(Diagnostic::new(
                            "E1005",
                            format!("Unknown unit `{other}`. Use mm, cm, in, or pt"),
                            span(k),
                        ));
                        None
                    }
                };
                out.push(Token {
                    tok: match unit {
                        Some(u) => Tok::Length(v, u),
                        None => Tok::Number(v),
                    },
                    span: span(k),
                });
                i = k;
            }
            b'a'..=b'z' | b'A'..=b'Z' | b'_' => {
                let mut j = i;
                while j < bytes.len() && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'_') {
                    j += 1;
                }
                let word = &src[i..j];
                out.push(Token {
                    tok: match keyword(word) {
                        Some(k) => Tok::Keyword(k),
                        None => Tok::Name(word.to_string()),
                    },
                    span: span(j),
                });
                i = j;
            }
            _ => {
                let two = if i + 1 < bytes.len() { bytes[i + 1] } else { 0 };
                let (p, n) = match (c, two) {
                    (b'+', b'=') => (Punct::PlusAssign, 2),
                    (b'-', b'=') => (Punct::MinusAssign, 2),
                    (b'*', b'=') => (Punct::StarAssign, 2),
                    (b'/', b'=') => (Punct::SlashAssign, 2),
                    (b'=', b'=') => (Punct::Eq, 2),
                    (b'!', b'=') => (Punct::Ne, 2),
                    (b'<', b'=') => (Punct::Le, 2),
                    (b'>', b'=') => (Punct::Ge, 2),
                    (b'.', b'.') => (Punct::DotDot, 2),
                    (b'+', _) => (Punct::Plus, 1),
                    (b'-', _) => (Punct::Minus, 1),
                    (b'*', _) => (Punct::Star, 1),
                    (b'/', _) => (Punct::Slash, 1),
                    (b'^', _) => (Punct::Caret, 1),
                    (b'=', _) => (Punct::Assign, 1),
                    (b'<', _) => (Punct::Lt, 1),
                    (b'>', _) => (Punct::Gt, 1),
                    (b'(', _) => (Punct::LParen, 1),
                    (b')', _) => (Punct::RParen, 1),
                    (b'[', _) => (Punct::LBracket, 1),
                    (b']', _) => (Punct::RBracket, 1),
                    (b',', _) => (Punct::Comma, 1),
                    (b'.', _) => (Punct::Dot, 1),
                    (b'|', _) => (Punct::Bar, 1),
                    _ => {
                        let ch = src[i..].chars().next().unwrap_or('?');
                        diags.push(Diagnostic::new(
                            "E1001",
                            format!("Unexpected character `{ch}`"),
                            span(i + ch.len_utf8()),
                        ));
                        i += ch.len_utf8();
                        continue;
                    }
                };
                match p {
                    Punct::LParen | Punct::LBracket => depth += 1,
                    Punct::RParen | Punct::RBracket => depth -= 1,
                    _ => {}
                }
                out.push(Token {
                    tok: Tok::Punct(p),
                    span: span(i + n),
                });
                i += n;
            }
        }
    }
    if depth > 0 {
        diags.push(Diagnostic::new(
            "E1006",
            format!("{depth} bracket(s) are not closed"),
            Span {
                start: src.len() as u32,
                end: src.len() as u32,
            },
        ));
    }
    let end = Span {
        start: src.len() as u32,
        end: src.len() as u32,
    };
    if !matches!(
        out.last(),
        Some(Token {
            tok: Tok::Newline,
            ..
        }) | None
    ) {
        out.push(Token {
            tok: Tok::Newline,
            span: end,
        });
    }
    out.push(Token {
        tok: Tok::Eof,
        span: end,
    });
    (out, diags)
}

/// Reads a decimal number. This is a small stand-in for a correct parser.
pub fn parse_number(s: &str) -> f64 {
    let (mant, exp) = match s.find(['e', 'E']) {
        Some(p) => (&s[..p], s[p + 1..].parse::<i32>().unwrap_or(0)),
        None => (s, 0),
    };
    let mut v = 0.0f64;
    let mut scale = 0i32;
    let mut after_point = false;
    for b in mant.bytes() {
        if b == b'.' {
            after_point = true;
            continue;
        }
        v = v * 10.0 + f64::from(b - b'0');
        if after_point {
            scale -= 1;
        }
    }
    v * libm::pow(10.0, f64::from(scale + exp))
}
