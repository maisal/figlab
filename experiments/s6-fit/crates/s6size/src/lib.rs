//! A minimal wasm module with one gauss fit (forward differences), for the
//! size of each candidate. scripts/size.sh builds it once per feature.
//!
//! Exports: `alloc(n)` returns a buffer of `n` f64 values; `fit(x, y, n, p)`
//! fits `y` against `x` and writes the 4 parameters to `p`.

use s6fit::fit::{Deriv, Spec};
use s6fit::models::Model;
use s6fit::problem::{Data, Problem};

#[unsafe(no_mangle)]
pub extern "C" fn alloc(n: usize) -> *mut f64 {
    let mut v = vec![0.0f64; n];
    let p = v.as_mut_ptr();
    core::mem::forget(v);
    p
}

/// # Safety
/// `x` and `y` point to `n` values, `p` to 4 values.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn fit(x: *const f64, y: *const f64, n: usize, p: *mut f64) -> i32 {
    // SAFETY: as the caller promises.
    let (x, y, p) = unsafe {
        (
            core::slice::from_raw_parts(x, n),
            core::slice::from_raw_parts(y, n),
            core::slice::from_raw_parts_mut(p, 4),
        )
    };
    let data = Data {
        ncols: 1,
        x: x.to_vec(),
        y: y.to_vec(),
        w: None,
    };
    let prob = Problem {
        model: Model::Gauss,
        data: &data,
    };
    let mut s = Spec::free(p, Deriv::Forward);
    s.lower[3] = 0.0;
    let out = run(&prob, &s);
    p.copy_from_slice(&out);
    0
}

#[cfg(feature = "base")]
fn run(prob: &Problem, s: &Spec) -> Vec<f64> {
    let mut r = vec![0.0; prob.m()];
    prob.resid(&s.init, &mut r);
    let mut out = s.init.clone();
    out[0] = r[0];
    out
}

#[cfg(feature = "lm")]
fn run(prob: &Problem, s: &Spec) -> Vec<f64> {
    let mut s = s.clone();
    s.lower[3] = f64::NEG_INFINITY;
    s6fit::cands::lm::fit(prob, &s, s6fit::cands::lm::Variant::Plain).params
}

#[cfg(feature = "lm-transform")]
fn run(prob: &Problem, s: &Spec) -> Vec<f64> {
    s6fit::cands::lm::fit(prob, s, s6fit::cands::lm::Variant::Transform).params
}

#[cfg(feature = "lm-bounded")]
fn run(prob: &Problem, s: &Spec) -> Vec<f64> {
    s6fit::cands::lm::fit(prob, s, s6fit::cands::lm::Variant::Bounded).params
}

#[cfg(feature = "cmpfit")]
fn run(prob: &Problem, s: &Spec) -> Vec<f64> {
    s6fit::cands::cmpfit::fit(prob, s).params
}

#[cfg(feature = "rmpfit")]
fn run(prob: &Problem, s: &Spec) -> Vec<f64> {
    s6fit::cands::rmpfit::fit(prob, s).params
}
