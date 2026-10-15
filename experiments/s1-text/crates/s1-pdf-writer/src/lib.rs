//! PDF candidate 2: pdf-writer 0.15 + subsetter 0.2, with miniz_oxide for
//! compression and skrifa for font metrics. Everything that krilla does for us
//! is written here by hand: CID fonts, widths, ToUnicode, compression, subset tags.

use std::collections::BTreeMap;

use pdf_writer::types::{CidFontType, FontFlags, LineJoinStyle, SystemInfo, UnicodeCmap};
use pdf_writer::{Content, Filter, Finish, Name, Pdf, Rect, Ref, Str};
use s1_core::{Page, Run};
use skrifa::instance::{LocationRef, Size};
use skrifa::raw::TableProvider;
use skrifa::string::StringId;
use skrifa::{FontRef, GlyphId, MetadataProvider, Tag};
use subsetter::GlyphRemapper;

const SYSTEM_INFO: SystemInfo = SystemInfo {
    registry: Str(b"Adobe"),
    ordering: Str(b"Identity"),
    supplement: 0,
};

fn deflate(data: &[u8]) -> Vec<u8> {
    miniz_oxide::deflate::compress_to_vec_zlib(data, 6)
}

fn rgb(c: u32) -> (f32, f32, f32) {
    (
        ((c >> 16) & 255) as f32 / 255.0,
        ((c >> 8) & 255) as f32 / 255.0,
        (c & 255) as f32 / 255.0,
    )
}

/// Per font: the glyph remapper and the text of each new glyph id (for ToUnicode).
struct FontUse {
    remapper: GlyphRemapper,
    to_unicode: BTreeMap<u16, String>,
}

/// Writes the sample page. `fonts[id]` is the font file of font id `id`.
pub fn write_pdf(page: &Page, runs: &[Run], fonts: &[&[u8]]) -> Vec<u8> {
    let mut uses: BTreeMap<u8, FontUse> = BTreeMap::new();
    // First pass: assign new glyph ids in order of use, so that the content can use them.
    for r in runs {
        let u = uses.entry(r.font).or_insert_with(|| FontUse {
            remapper: GlyphRemapper::new(),
            to_unicode: BTreeMap::new(),
        });
        for g in &r.glyphs {
            let new = u.remapper.remap(g.gid);
            let text = &r.text[g.text_start as usize..g.text_end as usize];
            // The first glyph of a cluster carries its text. A glyph keeps the first
            // text seen: a glyph used for two code points (for example U+002D and
            // U+00AD in Arimo) would need duplicate CIDs or ActualText.
            let first = r
                .glyphs
                .iter()
                .find(|o| o.text_start == g.text_start)
                .map(|o| o.gid)
                == Some(g.gid);
            if first && !text.is_empty() {
                u.to_unicode.entry(new).or_insert_with(|| text.to_string());
            }
        }
    }

    let mut alloc = Ref::new(1);
    let mut next = || alloc.bump();
    let catalog_id = next();
    let tree_id = next();
    let page_id = next();
    let content_id = next();
    let font_refs: BTreeMap<u8, Ref> = uses.keys().map(|&f| (f, next())).collect();

    let mut pdf = Pdf::new();
    pdf.catalog(catalog_id).pages(tree_id);
    pdf.pages(tree_id).kids([page_id]).count(1);
    {
        let mut p = pdf.page(page_id);
        p.media_box(Rect::new(0.0, 0.0, page.width, page.height));
        p.parent(tree_id);
        p.contents(content_id);
        let mut res = p.resources();
        let mut fd = res.fonts();
        for (&f, &r) in &font_refs {
            fd.pair(Name(format!("F{f}").as_bytes()), r);
        }
    }

    // Content stream. PDF y is up, so y_pdf = height - y.
    let h = page.height;
    let mut c = Content::new();
    c.set_line_join(LineJoinStyle::RoundJoin);
    for l in &page.lines {
        let (r, g, b) = rgb(l.color);
        c.set_stroke_rgb(r, g, b);
        c.set_line_width(l.width);
        for (i, &(x, y)) in l.points.iter().enumerate() {
            if i == 0 {
                c.move_to(x, h - y);
            } else {
                c.line_to(x, h - y);
            }
        }
        c.stroke();
    }
    let mut metrics_cache: BTreeMap<u8, (FontRef, f32)> = BTreeMap::new();
    for r in runs {
        let (font, upem) = metrics_cache
            .entry(r.font)
            .or_insert_with(|| {
                let f = FontRef::new(fonts[r.font as usize]).expect("font");
                let upem = f.head().map(|h| h.units_per_em()).unwrap_or(1000) as f32;
                (f, upem)
            })
            .clone();
        let gm = font.glyph_metrics(Size::unscaled(), LocationRef::default());
        let u = &uses[&r.font];
        let (cr, cg, cb) = rgb(r.color);
        c.set_fill_rgb(cr, cg, cb);
        c.begin_text();
        c.set_font(Name(format!("F{}", r.font).as_bytes()), r.size);
        let (x, y) = (r.x, h - r.y);
        if r.rotated {
            c.set_text_matrix([0.0, 1.0, -1.0, 0.0, x, y]);
        } else {
            c.set_text_matrix([1.0, 0.0, 0.0, 1.0, x, y]);
        }
        // TJ: glyph ids, with adjustments where the shaped position differs from
        // the default advance (kerning). Vertical offsets are not handled here.
        let mut tj = c.show_positioned();
        let mut items = tj.items();
        let mut pen = 0.0f32;
        let mut bytes = Vec::new();
        for g in &r.glyphs {
            let adj = (g.dx - pen) / r.size * 1000.0;
            if adj.abs() > 0.001 {
                if !bytes.is_empty() {
                    items.show(Str(&bytes));
                    bytes.clear();
                }
                items.adjust(-adj);
            }
            let new = u.remapper.get(g.gid).expect("remapped");
            bytes.extend_from_slice(&new.to_be_bytes());
            let adv = gm.advance_width(GlyphId::new(g.gid as u32)).unwrap_or(0.0);
            pen = g.dx + adv / upem * r.size;
        }
        if !bytes.is_empty() {
            items.show(Str(&bytes));
        }
        items.finish();
        tj.finish();
        c.end_text();
    }
    let content = deflate(&c.finish());
    pdf.stream(content_id, &content).filter(Filter::FlateDecode);

    for (&f, &type0_id) in &font_refs {
        write_font(
            &mut pdf,
            &mut next,
            type0_id,
            f,
            fonts[f as usize],
            &uses[&f],
        );
    }
    pdf.finish()
}

/// A subset tag of six letters made from the glyph set, so it is the same on every run.
fn subset_tag(font: u8, remapper: &GlyphRemapper) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325 ^ font as u64;
    for g in remapper.remapped_gids() {
        for b in g.to_le_bytes() {
            hash ^= b as u64;
            hash = hash.wrapping_mul(0x0100_0000_01b3);
        }
    }
    (0..6)
        .map(|_| {
            let c = b'A' + (hash % 26) as u8;
            hash /= 26;
            c as char
        })
        .collect()
}

fn write_font(
    pdf: &mut Pdf,
    next: &mut impl FnMut() -> Ref,
    type0_id: Ref,
    id: u8,
    data: &[u8],
    u: &FontUse,
) {
    let cid_id = next();
    let desc_id = next();
    let file_id = next();
    let cmap_id = next();
    let font = FontRef::new(data).expect("font");
    let is_cff = font.data_for_tag(Tag::new(b"CFF ")).is_some();
    let upem = font.head().map(|h| h.units_per_em()).unwrap_or(1000) as f32;
    let to_pdf = |v: f32| v / upem * 1000.0;
    let m = font.metrics(Size::unscaled(), LocationRef::default());
    let gm = font.glyph_metrics(Size::unscaled(), LocationRef::default());
    let ps_name = font
        .localized_strings(StringId::POSTSCRIPT_NAME)
        .english_or_first()
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("Font{id}"));
    let base = format!("{}+{}", subset_tag(id, &u.remapper), ps_name);

    let sub = subsetter::subset(data, 0, &u.remapper).expect("subset");
    let program: Vec<u8> = if is_cff {
        // Embed only the CFF table of the subset (FontFile3 /CIDFontType0C).
        FontRef::new(&sub)
            .expect("subset")
            .data_for_tag(Tag::new(b"CFF "))
            .expect("cff")
            .as_bytes()
            .to_vec()
    } else {
        sub
    };

    let mut t0 = pdf.type0_font(type0_id);
    if is_cff {
        t0.base_font(Name(format!("{base}-Identity-H").as_bytes()));
    } else {
        t0.base_font(Name(base.as_bytes()));
    }
    t0.encoding_predefined(Name(b"Identity-H"))
        .descendant_font(cid_id)
        .to_unicode(cmap_id);
    t0.finish();

    let mut cid = pdf.cid_font(cid_id);
    cid.subtype(if is_cff {
        CidFontType::Type0
    } else {
        CidFontType::Type2
    });
    cid.base_font(Name(base.as_bytes()));
    cid.system_info(SYSTEM_INFO);
    cid.font_descriptor(desc_id);
    cid.default_width(0.0);
    if !is_cff {
        cid.cid_to_gid_map_predefined(Name(b"Identity"));
    }
    let widths: Vec<f32> = u
        .remapper
        .remapped_gids()
        .map(|old| to_pdf(gm.advance_width(GlyphId::new(old as u32)).unwrap_or(0.0)))
        .collect();
    cid.widths().consecutive(0, widths);
    cid.finish();

    let mut flags = FontFlags::SYMBOLIC;
    if m.italic_angle != 0.0 {
        flags |= FontFlags::ITALIC;
    }
    let b = m.bounds.unwrap_or_default();
    let mut d = pdf.font_descriptor(desc_id);
    d.name(Name(base.as_bytes()))
        .flags(flags)
        .bbox(Rect::new(
            to_pdf(b.x_min),
            to_pdf(b.y_min),
            to_pdf(b.x_max),
            to_pdf(b.y_max),
        ))
        .italic_angle(m.italic_angle)
        .ascent(to_pdf(m.ascent))
        .descent(to_pdf(m.descent))
        .cap_height(to_pdf(m.cap_height.unwrap_or(m.ascent)))
        .stem_v(80.0);
    if is_cff {
        d.font_file3(file_id);
    } else {
        d.font_file2(file_id);
    }
    d.finish();

    let packed = deflate(&program);
    let mut s = pdf.stream(file_id, &packed);
    s.filter(Filter::FlateDecode);
    if is_cff {
        s.pair(Name(b"Subtype"), Name(b"CIDFontType0C"));
    } else {
        s.pair(Name(b"Length1"), program.len() as i32);
    }
    s.finish();

    let mut cmap = UnicodeCmap::new(Name(b"Custom"), SYSTEM_INFO);
    for (&g, text) in &u.to_unicode {
        cmap.pair_with_multiple(g, text.chars());
    }
    let cmap_data = deflate(&cmap.finish());
    pdf.stream(cmap_id, &cmap_data).filter(Filter::FlateDecode);
}
