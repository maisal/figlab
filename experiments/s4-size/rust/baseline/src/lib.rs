//! The smallest wasm-bindgen module, plus optional pieces of std.

use wasm_bindgen::prelude::*;

/// Adds two numbers. No allocation, no formatting.
#[wasm_bindgen]
pub fn add(a: u32, b: u32) -> u32 {
    a.wrapping_add(b)
}

/// Sums a vector, which needs the allocator.
#[cfg(feature = "alloc")]
#[wasm_bindgen]
pub fn sum(v: Vec<f64>) -> f64 {
    v.iter().sum()
}

/// Formats a float, which needs core::fmt.
#[cfg(feature = "fmt")]
#[wasm_bindgen]
pub fn show(x: f64) -> String {
    format!("{x}")
}

/// Encodes an RGBA image to PNG, with the png crate alone.
#[cfg(feature = "png-encode")]
#[wasm_bindgen]
pub fn encode_png(rgba: Vec<u8>, width: u32, height: u32) -> Vec<u8> {
    let mut out = Vec::new();
    let mut enc = png::Encoder::new(&mut out, width, height);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    if let Ok(mut w) = enc.write_header() {
        let _ = w.write_image_data(&rgba);
    }
    out
}
