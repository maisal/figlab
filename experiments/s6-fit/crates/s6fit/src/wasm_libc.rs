//! `malloc` and `free` for cmpfit in wasm32-unknown-unknown, which has no C
//! library. They use the Rust allocator. Each block has a 16-byte header
//! that holds its size. The other C functions cmpfit needs are in
//! csrc/wasm_shim.c (`printf`, `strcpy`), and `sqrt` and `fabs` become wasm
//! instructions (csrc/include/math.h).

use std::alloc::{Layout, alloc, dealloc};

const HEADER: usize = 16;

/// # Safety
/// Called from C as `malloc`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn malloc(size: usize) -> *mut u8 {
    let Ok(layout) = Layout::from_size_align(size + HEADER, HEADER) else {
        return core::ptr::null_mut();
    };
    // SAFETY: the layout has a non-zero size.
    unsafe {
        let p = alloc(layout);
        if p.is_null() {
            return p;
        }
        (p as *mut usize).write(size + HEADER);
        p.add(HEADER)
    }
}

/// # Safety
/// Called from C as `free`, with a pointer from `malloc` or null.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn free(p: *mut u8) {
    if p.is_null() {
        return;
    }
    // SAFETY: `p` came from `malloc`, so the header is just before it.
    unsafe {
        let base = p.sub(HEADER);
        let total = (base as *const usize).read();
        dealloc(base, Layout::from_size_align_unchecked(total, HEADER));
    }
}
