//! A tiny wasm module for the S3 experiment (data transfer between workers).
//!
//! It has no dependencies and uses plain `extern "C"` exports, so no
//! wasm-bindgen is needed. The memory is the same kind of
//! `WebAssembly.Memory` that wasm-bindgen would give (not shared).
//! wasm-bindgen would add glue code, but the memory and the copies are the same.

use std::alloc::{Layout, alloc, dealloc};

fn layout(bytes: usize) -> Layout {
    Layout::from_size_align(bytes.max(8), 8).expect("valid layout")
}

/// Allocates `bytes` bytes aligned to 8 and returns the address in wasm memory.
/// The memory may grow, which detaches the old `memory.buffer` in JavaScript.
#[unsafe(no_mangle)]
pub extern "C" fn alloc_bytes(bytes: usize) -> *mut u8 {
    // SAFETY: the layout has a non-zero size.
    unsafe { alloc(layout(bytes)) }
}

/// Frees memory from `alloc_bytes`. wasm memory never shrinks, so the pages
/// stay with the module and are reused by later allocations.
///
/// # Safety
///
/// `ptr` must come from `alloc_bytes(bytes)` and must not be freed twice.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn free_bytes(ptr: *mut u8, bytes: usize) {
    // SAFETY: the caller keeps the contract above.
    unsafe { dealloc(ptr, layout(bytes)) }
}

/// Writes `i as f64` into each of the `n` values at `ptr`, so that every page is touched.
///
/// # Safety
///
/// `ptr` must point to `n` f64 values that this module allocated.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn fill_f64(ptr: *mut f64, n: usize) {
    // SAFETY: the caller keeps the contract above.
    let values = unsafe { std::slice::from_raw_parts_mut(ptr, n) };
    for (i, v) in values.iter_mut().enumerate() {
        *v = i as f64;
    }
}

/// Returns the sum of the `n` values at `ptr`. Used to check that copies arrived.
///
/// # Safety
///
/// `ptr` must point to `n` f64 values that this module allocated.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sum_f64(ptr: *const f64, n: usize) -> f64 {
    // SAFETY: the caller keeps the contract above.
    let values = unsafe { std::slice::from_raw_parts(ptr, n) };
    values.iter().sum()
}

/// Returns the current size of wasm memory in bytes.
#[unsafe(no_mangle)]
pub extern "C" fn memory_bytes() -> usize {
    core::arch::wasm32::memory_size(0) * 65536
}
