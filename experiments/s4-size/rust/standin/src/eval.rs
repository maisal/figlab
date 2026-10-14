//! Interpreter stand-in: evaluates expressions over arrays of f64.

use crate::Diagnostic;
use crate::parse::{BinOp, CommandNames, DefaultCommands, Expr, Idx, Stmt, parse};
use std::collections::BTreeMap;

/// A value.
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    /// A number.
    Num(f64),
    /// A boolean.
    Bool(bool),
    /// A string.
    Str(String),
    /// A 1D array.
    Array(Vec<f64>),
}

/// The interpreter state: a flat map of names to values.
#[derive(Default)]
pub struct Interp {
    /// Variables and arrays.
    pub vars: BTreeMap<String, Value>,
    /// Lines of output (results of expression statements).
    pub output: Vec<String>,
}

type R<T> = Result<T, Diagnostic>;

fn err<T>(code: &'static str, message: String) -> R<T> {
    Err(Diagnostic::new(code, message, crate::Span::default()))
}

impl Interp {
    /// Runs a command file and returns the problems found.
    pub fn run(&mut self, src: &str) -> Vec<Diagnostic> {
        self.run_with(src, &DefaultCommands)
    }

    /// Runs a command file with the given command names.
    pub fn run_with<C: CommandNames>(&mut self, src: &str, c: &C) -> Vec<Diagnostic> {
        let (stmts, mut diags) = parse(src, c);
        if !diags.is_empty() {
            return diags;
        }
        for s in &stmts {
            if let Err(d) = self.stmt(s) {
                diags.push(d);
                break;
            }
        }
        diags
    }

    fn stmt(&mut self, s: &Stmt) -> R<()> {
        match s {
            Stmt::Let(r, e) | Stmt::ArrayDef(r, e) => {
                let name = r.join(".");
                if self.vars.contains_key(&name) {
                    return err("E3002", format!("`{name}` already exists"));
                }
                let v = self.expr(e)?;
                self.vars.insert(name, v);
            }
            Stmt::Assign(Expr::Ref(r, _), op, e) => {
                let name = r.join(".");
                let Some(old) = self.vars.get(&name).cloned() else {
                    return err("E3010", format!("Unknown name `{name}`"));
                };
                let v = self.expr(e)?;
                let v = match op {
                    Some(op) => binary(*op, old, v)?,
                    None => v,
                };
                self.vars.insert(name, v);
            }
            Stmt::Assign(..) => return err("E2002", "Cannot assign to this".into()),
            Stmt::Expr(e) => {
                let v = self.expr(e)?;
                self.output.push(show(&v));
            }
            Stmt::For(var, it, body) => {
                let items = match self.expr(it)? {
                    Value::Array(a) => a,
                    Value::Num(n) => vec![n],
                    _ => return err("E4003", "`for` needs a list or a range".into()),
                };
                for x in items {
                    self.vars.insert(var.clone(), Value::Num(x));
                    for b in body {
                        self.stmt(b)?;
                    }
                }
                self.vars.remove(var);
            }
            Stmt::Fn(..) => return err("E2011", "`fn` can be written only in .figf files".into()),
            Stmt::Command { name, args, .. } => {
                self.output.push(format!(
                    "{name}: {} argument(s) (not run in S4)",
                    args.len()
                ));
            }
        }
        Ok(())
    }

    fn expr(&mut self, e: &Expr) -> R<Value> {
        Ok(match e {
            Expr::Num(v) => Value::Num(*v),
            Expr::Str(s) => Value::Str(s.clone()),
            Expr::Bool(b) => Value::Bool(*b),
            Expr::Ref(r, _) => {
                let name = r.join(".");
                match self.vars.get(&name) {
                    Some(v) => v.clone(),
                    None => return err("E3010", format!("Unknown name `{name}`")),
                }
            }
            Expr::Array(items) => {
                let mut out = Vec::with_capacity(items.len());
                for i in items {
                    match self.expr(i)? {
                        Value::Num(n) => out.push(n),
                        other => {
                            return err(
                                "E4001",
                                format!(
                                    "Array elements must be numbers, not {}",
                                    type_name(&other)
                                ),
                            );
                        }
                    }
                }
                Value::Array(out)
            }
            Expr::Neg(a) => match self.expr(a)? {
                Value::Num(n) => Value::Num(-n),
                Value::Array(v) => Value::Array(v.into_iter().map(|x| -x).collect()),
                other => return err("E4001", format!("Cannot negate {}", type_name(&other))),
            },
            Expr::Not(a) => match self.expr(a)? {
                Value::Bool(b) => Value::Bool(!b),
                other => {
                    return err(
                        "E4001",
                        format!("`not` needs a boolean, not {}", type_name(&other)),
                    );
                }
            },
            Expr::Bin(op, a, b) => {
                let a = self.expr(a)?;
                let b = self.expr(b)?;
                binary(*op, a, b)?
            }
            Expr::If(c, a, b) => match self.expr(c)? {
                Value::Bool(true) => self.expr(a)?,
                Value::Bool(false) => self.expr(b)?,
                other => {
                    return err(
                        "E4001",
                        format!("`if` needs a boolean, not {}", type_name(&other)),
                    );
                }
            },
            Expr::Call(name, args, _) => {
                let mut vals = Vec::new();
                for (_, a) in args {
                    vals.push(self.expr(a)?);
                }
                call(name, vals)?
            }
            Expr::Index(a, idx) => {
                let Value::Array(v) = self.expr(a)? else {
                    return err("E4002", "Only arrays can be indexed".into());
                };
                match idx.as_slice() {
                    [Idx::At(i)] => {
                        let i = self.index_value(i, v.len())?;
                        Value::Num(v[i])
                    }
                    [Idx::Range(lo, hi)] => {
                        let lo = match lo {
                            Some(e) => self.index_value(e, v.len())?,
                            None => 0,
                        };
                        let hi = match hi {
                            Some(e) => self.index_value(e, v.len())?,
                            None => v.len().saturating_sub(1),
                        };
                        Value::Array(v[lo..=hi.max(lo)].to_vec())
                    }
                    _ => return err("E4002", "This index is not supported in S4".into()),
                }
            }
        })
    }

    fn index_value(&mut self, e: &Expr, len: usize) -> R<usize> {
        match self.expr(e)? {
            Value::Num(n) if n >= 0.0 && n.fract() == 0.0 && (n as usize) < len => Ok(n as usize),
            Value::Num(n) => err(
                "E4004",
                format!("Index {n} is out of range 0..{}", len.saturating_sub(1)),
            ),
            other => err(
                "E4002",
                format!("An index must be a number, not {}", type_name(&other)),
            ),
        }
    }
}

fn type_name(v: &Value) -> &'static str {
    match v {
        Value::Num(_) => "a number",
        Value::Bool(_) => "a boolean",
        Value::Str(_) => "a string",
        Value::Array(_) => "an array",
    }
}

/// Formats a value for the output.
pub fn show(v: &Value) -> String {
    match v {
        Value::Num(n) => format!("{n}"),
        Value::Bool(b) => format!("{b}"),
        Value::Str(s) => format!("{s:?}"),
        Value::Array(a) => {
            let head: Vec<String> = a.iter().take(5).map(|x| format!("{x:.6}")).collect();
            if a.len() > 5 {
                format!("[{}, ...] ({} points)", head.join(", "), a.len())
            } else {
                format!("[{}]", head.join(", "))
            }
        }
    }
}

fn num_op(op: BinOp, a: f64, b: f64) -> R<Value> {
    Ok(match op {
        BinOp::Add => Value::Num(a + b),
        BinOp::Sub => Value::Num(a - b),
        BinOp::Mul => Value::Num(a * b),
        BinOp::Div => Value::Num(a / b),
        BinOp::Pow => Value::Num(libm::pow(a, b)),
        BinOp::Eq => Value::Bool(a == b),
        BinOp::Ne => Value::Bool(a != b),
        BinOp::Lt => Value::Bool(a < b),
        BinOp::Le => Value::Bool(a <= b),
        BinOp::Gt => Value::Bool(a > b),
        BinOp::Ge => Value::Bool(a >= b),
        BinOp::And | BinOp::Or => return err("E4001", "`and` and `or` need booleans".into()),
    })
}

fn binary(op: BinOp, a: Value, b: Value) -> R<Value> {
    match (a, b) {
        (Value::Num(a), Value::Num(b)) => num_op(op, a, b),
        (Value::Bool(a), Value::Bool(b)) => match op {
            BinOp::And => Ok(Value::Bool(a && b)),
            BinOp::Or => Ok(Value::Bool(a || b)),
            BinOp::Eq => Ok(Value::Bool(a == b)),
            BinOp::Ne => Ok(Value::Bool(a != b)),
            _ => err("E4001", "This operator does not work on booleans".into()),
        },
        (Value::Str(a), Value::Str(b)) if op == BinOp::Add => Ok(Value::Str(a + &b)),
        (Value::Array(a), Value::Array(b)) => {
            if a.len() != b.len() {
                return err(
                    "E4005",
                    format!("Shapes do not match: {} and {} points", a.len(), b.len()),
                );
            }
            let mut out = Vec::with_capacity(a.len());
            for (x, y) in a.iter().zip(&b) {
                match num_op(op, *x, *y)? {
                    Value::Num(n) => out.push(n),
                    _ => return err("E4001", "Comparisons of arrays give no array in S4".into()),
                }
            }
            Ok(Value::Array(out))
        }
        (Value::Array(a), Value::Num(s)) => map_array(a, |x| num_op(op, x, s)),
        (Value::Num(s), Value::Array(a)) => map_array(a, |x| num_op(op, s, x)),
        (a, b) => err(
            "E4001",
            format!("Cannot combine {} and {}", type_name(&a), type_name(&b)),
        ),
    }
}

fn map_array(a: Vec<f64>, f: impl Fn(f64) -> R<Value>) -> R<Value> {
    let mut out = Vec::with_capacity(a.len());
    for x in a {
        match f(x)? {
            Value::Num(n) => out.push(n),
            _ => return err("E4001", "Comparisons of arrays give no array in S4".into()),
        }
    }
    Ok(Value::Array(out))
}

fn unary(vals: &[Value], name: &str, f: fn(f64) -> f64) -> R<Value> {
    match vals {
        [Value::Num(x)] => Ok(Value::Num(f(*x))),
        [Value::Array(a)] => Ok(Value::Array(a.iter().map(|x| f(*x)).collect())),
        _ => err("E4006", format!("`{name}` takes one number or array")),
    }
}

fn call(name: &str, vals: Vec<Value>) -> R<Value> {
    match name {
        "sin" => unary(&vals, name, libm::sin),
        "cos" => unary(&vals, name, libm::cos),
        "tan" => unary(&vals, name, libm::tan),
        "exp" => unary(&vals, name, libm::exp),
        "ln" => unary(&vals, name, libm::log),
        "log10" => unary(&vals, name, libm::log10),
        "sqrt" => unary(&vals, name, libm::sqrt),
        "abs" => unary(&vals, name, libm::fabs),
        "atan" => unary(&vals, name, libm::atan),
        "erf" => unary(&vals, name, libm::erf),
        "gamma" => unary(&vals, name, libm::tgamma),
        "range" | "linspace" => match vals.as_slice() {
            [Value::Num(a), Value::Num(b)] if name == "range" => {
                let n = (b - a).max(0.0) as usize + 1;
                Ok(Value::Array((0..n).map(|i| a + i as f64).collect()))
            }
            [Value::Num(a), Value::Num(b), Value::Num(n)] => {
                let n = *n as usize;
                let step = if n > 1 { (b - a) / (n - 1) as f64 } else { 0.0 };
                Ok(Value::Array((0..n).map(|i| a + step * i as f64).collect()))
            }
            _ => err("E4006", format!("Wrong arguments for `{name}`")),
        },
        "sum" | "mean" | "min" | "max" | "len" => match vals.as_slice() {
            [Value::Array(a)] => {
                let v = match name {
                    "sum" => a.iter().sum(),
                    "mean" => a.iter().sum::<f64>() / a.len() as f64,
                    "min" => a.iter().copied().fold(f64::INFINITY, f64::min),
                    "max" => a.iter().copied().fold(f64::NEG_INFINITY, f64::max),
                    _ => a.len() as f64,
                };
                Ok(Value::Num(v))
            }
            _ => err("E4006", format!("`{name}` takes one array")),
        },
        _ => err("E3011", format!("Unknown function `{name}`")),
    }
}
