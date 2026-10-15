//! Compares rustybuzz 0.20, harfrust 0.14, and harfrust 0.8 on the sample texts: glyph ids, advances, offsets,
//! clusters, and outlines. Also checks that kerning is applied.
//! Writes results/compare.json.

use s1_core::{Outline, Shaper, font, itemize, layout_page, sample_page, sample_texts};
use s1_hr::HrShaper;
use s1_native::{js, load_fonts, root};
use s1_rb::RbShaper;

fn main() {
    let fonts = load_fonts();
    let rb = RbShaper::new(&fonts);
    let hr = HrShaper::new(&fonts);
    let hr08 = s1_hr08::Hr08Shaper::new(&fonts);
    let mut out = Vec::new();
    let mut all_same = true;
    for fallback in font::FALLBACKS {
        for (name, spans, _) in sample_texts() {
            for span in &spans {
                for (f, piece) in itemize(&rb, &span.text, span.font, fallback) {
                    let mut a = Vec::new();
                    let mut b = Vec::new();
                    rb.shape(f, piece, &mut a);
                    hr.shape(f, piece, &mut b);
                    let mut c = Vec::new();
                    hr08.shape(f, piece, &mut c);
                    let same = a == b && a == c;
                    all_same &= same;
                    if fallback == font::NOTO_MATH || !same {
                        let gids: Vec<String> = a.iter().map(|g| g.gid.to_string()).collect();
                        let adv: Vec<String> = a.iter().map(|g| g.x_advance.to_string()).collect();
                        out.push(format!(
                            "{{\"label\":{},\"fallback\":{},\"font\":{},\"text\":{},\"same\":{},\"gids\":[{}],\"advances\":[{}]}}",
                            js(name), fallback, f, js(piece), same, gids.join(","), adv.join(",")
                        ));
                    }
                }
            }
        }
    }
    // Same runs for the whole page, for every fallback.
    let mut pages_same = true;
    for fallback in font::FALLBACKS {
        let page = sample_page(fallback);
        let r = layout_page(&rb, &page);
        pages_same &= r == layout_page(&hr, &page) && r == layout_page(&hr08, &page);
    }
    // Kerning: shaped advances versus the hmtx advances.
    let kern_text = "AVATAR To We Yo";
    let mut shaped = Vec::new();
    hr.shape(font::REGULAR, kern_text, &mut shaped);
    let face = ttf_parser::Face::parse(fonts[font::REGULAR as usize], 0).expect("font");
    let mut kerned = Vec::new();
    for (i, g) in shaped.iter().enumerate() {
        let nominal = face
            .glyph_hor_advance(ttf_parser::GlyphId(g.gid))
            .unwrap_or(0) as i32;
        if nominal != g.x_advance {
            let c = &kern_text[g.cluster as usize..];
            let pair: String = c.chars().take(2).collect();
            kerned.push(format!(
                "{{\"index\":{i},\"pair\":{},\"nominal\":{nominal},\"shaped\":{}}}",
                js(&pair),
                g.x_advance
            ));
        }
    }
    // Outlines of every glyph on the page.
    let page = sample_page(font::NOTO_MATH);
    let runs = layout_page(&hr, &page);
    let (mut n, mut same_outlines, mut same_normalized) = (0, 0, 0);
    let mut seen = std::collections::BTreeSet::new();
    for r in &runs {
        for g in &r.glyphs {
            if seen.insert((r.font, g.gid)) {
                let mut a = Outline::default();
                let mut b = Outline::default();
                rb.outline(r.font, g.gid, &mut a);
                hr.outline(r.font, g.gid, &mut b);
                n += 1;
                if a == b {
                    same_outlines += 1;
                }
                if normalize(&a) == normalize(&b) {
                    same_normalized += 1;
                }
            }
        }
    }
    let json = format!(
        "{{\n\"all_pieces_same\":{all_same},\n\"page_runs_same_for_all_fallbacks\":{pages_same},\n\"outlines_compared\":{n},\n\"outlines_same\":{same_outlines},\n\"outlines_same_after_dropping_closing_lines\":{same_normalized},\n\"kerning\":[{}],\n\"pieces\":[\n{}\n]\n}}\n",
        kerned.join(","),
        out.join(",\n")
    );
    std::fs::write(root().join("results/compare.json"), &json).expect("write");
    println!(
        "all shaped pieces identical (rustybuzz 0.20, harfrust 0.14, harfrust 0.8): {all_same}"
    );
    println!("page runs identical for all fallbacks: {pages_same}");
    println!(
        "outlines identical: {same_outlines} of {n}; after dropping closing lines: {same_normalized} of {n}"
    );
    println!("kerned pairs in {kern_text:?}: {}", kerned.len());
    for k in &kerned {
        println!("  {k}");
    }
}

/// ttf-parser adds a line back to the start point before each close, skrifa does
/// not. Both draw the same shape. This drops such lines.
fn normalize(o: &Outline) -> Outline {
    use s1_core::verb;
    let mut out = Outline::default();
    let (mut ci, mut start) = (0usize, (0i16, 0i16));
    let mut last_line: Option<(usize, (i16, i16))> = None;
    for &v in &o.verbs {
        let n = match v {
            verb::MOVE | verb::LINE => 2,
            verb::QUAD => 4,
            verb::CUBIC => 6,
            _ => 0,
        };
        let pts = &o.coords[ci..ci + n];
        ci += n;
        if v == verb::CLOSE
            && let Some((len, p)) = last_line
            && p == start
            && out.verbs.last() == Some(&verb::LINE)
        {
            out.verbs.pop();
            out.coords.truncate(len);
        }
        last_line = None;
        if v == verb::MOVE {
            start = (pts[0], pts[1]);
        }
        if v == verb::LINE {
            last_line = Some((out.coords.len(), (pts[0], pts[1])));
        }
        out.verbs.push(v);
        out.coords.extend_from_slice(pts);
    }
    out
}
