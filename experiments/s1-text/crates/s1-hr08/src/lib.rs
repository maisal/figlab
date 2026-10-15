//! harfrust 0.8.4 with skrifa 0.42: the versions on the same read-fonts (0.39) as
//! krilla 0.8.2. Only used to measure a wasm module with one font stack.
//! The API differs from harfrust 0.14 (`ShaperData` + `FontRef` instead of `Font`).

use harfrust08::{ShaperData, UnicodeBuffer};
use s1_core::{GlyphPos, Outline, Shaper};
use skrifa042::instance::{LocationRef, Size};
use skrifa042::outline::{DrawSettings, OutlinePen};
use skrifa042::raw::TableProvider;
use skrifa042::{FontRef, GlyphId, MetadataProvider};

struct Loaded {
    font: FontRef<'static>,
    data: ShaperData,
}

pub struct Hr08Shaper {
    fonts: Vec<Option<Loaded>>,
}

impl Hr08Shaper {
    pub fn new(fonts: &[&'static [u8]]) -> Self {
        let fonts = fonts
            .iter()
            .map(|d| {
                let font = FontRef::new(d).ok()?;
                let data = ShaperData::new(&font);
                Some(Loaded { font, data })
            })
            .collect();
        Hr08Shaper { fonts }
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

impl Shaper for Hr08Shaper {
    fn units_per_em(&self, font: u8) -> u16 {
        self.loaded(font)
            .font
            .head()
            .map(|h| h.units_per_em())
            .unwrap_or(1000)
    }
    fn has_char(&self, font: u8, c: char) -> bool {
        self.loaded(font)
            .font
            .charmap()
            .map(c)
            .is_some_and(|g| g.to_u32() != 0)
    }
    fn shape(&self, font: u8, text: &str, out: &mut Vec<GlyphPos>) {
        let l = self.loaded(font);
        let shaper = l.data.shaper(&l.font).build();
        let mut buf = UnicodeBuffer::new();
        buf.push_str(text);
        buf.set_direction(harfrust08::Direction::LeftToRight);
        buf.guess_segment_properties();
        let gb = shaper.shape(buf, Default::default());
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
        if let Some(g) = self
            .loaded(font)
            .font
            .outline_glyphs()
            .get(GlyphId::new(gid as u32))
        {
            let settings = DrawSettings::unhinted(Size::unscaled(), LocationRef::default());
            let _ = g.draw(settings, &mut Pen(out));
        }
    }
}
