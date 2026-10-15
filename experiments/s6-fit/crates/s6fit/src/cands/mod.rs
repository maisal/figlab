//! The candidates. Each takes a `Problem` and a `Spec` and returns an `Out`.

#[cfg(feature = "cmpfit")]
pub mod cmpfit;
pub mod lm;
pub mod rmpfit;

/// Without the `cmpfit` feature (no C compiler), cmpfit runs fail.
#[cfg(not(feature = "cmpfit"))]
pub mod cmpfit {
    use crate::fit::{Out, Spec};
    use crate::problem::Problem;
    pub fn fit(_p: &Problem, _s: &Spec) -> Out {
        Out {
            status: "not built".into(),
            failed: true,
            ..Out::default()
        }
    }
}
