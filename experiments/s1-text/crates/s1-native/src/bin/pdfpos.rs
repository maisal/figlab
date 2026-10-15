//! Checks where poppler finds the words in the PDFs: the left edge of each word
//! (pdftotext -bbox) must be where our layout put its first glyph.
//! Reads dist/pdf-render/<name>-bbox.html (made by scripts/check-pdf.sh).
//! Rotated runs are skipped.

use s1_core::{font, layout_page, sample_page};
use s1_native::root;

fn attr(s: &str, name: &str) -> f32 {
    let k = format!("{name}=\"");
    let i = s.find(&k).expect("attr") + k.len();
    let j = s[i..].find('"').expect("quote") + i;
    s[i..j].parse().expect("number")
}

fn main() {
    let fonts = s1_native::load_fonts();
    let shaper = s1_hr::HrShaper::new(&fonts);
    let page = sample_page(font::NOTO_MATH);
    let runs = layout_page(&shaper, &page);
    // (first char, x, baseline y) of every glyph in a non-rotated run.
    let mut starts = Vec::new();
    for r in runs.iter().filter(|r| !r.rotated) {
        for g in &r.glyphs {
            if let Some(c) = r.text[g.text_start as usize..].chars().next() {
                starts.push((c, r.x + g.dx, r.y + g.dy));
            }
        }
    }
    for name in ["krilla-noto", "pdfwriter-noto"] {
        let path = root().join(format!("dist/pdf-render/{name}-bbox.html"));
        let html = std::fs::read_to_string(&path).expect("run scripts/check-pdf.sh first");
        let (mut n, mut max, mut sum, mut unmatched) = (0, 0.0f32, 0.0f32, 0);
        for part in html.split("<word ").skip(1) {
            let (head, rest) = part.split_once('>').expect("word");
            let text = rest.split("</word>").next().unwrap_or("");
            let text = text
                .replace("&amp;", "&")
                .replace("&lt;", "<")
                .replace("&gt;", ">");
            let Some(c) = text.chars().next() else {
                continue;
            };
            let (x0, x1) = (attr(head, "xMin"), attr(head, "xMax"));
            let (y0, y1) = (attr(head, "yMin"), attr(head, "yMax"));
            if y1 - y0 > 15.0 && x1 - x0 < 11.0 {
                continue; // a word of the rotated label
            }
            let best = starts
                .iter()
                .filter(|s| s.0 == c && s.2 >= y0 && s.2 <= y1 + 1.0)
                .map(|s| (s.1 - x0).abs())
                .fold(f32::INFINITY, f32::min);
            if best.is_finite() {
                n += 1;
                sum += best;
                max = max.max(best);
            } else {
                unmatched += 1;
                eprintln!("  unmatched word {text:?} at x {x0} y {y0}..{y1}");
            }
        }
        println!(
            "{name}: {n} words, left edge vs layout: max {max:.4} pt, mean {:.4} pt, unmatched {unmatched}",
            sum / n as f32
        );
    }
}
