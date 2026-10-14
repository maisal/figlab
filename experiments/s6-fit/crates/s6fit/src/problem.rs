//! Data, residuals, and Jacobians.

use crate::models::Model;

/// Measured data. `x` is row-major with `ncols` predictors per point.
#[derive(Clone)]
pub struct Data {
    pub ncols: usize,
    pub x: Vec<f64>,
    pub y: Vec<f64>,
    /// Weights `1/sigma` per point, or `None` for an unweighted fit.
    pub w: Option<Vec<f64>>,
}

/// A least squares problem: residuals `r_i = (f(x_i | b) - y_i) * w_i`.
#[derive(Clone, Copy)]
pub struct Problem<'a> {
    pub model: Model,
    pub data: &'a Data,
}

impl Problem<'_> {
    /// The number of residuals.
    pub fn m(&self) -> usize {
        self.data.y.len()
    }

    /// The number of parameters.
    pub fn npar(&self) -> usize {
        self.model.npar()
    }

    /// The residuals at `b`.
    pub fn resid(&self, b: &[f64], r: &mut [f64]) {
        let d = self.data;
        let nc = d.ncols;
        for i in 0..d.y.len() {
            let f = self.model.eval(&d.x[i * nc..i * nc + nc], b);
            let mut v = f - d.y[i];
            if let Some(w) = &d.w {
                v *= w[i];
            }
            r[i] = v;
        }
    }

    /// The Jacobian at `b`, column-major (`m` rows, `npar` columns).
    pub fn jac(&self, b: &[f64], jac: &mut [f64]) {
        let d = self.data;
        let nc = d.ncols;
        let m = d.y.len();
        let p = self.npar();
        let mut g = [0.0f64; 16];
        for i in 0..m {
            self.model.grad(&d.x[i * nc..i * nc + nc], b, &mut g[..p]);
            let w = d.w.as_ref().map_or(1.0, |w| w[i]);
            for (j, gj) in g[..p].iter().enumerate() {
                jac[j * m + i] = gj * w;
            }
        }
    }

    /// The residual sum of squares at `b`, summed in order.
    pub fn rss(&self, b: &[f64]) -> f64 {
        let mut r = vec![0.0; self.m()];
        self.resid(b, &mut r);
        r.iter().map(|v| v * v).fold(0.0, |a, v| a + v)
    }
}

/// The forward difference step that MINPACK and cmpfit use:
/// `sqrt(eps) * |x|`, or `sqrt(eps)` when `x` is zero. The step is negative
/// when `x + h` would pass the upper bound.
pub fn fd_step(x: f64, upper: f64) -> f64 {
    let eps = f64::EPSILON.sqrt();
    let mut h = eps * x.abs();
    if h == 0.0 {
        h = eps;
    }
    if x > upper - h {
        h = -h;
    }
    h
}
