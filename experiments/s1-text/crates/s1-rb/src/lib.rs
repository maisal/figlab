//! Shaping candidate 1: rustybuzz 0.20 with ttf-parser 0.25 for cmap and outlines.

use s1_core::{GlyphPos, Outline, Shaper};

pub struct RbShaper {
    faces: Vec<Option<rustybuzz::Face<'static>>>,
}

impl RbShaper {
    /// One entry per font id. An empty slice means the font is not loaded.
    pub fn new(fonts: &[&'static [u8]]) -> Self {
        let faces = fonts
            .iter()
            .map(|d| {
                if d.is_empty() {
                    None
                } else {
                    rustybuzz::Face::from_slice(d, 0)
                }
            })
            .collect();
        RbShaper { faces }
    }
    fn face(&self, font: u8) -> &rustybuzz::Face<'static> {
        self.faces[font as usize].as_ref().expect("font not loaded")
    }
}

struct Pen<'a>(&'a mut Outline);
impl ttf_parser::OutlineBuilder for Pen<'_> {
    fn move_to(&mut self, x: f32, y: f32) {
        self.0.move_to(x, y);
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.0.line_to(x, y);
    }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        self.0.quad_to(x1, y1, x, y);
    }
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        self.0.curve_to(x1, y1, x2, y2, x, y);
    }
    fn close(&mut self) {
        self.0.close();
    }
}

impl Shaper for RbShaper {
    fn units_per_em(&self, font: u8) -> u16 {
        self.face(font).units_per_em() as u16
    }
    fn has_char(&self, font: u8, c: char) -> bool {
        self.face(font).glyph_index(c).is_some_and(|g| g.0 != 0)
    }
    fn shape(&self, font: u8, text: &str, out: &mut Vec<GlyphPos>) {
        let mut buf = rustybuzz::UnicodeBuffer::new();
        buf.push_str(text);
        buf.set_direction(rustybuzz::Direction::LeftToRight);
        buf.guess_segment_properties();
        let gb = rustybuzz::shape(self.face(font), &[], buf);
        for (i, p) in gb.glyph_infos().iter().zip(gb.glyph_positions()) {
            out.push(GlyphPos {
                gid: i.glyph_id as u16,
                cluster: i.cluster,
                x_advance: p.x_advance,
                y_advance: p.y_advance,
                x_offset: p.x_offset,
                y_offset: p.y_offset,
            });
        }
    }
    fn outline(&self, font: u8, gid: u16, out: &mut Outline) {
        let _ = self
            .face(font)
            .outline_glyph(ttf_parser::GlyphId(gid), &mut Pen(out));
    }
}

/// Font metrics for the fallback comparison, read with ttf-parser.
pub struct Metrics {
    pub units_per_em: u16,
    pub x_height: Option<i16>,
    pub cap_height: Option<i16>,
    pub ascender: i16,
    pub descender: i16,
    pub num_glyphs: u16,
}

pub fn metrics(data: &[u8]) -> Option<Metrics> {
    let f = ttf_parser::Face::parse(data, 0).ok()?;
    Some(Metrics {
        units_per_em: f.units_per_em(),
        x_height: f.x_height(),
        cap_height: f.capital_height(),
        ascender: f.ascender(),
        descender: f.descender(),
        num_glyphs: f.number_of_glyphs(),
    })
}

/// Bounding box of the glyph for `c`, in font units: (x_min, y_min, x_max, y_max).
pub fn char_bbox(data: &[u8], c: char) -> Option<(i16, i16, i16, i16)> {
    let f = ttf_parser::Face::parse(data, 0).ok()?;
    let g = f.glyph_index(c)?;
    let b = f.glyph_bounding_box(g)?;
    Some((b.x_min, b.y_min, b.x_max, b.y_max))
}

/// The license URL or text in the name table (name ids 14 and 13).
pub fn license(data: &[u8]) -> String {
    let Ok(f) = ttf_parser::Face::parse(data, 0) else {
        return String::new();
    };
    let mut url = None;
    let mut text = None;
    for n in f.names() {
        if !n.is_unicode() {
            continue;
        }
        match n.name_id {
            14 if url.is_none() => url = n.to_string(),
            13 if text.is_none() => text = n.to_string(),
            _ => {}
        }
    }
    url.or(text).unwrap_or_default()
}
