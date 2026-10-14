//! PDF candidate 1: krilla 0.8 (default features off). krilla subsets the fonts,
//! writes CID fonts with ToUnicode, and compresses the streams.

use std::collections::BTreeMap;

use krilla::color::rgb;
use krilla::geom::{PathBuilder, Point, Transform};
use krilla::num::NormalizedF32;
use krilla::page::PageSettings;
use krilla::paint::{Fill, LineJoin, Stroke};
use krilla::text::{Font, GlyphId, KrillaGlyph};
use krilla::{Document, SerializeSettings};
use s1_core::{Page, Run};

fn color(c: u32) -> rgb::Color {
    rgb::Color::new((c >> 16) as u8, (c >> 8) as u8, c as u8)
}

/// Writes the sample page. `fonts[id]` is the font file of font id `id`.
pub fn write_pdf(page: &Page, runs: &[Run], fonts: &[&'static [u8]]) -> Vec<u8> {
    let settings = SerializeSettings {
        xmp_metadata: false,
        ..Default::default()
    };
    let mut doc = Document::new_with(settings);
    let mut kfonts: BTreeMap<u8, Font> = BTreeMap::new();
    {
        let mut p =
            doc.start_page_with(PageSettings::from_wh(page.width, page.height).expect("size"));
        let mut s = p.surface();
        s.set_fill(None);
        for l in &page.lines {
            let mut pb = PathBuilder::new();
            for (i, &(x, y)) in l.points.iter().enumerate() {
                if i == 0 {
                    pb.move_to(x, y);
                } else {
                    pb.line_to(x, y);
                }
            }
            s.set_stroke(Some(Stroke {
                paint: color(l.color).into(),
                width: l.width,
                line_join: LineJoin::Round,
                ..Default::default()
            }));
            if let Some(path) = pb.finish() {
                s.draw_path(&path);
            }
        }
        s.set_stroke(None);
        let mut glyphs = Vec::new();
        for r in runs {
            let font = kfonts
                .entry(r.font)
                .or_insert_with(|| Font::new(fonts[r.font as usize].into(), 0).expect("font"))
                .clone();
            s.set_fill(Some(Fill {
                paint: color(r.color).into(),
                opacity: NormalizedF32::ONE,
                rule: Default::default(),
            }));
            glyphs.clear();
            let mut pen = 0.0f32;
            for g in &r.glyphs {
                glyphs.push(KrillaGlyph::new(
                    GlyphId::new(g.gid as u32),
                    g.advance / r.size,
                    (g.dx - pen) / r.size,
                    -g.dy / r.size,
                    0.0,
                    g.text_start as usize..g.text_end as usize,
                    None,
                ));
                pen += g.advance;
            }
            // Rotated runs: baseline along -y, from the run origin (y is down in krilla).
            let t = if r.rotated {
                Transform::from_row(0.0, -1.0, 1.0, 0.0, r.x, r.y)
            } else {
                Transform::from_translate(r.x, r.y)
            };
            s.push_transform(&t);
            s.draw_glyphs(
                Point::from_xy(0.0, 0.0),
                &glyphs,
                font,
                &r.text,
                r.size,
                false,
            );
            s.pop();
        }
        s.finish();
        p.finish();
    }
    doc.finish().expect("pdf")
}
