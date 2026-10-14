//! Math functions that give the same bits on every platform.
//!
//! The standard float functions such as `f64::sin` call the math library of the
//! operating system. Its results can differ between platforms, and between
//! native builds and wasm. figlab must give bit-identical results everywhere
//! (docs/language.md 10.2), so it uses the pure Rust `libm` crate instead.
//! `clippy.toml` forbids the standard functions.
//!
//! `f64::sqrt`, `f64::mul_add`, `f64::floor`, and similar functions are not
//! listed here. IEEE 754 requires them to be exact or correctly rounded, so
//! they already give the same bits everywhere.

pub use libm::{
    acos, acosh, asin, asinh, atan, atan2, atanh, cbrt, cos, cosh, exp, exp2, expm1, hypot, log,
    log1p, log2, log10, pow, sin, sinh, tan, tanh,
};

#[cfg(test)]
mod tests {
    use super::*;

    /// The bits of a few results, computed once with libm and fixed. If one of
    /// these fails, results would differ from those of other platforms or of
    /// earlier builds.
    ///
    /// `exp(1.0)` is one ulp above the correctly rounded value, and the macOS
    /// math library gives the correctly rounded value. This is the kind of
    /// difference that this module avoids: what matters is that every
    /// platform gives the same bits.
    #[test]
    fn results_have_fixed_bits() {
        assert_eq!(exp(1.0).to_bits(), 0x4005_bf0a_8b14_576a);
        assert_eq!(sin(1.0).to_bits(), 0x3fea_ed54_8f09_0cee);
        assert_eq!(log(10.0).to_bits(), 0x4002_6bb1_bbb5_5516);
        assert_eq!(atan2(1.0, 2.0).to_bits(), 0x3fdd_ac67_0561_bb4f);
    }
}
