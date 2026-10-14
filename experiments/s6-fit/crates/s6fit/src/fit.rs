//! The common fit interface, the candidates, and the analysis of a result.

use crate::cands;
use crate::linalg::inv_jtj;
use crate::problem::{Problem, fd_step};

/// How the Jacobian is computed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Deriv {
    /// From the analytic gradient of the model.
    Analytic,
    /// Forward differences, as figlab would use for user models.
    Forward,
}

impl Deriv {
    pub fn name(self) -> &'static str {
        match self {
            Deriv::Analytic => "analytic",
            Deriv::Forward => "forward",
        }
    }
    pub fn from_u32(v: u32) -> Deriv {
        if v == 0 {
            Deriv::Analytic
        } else {
            Deriv::Forward
        }
    }
}

/// The candidates.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cand {
    /// A0: the `levenberg-marquardt` crate as it is (no bounds).
    Lm,
    /// A1: the crate with a parameter transformation for bounds.
    LmTransform,
    /// A2: a fork of the crate with cmpfit-style bounds.
    LmBounded,
    /// B: cmpfit 1.5 (C).
    Cmpfit,
    /// C: the `rmpfit` crate.
    Rmpfit,
}

pub const ALL_CANDS: [Cand; 5] = [
    Cand::Lm,
    Cand::LmTransform,
    Cand::LmBounded,
    Cand::Cmpfit,
    Cand::Rmpfit,
];

impl Cand {
    pub fn name(self) -> &'static str {
        match self {
            Cand::Lm => "lm",
            Cand::LmTransform => "lm-transform",
            Cand::LmBounded => "lm-bounded",
            Cand::Cmpfit => "cmpfit",
            Cand::Rmpfit => "rmpfit",
        }
    }
    pub fn from_u32(v: u32) -> Cand {
        ALL_CANDS[v as usize]
    }
    /// Whether the candidate can keep parameters inside bounds.
    pub fn has_bounds(self) -> bool {
        self != Cand::Lm
    }
}

/// What to fit.
#[derive(Clone, Debug)]
pub struct Spec {
    pub init: Vec<f64>,
    pub fixed: Vec<bool>,
    /// `-inf` when there is no lower bound.
    pub lower: Vec<f64>,
    /// `inf` when there is no upper bound.
    pub upper: Vec<f64>,
    pub deriv: Deriv,
    pub maxiter: usize,
    /// Used for ftol, xtol, and gtol of every candidate.
    pub tol: f64,
}

/// The tolerance used for every run: the default of the
/// `levenberg-marquardt` crate (30 machine epsilons).
pub const TOL: f64 = 30.0 * f64::EPSILON;

impl Spec {
    /// A spec with no fixed parameters and no bounds.
    pub fn free(init: &[f64], deriv: Deriv) -> Spec {
        let n = init.len();
        Spec {
            init: init.to_vec(),
            fixed: vec![false; n],
            lower: vec![f64::NEG_INFINITY; n],
            upper: vec![f64::INFINITY; n],
            deriv,
            maxiter: 1000,
            tol: TOL,
        }
    }
    pub fn has_bounds(&self) -> bool {
        self.lower.iter().any(|v| v.is_finite()) || self.upper.iter().any(|v| v.is_finite())
    }
}

/// What a candidate returns.
#[derive(Clone, Debug, Default)]
pub struct Out {
    pub params: Vec<f64>,
    /// Parameter errors as the library gives them, scaled by
    /// `sqrt(rss / dof)` (the library assumes unit weights).
    pub lib_err: Option<Vec<f64>>,
    /// The covariance matrix as the library gives it (row-major, unscaled).
    pub lib_cov: Option<Vec<f64>>,
    pub iterations: usize,
    /// Evaluations of the whole residual vector, including those spent on
    /// forward differences.
    pub nfev: usize,
    /// Jacobian evaluations.
    pub njev: usize,
    pub status: String,
    pub converged: bool,
    /// Set when the library returned an error and no result.
    pub failed: bool,
}

/// Run one fit.
pub fn run(c: Cand, p: &Problem, s: &Spec) -> Out {
    match c {
        Cand::Lm => cands::lm::fit(p, s, cands::lm::Variant::Plain),
        Cand::LmTransform => cands::lm::fit(p, s, cands::lm::Variant::Transform),
        Cand::LmBounded => cands::lm::fit(p, s, cands::lm::Variant::Bounded),
        Cand::Cmpfit => cands::cmpfit::fit(p, s),
        Cand::Rmpfit => cands::rmpfit::fit(p, s),
    }
}

/// A result with the values figlab would output.
#[derive(Clone, Debug)]
pub struct Analysis {
    pub out: Out,
    pub rss: f64,
    /// Parameter errors from the Jacobian at the solution (0 for fixed
    /// parameters and parameters at a bound, NaN if `J` is singular).
    pub err: Vec<f64>,
    /// Covariance matrix (row-major, scaled by `s^2`).
    pub cov: Vec<f64>,
    pub at_bound: Vec<bool>,
    pub dof: usize,
}

/// Whether `x` counts as being at bound `b`. Exact for candidates that put
/// parameters on the bound. The relative tolerance is for the transform.
pub fn near(x: f64, b: f64) -> bool {
    b.is_finite() && (x - b).abs() <= 1e-9 * b.abs().max(1e-300)
}

/// The Jacobian (column-major, all parameters) at `b`, analytic or by
/// forward differences with the MINPACK step.
pub fn jacobian(p: &Problem, b: &[f64], upper: &[f64], deriv: Deriv) -> Vec<f64> {
    let m = p.m();
    let n = p.npar();
    let mut jac = vec![0.0; m * n];
    match deriv {
        Deriv::Analytic => p.jac(b, &mut jac),
        Deriv::Forward => {
            let mut f0 = vec![0.0; m];
            p.resid(b, &mut f0);
            let mut x = b.to_vec();
            let mut f1 = vec![0.0; m];
            for j in 0..n {
                let h = fd_step(b[j], upper[j]);
                x[j] = b[j] + h;
                p.resid(&x, &mut f1);
                x[j] = b[j];
                for i in 0..m {
                    jac[j * m + i] = (f1[i] - f0[i]) / h;
                }
            }
        }
    }
    jac
}

/// Compute rss, errors, and covariance the same way for every candidate.
pub fn analyze(p: &Problem, s: &Spec, out: Out) -> Analysis {
    let n = p.npar();
    let m = p.m();
    if out.failed || out.params.len() != n || out.params.iter().any(|v| !v.is_finite()) {
        return Analysis {
            out,
            rss: f64::NAN,
            err: vec![f64::NAN; n],
            cov: vec![f64::NAN; n * n],
            at_bound: vec![false; n],
            dof: 0,
        };
    }
    let b = &out.params;
    let rss = p.rss(b);
    let at_bound: Vec<bool> = (0..n)
        .map(|j| near(b[j], s.lower[j]) || near(b[j], s.upper[j]))
        .collect();
    let free: Vec<usize> = (0..n).filter(|&j| !s.fixed[j] && !at_bound[j]).collect();
    let k = free.len();
    let dof = m.saturating_sub(k);
    let full = jacobian(p, b, &s.upper, s.deriv);
    let mut sub = Vec::with_capacity(m * k);
    for &j in &free {
        sub.extend_from_slice(&full[j * m..(j + 1) * m]);
    }
    let s2 = if dof > 0 { rss / dof as f64 } else { f64::NAN };
    let mut err = vec![0.0; n];
    let mut cov = vec![0.0; n * n];
    match inv_jtj(&sub, m, k) {
        Some(c) => {
            for (a, &ja) in free.iter().enumerate() {
                for (bb, &jb) in free.iter().enumerate() {
                    cov[ja * n + jb] = c[a * k + bb] * s2;
                }
                err[ja] = (c[a * k + a] * s2).sqrt();
            }
        }
        None => {
            for &j in &free {
                err[j] = f64::NAN;
            }
            cov.iter_mut().for_each(|v| *v = f64::NAN);
        }
    }
    let mut out = out;
    if let Some(e) = &mut out.lib_err {
        let scale = (rss / dof as f64).sqrt();
        e.iter_mut().for_each(|v| *v *= scale);
    }
    Analysis {
        out,
        rss,
        err,
        cov,
        at_bound,
        dof,
    }
}

/// The log relative error: the number of correct significant digits of `x`
/// against the certified value `c`, from 0 to `digits`.
pub fn lre(x: f64, c: f64, digits: u32) -> f64 {
    if !x.is_finite() {
        return 0.0;
    }
    if x == c {
        return digits as f64;
    }
    let rel = if c == 0.0 {
        (x - c).abs()
    } else {
        ((x - c) / c).abs()
    };
    let v = -libm::log10(rel);
    v.clamp(0.0, digits as f64)
}
