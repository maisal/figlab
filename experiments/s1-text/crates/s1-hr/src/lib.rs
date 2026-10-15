//! Shaping candidate 2: harfrust 0.14 (read-fonts) with skrifa 0.48 for cmap and outlines.

use harfrust::{Buffer, Direction, ShaperFont};
use s1_core::{GlyphPos, Outline, Shaper};
use skrifa::instance::{LocationRef, Size};
use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::{FontRef, GlyphId, MetadataProvider};

struct Loaded {
    data: &'static [u8],
    font: harfrust::Font,
}

pub struct HrShaper {
    fonts: Vec<Option<Loaded>>,
}

impl HrShaper {
    /// One entry per font id. An empty slice means the font is not loaded.
    pub fn new(fonts: &[&'static [u8]]) -> Self {
        let fonts = fonts
            .iter()
            .map(|d| {
                if d.is_empty() {
                    return None;
                }
                Some(Loaded {
                    data: d,
                    font: harfrust::Font::new(*d, 0)?,
                })
            })
            .collect();
        HrShaper { fonts }
    }
    fn loaded(&self, font: u8) -> &Loaded {
        self.fonts[font as usize].as_ref().expect("font not loaded")
    }
}

struct Pen<'a>(&'a mut Outline);
impl OutlinePen for Pen<'_> {
    fn move_to(&mut self, x: f32, y: f32) {
        self.0.move_to(x, y);
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.0.line_to(x, y);
    }
    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        self.0.quad_to(cx0, cy0, x, y);
    }
    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        self.0.curve_to(cx0, cy0, cx1, cy1, x, y);
    }
    fn close(&mut self) {
        self.0.close();
    }
}

impl Shaper for HrShaper {
    fn units_per_em(&self, font: u8) -> u16 {
        self.loaded(font).font.units_per_em()
    }
    fn has_char(&self, font: u8, c: char) -> bool {
        self.loaded(font)
            .font
            .charmap()
            .map_unicode(c)
            .is_some_and(|g| g.to_u32() != 0)
    }
    fn shape(&self, font: u8, text: &str, out: &mut Vec<GlyphPos>) {
        let l = self.loaded(font);
        let shaper = ShaperFont::new(&l.font);
        let mut buf = Buffer::new();
        buf.push_str(text);
        buf.set_direction(Direction::LeftToRight);
        buf.guess_segment_properties();
        harfrust::shape(&shaper, &mut buf, Default::default()).expect("shape");
        for (i, p) in buf.glyph_infos().iter().zip(buf.glyph_positions()) {
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
        let f = FontRef::new(self.loaded(font).data).expect("font");
        if let Some(g) = f.outline_glyphs().get(GlyphId::new(gid as u32)) {
            let settings = DrawSettings::unhinted(Size::unscaled(), LocationRef::default());
            let _ = g.draw(settings, &mut Pen(out));
        }
    }
}
