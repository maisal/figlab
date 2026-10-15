//! Candidates A0, A1, and A2: the `levenberg-marquardt` crate.
//!
//! - A0 (`Plain`): the crate as it is. It has no bounds.
//! - A1 (`Transform`): the crate as it is, with the MINUIT/lmfit parameter
//!   transformation. The optimizer sees internal parameters without bounds.
//!   Two bounds: `ext = lo + (sin(int) + 1) * (hi - lo) / 2`. One bound:
//!   `ext = lo - 1 + sqrt(int^2 + 1)` (or the mirror for an upper bound).
//! - A2 (`Bounded`): the fork in downloads/lm-bounded (patches/lm-bounded.patch)
//!   with cmpfit-style bounds.
//!
//! Fixed parameters are left out of the optimizer by this wrapper for all three.
//! `maxiter` counts Jacobian evaluations; the wrapper stops the crate when
//! it is reached.

use core::cell::{Cell, RefCell};
use libm::{asin, cos, sin};
use nalgebra::{DMatrix, DVector, Dyn, Owned};

use crate::fit::{Deriv, Out, Spec};
use crate::linalg::inv_jtj;
use crate::problem::{Problem, fd_step};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Variant {
    Plain,
    Transform,
    Bounded,
}

struct Inner<'a> {
    p: &'a Problem<'a>,
    s: &'a Spec,
    free: Vec<usize>,
    variant: Variant,
    nres: Cell<usize>,
    njac: Cell<usize>,
    over: Cell<bool>,
    /// The residuals at the last point, to reuse them for forward differences.
    cache: RefCell<(Vec<f64>, Vec<f64>)>,
}

impl Inner<'_> {
    fn bounds(&self, k: usize) -> (f64, f64) {
        let j = self.free[k];
        (self.s.lower[j], self.s.upper[j])
    }

    /// External value of free parameter `k` from its internal value.
    fn ext(&self, k: usize, v: f64) -> f64 {
        if self.variant != Variant::Transform {
            return v;
        }
        let (lo, hi) = self.bounds(k);
        match (lo.is_finite(), hi.is_finite()) {
            (true, true) => lo + (sin(v) + 1.0) * (hi - lo) / 2.0,
            (true, false) => lo - 1.0 + (v * v + 1.0).sqrt(),
            (false, true) => hi + 1.0 - (v * v + 1.0).sqrt(),
            (false, false) => v,
        }
    }

    /// `d ext / d int` of free parameter `k`.
    fn dext(&self, k: usize, v: f64) -> f64 {
        if self.variant != Variant::Transform {
            return 1.0;
        }
        let (lo, hi) = self.bounds(k);
        match (lo.is_finite(), hi.is_finite()) {
            (true, true) => cos(v) * (hi - lo) / 2.0,
            (true, false) => v / (v * v + 1.0).sqrt(),
            (false, true) => -v / (v * v + 1.0).sqrt(),
            (false, false) => 1.0,
        }
    }

    /// Internal value of free parameter `k` from its external value.
    fn int(&self, k: usize, e: f64) -> f64 {
        if self.variant != Variant::Transform {
            return e;
        }
        let (lo, hi) = self.bounds(k);
        match (lo.is_finite(), hi.is_finite()) {
            (true, true) => asin(2.0 * (e - lo) / (hi - lo) - 1.0),
            (true, false) => ((e - lo + 1.0) * (e - lo + 1.0) - 1.0).sqrt(),
            (false, true) => ((hi - e + 1.0) * (hi - e + 1.0) - 1.0).sqrt(),
            (false, false) => e,
        }
    }

    fn full(&self, x: &[f64]) -> Vec<f64> {
        let mut b = self.s.init.clone();
        for (k, &j) in self.free.iter().enumerate() {
            b[j] = self.ext(k, x[k]);
        }
        b
    }

    fn resid(&self, x: &[f64]) -> Vec<f64> {
        self.nres.set(self.nres.get() + 1);
        let mut r = vec![0.0; self.p.m()];
        self.p.resid(&self.full(x), &mut r);
        *self.cache.borrow_mut() = (x.to_vec(), r.clone());
        r
    }

    /// Column-major `m x k` Jacobian with respect to the internal parameters.
    fn jac_unlimited(&self, x: &[f64]) -> Vec<f64> {
        let m = self.p.m();
        let k = self.free.len();
        let mut out = vec![0.0; m * k];
        match self.s.deriv {
            Deriv::Analytic => {
                let n = self.p.npar();
                let mut full = vec![0.0; m * n];
                self.p.jac(&self.full(x), &mut full);
                for (c, &j) in self.free.iter().enumerate() {
                    let d = self.dext(c, x[c]);
                    for i in 0..m {
                        out[c * m + i] = if self.variant == Variant::Transform {
                            full[j * m + i] * d
                        } else {
                            full[j * m + i]
                        };
                    }
                }
            }
            Deriv::Forward => {
                let f0 = {
                    let cache = self.cache.borrow();
                    if cache.0 == x {
                        Some(cache.1.clone())
                    } else {
                        None
                    }
                };
                let f0 = f0.unwrap_or_else(|| self.resid(x));
                let mut xx = x.to_vec();
                let mut f1 = vec![0.0; m];
                for c in 0..k {
                    let upper = if self.variant == Variant::Bounded {
                        self.bounds(c).1
                    } else {
                        f64::INFINITY
                    };
                    let h = fd_step(x[c], upper);
                    xx[c] = x[c] + h;
                    self.nres.set(self.nres.get() + 1);
                    self.p.resid(&self.full(&xx), &mut f1);
                    xx[c] = x[c];
                    for i in 0..m {
                        out[c * m + i] = (f1[i] - f0[i]) / h;
                    }
                }
            }
        }
        out
    }

    fn jac(&self, x: &[f64]) -> Option<Vec<f64>> {
        if self.njac.get() >= self.s.maxiter {
            self.over.set(true);
            return None;
        }
        self.njac.set(self.njac.get() + 1);
        Some(self.jac_unlimited(x))
    }
}

struct W<'a> {
    inner: &'a Inner<'a>,
    x: DVector<f64>,
}

macro_rules! impl_problem {
    ($krate:ident { $($extra:tt)* }) => {
        impl $krate::LeastSquaresProblem<f64, Dyn, Dyn> for W<'_> {
            type ResidualStorage = Owned<f64, Dyn>;
            type JacobianStorage = Owned<f64, Dyn, Dyn>;
            type ParameterStorage = Owned<f64, Dyn>;
            fn set_params(&mut self, x: &DVector<f64>) {
                self.x.copy_from(x);
            }
            fn params(&self) -> DVector<f64> {
                self.x.clone()
            }
            fn residuals(&self) -> Option<DVector<f64>> {
                Some(DVector::from_vec(self.inner.resid(self.x.as_slice())))
            }
            fn jacobian(&self) -> Option<DMatrix<f64>> {
                let m = self.inner.p.m();
                let k = self.inner.free.len();
                self.inner.jac(self.x.as_slice()).map(|v| DMatrix::from_vec(m, k, v))
            }
            $($extra)*
        }
    };
}

impl_problem!(levenberg_marquardt {});
impl_problem!(lm_bounded {
    fn bounds(&self) -> Option<(DVector<f64>, DVector<f64>)> {
        let k = self.inner.free.len();
        let lo = DVector::from_iterator(k, (0..k).map(|c| self.inner.bounds(c).0));
        let hi = DVector::from_iterator(k, (0..k).map(|c| self.inner.bounds(c).1));
        Some((lo, hi))
    }
});

/// The name of a termination reason, without `Debug` formatting (which
/// would add the formatting code to the wasm size modules).
macro_rules! term_name {
    ($krate:ident, $t:expr) => {{
        use $krate::TerminationReason as T;
        match $t {
            T::User(_) => "User",
            T::Numerical(_) => "Numerical",
            T::ResidualsZero => "ResidualsZero",
            T::Orthogonal => "Orthogonal",
            T::Converged {
                ftol: true,
                xtol: true,
            } => "Converged(ftol, xtol)",
            T::Converged { ftol: true, .. } => "Converged(ftol)",
            T::Converged { .. } => "Converged(xtol)",
            T::NoImprovementPossible(_) => "NoImprovementPossible",
            T::LostPatience => "LostPatience",
            T::NoParameters => "NoParameters",
            T::NoResiduals => "NoResiduals",
            T::WrongDimensions(_) => "WrongDimensions",
        }
    }};
}

pub fn fit(p: &Problem, s: &Spec, variant: Variant) -> Out {
    let free: Vec<usize> = (0..p.npar()).filter(|&j| !s.fixed[j]).collect();
    let inner = Inner {
        p,
        s,
        free,
        variant,
        nres: Cell::new(0),
        njac: Cell::new(0),
        over: Cell::new(false),
        cache: RefCell::new((vec![], vec![])),
    };
    let k = inner.free.len();
    let x0 = DVector::from_iterator(k, (0..k).map(|c| inner.int(c, s.init[inner.free[c]])));
    let w = W {
        inner: &inner,
        x: x0,
    };
    let tol = s.tol;
    let patience = 1_000_000;
    let (x, status, converged) = match variant {
        Variant::Plain | Variant::Transform => {
            let lm = levenberg_marquardt::LevenbergMarquardt::new()
                .with_ftol(tol)
                .with_xtol(tol)
                .with_gtol(tol)
                .with_patience(patience);
            let (w, report) = lm.minimize(w);
            (
                w.x,
                term_name!(levenberg_marquardt, &report.termination),
                report.termination.was_successful(),
            )
        }
        Variant::Bounded => {
            let lm = lm_bounded::LevenbergMarquardt::new()
                .with_ftol(tol)
                .with_xtol(tol)
                .with_gtol(tol)
                .with_patience(patience);
            let (w, report) = lm.minimize(w);
            (
                w.x,
                term_name!(lm_bounded, &report.termination),
                report.termination.was_successful(),
            )
        }
    };
    let over = inner.over.get();
    let (nfev, njev) = (inner.nres.get(), inner.njac.get());
    let params = inner.full(x.as_slice());
    // A1 errors as lmfit gives them: the covariance of the internal
    // parameters, mapped with d ext / d int.
    let lib_err = if variant == Variant::Transform {
        let m = p.m();
        let jac = inner.jac_unlimited(x.as_slice());
        let mut e = vec![0.0; p.npar()];
        match inv_jtj(&jac, m, k) {
            Some(c) => {
                for (cc, &j) in inner.free.iter().enumerate() {
                    e[j] = inner.dext(cc, x[cc]).abs() * c[cc * k + cc].sqrt();
                }
            }
            None => e.iter_mut().for_each(|v| *v = f64::NAN),
        }
        Some(e)
    } else {
        None
    };
    Out {
        params,
        lib_err,
        lib_cov: None,
        iterations: njev,
        nfev,
        njev,
        status: if over {
            "MaxIter".into()
        } else {
            status.into()
        },
        converged: converged && !over,
        failed: false,
    }
}
