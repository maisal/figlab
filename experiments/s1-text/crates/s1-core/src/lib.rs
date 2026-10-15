//! Shared code of the S1 experiment. It does not depend on a font library.
//!
//! - the font table and the sample page (labels built by hand as runs)
//! - the `Shaper` trait that each shaping candidate implements
//! - layout: spans to runs, with fallback to a second font for missing characters
//! - the draw data format that TypeScript draws on a Canvas

use std::collections::BTreeMap;

/// The font files, in the order of their font ids. They live in `downloads/fonts/`.
pub const FONT_FILES: [&str; 11] = [
    "Arimo-Regular.ttf",
    "Arimo-Italic.ttf",
    "Arimo-Bold.ttf",
    "Tinos-Regular.ttf",
    "NotoSansMath-Regular.ttf",
    "NotoSansSymbols-VF.ttf",
    "NotoSansSymbols2-Regular.ttf",
    "STIXTwoMath-Regular.ttf",
    "LibertinusMath-Regular.ttf",
    "NotoSans-VF.ttf",
    "FiraMath-Regular.otf",
];

/// Font ids (indexes into `FONT_FILES`).
pub mod font {
    pub const REGULAR: u8 = 0;
    pub const ITALIC: u8 = 1;
    pub const BOLD: u8 = 2;
    pub const SERIF: u8 = 3;
    pub const NOTO_MATH: u8 = 4;
    pub const NOTO_SYMBOLS: u8 = 5;
    pub const NOTO_SYMBOLS2: u8 = 6;
    pub const STIX_MATH: u8 = 7;
    pub const LIBERTINUS_MATH: u8 = 8;
    pub const NOTO_SANS: u8 = 9;
    pub const FIRA_MATH: u8 = 10;
    /// The fallback candidates, in the order of the report.
    pub const FALLBACKS: [u8; 7] = [
        NOTO_MATH,
        NOTO_SYMBOLS,
        NOTO_SYMBOLS2,
        STIX_MATH,
        LIBERTINUS_MATH,
        NOTO_SANS,
        FIRA_MATH,
    ];
}

/// One shaped glyph, in font units, as the shapers return it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GlyphPos {
    pub gid: u16,
    /// Byte offset of the cluster in the shaped text.
    pub cluster: u32,
    pub x_advance: i32,
    pub y_advance: i32,
    pub x_offset: i32,
    pub y_offset: i32,
}

/// Path verbs of the outline format.
pub mod verb {
    pub const MOVE: u8 = 0;
    pub const LINE: u8 = 1;
    pub const QUAD: u8 = 2;
    pub const CUBIC: u8 = 3;
    pub const CLOSE: u8 = 4;
}

/// A glyph outline in font units (y up). Coordinates are rounded to whole units.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Outline {
    pub verbs: Vec<u8>,
    pub coords: Vec<i16>,
}

impl Outline {
    pub fn clear(&mut self) {
        self.verbs.clear();
        self.coords.clear();
    }
    fn pt(&mut self, x: f32, y: f32) {
        // TrueType coordinates are whole units already. CFF ones may not be.
        self.coords.push(round_i16(x));
        self.coords.push(round_i16(y));
    }
    pub fn move_to(&mut self, x: f32, y: f32) {
        self.verbs.push(verb::MOVE);
        self.pt(x, y);
    }
    pub fn line_to(&mut self, x: f32, y: f32) {
        self.verbs.push(verb::LINE);
        self.pt(x, y);
    }
    pub fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        self.verbs.push(verb::QUAD);
        self.pt(x1, y1);
        self.pt(x, y);
    }
    pub fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        self.verbs.push(verb::CUBIC);
        self.pt(x1, y1);
        self.pt(x2, y2);
        self.pt(x, y);
    }
    pub fn close(&mut self) {
        self.verbs.push(verb::CLOSE);
    }
}

fn round_i16(v: f32) -> i16 {
    // `f32::round` is a standard float function (roadmap M0). Round by hand.
    let r = if v >= 0.0 { v + 0.5 } else { v - 0.5 };
    r as i16
}

/// A text shaping library together with the font parser that comes with it.
pub trait Shaper {
    fn units_per_em(&self, font: u8) -> u16;
    fn has_char(&self, font: u8, c: char) -> bool;
    /// Shapes `text` left to right with the default features. Appends to `out`.
    fn shape(&self, font: u8, text: &str, out: &mut Vec<GlyphPos>);
    /// Writes the outline of a glyph, unhinted, in font units.
    fn outline(&self, font: u8, gid: u16, out: &mut Outline);
}

/// A piece of label text in one style. Built by hand here. Later the parser of the
/// text notation (spec.md 8.4) makes these.
#[derive(Clone, Debug)]
pub struct Span {
    pub text: String,
    pub font: u8,
    /// Size relative to the label size (0.7 for superscripts and subscripts).
    pub scale: f32,
    /// Baseline shift in units of the label size. Positive is up.
    pub rise: f32,
}

/// Superscript and subscript settings. figlab has not fixed these yet.
pub const SCRIPT_SCALE: f32 = 0.7;
pub const SUP_RISE: f32 = 0.36;
pub const SUB_RISE: f32 = -0.14;

impl Span {
    pub fn new(text: &str, font: u8) -> Self {
        Span {
            text: text.to_string(),
            font,
            scale: 1.0,
            rise: 0.0,
        }
    }
    pub fn sup(text: &str, font: u8) -> Self {
        Span {
            text: text.to_string(),
            font,
            scale: SCRIPT_SCALE,
            rise: SUP_RISE,
        }
    }
    pub fn sub(text: &str, font: u8) -> Self {
        Span {
            text: text.to_string(),
            font,
            scale: SCRIPT_SCALE,
            rise: SUB_RISE,
        }
    }
}

/// A label: spans placed at a point. `x`, `y` is the start of the baseline, in pt,
/// with y down from the top of the page.
#[derive(Clone, Debug)]
pub struct Label {
    pub spans: Vec<Span>,
    pub size: f32,
    pub x: f32,
    pub y: f32,
    /// 0xRRGGBB.
    pub color: u32,
    /// Font used for characters that the span font does not have.
    pub fallback: u8,
    /// Rotated 90 degrees counterclockwise (reads from bottom to top).
    pub rotated: bool,
}

impl Label {
    pub fn new(spans: Vec<Span>, size: f32, x: f32, y: f32) -> Self {
        Label {
            spans,
            size,
            x,
            y,
            color: 0,
            fallback: font::NOTO_MATH,
            rotated: false,
        }
    }
}

/// A glyph placed in a run, in pt. `dx`, `dy` are measured from the run origin
/// along the baseline (y down).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Glyph {
    pub gid: u16,
    pub dx: f32,
    pub dy: f32,
    pub advance: f32,
    /// Byte range of the glyph's cluster in `Run::text`.
    pub text_start: u32,
    pub text_end: u32,
}

/// Text in one font, size, and color, with its glyphs placed.
#[derive(Clone, Debug, PartialEq)]
pub struct Run {
    pub font: u8,
    pub size: f32,
    pub color: u32,
    /// Origin of the run on the page, in pt, y down.
    pub x: f32,
    pub y: f32,
    pub rotated: bool,
    pub text: String,
    pub glyphs: Vec<Glyph>,
}

impl Run {
    pub fn advance(&self) -> f32 {
        self.glyphs.iter().map(|g| g.advance).sum()
    }
}

/// A stroked polyline, for the frame and ticks of the sample page.
#[derive(Clone, Debug)]
pub struct Line {
    pub points: Vec<(f32, f32)>,
    pub width: f32,
    pub color: u32,
}

/// The sample page used for the PDFs and the Canvas comparison.
#[derive(Clone, Debug)]
pub struct Page {
    pub width: f32,
    pub height: f32,
    pub labels: Vec<Label>,
    pub lines: Vec<Line>,
}

/// Splits text into pieces by font. Characters that `primary` lacks go to
/// `fallback`. Spaces always use `primary`, so they keep the main font's width.
/// A character that neither font has stays in `primary` (it shows as .notdef).
pub fn itemize<'a>(
    shaper: &dyn Shaper,
    text: &'a str,
    primary: u8,
    fallback: u8,
) -> Vec<(u8, &'a str)> {
    let mut out: Vec<(u8, &'a str)> = Vec::new();
    let mut start = 0;
    let mut cur: Option<u8> = None;
    for (i, c) in text.char_indices() {
        let f = if c == ' ' || shaper.has_char(primary, c) || !shaper.has_char(fallback, c) {
            primary
        } else {
            fallback
        };
        match cur {
            Some(cf) if cf != f => {
                out.push((cf, &text[start..i]));
                start = i;
                cur = Some(f);
            }
            Some(_) => {}
            None => cur = Some(f),
        }
    }
    if let Some(cf) = cur {
        out.push((cf, &text[start..]));
    }
    out
}

/// Lays out labels into runs. Kerning applies inside a run only.
pub fn layout(shaper: &dyn Shaper, labels: &[Label]) -> Vec<Run> {
    let mut runs = Vec::new();
    let mut buf = Vec::new();
    let mut clusters: Vec<u32> = Vec::new();
    for label in labels {
        let mut pen = 0.0f32;
        for span in &label.spans {
            let size = label.size * span.scale;
            let rise = label.size * span.rise;
            for (font, piece) in itemize(shaper, &span.text, span.font, label.fallback) {
                buf.clear();
                shaper.shape(font, piece, &mut buf);
                let k = size / shaper.units_per_em(font) as f32;
                clusters.clear();
                clusters.extend(buf.iter().map(|g| g.cluster));
                clusters.sort_unstable();
                clusters.dedup();
                let mut glyphs = Vec::with_capacity(buf.len());
                let mut x = 0.0f32;
                for g in &buf {
                    let end = clusters
                        .iter()
                        .copied()
                        .find(|&c| c > g.cluster)
                        .unwrap_or(piece.len() as u32);
                    glyphs.push(Glyph {
                        gid: g.gid,
                        dx: x + g.x_offset as f32 * k,
                        dy: -(g.y_offset as f32) * k,
                        advance: g.x_advance as f32 * k,
                        text_start: g.cluster,
                        text_end: end,
                    });
                    x += g.x_advance as f32 * k;
                }
                // Origin: the label origin, plus the pen along the baseline, minus the
                // rise across it (y is down).
                let (ox, oy) = if label.rotated {
                    (label.x - rise, label.y - pen)
                } else {
                    (label.x + pen, label.y - rise)
                };
                pen += x;
                runs.push(Run {
                    font,
                    size,
                    color: label.color,
                    x: ox,
                    y: oy,
                    rotated: label.rotated,
                    text: piece.to_string(),
                    glyphs,
                });
            }
        }
    }
    runs
}

/// The labels named in the S1 task, in the sizes of the common style
/// (tests/figures/README.md). Each entry is (name, spans, size in pt).
pub fn sample_texts() -> Vec<(&'static str, Vec<Span>, f32)> {
    use font::*;
    vec![
        (
            "plain",
            vec![Span::new("Intensity (arb. units)", REGULAR)],
            9.0,
        ),
        (
            "italic",
            vec![Span::new("E", ITALIC), Span::new(" (meV)", REGULAR)],
            9.0,
        ),
        (
            "sup-angstrom",
            vec![
                Span::new("q", ITALIC),
                Span::new(" (Å", REGULAR),
                Span::sup("−1", REGULAR),
                Span::new(")", REGULAR),
            ],
            9.0,
        ),
        ("unicode-sup", vec![Span::new("q (Å⁻¹)", REGULAR)], 9.0),
        ("minus", vec![Span::new("−0.5", REGULAR)], 8.0),
        (
            "power",
            vec![Span::new("10", REGULAR), Span::sup("3", REGULAR)],
            8.0,
        ),
        ("unicode-power", vec![Span::new("10³", REGULAR)], 8.0),
        (
            "chi2-red",
            vec![
                Span::new("χ", ITALIC),
                Span::sup("2", REGULAR),
                Span::sub("red", REGULAR),
            ],
            9.0,
        ),
        ("greek", vec![Span::new("α β γ Δ", REGULAR)], 9.0),
        ("degree", vec![Span::new("Temperature (°C)", REGULAR)], 9.0),
        ("fallback", vec![Span::new("x ∝ y ± 1", REGULAR)], 9.0),
        (
            "mu-b",
            vec![
                Span::new("Ordered moment (μ", REGULAR),
                Span::sub("B", REGULAR),
                Span::new(")", REGULAR),
            ],
            9.0,
        ),
        ("kerning", vec![Span::new("AVATAR To We Yo", REGULAR)], 9.0),
        ("bold", vec![Span::new("Bold: Fit", BOLD)], 9.0),
        (
            "serif",
            vec![Span::new("Tinos: Temperature (K)", SERIF)],
            9.0,
        ),
        (
            "symbols",
            vec![Span::new("≈ ≤ ≥ ∞ ℏ ⟨x⟩ ∂ ∇", REGULAR)],
            9.0,
        ),
    ]
}

/// The sample page: a plot frame with ticks, tick labels, a data line, a rotated
/// axis label, and the sample texts below. The page is 300 pt x 330 pt.
pub fn sample_page(fallback: u8) -> Page {
    let mut labels = Vec::new();
    let mut lines = Vec::new();
    // Plot frame at (50, 20), 170 x 128 pt, 0.75 pt black.
    let (x0, y0, w, h) = (50.0f32, 20.0f32, 170.0f32, 128.0f32);
    lines.push(Line {
        points: vec![
            (x0, y0),
            (x0 + w, y0),
            (x0 + w, y0 + h),
            (x0, y0 + h),
            (x0, y0),
        ],
        width: 0.75,
        color: 0,
    });
    // Bottom ticks and tick labels: -1.0 to 1.0 every 0.5. Labels are centered later.
    let ticks = ["−1.0", "−0.5", "0.0", "0.5", "1.0"];
    for (i, t) in ticks.iter().enumerate() {
        let x = x0 + w * i as f32 / 4.0;
        lines.push(Line {
            points: vec![(x, y0 + h), (x, y0 + h - 3.5)],
            width: 0.75,
            color: 0,
        });
        let mut l = Label::new(
            vec![Span::new(t, font::REGULAR)],
            8.0,
            x,
            y0 + h + 3.0 + 8.0 * 0.72,
        );
        l.fallback = fallback;
        labels.push(l);
    }
    // A data line, 1 pt red.
    let pts: Vec<(f32, f32)> = (0..=20)
        .map(|i| {
            let t = i as f32 / 20.0;
            (x0 + w * t, y0 + h - h * (0.1 + 0.8 * t * t))
        })
        .collect();
    lines.push(Line {
        points: pts,
        width: 1.0,
        color: 0xd62728,
    });
    // Axis labels.
    let mut xl = Label::new(
        vec![
            Span::new("E", font::ITALIC),
            Span::new(" (meV)", font::REGULAR),
        ],
        9.0,
        x0 + w / 2.0,
        y0 + h + 24.0,
    );
    xl.fallback = fallback;
    labels.push(xl);
    let mut yl = Label::new(
        vec![Span::new("Intensity (arb. units)", font::REGULAR)],
        9.0,
        x0 - 12.0,
        y0 + h / 2.0,
    );
    yl.rotated = true;
    yl.fallback = fallback;
    labels.push(yl);
    // The sample texts in two columns below the plot. Every third one is blue.
    for (i, (_, spans, size)) in sample_texts().into_iter().enumerate() {
        let col = i / 8;
        let row = i % 8;
        let mut l = Label::new(
            spans,
            size,
            12.0 + col as f32 * 145.0,
            200.0 + row as f32 * 16.0,
        );
        l.fallback = fallback;
        if i % 3 == 2 {
            l.color = 0x1f77b4;
        }
        labels.push(l);
    }
    Page {
        width: 300.0,
        height: 330.0,
        labels,
        lines,
    }
}

/// Number of labels at the start of `sample_page` that are centered on their point:
/// five tick labels, the x label, and the rotated y label.
const CENTERED_LABELS: usize = 7;

/// Lays out the sample page and centers the tick and axis labels.
pub fn layout_page(shaper: &dyn Shaper, page: &Page) -> Vec<Run> {
    let mut runs = Vec::new();
    for (i, label) in page.labels.iter().enumerate() {
        let mut lr = layout(shaper, std::slice::from_ref(label));
        if i < CENTERED_LABELS {
            let total: f32 = lr.iter().map(Run::advance).sum();
            for r in &mut lr {
                if r.rotated {
                    r.y += total / 2.0;
                } else {
                    r.x -= total / 2.0;
                }
            }
        }
        runs.extend(lr);
    }
    runs
}

/// `n` labels for timing: the sample texts and tick labels, on a grid.
pub fn bench_labels(n: usize, fallback: u8) -> Vec<Label> {
    let texts = sample_texts();
    let ticks = ["0.0", "0.5", "1.0", "−0.5", "−1.0", "100", "250", "5.405"];
    (0..n)
        .map(|i| {
            let (spans, size) = if i % 2 == 0 {
                let (_, s, z) = &texts[(i / 2) % texts.len()];
                (s.clone(), *z)
            } else {
                (
                    vec![Span::new(ticks[(i / 2) % ticks.len()], font::REGULAR)],
                    8.0,
                )
            };
            let mut l = Label::new(
                spans,
                size,
                10.0 + (i % 4) as f32 * 150.0,
                14.0 + (i / 4) as f32 * 14.0,
            );
            l.fallback = fallback;
            l
        })
        .collect()
}

/// The symbol list for the fallback coverage, in groups. It comes from the text
/// notation (spec.md 8.4: Greek letters, \AA, superscripts and subscripts) and
/// from symbols common in science figures. Each code point appears once: the
/// units group has the angstrom sign U+212B and the ohm sign U+2126, which differ
/// from Å U+00C5 and Ω U+03A9.
pub fn symbol_groups() -> Vec<(&'static str, &'static str)> {
    vec![
        ("greek-lower", "αβγδεζηθικλμνξοπρστυφχψωϑϕϵϖςϱ"),
        ("greek-upper", "ΓΔΘΛΞΠΣΥΦΨΩ"),
        ("units", "Å°µ±×·÷‰′″℃\u{212B}\u{2126}ℏħℓ¬"),
        ("scripts", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻₀₁₂₃₄₅₆₇₈₉₊₋"),
        (
            "operators",
            "−∓∝∞√≈≠≤≥≪≫≲≳∼≃≅≡∂∇∫∮∑∏∈∉⊂⊃⊆⊇∪∩∅∀∃∧∨⊥∥∠∘∗⋅⊗⊕⊙†‡⟨⟩‖…",
        ),
        ("arrows", "←→↑↓↔⇐⇒⇔↦"),
        ("shapes", "●○■□▲△▼▽◆◇★☆"),
        ("punctuation", "–—‐‘’“”"),
    ]
}

/// Little-endian writer for the draw data.
struct W(Vec<u8>);
impl W {
    fn u8(&mut self, v: u8) {
        self.0.push(v);
    }
    fn u16(&mut self, v: u16) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn u32(&mut self, v: u32) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn i16(&mut self, v: i16) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn f32(&mut self, v: f32) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
}

/// Encodes draw data version 1 (little endian, no padding):
///
/// ```text
/// "S1DD" u16 version=1
/// u8 nfonts, then u16 units_per_em per font id (0 for fonts not used)
/// u32 noutlines, then per outline: u8 font, u16 gid, u16 nverbs, u16 ncoords,
///     nverbs x u8 verb, ncoords x i16 (font units, y up)
/// u32 nruns, then per run: u8 font, u8 flags (1 = rotated), f32 size, u32 color,
///     f32 x, f32 y, f32 advance (pt), u16 text bytes, text (UTF-8), u16 nglyphs,
///     then per glyph: u16 outline index, f32 dx, f32 dy (pt, y down)
/// u32 nlines, then per line: f32 width, u32 color, u16 npoints, npoints x (f32 x, f32 y)
/// ```
pub fn encode_draw_data(shaper: &dyn Shaper, runs: &[Run], lines: &[Line]) -> Vec<u8> {
    let mut w = W(Vec::with_capacity(4096));
    w.0.extend_from_slice(b"S1DD");
    w.u16(1);
    let nfonts = FONT_FILES.len() as u8;
    w.u8(nfonts);
    let mut used = [false; FONT_FILES.len()];
    for r in runs {
        used[r.font as usize] = true;
    }
    for f in 0..nfonts {
        w.u16(if used[f as usize] {
            shaper.units_per_em(f)
        } else {
            0
        });
    }
    // Unique outlines, in a fixed order.
    let mut index: BTreeMap<(u8, u16), u16> = BTreeMap::new();
    for r in runs {
        for g in &r.glyphs {
            index.entry((r.font, g.gid)).or_insert(0);
        }
    }
    for (i, v) in index.values_mut().enumerate() {
        *v = i as u16;
    }
    w.u32(index.len() as u32);
    let mut o = Outline::default();
    for &(f, gid) in index.keys() {
        o.clear();
        shaper.outline(f, gid, &mut o);
        w.u8(f);
        w.u16(gid);
        w.u16(o.verbs.len() as u16);
        w.u16(o.coords.len() as u16);
        w.0.extend_from_slice(&o.verbs);
        for &c in &o.coords {
            w.i16(c);
        }
    }
    w.u32(runs.len() as u32);
    for r in runs {
        w.u8(r.font);
        w.u8(u8::from(r.rotated));
        w.f32(r.size);
        w.u32(r.color);
        w.f32(r.x);
        w.f32(r.y);
        w.f32(r.advance());
        w.u16(r.text.len() as u16);
        w.0.extend_from_slice(r.text.as_bytes());
        w.u16(r.glyphs.len() as u16);
        for g in &r.glyphs {
            w.u16(index[&(r.font, g.gid)]);
            w.f32(g.dx);
            w.f32(g.dy);
        }
    }
    w.u32(lines.len() as u32);
    for l in lines {
        w.f32(l.width);
        w.u32(l.color);
        w.u16(l.points.len() as u16);
        for &(x, y) in &l.points {
            w.f32(x);
            w.f32(y);
        }
    }
    w.0
}

/// Display names of the fallback candidates, by font id.
pub fn font_name(id: u8) -> &'static str {
    match id {
        font::REGULAR => "Arimo",
        font::ITALIC => "Arimo Italic",
        font::BOLD => "Arimo Bold",
        font::SERIF => "Tinos",
        font::NOTO_MATH => "Noto Sans Math",
        font::NOTO_SYMBOLS => "Noto Sans Symbols",
        font::NOTO_SYMBOLS2 => "Noto Sans Symbols 2",
        font::STIX_MATH => "STIX Two Math",
        font::LIBERTINUS_MATH => "Libertinus Math",
        font::NOTO_SANS => "Noto Sans",
        font::FIRA_MATH => "Fira Math",
        _ => "?",
    }
}

/// One line per fallback candidate, 14 pt: Arimo text with symbols that Arimo
/// lacks (so they come from the candidate), next to Arimo symbols it has.
/// The page is 520 pt x 250 pt.
pub fn fallback_sheet() -> Page {
    let mut labels = Vec::new();
    for (i, &fb) in font::FALLBACKS.iter().enumerate() {
        let y = 24.0 + i as f32 * 32.0;
        let mut name = Label::new(vec![Span::new(font_name(fb), font::REGULAR)], 9.0, 8.0, y);
        name.fallback = fb;
        name.color = 0x7f7f7f;
        labels.push(name);
        let mut l = Label::new(
            vec![Span::new(
                "x ∝ y, ⟨a⟩ ∇×B ∈ ⊂ ∼ ≪ ⊥ ⇒ ★ ◇ | x ± y ≤ 2 ∞ ∂ −1 °",
                font::REGULAR,
            )],
            14.0,
            120.0,
            y,
        );
        l.fallback = fb;
        labels.push(l);
    }
    Page {
        width: 520.0,
        height: 250.0,
        labels,
        lines: Vec::new(),
    }
}
