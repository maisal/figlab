//! Model functions and their analytic gradients.
//!
//! The NIST StRD models use the formulas from the .dat files. `Gauss` and
//! `ExpDecay` are the figlab built-in models (docs/spec.md 6.5). All math
//! functions come from the `libm` crate, as figlab requires.

use core::f64::consts::PI;
use libm::{atan, cos, exp, log, pow, sin};

/// A model `f(x | b)`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Model {
    /// `b1*(1-exp(-b2*x))` (Misra1a, BoxBOD)
    Misra1a,
    /// `exp(-b1*x)/(b2+b3*x)` (Chwirut1, Chwirut2)
    Chwirut,
    /// `b1*x^b2`
    DanWood,
    /// `b1*(1-(1+b2*x/2)^(-2))`
    Misra1b,
    /// `(b1+b2*x+b3*x^2)/(1+b4*x+b5*x^2)`
    Kirby2,
    /// `(b1+b2*x+b3*x^2+b4*x^3)/(1+b5*x+b6*x^2+b7*x^3)` (Hahn1, Thurber)
    Rational33,
    /// `b1 - b2*x1*exp(-b3*x2)`, fitted to `log(y)`
    Nelson,
    /// `b1 + b2*exp(-x*b4) + b3*exp(-x*b5)`
    Mgh17,
    /// `b1*exp(-b2*x) + b3*exp(-b4*x) + b5*exp(-b6*x)` (Lanczos1-3)
    Lanczos,
    /// `b1*exp(-b2*x) + b3*exp(-(x-b4)^2/b5^2) + b6*exp(-(x-b7)^2/b8^2)` (Gauss1-3)
    Gauss2Peaks,
    /// `b1*(1-(1+2*b2*x)^(-1/2))`
    Misra1c,
    /// `b1*b2*x/(1+b2*x)`
    Misra1d,
    /// `b1 - b2*x - atan(b3/(x-b4))/pi`
    Roszman1,
    /// Three cosine and sine pairs (ENSO)
    Enso,
    /// `b1*(x^2+x*b2)/(x^2+x*b3+b4)`
    Mgh09,
    /// `b1/(1+exp(b2-b3*x))`
    Rat42,
    /// `b1*exp(b2/(x+b3))`
    Mgh10,
    /// `(b1/b2)*exp(-0.5*((x-b3)/b2)^2)`
    Eckerle4,
    /// `b1/((1+exp(b2-b3*x))^(1/b4))`
    Rat43,
    /// `b1*(b2+x)^(-1/b3)`
    Bennett5,
    /// figlab `gauss(x | y0, a, x0, w)`: `y0 + a*exp(-((x-x0)/w)^2)`
    Gauss,
    /// figlab `expdecay(x | y0, a, tau)`: `y0 + a*exp(-x/tau)`
    ExpDecay,
}

impl Model {
    /// The number of parameters.
    pub fn npar(self) -> usize {
        use Model::*;
        match self {
            Misra1a | DanWood | Misra1b | Misra1c | Misra1d => 2,
            Chwirut | Nelson | Rat42 | Mgh10 | Eckerle4 | Bennett5 | ExpDecay => 3,
            Roszman1 | Mgh09 | Rat43 | Gauss => 4,
            Kirby2 | Mgh17 => 5,
            Lanczos => 6,
            Rational33 => 7,
            Gauss2Peaks => 8,
            Enso => 9,
        }
    }

    /// The number of predictor columns.
    pub fn ncols(self) -> usize {
        if self == Model::Nelson { 2 } else { 1 }
    }

    /// The model value at one point. `xs` holds the predictors of the point.
    pub fn eval(self, xs: &[f64], b: &[f64]) -> f64 {
        use Model::*;
        let x = xs[0];
        match self {
            Misra1a => b[0] * (1.0 - exp(-b[1] * x)),
            Chwirut => exp(-b[0] * x) / (b[1] + b[2] * x),
            DanWood => b[0] * pow(x, b[1]),
            Misra1b => b[0] * (1.0 - pow(1.0 + b[1] * x / 2.0, -2.0)),
            Kirby2 => (b[0] + b[1] * x + b[2] * x * x) / (1.0 + b[3] * x + b[4] * x * x),
            Rational33 => {
                let x2 = x * x;
                let x3 = x2 * x;
                (b[0] + b[1] * x + b[2] * x2 + b[3] * x3) / (1.0 + b[4] * x + b[5] * x2 + b[6] * x3)
            }
            Nelson => b[0] - b[1] * x * exp(-b[2] * xs[1]),
            Mgh17 => b[0] + b[1] * exp(-x * b[3]) + b[2] * exp(-x * b[4]),
            Lanczos => b[0] * exp(-b[1] * x) + b[2] * exp(-b[3] * x) + b[4] * exp(-b[5] * x),
            Gauss2Peaks => {
                let u = x - b[3];
                let v = x - b[6];
                b[0] * exp(-b[1] * x)
                    + b[2] * exp(-(u * u) / (b[4] * b[4]))
                    + b[5] * exp(-(v * v) / (b[7] * b[7]))
            }
            Misra1c => b[0] * (1.0 - pow(1.0 + 2.0 * b[1] * x, -0.5)),
            Misra1d => b[0] * b[1] * x / (1.0 + b[1] * x),
            Roszman1 => b[0] - b[1] * x - atan(b[2] / (x - b[3])) / PI,
            Enso => {
                let t0 = 2.0 * PI * x / 12.0;
                let t1 = 2.0 * PI * x / b[3];
                let t2 = 2.0 * PI * x / b[6];
                b[0] + b[1] * cos(t0)
                    + b[2] * sin(t0)
                    + b[4] * cos(t1)
                    + b[5] * sin(t1)
                    + b[7] * cos(t2)
                    + b[8] * sin(t2)
            }
            Mgh09 => b[0] * (x * x + x * b[1]) / (x * x + x * b[2] + b[3]),
            Rat42 => b[0] / (1.0 + exp(b[1] - b[2] * x)),
            Mgh10 => b[0] * exp(b[1] / (x + b[2])),
            Eckerle4 => {
                let z = (x - b[2]) / b[1];
                (b[0] / b[1]) * exp(-0.5 * z * z)
            }
            Rat43 => b[0] / pow(1.0 + exp(b[1] - b[2] * x), 1.0 / b[3]),
            Bennett5 => b[0] * pow(b[1] + x, -1.0 / b[2]),
            Gauss => {
                let z = (x - b[2]) / b[3];
                b[0] + b[1] * exp(-z * z)
            }
            ExpDecay => b[0] + b[1] * exp(-x / b[2]),
        }
    }

    /// The gradient of the model value with respect to `b`, written to `g`.
    pub fn grad(self, xs: &[f64], b: &[f64], g: &mut [f64]) {
        use Model::*;
        let x = xs[0];
        match self {
            Misra1a => {
                let e = exp(-b[1] * x);
                g[0] = 1.0 - e;
                g[1] = b[0] * x * e;
            }
            Chwirut => {
                let e = exp(-b[0] * x);
                let d = b[1] + b[2] * x;
                g[0] = -x * e / d;
                g[1] = -e / (d * d);
                g[2] = -x * e / (d * d);
            }
            DanWood => {
                let p = pow(x, b[1]);
                g[0] = p;
                g[1] = b[0] * p * log(x);
            }
            Misra1b => {
                let u = 1.0 + b[1] * x / 2.0;
                g[0] = 1.0 - pow(u, -2.0);
                g[1] = b[0] * x * pow(u, -3.0);
            }
            Kirby2 => {
                let n = b[0] + b[1] * x + b[2] * x * x;
                let d = 1.0 + b[3] * x + b[4] * x * x;
                g[0] = 1.0 / d;
                g[1] = x / d;
                g[2] = x * x / d;
                g[3] = -n * x / (d * d);
                g[4] = -n * x * x / (d * d);
            }
            Rational33 => {
                let x2 = x * x;
                let x3 = x2 * x;
                let n = b[0] + b[1] * x + b[2] * x2 + b[3] * x3;
                let d = 1.0 + b[4] * x + b[5] * x2 + b[6] * x3;
                g[0] = 1.0 / d;
                g[1] = x / d;
                g[2] = x2 / d;
                g[3] = x3 / d;
                g[4] = -n * x / (d * d);
                g[5] = -n * x2 / (d * d);
                g[6] = -n * x3 / (d * d);
            }
            Nelson => {
                let e = exp(-b[2] * xs[1]);
                g[0] = 1.0;
                g[1] = -x * e;
                g[2] = b[1] * x * xs[1] * e;
            }
            Mgh17 => {
                let e4 = exp(-x * b[3]);
                let e5 = exp(-x * b[4]);
                g[0] = 1.0;
                g[1] = e4;
                g[2] = e5;
                g[3] = -b[1] * x * e4;
                g[4] = -b[2] * x * e5;
            }
            Lanczos => {
                for k in 0..3 {
                    let e = exp(-b[2 * k + 1] * x);
                    g[2 * k] = e;
                    g[2 * k + 1] = -b[2 * k] * x * e;
                }
            }
            Gauss2Peaks => {
                let e = exp(-b[1] * x);
                g[0] = e;
                g[1] = -b[0] * x * e;
                for (k, i) in [(2usize, 3usize), (5, 6)] {
                    let u = x - b[i];
                    let w = b[i + 1];
                    let q = exp(-(u * u) / (w * w));
                    g[k] = q;
                    g[i] = b[k] * q * 2.0 * u / (w * w);
                    g[i + 1] = b[k] * q * 2.0 * u * u / (w * w * w);
                }
            }
            Misra1c => {
                let u = 1.0 + 2.0 * b[1] * x;
                g[0] = 1.0 - pow(u, -0.5);
                g[1] = b[0] * x * pow(u, -1.5);
            }
            Misra1d => {
                let d = 1.0 + b[1] * x;
                g[0] = b[1] * x / d;
                g[1] = b[0] * x / (d * d);
            }
            Roszman1 => {
                let v = x - b[3];
                let t = b[2] / v;
                let da = 1.0 / (1.0 + t * t);
                g[0] = 1.0;
                g[1] = -x;
                g[2] = -da / (v * PI);
                g[3] = -da * b[2] / (v * v * PI);
            }
            Enso => {
                let t0 = 2.0 * PI * x / 12.0;
                g[0] = 1.0;
                g[1] = cos(t0);
                g[2] = sin(t0);
                for (i, a, c) in [(3usize, 4usize, 5usize), (6, 7, 8)] {
                    let t = 2.0 * PI * x / b[i];
                    let (s, co) = (sin(t), cos(t));
                    g[a] = co;
                    g[c] = s;
                    g[i] = (-b[a] * s + b[c] * co) * (-2.0 * PI * x / (b[i] * b[i]));
                }
            }
            Mgh09 => {
                let n = x * x + x * b[1];
                let d = x * x + x * b[2] + b[3];
                g[0] = n / d;
                g[1] = b[0] * x / d;
                g[2] = -b[0] * n * x / (d * d);
                g[3] = -b[0] * n / (d * d);
            }
            Rat42 => {
                let e = exp(b[1] - b[2] * x);
                let d = 1.0 + e;
                g[0] = 1.0 / d;
                g[1] = -b[0] * e / (d * d);
                g[2] = b[0] * x * e / (d * d);
            }
            Mgh10 => {
                let v = x + b[2];
                let e = exp(b[1] / v);
                g[0] = e;
                g[1] = b[0] * e / v;
                g[2] = -b[0] * e * b[1] / (v * v);
            }
            Eckerle4 => {
                let z = (x - b[2]) / b[1];
                let e = exp(-0.5 * z * z);
                g[0] = e / b[1];
                g[1] = b[0] * e * (z * z - 1.0) / (b[1] * b[1]);
                g[2] = b[0] * e * z / (b[1] * b[1]);
            }
            Rat43 => {
                let e = exp(b[1] - b[2] * x);
                let u = 1.0 + e;
                let f0 = pow(u, -1.0 / b[3]);
                let f1 = pow(u, -1.0 / b[3] - 1.0);
                g[0] = f0;
                g[1] = -b[0] * e * f1 / b[3];
                g[2] = b[0] * x * e * f1 / b[3];
                g[3] = b[0] * f0 * log(u) / (b[3] * b[3]);
            }
            Bennett5 => {
                let v = b[1] + x;
                let f0 = pow(v, -1.0 / b[2]);
                g[0] = f0;
                g[1] = -b[0] * pow(v, -1.0 / b[2] - 1.0) / b[2];
                g[2] = b[0] * f0 * log(v) / (b[2] * b[2]);
            }
            Gauss => {
                let z = (x - b[2]) / b[3];
                let e = exp(-z * z);
                g[0] = 1.0;
                g[1] = e;
                g[2] = b[1] * e * 2.0 * z / b[3];
                g[3] = b[1] * e * 2.0 * z * z / b[3];
            }
            ExpDecay => {
                let e = exp(-x / b[2]);
                g[0] = 1.0;
                g[1] = e;
                g[2] = b[1] * e * x / (b[2] * b[2]);
            }
        }
    }
}
