//! S6: compare Levenberg-Marquardt implementations for figlab.
//!
//! See experiments/s6-fit/README.md. This code is an experiment, not part
//! of figlab.

pub mod cands;
pub mod fit;
pub mod linalg;
pub mod models;
pub mod nist;
pub mod problem;
pub mod suite;

#[cfg(all(target_arch = "wasm32", feature = "cmpfit"))]
mod wasm_libc;
