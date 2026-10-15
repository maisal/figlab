//! The S6 tests as a wasm module with a tiny export interface (no
//! wasm-bindgen). js/run-wasm.mjs and js/speed-wasm.mjs use it.
//!
//! - `run(kind)` runs the NIST (0), bounds (1), or gauss (2) tests and returns
//!   the length of the JSON text at `out_ptr()`.
//! - `gauss_setup(n)` makes the gauss data; `gauss_fit(cand, deriv, errors)` runs one
//!   fit (`errors` = 1: plus the error analysis) and returns its number of
//!   iterations. JavaScript times it.

use s6fit::fit::{ALL_CANDS, Cand, Deriv, analyze, run as fit_run};
use s6fit::models::Model;
use s6fit::problem::{Data, Problem};
use s6fit::suite;
use std::sync::Mutex;

static OUT: Mutex<Vec<u8>> = Mutex::new(Vec::new());
static GAUSS: Mutex<Option<Data>> = Mutex::new(None);

const SPEED_CANDS: [Cand; 4] = [Cand::Lm, Cand::LmBounded, Cand::Cmpfit, Cand::Rmpfit];

#[unsafe(no_mangle)]
pub extern "C" fn run(kind: u32) -> u32 {
    let text = match kind {
        0 => suite::nist_json(&ALL_CANDS),
        1 => suite::bounds_json(),
        _ => {
            let data = suite::gauss_data(100_000);
            let mut recs = vec![];
            for c in SPEED_CANDS {
                for d in [Deriv::Analytic, Deriv::Forward] {
                    recs.push(suite::gauss_json(&data, c, d));
                }
            }
            format!("[\n{}\n]\n", recs.join(",\n"))
        }
    };
    let mut out = OUT.lock().unwrap();
    *out = text.into_bytes();
    out.len() as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn out_ptr() -> *const u8 {
    OUT.lock().unwrap().as_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn gauss_setup(n: u32) {
    *GAUSS.lock().unwrap() = Some(suite::gauss_data(n as usize));
}

/// One gauss fit. With `errors` set, also the error analysis that figlab
/// adds (Jacobian and QR at the solution).
#[unsafe(no_mangle)]
pub extern "C" fn gauss_fit(cand: u32, deriv: u32, errors: u32) -> u32 {
    let g = GAUSS.lock().unwrap();
    let data = g.as_ref().expect("call gauss_setup first");
    let p = Problem {
        model: Model::Gauss,
        data,
    };
    let s = suite::gauss_spec(Deriv::from_u32(deriv));
    let out = fit_run(Cand::from_u32(cand), &p, &s);
    let it = out.iterations as u32;
    if errors != 0 {
        core::hint::black_box(analyze(&p, &s, out));
    }
    it
}
