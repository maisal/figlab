//! Stand-in for the PNG export module, loaded only when the user exports.
//!
//! Input: the flat draw data made by the render module. Glyphs are drawn
//! from the outlines in the draw data, so this module needs no font parser.

use standin::layout::{Draw, PathCmd, unflatten};
use tiny_skia::{FillRule, Paint, PathBuilder, Pixmap, Stroke, Transform};
use wasm_bindgen::prelude::*;

fn paint(c: u32) -> Paint<'static> {
    let mut p = Paint::default();
    p.set_color_rgba8((c >> 16) as u8, (c >> 8) as u8, c as u8, 255);
    p.anti_alias = true;
    p
}

/// Draws the draw data at `dpi` and returns a PNG file (raw RGBA pixels without the `png-format` feature).
#[wasm_bindgen]
pub fn export_png(draw: &[f32], width: f32, height: f32, dpi: f32) -> Vec<u8> {
    let scale = dpi / 72.0;
    let w = (width * scale).ceil() as u32;
    let h = (height * scale).ceil() as u32;
    let Some(mut pm) = Pixmap::new(w.max(1), h.max(1)) else {
        return Vec::new();
    };
    pm.fill(tiny_skia::Color::WHITE);
    let t = Transform::from_scale(scale, scale);
    for item in unflatten(draw) {
        match item {
            Draw::Line {
                points,
                width,
                color,
            } => {
                let mut pb = PathBuilder::new();
                for (i, (x, y)) in points.iter().enumerate() {
                    if i == 0 {
                        pb.move_to(*x, *y);
                    } else {
                        pb.line_to(*x, *y);
                    }
                }
                if let Some(path) = pb.finish() {
                    let stroke = Stroke {
                        width,
                        ..Default::default()
                    };
                    pm.stroke_path(&path, &paint(color), &stroke, t, None);
                }
            }
            Draw::Path { cmds, color } => {
                let mut pb = PathBuilder::new();
                for c in cmds {
                    match c {
                        PathCmd::M(x, y) => pb.move_to(x, y),
                        PathCmd::L(x, y) => pb.line_to(x, y),
                        PathCmd::Q(a, b, x, y) => pb.quad_to(a, b, x, y),
                        PathCmd::C(a, b, c2, d, x, y) => pb.cubic_to(a, b, c2, d, x, y),
                        PathCmd::Z => pb.close(),
                    }
                }
                if let Some(path) = pb.finish() {
                    pm.fill_path(&path, &paint(color), FillRule::Winding, t, None);
                }
            }
            Draw::Glyphs { .. } => {}
        }
    }
    #[cfg(feature = "png-format")]
    return pm.encode_png().unwrap_or_default();
    #[cfg(not(feature = "png-format"))]
    return pm.data().to_vec();
}
