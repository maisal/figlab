//! Stand-in for the compute worker module.
//!
//! Each feature adds one library (or figlab's own stand-in code), so that
//! the size of each part can be measured on its own.

use wasm_bindgen::prelude::*;

/// Returns 1. The worker calls it to check that the module is ready.
#[wasm_bindgen]
pub fn ready() -> u32 {
    1
}

/// Runs a command with the interpreter stand-in and returns its output.
#[cfg(feature = "interp")]
#[wasm_bindgen(js_name = run)]
pub fn eval(src: &str) -> String {
    let mut it = standin::eval::Interp::default();
    let diags = it.run(src);
    let mut out = it.output.join("\n");
    for d in diags {
        out.push_str(&format!("\n{}: {}", d.code, d.message));
    }
    out
}

/// Decodes bytes to text: UTF-8 if valid, otherwise Shift_JIS.
#[cfg(feature = "sjis")]
fn decode(bytes: &[u8]) -> String {
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    match core::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => {
            let (text, _, _) = encoding_rs::SHIFT_JIS.decode(bytes);
            text.into_owned()
        }
    }
}

#[cfg(not(feature = "sjis"))]
fn decode(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

/// Imports a text table. Returns the columns one after another, each
/// preceded by its length.
#[wasm_bindgen]
pub fn import(bytes: &[u8]) -> Vec<f64> {
    let text = decode(bytes);
    let cols = read(&text);
    let mut out = Vec::new();
    for c in cols {
        out.push(c.len() as f64);
        out.extend(c);
    }
    out
}

#[cfg(feature = "csv")]
fn read(text: &str) -> Vec<Vec<f64>> {
    #[cfg(feature = "interp")]
    let (delimiter, skip) = {
        let d = standin::detect::detect(text);
        let first = usize::from(d.header) + usize::from(d.units);
        (d.delimiter, d.skip + first)
    };
    #[cfg(not(feature = "interp"))]
    let (delimiter, skip) = (b',', 0);
    let mut rdr = csv::ReaderBuilder::new()
        .delimiter(if delimiter == b' ' { b'\t' } else { delimiter })
        .has_headers(false)
        .flexible(true)
        .comment(Some(b'#'))
        .from_reader(text.as_bytes());
    let mut cols: Vec<Vec<f64>> = Vec::new();
    for rec in rdr.records().skip(skip).flatten() {
        for (i, f) in rec.iter().enumerate() {
            if cols.len() <= i {
                cols.push(Vec::new());
            }
            cols[i].push(f.trim().parse().unwrap_or(f64::NAN));
        }
    }
    cols
}

#[cfg(all(not(feature = "csv"), feature = "interp"))]
fn read(text: &str) -> Vec<Vec<f64>> {
    let d = standin::detect::detect(text);
    standin::detect::read_columns(text, &d)
}

#[cfg(all(not(feature = "csv"), not(feature = "interp")))]
fn read(text: &str) -> Vec<Vec<f64>> {
    vec![vec![text.len() as f64]]
}

/// The Gaussian model `y0 + a*exp(-((x - x0)/w)^2)` and its derivatives.
#[cfg(any(feature = "fit-lm", feature = "fit-rmpfit"))]
fn gauss(x: f64, p: &[f64]) -> (f64, [f64; 4]) {
    let t = (x - p[2]) / p[3];
    let e = libm::exp(-t * t);
    let f = p[0] + p[1] * e;
    let d = [
        1.0,
        e,
        p[1] * e * 2.0 * t / p[3],
        p[1] * e * 2.0 * t * t / p[3],
    ];
    (f, d)
}

#[cfg(feature = "fit-lm")]
mod lm {
    use levenberg_marquardt::{LeastSquaresProblem, LevenbergMarquardt};
    use nalgebra::{DMatrix, DVector, Dyn, Owned};

    struct Gauss<'a> {
        x: &'a [f64],
        y: &'a [f64],
        p: DVector<f64>,
    }

    impl LeastSquaresProblem<f64, Dyn, Dyn> for Gauss<'_> {
        type ResidualStorage = Owned<f64, Dyn>;
        type JacobianStorage = Owned<f64, Dyn, Dyn>;
        type ParameterStorage = Owned<f64, Dyn>;

        fn set_params(&mut self, p: &DVector<f64>) {
            self.p.copy_from(p);
        }
        fn params(&self) -> DVector<f64> {
            self.p.clone()
        }
        fn residuals(&self) -> Option<DVector<f64>> {
            let p = self.p.as_slice();
            Some(DVector::from_iterator(
                self.x.len(),
                self.x
                    .iter()
                    .zip(self.y)
                    .map(|(&x, &y)| super::gauss(x, p).0 - y),
            ))
        }
        fn jacobian(&self) -> Option<DMatrix<f64>> {
            let p = self.p.as_slice();
            let mut j = DMatrix::zeros(self.x.len(), 4);
            for (i, &x) in self.x.iter().enumerate() {
                let (_, d) = super::gauss(x, p);
                for (k, dk) in d.iter().enumerate() {
                    j[(i, k)] = *dk;
                }
            }
            Some(j)
        }
    }

    /// Fits and returns the parameters, their errors, chi-square, and
    /// whether the fit converged.
    pub fn fit(x: &[f64], y: &[f64], p0: &[f64]) -> Vec<f64> {
        let problem = Gauss {
            x,
            y,
            p: DVector::from_column_slice(p0),
        };
        let (problem, report) = LevenbergMarquardt::new().minimize(problem);
        let chisq = report.objective_function * 2.0;
        let mut out: Vec<f64> = problem.p.iter().copied().collect();
        let dof = (x.len() as f64 - 4.0).max(1.0);
        let errs = problem
            .jacobian()
            .and_then(|j| (j.transpose() * &j).try_inverse())
            .map(|c| {
                (0..4)
                    .map(|k| libm::sqrt(c[(k, k)] * chisq / dof))
                    .collect()
            })
            .unwrap_or_else(|| vec![f64::NAN; 4]);
        out.extend(errs);
        out.push(chisq);
        out.push(if report.termination.was_successful() {
            1.0
        } else {
            0.0
        });
        out
    }
}

/// Fits a Gaussian with levenberg-marquardt.
#[cfg(feature = "fit-lm")]
#[wasm_bindgen]
pub fn fit_lm(x: &[f64], y: &[f64], p0: &[f64]) -> Vec<f64> {
    lm::fit(x, y, p0)
}

#[cfg(feature = "fit-rmpfit")]
mod mp {
    use rmpfit::{MPFitter, MPResult};

    struct Gauss<'a> {
        x: &'a [f64],
        y: &'a [f64],
    }

    impl MPFitter for Gauss<'_> {
        fn eval(&mut self, params: &[f64], deviates: &mut [f64]) -> MPResult<()> {
            for ((d, &x), &y) in deviates.iter_mut().zip(self.x).zip(self.y) {
                *d = y - super::gauss(x, params).0;
            }
            Ok(())
        }
        fn number_of_points(&self) -> usize {
            self.x.len()
        }
    }

    /// Fits and returns the parameters, their errors, chi-square, and
    /// whether the fit converged.
    pub fn fit(x: &[f64], y: &[f64], p0: &[f64]) -> Vec<f64> {
        let mut p = p0.to_vec();
        let mut g = Gauss { x, y };
        match g.mpfit(&mut p) {
            Ok(st) => {
                let mut out = p;
                out.extend(st.xerror.iter().copied());
                out.push(st.best_norm);
                out.push(1.0);
                out
            }
            Err(_) => vec![f64::NAN; 10],
        }
    }
}

/// Fits a Gaussian with rmpfit.
#[cfg(feature = "fit-rmpfit")]
#[wasm_bindgen]
pub fn fit_mp(x: &[f64], y: &[f64], p0: &[f64]) -> Vec<f64> {
    mp::fit(x, y, p0)
}

/// Calls generated function `i`. Only there so the generated code is kept.
#[cfg(feature = "ballast")]
#[wasm_bindgen]
pub fn ballast(i: u32, x: f64) -> f64 {
    ballast::call(i, x)
}
