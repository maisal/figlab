//! Stand-in for the PDF export module, loaded only when the user exports.
//!
//! Input: the flat draw data made by the render module, the texts of the
//! glyph runs (one per line), and the font file. Output: a PDF file with
//! the font embedded as a subset.

use standin::layout::{Draw, PathCmd, unflatten};
use wasm_bindgen::prelude::*;

/// Makes a PDF from draw data. `texts` has one line per glyph run.
#[wasm_bindgen]
pub fn export_pdf(draw: &[f32], texts: &str, font: Vec<u8>, width: f32, height: f32) -> Vec<u8> {
    let items = unflatten(draw);
    let texts: Vec<&str> = texts.split('\n').collect();
    imp::export(&items, &texts, font, width, height)
}

#[cfg(feature = "krilla")]
mod imp {
    use super::*;
    use krilla::Document;
    use krilla::color::rgb;
    use krilla::geom::{PathBuilder, Point};
    use krilla::page::PageSettings;
    use krilla::paint::{Fill, Stroke};
    use krilla::text::{Font, GlyphId, KrillaGlyph};

    fn color(c: u32) -> rgb::Color {
        rgb::Color::new((c >> 16) as u8, (c >> 8) as u8, c as u8)
    }

    pub fn export(items: &[Draw], texts: &[&str], font: Vec<u8>, w: f32, h: f32) -> Vec<u8> {
        let mut doc = Document::new();
        let font = Font::new(font.into(), 0);
        let Some(settings) = PageSettings::from_wh(w, h) else {
            return Vec::new();
        };
        let mut page = doc.start_page_with(settings);
        let mut surface = page.surface();
        let mut run = 0;
        for item in items {
            match item {
                Draw::Line {
                    points,
                    width,
                    color: c,
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
                        surface.set_fill(None);
                        surface.set_stroke(Some(Stroke {
                            paint: color(*c).into(),
                            width: *width,
                            ..Default::default()
                        }));
                        surface.draw_path(&path);
                    }
                }
                Draw::Path { cmds, color: c } => {
                    let mut pb = PathBuilder::new();
                    for cmd in cmds {
                        match *cmd {
                            PathCmd::M(x, y) => pb.move_to(x, y),
                            PathCmd::L(x, y) => pb.line_to(x, y),
                            PathCmd::Q(a, b, x, y) => pb.quad_to(a, b, x, y),
                            PathCmd::C(a, b, c2, d, x, y) => pb.cubic_to(a, b, c2, d, x, y),
                            PathCmd::Z => pb.close(),
                        }
                    }
                    if let Some(path) = pb.finish() {
                        surface.set_stroke(None);
                        surface.set_fill(Some(Fill {
                            paint: color(*c).into(),
                            ..Default::default()
                        }));
                        surface.draw_path(&path);
                    }
                }
                Draw::Glyphs {
                    glyphs, size, x, y, ..
                } => {
                    let text = texts.get(run).copied().unwrap_or("");
                    run += 1;
                    let Some(font) = font.clone() else { continue };
                    let chars: Vec<(usize, char)> = text.char_indices().collect();
                    let kg: Vec<KrillaGlyph> = glyphs
                        .iter()
                        .enumerate()
                        .map(|(i, (g, gx, _))| {
                            let next = glyphs.get(i + 1).map(|n| n.1).unwrap_or(*gx + size * 0.5);
                            let range = if chars.len() == glyphs.len() {
                                let s = chars[i].0;
                                s..s + chars[i].1.len_utf8()
                            } else if i == 0 {
                                0..text.len()
                            } else {
                                text.len()..text.len()
                            };
                            KrillaGlyph::new(
                                GlyphId::new(u32::from(*g)),
                                (next - gx) / size,
                                0.0,
                                0.0,
                                0.0,
                                range,
                                None,
                            )
                        })
                        .collect();
                    surface.set_stroke(None);
                    surface.set_fill(Some(Fill::default()));
                    surface.draw_glyphs(Point::from_xy(*x, *y), &kg, font, text, *size, false);
                }
            }
        }
        surface.finish();
        page.finish();
        doc.finish().unwrap_or_default()
    }
}

/// Font metrics for the PDF font dictionaries, in font units.
#[cfg(all(
    any(feature = "pdf-writer-min", feature = "pdf-writer-skrifa"),
    not(feature = "krilla")
))]
struct Metrics {
    upem: f32,
    ascent: f32,
    descent: f32,
    cap_height: f32,
    bbox: [f32; 4],
    widths: Vec<f32>,
}

/// Metrics read with skrifa (the same font stack as the harfrust shaper).
#[cfg(all(feature = "pdf-writer-skrifa", not(feature = "krilla")))]
fn metrics(font: &[u8], gids: impl Iterator<Item = u16>) -> Option<Metrics> {
    use skrifa::instance::{LocationRef, Size};
    use skrifa::{FontRef, GlyphId, MetadataProvider};
    let f = FontRef::new(font).ok()?;
    let m = f.metrics(Size::unscaled(), LocationRef::default());
    let gm = f.glyph_metrics(Size::unscaled(), LocationRef::default());
    let bbox = m
        .bounds
        .map(|b| [b.x_min, b.y_min, b.x_max, b.y_max])
        .unwrap_or_default();
    Some(Metrics {
        upem: f32::from(m.units_per_em),
        ascent: m.ascent,
        descent: m.descent,
        cap_height: m.cap_height.unwrap_or(0.0),
        bbox,
        widths: gids
            .map(|g| gm.advance_width(GlyphId::new(u32::from(g))).unwrap_or(0.0))
            .collect(),
    })
}

/// Metrics read with ttf-parser.
#[cfg(all(
    feature = "pdf-writer-min",
    not(feature = "pdf-writer-skrifa"),
    not(feature = "krilla")
))]
fn metrics(font: &[u8], gids: impl Iterator<Item = u16>) -> Option<Metrics> {
    let face = ttf_parser::Face::parse(font, 0).ok()?;
    let bb = face.global_bounding_box();
    Some(Metrics {
        upem: f32::from(face.units_per_em()),
        ascent: f32::from(face.ascender()),
        descent: f32::from(face.descender()),
        cap_height: f32::from(face.capital_height().unwrap_or(0)),
        bbox: [
            f32::from(bb.x_min),
            f32::from(bb.y_min),
            f32::from(bb.x_max),
            f32::from(bb.y_max),
        ],
        widths: gids
            .map(|g| f32::from(face.glyph_hor_advance(ttf_parser::GlyphId(g)).unwrap_or(0)))
            .collect(),
    })
}

#[cfg(all(
    any(feature = "pdf-writer-min", feature = "pdf-writer-skrifa"),
    not(feature = "krilla")
))]
mod imp {
    use super::*;
    use pdf_writer::types::{CidFontType, FontFlags, SystemInfo, UnicodeCmap};
    use pdf_writer::{Content, Filter, Finish, Name, Pdf, Rect, Ref, Str};

    fn rgb(c: u32) -> (f32, f32, f32) {
        (
            ((c >> 16) & 255) as f32 / 255.0,
            ((c >> 8) & 255) as f32 / 255.0,
            (c & 255) as f32 / 255.0,
        )
    }

    pub fn export(items: &[Draw], texts: &[&str], font: Vec<u8>, w: f32, h: f32) -> Vec<u8> {
        // Collect the glyphs used, and their text for ToUnicode.
        let mut remapper = subsetter::GlyphRemapper::new();
        let mut cmap = UnicodeCmap::new(
            Name(b"Custom"),
            SystemInfo {
                registry: Str(b"Adobe"),
                ordering: Str(b"Identity"),
                supplement: 0,
            },
        );
        let mut run = 0;
        let mut content = Content::new();
        for item in items {
            match item {
                Draw::Line {
                    points,
                    width,
                    color,
                } => {
                    let (r, g, b) = rgb(*color);
                    content.set_stroke_rgb(r, g, b);
                    content.set_line_width(*width);
                    for (i, (x, y)) in points.iter().enumerate() {
                        if i == 0 {
                            content.move_to(*x, h - *y);
                        } else {
                            content.line_to(*x, h - *y);
                        }
                    }
                    content.stroke();
                }
                Draw::Path { cmds, color } => {
                    let (r, g, b) = rgb(*color);
                    content.set_fill_rgb(r, g, b);
                    let mut cur = (0.0, 0.0);
                    for cmd in cmds {
                        match *cmd {
                            PathCmd::M(x, y) => {
                                content.move_to(x, h - y);
                                cur = (x, y);
                            }
                            PathCmd::L(x, y) => {
                                content.line_to(x, h - y);
                                cur = (x, y);
                            }
                            PathCmd::Q(a, b, x, y) => {
                                let c1 = (
                                    cur.0 + 2.0 / 3.0 * (a - cur.0),
                                    cur.1 + 2.0 / 3.0 * (b - cur.1),
                                );
                                let c2 = (x + 2.0 / 3.0 * (a - x), y + 2.0 / 3.0 * (b - y));
                                content.cubic_to(c1.0, h - c1.1, c2.0, h - c2.1, x, h - y);
                                cur = (x, y);
                            }
                            PathCmd::C(a, b, c2, d, x, y) => {
                                content.cubic_to(a, h - b, c2, h - d, x, h - y);
                                cur = (x, y);
                            }
                            PathCmd::Z => {
                                content.close_path();
                            }
                        }
                    }
                    content.fill_nonzero();
                }
                Draw::Glyphs { glyphs, size, .. } => {
                    let text = texts.get(run).copied().unwrap_or("");
                    run += 1;
                    let chars: Vec<char> = text.chars().collect();
                    content.begin_text();
                    content.set_fill_rgb(0.0, 0.0, 0.0);
                    content.set_font(Name(b"F1"), *size);
                    for (i, (g, x, y)) in glyphs.iter().enumerate() {
                        let new = remapper.remap(*g);
                        if chars.len() == glyphs.len() {
                            cmap.pair(new, chars[i]);
                        }
                        content.set_text_matrix([1.0, 0.0, 0.0, 1.0, *x, h - *y]);
                        content.show(Str(&new.to_be_bytes()));
                    }
                    content.end_text();
                }
            }
        }

        let catalog = Ref::new(1);
        let tree = Ref::new(2);
        let page_id = Ref::new(3);
        let font_id = Ref::new(4);
        let cid_id = Ref::new(5);
        let desc_id = Ref::new(6);
        let file_id = Ref::new(7);
        let cmap_id = Ref::new(8);
        let content_id = Ref::new(9);
        let base = Name(b"AAAAAA+Arimo");

        let mut pdf = Pdf::new();
        pdf.catalog(catalog).pages(tree);
        pdf.pages(tree).kids([page_id]).count(1);
        let mut page = pdf.page(page_id);
        page.media_box(Rect::new(0.0, 0.0, w, h));
        page.parent(tree);
        page.contents(content_id);
        page.resources().fonts().pair(Name(b"F1"), font_id);
        page.finish();

        pdf.type0_font(font_id)
            .base_font(base)
            .encoding_predefined(Name(b"Identity-H"))
            .descendant_font(cid_id)
            .to_unicode(cmap_id);

        let mut cid = pdf.cid_font(cid_id);
        cid.subtype(CidFontType::Type2);
        cid.base_font(base);
        cid.system_info(SystemInfo {
            registry: Str(b"Adobe"),
            ordering: Str(b"Identity"),
            supplement: 0,
        });
        cid.font_descriptor(desc_id);
        cid.default_width(0.0);
        cid.cid_to_gid_map_predefined(Name(b"Identity"));
        let Some(m) = super::metrics(&font, remapper.remapped_gids()) else {
            return Vec::new();
        };
        let to_pdf = |v: f32| v / m.upem * 1000.0;
        cid.widths()
            .consecutive(0, m.widths.iter().map(|w| to_pdf(*w)));
        cid.finish();

        pdf.font_descriptor(desc_id)
            .name(base)
            .flags(FontFlags::NON_SYMBOLIC)
            .bbox(Rect::new(
                to_pdf(m.bbox[0]),
                to_pdf(m.bbox[1]),
                to_pdf(m.bbox[2]),
                to_pdf(m.bbox[3]),
            ))
            .italic_angle(0.0)
            .ascent(to_pdf(m.ascent))
            .descent(to_pdf(m.descent))
            .cap_height(to_pdf(m.cap_height))
            .stem_v(80.0)
            .font_file2(file_id);

        let subset = subsetter::subset(&font, 0, &remapper).unwrap_or_default();
        let packed = miniz_oxide::deflate::compress_to_vec_zlib(&subset, 6);
        pdf.stream(file_id, &packed).filter(Filter::FlateDecode);

        pdf.cmap(cmap_id, &cmap.finish());
        let data = content.finish();
        let packed = miniz_oxide::deflate::compress_to_vec_zlib(&data, 6);
        pdf.stream(content_id, &packed).filter(Filter::FlateDecode);
        pdf.finish()
    }
}

#[cfg(not(any(
    feature = "krilla",
    feature = "pdf-writer-min",
    feature = "pdf-writer-skrifa"
)))]
mod imp {
    use super::*;

    pub fn export(items: &[Draw], _: &[&str], _: Vec<u8>, _: f32, _: f32) -> Vec<u8> {
        vec![items.len() as u8]
    }
}
