//! Checker stand-in: names, options, and argument counts.

use crate::parse::{Arg, CommandNames, Expr, OptValue, Stmt, parse};
use crate::{Diagnostic, Span};
use std::collections::BTreeSet;

/// The type of an option, as in `commands.json`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OptType {
    /// A boolean.
    Bool,
    /// A number.
    Number,
    /// A length.
    Length,
    /// A color.
    Color,
    /// One word from a fixed list.
    Enum,
    /// An array name.
    Array,
    /// Anything else.
    Other,
}

/// The facts the checker needs about commands and functions.
pub trait Table: CommandNames {
    /// The options of a command, or `None` if the command is unknown.
    fn options(&self, command: &str) -> Option<Vec<(&str, OptType)>>;
    /// The allowed words of an enum option.
    fn enum_values(&self, command: &str, option: &str) -> Vec<&str>;
    /// The number of positional arguments (min, max) of a command.
    fn arg_count(&self, command: &str) -> (usize, usize);
    /// Whether `name` is a built-in function.
    fn is_function(&self, name: &str) -> bool;
    /// The documentation text of an entry.
    fn doc(&self, name: &str) -> Option<&str>;
}

/// Checks a command file and returns its problems.
pub fn check<T: Table>(src: &str, table: &T, known: &BTreeSet<String>) -> Vec<Diagnostic> {
    let (stmts, mut diags) = parse(src, table);
    let mut defined = known.clone();
    for s in &stmts {
        check_stmt(s, table, &mut defined, &mut diags);
    }
    diags
}

fn check_stmt<T: Table>(
    s: &Stmt,
    table: &T,
    defined: &mut BTreeSet<String>,
    diags: &mut Vec<Diagnostic>,
) {
    match s {
        Stmt::Let(r, e) | Stmt::ArrayDef(r, e) => {
            check_expr(e, table, defined, diags);
            let name = r.join(".");
            if defined.contains(&name) {
                diags.push(Diagnostic::new(
                    "E3002",
                    format!("`{name}` already exists. Use `=` to change it"),
                    Span::default(),
                ));
            }
            defined.insert(name);
        }
        Stmt::Assign(l, _, r) => {
            check_expr(l, table, defined, diags);
            check_expr(r, table, defined, diags);
        }
        Stmt::Expr(e) => check_expr(e, table, defined, diags),
        Stmt::For(v, it, body) => {
            check_expr(it, table, defined, diags);
            let added = defined.insert(v.clone());
            for b in body {
                check_stmt(b, table, defined, diags);
            }
            if added {
                defined.remove(v);
            }
        }
        Stmt::Fn(_, params, fit, body) => {
            let mut inner = defined.clone();
            inner.extend(params.iter().cloned());
            inner.extend(fit.iter().cloned());
            check_expr(body, table, &inner, diags);
        }
        Stmt::Command {
            name,
            args,
            options,
            span,
        } => {
            let Some(opts) = table.options(name) else {
                diags.push(Diagnostic::new(
                    "E3001",
                    format!("Unknown command `{name}`"),
                    *span,
                ));
                return;
            };
            let (lo, hi) = table.arg_count(name);
            if args.len() < lo || args.len() > hi {
                diags.push(Diagnostic::new(
                    "E3003",
                    format!(
                        "`{name}` takes {lo} to {hi} arguments, but {} were given",
                        args.len()
                    ),
                    *span,
                ));
            }
            for a in args {
                if let Arg::Computed(e) = a {
                    check_expr(e, table, defined, diags);
                }
            }
            let mut seen = BTreeSet::new();
            for (oname, value, ospan) in options {
                if !seen.insert(oname.as_str()) {
                    diags.push(Diagnostic::new(
                        "E3004",
                        format!("The option `{oname}` is given twice"),
                        *ospan,
                    ));
                }
                match opts.iter().find(|(n, _)| n == oname) {
                    None => {
                        let near = nearest(oname, opts.iter().map(|(n, _)| *n));
                        let hint = match near {
                            Some(n) => format!(". Did you mean `{n}`?"),
                            None => String::new(),
                        };
                        diags.push(Diagnostic::new(
                            "E3005",
                            format!("`{name}` has no option `{oname}`{hint}"),
                            *ospan,
                        ));
                    }
                    Some((_, ty)) => check_value(name, oname, *ty, value, *ospan, table, diags),
                }
            }
        }
    }
}

fn check_value<T: Table>(
    command: &str,
    option: &str,
    ty: OptType,
    v: &OptValue,
    span: Span,
    table: &T,
    diags: &mut Vec<Diagnostic>,
) {
    let ok = match (ty, v) {
        (OptType::Bool, OptValue::Expr(Expr::Bool(_))) => true,
        (OptType::Number, OptValue::Expr(_)) => true,
        (OptType::Length, OptValue::Length(_)) => true,
        (OptType::Color, OptValue::Color(_)) => true,
        (OptType::Color, OptValue::Expr(Expr::Ref(r, _))) => r.len() == 1,
        (OptType::Enum, OptValue::Expr(Expr::Ref(r, _))) => {
            let allowed = table.enum_values(command, option);
            if r.len() == 1 && allowed.contains(&r[0].as_str()) {
                true
            } else {
                diags.push(Diagnostic::new(
                    "E3007",
                    format!(
                        "`{option}` must be one of {}",
                        allowed
                            .iter()
                            .map(|s| format!("`{s}`"))
                            .collect::<Vec<_>>()
                            .join(", ")
                    ),
                    span,
                ));
                return;
            }
        }
        (OptType::Array, OptValue::Expr(_)) => true,
        (OptType::Other, _) => true,
        _ => false,
    };
    if !ok {
        diags.push(Diagnostic::new(
            "E3006",
            format!("The value of `{option}` has the wrong type, expected {ty:?}"),
            span,
        ));
    }
}

fn check_expr<T: Table>(
    e: &Expr,
    table: &T,
    defined: &BTreeSet<String>,
    diags: &mut Vec<Diagnostic>,
) {
    match e {
        Expr::Ref(r, sp) => {
            let name = r.join(".");
            if r[0] != "root" && !defined.contains(&name) && !defined.contains(&r[0]) {
                let near = nearest(&name, defined.iter().map(String::as_str));
                let hint = match near {
                    Some(n) => format!(". Did you mean `{n}`?"),
                    None => String::new(),
                };
                diags.push(Diagnostic::new(
                    "E3010",
                    format!("Unknown name `{name}`{hint}"),
                    *sp,
                ));
            }
        }
        Expr::Call(n, args, sp) => {
            if !table.is_function(n) {
                diags.push(Diagnostic::new(
                    "E3011",
                    format!("Unknown function `{n}`"),
                    *sp,
                ));
            }
            for (_, a) in args {
                check_expr(a, table, defined, diags);
            }
        }
        Expr::Array(items) => {
            for i in items {
                check_expr(i, table, defined, diags);
            }
        }
        Expr::Neg(a) | Expr::Not(a) => check_expr(a, table, defined, diags),
        Expr::Bin(_, a, b) => {
            check_expr(a, table, defined, diags);
            check_expr(b, table, defined, diags);
        }
        Expr::If(c, a, b) => {
            check_expr(c, table, defined, diags);
            check_expr(a, table, defined, diags);
            check_expr(b, table, defined, diags);
        }
        Expr::Index(a, _) => check_expr(a, table, defined, diags),
        Expr::Num(_) | Expr::Str(_) | Expr::Bool(_) => {}
    }
}

/// Edit distance between two short strings.
pub fn distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0; b.len() + 1];
    for (i, ca) in a.chars().enumerate() {
        cur[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let cost = usize::from(ca != *cb);
            cur[j + 1] = (prev[j] + cost).min(prev[j + 1] + 1).min(cur[j] + 1);
        }
        core::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

/// The candidate closest to `name`, if it is close enough.
pub fn nearest<'a>(name: &str, candidates: impl Iterator<Item = &'a str>) -> Option<&'a str> {
    candidates
        .map(|c| (distance(name, c), c))
        .filter(|(d, _)| *d <= 2)
        .min_by_key(|(d, _)| *d)
        .map(|(_, c)| c)
}

/// Completion candidates for a prefix, from a list of names.
pub fn complete<'a>(prefix: &str, names: impl Iterator<Item = &'a str>) -> Vec<&'a str> {
    let mut out: Vec<&str> = names.filter(|n| n.starts_with(prefix)).collect();
    out.sort_unstable();
    out.dedup();
    out
}
