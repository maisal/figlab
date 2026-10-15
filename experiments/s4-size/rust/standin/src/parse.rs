//! Recursive-descent parser stand-in. It follows the shape of the EBNF in
//! docs/language.md Section 3, but it is not complete.

use crate::lex::{Keyword, LengthUnit, Punct, Tok, Token, lex};
use crate::{Diagnostic, Span};

/// A binary operator.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BinOp {
    /// `+`
    Add,
    /// `-`
    Sub,
    /// `*`
    Mul,
    /// `/`
    Div,
    /// `^`
    Pow,
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
    /// `and`
    And,
    /// `or`
    Or,
}

/// An expression.
#[derive(Clone, Debug, PartialEq)]
pub enum Expr {
    /// A number.
    Num(f64),
    /// A string.
    Str(String),
    /// A boolean.
    Bool(bool),
    /// A reference such as `a.b.c`.
    Ref(Vec<String>, Span),
    /// A function call.
    Call(String, Vec<(Option<String>, Expr)>, Span),
    /// An array literal.
    Array(Vec<Expr>),
    /// A unary minus.
    Neg(Box<Expr>),
    /// `not`.
    Not(Box<Expr>),
    /// A binary operation.
    Bin(BinOp, Box<Expr>, Box<Expr>),
    /// `if c then a else b`.
    If(Box<Expr>, Box<Expr>, Box<Expr>),
    /// Indexing.
    Index(Box<Expr>, Vec<Idx>),
}

/// One index inside `[...]`.
#[derive(Clone, Debug, PartialEq)]
pub enum Idx {
    /// A point index.
    At(Expr),
    /// A range of point indices.
    Range(Option<Expr>, Option<Expr>),
    /// By coordinate value.
    Coord(char, Option<Expr>, Option<Expr>, bool),
}

/// An option value.
#[derive(Clone, Debug, PartialEq)]
pub enum OptValue {
    /// An expression.
    Expr(Expr),
    /// A range.
    Range(Option<Expr>, Option<Expr>),
    /// A length in points.
    Length(f64),
    /// A color.
    Color(u32),
    /// A record.
    Record(Vec<(String, OptValue)>),
    /// A list.
    List(Vec<OptValue>),
}

/// A positional argument of a command.
#[derive(Clone, Debug, PartialEq)]
pub enum Arg {
    /// A target, possibly after `vs`.
    Target(Vec<String>, bool),
    /// A string.
    Str(String),
    /// A number.
    Num(f64),
    /// `..`.
    Parent,
    /// A computed value.
    Computed(Expr),
}

/// A statement.
#[derive(Clone, Debug, PartialEq)]
pub enum Stmt {
    /// `let a = e`.
    Let(Vec<String>, Expr),
    /// `array a = e`.
    ArrayDef(Vec<String>, Expr),
    /// An assignment.
    Assign(Expr, Option<BinOp>, Expr),
    /// An expression statement.
    Expr(Expr),
    /// A command.
    Command {
        /// The command name.
        name: String,
        /// Positional arguments.
        args: Vec<Arg>,
        /// Options.
        options: Vec<(String, OptValue, Span)>,
        /// The place of the name.
        span: Span,
    },
    /// A `for` loop.
    For(String, Expr, Vec<Stmt>),
    /// A function definition.
    Fn(String, Vec<String>, Vec<String>, Expr),
}

/// Something that knows which names are commands.
pub trait CommandNames {
    /// Whether `name` is a command.
    fn is_command(&self, name: &str) -> bool;
}

/// A fixed list of command names, used when no table is given.
pub struct DefaultCommands;

impl CommandNames for DefaultCommands {
    fn is_command(&self, name: &str) -> bool {
        matches!(
            name,
            "load"
                | "plot"
                | "fit"
                | "export"
                | "mkdir"
                | "cd"
                | "help"
                | "source"
                | "graph"
                | "axis"
                | "legend"
                | "label"
                | "page"
                | "style"
                | "delete"
                | "rename"
        )
    }
}

struct Parser<'a, C: CommandNames> {
    toks: Vec<Token>,
    pos: usize,
    diags: Vec<Diagnostic>,
    commands: &'a C,
}

/// Parses a whole command file.
pub fn parse<C: CommandNames>(src: &str, commands: &C) -> (Vec<Stmt>, Vec<Diagnostic>) {
    let (toks, mut diags) = lex(src);
    let mut p = Parser {
        toks,
        pos: 0,
        diags: Vec::new(),
        commands,
    };
    let mut out = Vec::new();
    while !p.at_eof() {
        if p.eat_newline() {
            continue;
        }
        match p.statement() {
            Some(s) => out.push(s),
            None => p.skip_line(),
        }
        if !p.eat_newline() && !p.at_eof() {
            let sp = p.span();
            p.error("E2001", "Expected the end of the statement".into(), sp);
            p.skip_line();
        }
    }
    diags.append(&mut p.diags);
    (out, diags)
}

impl<C: CommandNames> Parser<'_, C> {
    fn peek(&self) -> &Tok {
        &self.toks[self.pos].tok
    }
    fn peek2(&self) -> &Tok {
        &self.toks[(self.pos + 1).min(self.toks.len() - 1)].tok
    }
    fn span(&self) -> Span {
        self.toks[self.pos].span
    }
    fn bump(&mut self) -> Tok {
        let t = self.toks[self.pos].tok.clone();
        if self.pos + 1 < self.toks.len() {
            self.pos += 1;
        }
        t
    }
    fn at_eof(&self) -> bool {
        matches!(self.peek(), Tok::Eof)
    }
    fn eat_newline(&mut self) -> bool {
        if matches!(self.peek(), Tok::Newline) {
            self.bump();
            true
        } else {
            false
        }
    }
    fn skip_line(&mut self) {
        while !matches!(self.peek(), Tok::Newline | Tok::Eof) {
            self.bump();
        }
    }
    fn error(&mut self, code: &'static str, message: String, span: Span) {
        self.diags.push(Diagnostic::new(code, message, span));
    }
    fn eat_punct(&mut self, p: Punct) -> bool {
        if *self.peek() == Tok::Punct(p) {
            self.bump();
            true
        } else {
            false
        }
    }
    fn expect_punct(&mut self, p: Punct, what: &str) -> Option<()> {
        if self.eat_punct(p) {
            Some(())
        } else {
            let sp = self.span();
            self.error("E2003", format!("Expected {what}"), sp);
            None
        }
    }
    fn eat_kw(&mut self, k: Keyword) -> bool {
        if *self.peek() == Tok::Keyword(k) {
            self.bump();
            true
        } else {
            false
        }
    }
    fn name(&mut self) -> Option<String> {
        match self.peek().clone() {
            Tok::Name(n) => {
                self.bump();
                Some(n)
            }
            other => {
                let sp = self.span();
                self.error(
                    "E2004",
                    format!("Expected a name, found {}", describe(&other)),
                    sp,
                );
                None
            }
        }
    }
    fn reference(&mut self) -> Option<Vec<String>> {
        let mut parts = Vec::new();
        if self.eat_kw(Keyword::Root) {
            parts.push("root".to_string());
        } else {
            parts.push(self.name()?);
        }
        while *self.peek() == Tok::Punct(Punct::Dot) {
            self.bump();
            parts.push(self.name()?);
        }
        Some(parts)
    }

    fn statement(&mut self) -> Option<Stmt> {
        match self.peek().clone() {
            Tok::Keyword(Keyword::Let) => {
                self.bump();
                let r = self.reference()?;
                self.expect_punct(Punct::Assign, "`=`")?;
                Some(Stmt::Let(r, self.expr()?))
            }
            Tok::Keyword(Keyword::Array) => {
                self.bump();
                let r = self.reference()?;
                self.expect_punct(Punct::Assign, "`=`")?;
                Some(Stmt::ArrayDef(r, self.expr()?))
            }
            Tok::Keyword(Keyword::For) => self.for_stmt(),
            Tok::Keyword(Keyword::Fn) => self.fn_def(),
            Tok::Name(n) if self.commands.is_command(&n) => self.command(n),
            _ => {
                let lhs = self.expr()?;
                let op = match self.peek() {
                    Tok::Punct(Punct::Assign) => Some(None),
                    Tok::Punct(Punct::PlusAssign) => Some(Some(BinOp::Add)),
                    Tok::Punct(Punct::MinusAssign) => Some(Some(BinOp::Sub)),
                    Tok::Punct(Punct::StarAssign) => Some(Some(BinOp::Mul)),
                    Tok::Punct(Punct::SlashAssign) => Some(Some(BinOp::Div)),
                    _ => None,
                };
                match op {
                    Some(op) => {
                        let sp = self.span();
                        self.bump();
                        if !matches!(lhs, Expr::Ref(..) | Expr::Index(..)) {
                            self.error(
                                "E2002",
                                "The left side of an assignment must be a name".into(),
                                sp,
                            );
                        }
                        Some(Stmt::Assign(lhs, op, self.expr()?))
                    }
                    None => Some(Stmt::Expr(lhs)),
                }
            }
        }
    }

    fn for_stmt(&mut self) -> Option<Stmt> {
        self.bump();
        let var = self.name()?;
        if !self.eat_kw(Keyword::In) {
            let sp = self.span();
            self.error("E2005", "Expected `in`".into(), sp);
            return None;
        }
        let first = self.expr()?;
        let iter = if self.eat_punct(Punct::DotDot) {
            let last = self.expr()?;
            Expr::Call(
                "range".into(),
                vec![(None, first), (None, last)],
                Span::default(),
            )
        } else {
            first
        };
        if !self.eat_kw(Keyword::Do) {
            let sp = self.span();
            self.error("E2005", "Expected `do`".into(), sp);
            return None;
        }
        let mut body = Vec::new();
        loop {
            if self.eat_newline() {
                continue;
            }
            if self.at_eof() {
                let sp = self.span();
                self.error("E2006", "The for loop has no `end`".into(), sp);
                break;
            }
            if self.eat_kw(Keyword::End) {
                break;
            }
            match self.statement() {
                Some(s) => body.push(s),
                None => self.skip_line(),
            }
        }
        Some(Stmt::For(var, iter, body))
    }

    fn fn_def(&mut self) -> Option<Stmt> {
        self.bump();
        let name = self.name()?;
        self.expect_punct(Punct::LParen, "`(`")?;
        let mut params = vec![self.name()?];
        while self.eat_punct(Punct::Comma) {
            params.push(self.name()?);
        }
        let mut fit = Vec::new();
        if self.eat_punct(Punct::Bar) {
            fit.push(self.name()?);
            while self.eat_punct(Punct::Comma) {
                fit.push(self.name()?);
            }
        }
        self.expect_punct(Punct::RParen, "`)`")?;
        self.expect_punct(Punct::Assign, "`=`")?;
        Some(Stmt::Fn(name, params, fit, self.expr()?))
    }

    fn command(&mut self, name: String) -> Option<Stmt> {
        let span = self.span();
        self.bump();
        let mut args = Vec::new();
        let mut options = Vec::new();
        loop {
            match self.peek().clone() {
                Tok::Newline | Tok::Eof => break,
                Tok::Name(n) if *self.peek2() == Tok::Punct(Punct::Assign) => {
                    let sp = self.span();
                    self.bump();
                    self.bump();
                    let v = self.opt_value()?;
                    options.push((n, v, sp));
                }
                _ if !options.is_empty() => {
                    let sp = self.span();
                    self.error(
                        "E2007",
                        "Positional arguments cannot follow options".into(),
                        sp,
                    );
                    return None;
                }
                Tok::Keyword(Keyword::Vs) => {
                    self.bump();
                    args.push(Arg::Target(self.reference()?, true));
                }
                Tok::Name(_) | Tok::Keyword(Keyword::Root) => {
                    args.push(Arg::Target(self.reference()?, false));
                }
                Tok::Str(s) => {
                    self.bump();
                    args.push(Arg::Str(s));
                }
                Tok::Number(v) => {
                    self.bump();
                    args.push(Arg::Num(v));
                }
                Tok::Punct(Punct::Minus) => {
                    self.bump();
                    match self.bump() {
                        Tok::Number(v) => args.push(Arg::Num(-v)),
                        other => {
                            let sp = self.span();
                            self.error(
                                "E2003",
                                format!("Expected a number after `-`, found {}", describe(&other)),
                                sp,
                            );
                            return None;
                        }
                    }
                }
                Tok::Punct(Punct::DotDot) => {
                    self.bump();
                    args.push(Arg::Parent);
                }
                Tok::Punct(Punct::LParen) => {
                    self.bump();
                    let e = self.expr()?;
                    self.expect_punct(Punct::RParen, "`)`")?;
                    args.push(Arg::Computed(e));
                }
                other => {
                    let sp = self.span();
                    self.error(
                        "E2003",
                        format!("Unexpected {} in a command", describe(&other)),
                        sp,
                    );
                    return None;
                }
            }
        }
        Some(Stmt::Command {
            name,
            args,
            options,
            span,
        })
    }

    fn opt_value(&mut self) -> Option<OptValue> {
        match self.peek().clone() {
            Tok::Length(v, u) => {
                self.bump();
                Some(OptValue::Length(v * u.to_pt()))
            }
            Tok::Color(c) => {
                self.bump();
                Some(OptValue::Color(c))
            }
            Tok::Punct(Punct::LBracket) => {
                self.bump();
                let mut items = Vec::new();
                if !self.eat_punct(Punct::RBracket) {
                    loop {
                        items.push(self.opt_value()?);
                        if self.eat_punct(Punct::RBracket) {
                            break;
                        }
                        self.expect_punct(Punct::Comma, "`,` or `]`")?;
                    }
                }
                Some(OptValue::List(items))
            }
            Tok::Punct(Punct::LParen)
                if matches!(self.peek2(), Tok::Name(_))
                    && self.toks.get(self.pos + 2).map(|t| &t.tok)
                        == Some(&Tok::Punct(Punct::Assign)) =>
            {
                self.bump();
                let mut fields = Vec::new();
                loop {
                    let n = self.name()?;
                    self.expect_punct(Punct::Assign, "`=`")?;
                    fields.push((n, self.opt_value()?));
                    if self.eat_punct(Punct::RParen) {
                        break;
                    }
                    self.expect_punct(Punct::Comma, "`,` or `)`")?;
                }
                Some(OptValue::Record(fields))
            }
            Tok::Punct(Punct::DotDot) => {
                self.bump();
                let hi = self.range_end()?;
                Some(OptValue::Range(None, hi))
            }
            _ => {
                let e = self.expr()?;
                if self.eat_punct(Punct::DotDot) {
                    let hi = self.range_end()?;
                    Some(OptValue::Range(Some(e), hi))
                } else {
                    Some(OptValue::Expr(e))
                }
            }
        }
    }

    fn range_end(&mut self) -> Option<Option<Expr>> {
        let next_is_option =
            matches!(self.peek(), Tok::Name(_)) && *self.peek2() == Tok::Punct(Punct::Assign);
        if next_is_option
            || matches!(
                self.peek(),
                Tok::Newline
                    | Tok::Eof
                    | Tok::Punct(Punct::Comma | Punct::RParen | Punct::RBracket)
            )
        {
            Some(None)
        } else {
            Some(Some(self.expr()?))
        }
    }

    fn expr(&mut self) -> Option<Expr> {
        if self.eat_kw(Keyword::If) {
            let c = self.expr()?;
            if !self.eat_kw(Keyword::Then) {
                let sp = self.span();
                self.error("E2008", "Expected `then`".into(), sp);
                return None;
            }
            let a = self.expr()?;
            if !self.eat_kw(Keyword::Else) {
                let sp = self.span();
                self.error("E2008", "Expected `else`".into(), sp);
                return None;
            }
            let b = self.expr()?;
            return Some(Expr::If(Box::new(c), Box::new(a), Box::new(b)));
        }
        let first = self.not_expr()?;
        let op = match self.peek() {
            Tok::Keyword(Keyword::And) => BinOp::And,
            Tok::Keyword(Keyword::Or) => BinOp::Or,
            _ => return Some(first),
        };
        let mut acc = first;
        loop {
            let k = match self.peek() {
                Tok::Keyword(Keyword::And) => BinOp::And,
                Tok::Keyword(Keyword::Or) => BinOp::Or,
                _ => break,
            };
            if k != op {
                let sp = self.span();
                self.error(
                    "E2009",
                    "Mixing `and` and `or` needs parentheses".into(),
                    sp,
                );
                return None;
            }
            self.bump();
            let rhs = self.not_expr()?;
            acc = Expr::Bin(op, Box::new(acc), Box::new(rhs));
        }
        Some(acc)
    }

    fn not_expr(&mut self) -> Option<Expr> {
        if self.eat_kw(Keyword::Not) {
            return Some(Expr::Not(Box::new(self.not_expr()?)));
        }
        let lhs = self.add_expr()?;
        let op = match self.peek() {
            Tok::Punct(Punct::Eq) => BinOp::Eq,
            Tok::Punct(Punct::Ne) => BinOp::Ne,
            Tok::Punct(Punct::Lt) => BinOp::Lt,
            Tok::Punct(Punct::Le) => BinOp::Le,
            Tok::Punct(Punct::Gt) => BinOp::Gt,
            Tok::Punct(Punct::Ge) => BinOp::Ge,
            _ => return Some(lhs),
        };
        self.bump();
        let rhs = self.add_expr()?;
        if matches!(
            self.peek(),
            Tok::Punct(Punct::Eq | Punct::Ne | Punct::Lt | Punct::Le | Punct::Gt | Punct::Ge)
        ) {
            let sp = self.span();
            self.error("E2010", "Comparisons cannot be chained".into(), sp);
            return None;
        }
        Some(Expr::Bin(op, Box::new(lhs), Box::new(rhs)))
    }

    fn add_expr(&mut self) -> Option<Expr> {
        let mut acc = self.mul_expr()?;
        loop {
            let op = match self.peek() {
                Tok::Punct(Punct::Plus) => BinOp::Add,
                Tok::Punct(Punct::Minus) => BinOp::Sub,
                _ => return Some(acc),
            };
            self.bump();
            let rhs = self.mul_expr()?;
            acc = Expr::Bin(op, Box::new(acc), Box::new(rhs));
        }
    }

    fn mul_expr(&mut self) -> Option<Expr> {
        let mut acc = self.neg_expr()?;
        loop {
            let op = match self.peek() {
                Tok::Punct(Punct::Star) => BinOp::Mul,
                Tok::Punct(Punct::Slash) => BinOp::Div,
                _ => return Some(acc),
            };
            self.bump();
            let rhs = self.neg_expr()?;
            acc = Expr::Bin(op, Box::new(acc), Box::new(rhs));
        }
    }

    fn neg_expr(&mut self) -> Option<Expr> {
        if self.eat_punct(Punct::Minus) {
            return Some(Expr::Neg(Box::new(self.neg_expr()?)));
        }
        let base = self.postfix()?;
        if self.eat_punct(Punct::Caret) {
            let exp = self.neg_expr()?;
            return Some(Expr::Bin(BinOp::Pow, Box::new(base), Box::new(exp)));
        }
        Some(base)
    }

    fn postfix(&mut self) -> Option<Expr> {
        let p = self.primary()?;
        if *self.peek() == Tok::Punct(Punct::LBracket) {
            self.bump();
            let mut idx = Vec::new();
            loop {
                idx.push(self.index()?);
                if self.eat_punct(Punct::RBracket) {
                    break;
                }
                self.expect_punct(Punct::Comma, "`,` or `]`")?;
            }
            return Some(Expr::Index(Box::new(p), idx));
        }
        Some(p)
    }

    fn index(&mut self) -> Option<Idx> {
        if let Tok::Name(n) = self.peek().clone()
            && n.len() == 1
            && matches!(n.as_bytes()[0], b'x' | b'y' | b'z' | b't')
            && *self.peek2() == Tok::Punct(Punct::Assign)
        {
            self.bump();
            self.bump();
            let c = n.as_bytes()[0] as char;
            if self.eat_punct(Punct::DotDot) {
                let hi = self.range_end()?;
                return Some(Idx::Coord(c, None, hi, true));
            }
            let lo = self.expr()?;
            if self.eat_punct(Punct::DotDot) {
                let hi = self.range_end()?;
                return Some(Idx::Coord(c, Some(lo), hi, true));
            }
            return Some(Idx::Coord(c, Some(lo), None, false));
        }
        if self.eat_punct(Punct::DotDot) {
            return Some(Idx::Range(None, self.range_end()?));
        }
        let lo = self.expr()?;
        if self.eat_punct(Punct::DotDot) {
            return Some(Idx::Range(Some(lo), self.range_end()?));
        }
        Some(Idx::At(lo))
    }

    fn primary(&mut self) -> Option<Expr> {
        let sp = self.span();
        match self.peek().clone() {
            Tok::Number(v) => {
                self.bump();
                Some(Expr::Num(v))
            }
            Tok::Str(s) => {
                self.bump();
                Some(Expr::Str(s))
            }
            Tok::Keyword(Keyword::True) => {
                self.bump();
                Some(Expr::Bool(true))
            }
            Tok::Keyword(Keyword::False) => {
                self.bump();
                Some(Expr::Bool(false))
            }
            Tok::Keyword(Keyword::Nan) => {
                self.bump();
                Some(Expr::Num(f64::NAN))
            }
            Tok::Keyword(Keyword::Inf) => {
                self.bump();
                Some(Expr::Num(f64::INFINITY))
            }
            Tok::Keyword(Keyword::Pi) => {
                self.bump();
                Some(Expr::Num(core::f64::consts::PI))
            }
            Tok::Punct(Punct::LParen) => {
                self.bump();
                let e = self.expr()?;
                self.expect_punct(Punct::RParen, "`)`")?;
                Some(e)
            }
            Tok::Punct(Punct::LBracket) => {
                self.bump();
                let mut items = vec![self.expr()?];
                while self.eat_punct(Punct::Comma) {
                    items.push(self.expr()?);
                }
                self.expect_punct(Punct::RBracket, "`]`")?;
                Some(Expr::Array(items))
            }
            Tok::Name(n) if *self.peek2() == Tok::Punct(Punct::LParen) => {
                self.bump();
                self.bump();
                let mut args = Vec::new();
                if !self.eat_punct(Punct::RParen) {
                    loop {
                        let named = match (self.peek().clone(), self.peek2()) {
                            (Tok::Name(k), Tok::Punct(Punct::Assign)) => {
                                self.bump();
                                self.bump();
                                Some(k)
                            }
                            _ => None,
                        };
                        args.push((named, self.expr()?));
                        if self.eat_punct(Punct::RParen) {
                            break;
                        }
                        self.expect_punct(Punct::Comma, "`,` or `)`")?;
                    }
                }
                Some(Expr::Call(n, args, sp))
            }
            Tok::Name(_) | Tok::Keyword(Keyword::Root) => Some(Expr::Ref(self.reference()?, sp)),
            Tok::Length(v, LengthUnit::Pt) => {
                self.bump();
                Some(Expr::Num(v))
            }
            other => {
                self.error(
                    "E2003",
                    format!("Expected a value, found {}", describe(&other)),
                    sp,
                );
                None
            }
        }
    }
}

/// A short description of a token for error messages.
pub fn describe(t: &Tok) -> String {
    match t {
        Tok::Name(n) => format!("the name `{n}`"),
        Tok::Number(v) => format!("the number {v}"),
        Tok::Length(v, _) => format!("the length {v}"),
        Tok::Str(_) => "a string".into(),
        Tok::Color(_) => "a color".into(),
        Tok::Keyword(k) => format!("the word `{}`", format!("{k:?}").to_lowercase()),
        Tok::Punct(p) => format!("`{p:?}`"),
        Tok::Newline => "the end of the line".into(),
        Tok::Eof => "the end of the input".into(),
    }
}
