//! Generated code that only adds size. See build.rs.

#![allow(clippy::all, unused_assignments, unused_mut, unused_variables)]

include!(concat!(env!("OUT_DIR"), "/ballast.rs"));

/// The number of generated functions.
pub fn count() -> usize {
    FNS.len()
}

/// Calls generated function `i` (modulo the count). Returns `x` if there are none.
pub fn call(i: u32, x: f64) -> f64 {
    if FNS.is_empty() {
        return x;
    }
    let mut s = [x; 8];
    FNS[i as usize % FNS.len()](x, &mut s)
}
