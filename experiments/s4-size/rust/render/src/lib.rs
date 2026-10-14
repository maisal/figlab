//! Stand-in for the render module, which runs on the main thread.
//!
//! It loads a font, shapes text, lays out a simple graph, and returns draw
//! data (with glyph outlines for the screen) or an SVG document.

use standin::layout::{PathCmd, Shaper};
use std::cell::RefCell;
use wasm_bindgen::prelude::*;

// Linking the crates is enough: their #[wasm_bindgen] functions are exported.
#[cfg(any(
    feature = "with-pdf-krilla",
    feature = "with-pdf-writer",
    feature = "with-pdf-writer-skrifa"
))]
extern crate m_export_pdf;
#[cfg(feature = "with-png")]
extern crate m_export_png;

/// Collects outline commands, scaled from font units to pt.
#[allow(dead_code)]
struct Pen<'a> {
    out: &'a mut Vec<PathCmd>,
    scale: f32,
}

#[cfg(feature = "shape-rustybuzz")]
mod font {
    use super::Pen;
    use standin::layout::PathCmd;

    impl ttf_parser::OutlineBuilder for Pen<'_> {
        fn move_to(&mut self, x: f32, y: f32) {
            self.out.push(PathCmd::M(x * self.scale, y * self.scale));
        }
        fn line_to(&mut self, x: f32, y: f32) {
            self.out.push(PathCmd::L(x * self.scale, y * self.scale));
        }
        fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
            let s = self.scale;
            self.out.push(PathCmd::Q(x1 * s, y1 * s, x * s, y * s));
        }
        fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
            let s = self.scale;
            self.out
                .push(PathCmd::C(x1 * s, y1 * s, x2 * s, y2 * s, x * s, y * s));
        }
        fn close(&mut self) {
            self.out.push(PathCmd::Z);
        }
    }

    /// A font loaded with rustybuzz.
    pub struct Font {
        face: rustybuzz::Face<'static>,
    }

    impl Font {
        pub fn new(data: &'static [u8]) -> Option<Font> {
            Some(Font {
                face: rustybuzz::Face::from_slice(data, 0)?,
            })
        }
    }

    impl super::Shaper for Font {
        fn shape(&mut self, text: &str, size: f32) -> (Vec<(u16, f32)>, f32) {
            let scale = size / self.face.units_per_em() as f32;
            let mut buf = rustybuzz::UnicodeBuffer::new();
            buf.push_str(text);
            let glyphs = rustybuzz::shape(&self.face, &[], buf);
            let mut x = 0.0;
            let mut out = Vec::with_capacity(glyphs.len());
            for (info, pos) in glyphs.glyph_infos().iter().zip(glyphs.glyph_positions()) {
                out.push((info.glyph_id as u16, x + pos.x_offset as f32 * scale));
                x += pos.x_advance as f32 * scale;
            }
            (out, x)
        }
        fn outline(&mut self, glyph: u16, size: f32, out: &mut Vec<PathCmd>) {
            let scale = size / self.face.units_per_em() as f32;
            let mut pen = Pen { out, scale };
            let _ = self
                .face
                .outline_glyph(ttf_parser::GlyphId(glyph), &mut pen);
        }
    }
}

#[cfg(all(feature = "shape-harfrust", not(feature = "shape-rustybuzz")))]
mod font {
    use super::Pen;
    use skrifa::MetadataProvider;
    use skrifa::instance::{LocationRef, Size};
    use standin::layout::PathCmd;

    impl skrifa::outline::OutlinePen for Pen<'_> {
        fn move_to(&mut self, x: f32, y: f32) {
            self.out.push(PathCmd::M(x * self.scale, y * self.scale));
        }
        fn line_to(&mut self, x: f32, y: f32) {
            self.out.push(PathCmd::L(x * self.scale, y * self.scale));
        }
        fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
            let s = self.scale;
            self.out.push(PathCmd::Q(x1 * s, y1 * s, x * s, y * s));
        }
        fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
            let s = self.scale;
            self.out
                .push(PathCmd::C(x1 * s, y1 * s, x2 * s, y2 * s, x * s, y * s));
        }
        fn close(&mut self) {
            self.out.push(PathCmd::Z);
        }
    }

    /// A font loaded with harfrust (shaping) and skrifa (outlines).
    pub struct Font {
        font: &'static harfrust::Font,
        outlines: skrifa::FontRef<'static>,
        upem: f32,
    }

    impl Font {
        pub fn new(data: &'static [u8]) -> Option<Font> {
            let font: &'static harfrust::Font = Box::leak(Box::new(harfrust::Font::new(data, 0)?));
            let upem = f32::from(font.units_per_em());
            Some(Font {
                font,
                outlines: skrifa::FontRef::new(data).ok()?,
                upem,
            })
        }
    }

    impl super::Shaper for Font {
        fn shape(&mut self, text: &str, size: f32) -> (Vec<(u16, f32)>, f32) {
            let scale = size / self.upem;
            let sf = harfrust::ShaperFont::new(self.font);
            let mut buf = harfrust::Buffer::new();
            buf.push_str(text);
            buf.guess_segment_properties();
            if harfrust::shape(&sf, &mut buf, harfrust::ShapeOptions::new()).is_err() {
                return (Vec::new(), 0.0);
            }
            let mut x = 0.0;
            let mut out = Vec::new();
            for (info, pos) in buf.glyph_infos().iter().zip(buf.glyph_positions()) {
                out.push((info.glyph_id as u16, x + pos.x_offset as f32 * scale));
                x += pos.x_advance as f32 * scale;
            }
            (out, x)
        }
        fn outline(&mut self, glyph: u16, size: f32, out: &mut Vec<PathCmd>) {
            let scale = size / self.upem;
            let mut pen = Pen { out, scale };
            if let Some(g) = self
                .outlines
                .outline_glyphs()
                .get(skrifa::GlyphId::new(u32::from(glyph)))
            {
                let _ = g.draw((Size::unscaled(), LocationRef::default()), &mut pen);
            }
        }
    }
}

/// A shaper without a font: every character is half an em wide.
#[cfg(not(any(feature = "shape-rustybuzz", feature = "shape-harfrust")))]
mod font {
    use standin::layout::PathCmd;

    pub struct Font;

    impl Font {
        pub fn new(_data: &'static [u8]) -> Option<Font> {
            Some(Font)
        }
    }

    impl super::Shaper for Font {
        fn shape(&mut self, text: &str, size: f32) -> (Vec<(u16, f32)>, f32) {
            let out: Vec<(u16, f32)> = text
                .chars()
                .enumerate()
                .map(|(i, c)| (c as u16, i as f32 * size * 0.5))
                .collect();
            let w = out.len() as f32 * size * 0.5;
            (out, w)
        }
        fn outline(&mut self, _glyph: u16, size: f32, out: &mut Vec<PathCmd>) {
            out.extend([
                PathCmd::M(0.0, 0.0),
                PathCmd::L(size * 0.4, 0.0),
                PathCmd::L(size * 0.4, size * 0.7),
                PathCmd::Z,
            ]);
        }
    }
}

thread_local! {
    static FONT: RefCell<Option<font::Font>> = const { RefCell::new(None) };
}

/// Loads a font from its file contents. Returns false if it cannot be read.
#[wasm_bindgen]
pub fn load_font(data: Vec<u8>) -> bool {
    let data: &'static [u8] = Box::leak(data.into_boxed_slice());
    let f = font::Font::new(data);
    let ok = f.is_some();
    FONT.with(|cell| *cell.borrow_mut() = f);
    ok
}

/// Shapes a text. Returns the advance, then glyph ids and x positions in pairs.
#[wasm_bindgen]
pub fn shape(text: &str, size: f32) -> Vec<f32> {
    FONT.with(|cell| {
        let mut b = cell.borrow_mut();
        let Some(f) = b.as_mut() else {
            return Vec::new();
        };
        let (glyphs, adv) = f.shape(text, size);
        let mut out = vec![adv];
        for (g, x) in glyphs {
            out.push(f32::from(g));
            out.push(x);
        }
        out
    })
}

/// The outline of one glyph as flat path commands.
#[wasm_bindgen]
pub fn outline(glyph: u16, size: f32) -> Vec<f32> {
    FONT.with(|cell| {
        let mut b = cell.borrow_mut();
        let Some(f) = b.as_mut() else {
            return Vec::new();
        };
        let mut cmds = Vec::new();
        f.outline(glyph, size, &mut cmds);
        standin::layout::flatten(&[standin::layout::Draw::Path { cmds, color: 0 }])
    })
}

#[cfg(feature = "standin")]
fn graph(x: &[f64], y: &[f64], outlines: bool) -> standin::layout::Graph {
    standin::layout::Graph {
        width: 240.0,
        height: 180.0,
        x: x.to_vec(),
        y: y.to_vec(),
        xlabel: "Energy (meV)".into(),
        ylabel: "Intensity (counts)".into(),
        font_size: 9.0,
        outlines,
    }
}

/// Lays out an xy graph and returns the flat draw data for the screen.
#[cfg(feature = "standin")]
#[wasm_bindgen]
pub fn draw(x: &[f64], y: &[f64]) -> Vec<f32> {
    FONT.with(|cell| {
        let mut b = cell.borrow_mut();
        let Some(f) = b.as_mut() else {
            return Vec::new();
        };
        standin::layout::flatten(&standin::layout::layout(&graph(x, y, true), f))
    })
}

/// Lays out an xy graph and returns it as an SVG document.
#[cfg(feature = "standin")]
#[wasm_bindgen]
pub fn svg(x: &[f64], y: &[f64]) -> String {
    FONT.with(|cell| {
        let mut b = cell.borrow_mut();
        let Some(f) = b.as_mut() else {
            return String::new();
        };
        let d = standin::layout::layout(&graph(x, y, false), f);
        standin::svg::svg(&d, 240.0, 180.0, "Arimo")
    })
}

/// Calls generated function `i`. Only there so the generated code is kept.
#[cfg(feature = "ballast")]
#[wasm_bindgen]
pub fn ballast(i: u32, x: f64) -> f64 {
    ballast::call(i, x)
}
