//! The S1 wasm module. It uses a plain C ABI so that the size numbers show the
//! libraries, not binding glue. JavaScript copies font files in with `s1_alloc`
//! and `s1_load_font`, calls a function, and reads the result at `s1_out_ptr`.
//!
//! Shaper ids: 0 = rustybuzz, 1 = harfrust 0.14, 2 = harfrust 0.8.
//! PDF ids: 0 = krilla, 1 = pdf-writer.

#![allow(clippy::missing_safety_doc)]

use std::cell::RefCell;

use s1_core::{FONT_FILES, Shaper};

#[derive(Default)]
struct State {
    fonts: Vec<&'static [u8]>,
    #[cfg(feature = "rb")]
    rb: Option<s1_rb::RbShaper>,
    #[cfg(feature = "hr")]
    hr: Option<s1_hr::HrShaper>,
    #[cfg(feature = "hr08")]
    hr08: Option<s1_hr08::Hr08Shaper>,
    out: Vec<u8>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State { fonts: vec![&[]; FONT_FILES.len()], ..Default::default() });
}

/// Returns a buffer of `len` bytes that JavaScript fills. It is never freed.
#[unsafe(no_mangle)]
pub extern "C" fn s1_alloc(len: usize) -> *mut u8 {
    Box::leak(vec![0u8; len].into_boxed_slice()).as_mut_ptr()
}

/// Sets font `id` to a buffer from `s1_alloc`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn s1_load_font(id: u32, ptr: *const u8, len: usize) {
    // SAFETY: the buffer comes from `s1_alloc` and is never freed.
    let data: &'static [u8] = unsafe { std::slice::from_raw_parts(ptr, len) };
    STATE.with_borrow_mut(|s| s.fonts[id as usize] = data);
}

/// Builds the shapers once all fonts are loaded.
#[unsafe(no_mangle)]
pub extern "C" fn s1_init() {
    STATE.with_borrow_mut(|_s| {
        #[cfg(feature = "rb")]
        {
            _s.rb = Some(s1_rb::RbShaper::new(&_s.fonts));
        }
        #[cfg(feature = "hr")]
        {
            _s.hr = Some(s1_hr::HrShaper::new(&_s.fonts));
        }
        #[cfg(feature = "hr08")]
        {
            _s.hr08 = Some(s1_hr08::Hr08Shaper::new(&_s.fonts));
        }
    });
}

#[unsafe(no_mangle)]
pub extern "C" fn s1_out_ptr() -> *const u8 {
    STATE.with_borrow(|s| s.out.as_ptr())
}

fn shaper(s: &State, id: u32) -> &dyn Shaper {
    let _ = s;
    match id {
        #[cfg(feature = "rb")]
        0 => s.rb.as_ref().expect("init"),
        #[cfg(feature = "hr")]
        1 => s.hr.as_ref().expect("init"),
        #[cfg(feature = "hr08")]
        2 => s.hr08.as_ref().expect("init"),
        _ => panic!("shaper {id} is not in this build"),
    }
}

/// Lays out the sample page and writes its draw data. Returns the length.
#[unsafe(no_mangle)]
pub extern "C" fn s1_draw_sample(shaper_id: u32, fallback: u32) -> u32 {
    STATE.with_borrow_mut(|s| {
        let sh = shaper(s, shaper_id);
        let page = s1_core::sample_page(fallback as u8);
        let runs = s1_core::layout_page(sh, &page);
        let out = s1_core::encode_draw_data(sh, &runs, &page.lines);
        s.out = out;
        s.out.len() as u32
    })
}

/// Lays out the fallback comparison sheet and writes its draw data. Returns the length.
#[unsafe(no_mangle)]
pub extern "C" fn s1_draw_fallback_sheet(shaper_id: u32) -> u32 {
    STATE.with_borrow_mut(|s| {
        let sh = shaper(s, shaper_id);
        let page = s1_core::fallback_sheet();
        let runs = s1_core::layout(sh, &page.labels);
        let out = s1_core::encode_draw_data(sh, &runs, &page.lines);
        s.out = out;
        s.out.len() as u32
    })
}

/// Lays out `n` labels and writes their draw data. Returns the length.
#[unsafe(no_mangle)]
pub extern "C" fn s1_draw_bench(shaper_id: u32, n: u32, fallback: u32) -> u32 {
    STATE.with_borrow_mut(|s| {
        let sh = shaper(s, shaper_id);
        let labels = s1_core::bench_labels(n as usize, fallback as u8);
        let runs = s1_core::layout(sh, &labels);
        let out = s1_core::encode_draw_data(sh, &runs, &[]);
        s.out = out;
        s.out.len() as u32
    })
}

/// Lays out `n` labels only (no outlines). Returns the number of glyphs.
#[unsafe(no_mangle)]
pub extern "C" fn s1_layout_bench(shaper_id: u32, n: u32, fallback: u32) -> u32 {
    STATE.with_borrow(|s| {
        let sh = shaper(s, shaper_id);
        let labels = s1_core::bench_labels(n as usize, fallback as u8);
        s1_core::layout(sh, &labels)
            .iter()
            .map(|r| r.glyphs.len() as u32)
            .sum()
    })
}

/// Writes the sample page as PDF with writer `kind`. Returns the length.
#[unsafe(no_mangle)]
pub extern "C" fn s1_pdf_sample(_kind: u32, _shaper_id: u32, _fallback: u32) -> u32 {
    STATE.with_borrow_mut(|_s| {
        let page = s1_core::sample_page(_fallback as u8);
        let runs = s1_core::layout_page(shaper(_s, _shaper_id), &page);
        let out: Vec<u8> = match _kind {
            #[cfg(feature = "krilla")]
            0 => s1_pdf_krilla::write_pdf(&page, &runs, &_s.fonts),
            #[cfg(feature = "pdfw")]
            1 => s1_pdf_writer::write_pdf(&page, &runs, &_s.fonts),
            _ => {
                let _ = runs;
                Vec::new()
            }
        };
        _s.out = out;
        _s.out.len() as u32
    })
}
