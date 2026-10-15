//! Fallback font candidates: license, file size, coverage of the symbol list,
//! subset size for a typical figure, and metrics next to Arimo (x-height and cap
//! height from the OS/2 table, the minus bar and glyph extents from glyph boxes).
//! Writes results/coverage.json and results/coverage.md.

use std::collections::BTreeSet;
use std::fmt::Write as _;

use s1_core::{FONT_FILES, font, sample_texts, symbol_groups};
use s1_native::{js, load_fonts, root};

/// Unicode blocks a bundled symbol font would need: Greek, letterlike symbols,
/// arrows, mathematical operators, miscellaneous technical, geometric shapes,
/// miscellaneous symbols (for ★ ☆), miscellaneous mathematical symbols A, and
/// supplemental arrows A.
const BLOCKS: [std::ops::RangeInclusive<u32>; 9] = [
    0x0370..=0x03FF,
    0x2100..=0x214F,
    0x2190..=0x21FF,
    0x2200..=0x22FF,
    0x2300..=0x23FF,
    0x25A0..=0x25FF,
    0x2600..=0x26FF,
    0x27C0..=0x27EF,
    0x27F0..=0x27FF,
];

fn has(face: &ttf_parser::Face, c: char) -> bool {
    face.glyph_index(c).is_some_and(|g| g.0 != 0)
}

fn main() {
    let fonts = load_fonts();
    let arimo = ttf_parser::Face::parse(fonts[font::REGULAR as usize], 0).expect("arimo");
    let all: Vec<char> = symbol_groups()
        .iter()
        .flat_map(|(_, s)| s.chars())
        .collect();
    let missing: Vec<char> = all.iter().copied().filter(|&c| !has(&arimo, c)).collect();
    // The characters of the sample texts that Arimo lacks: a "typical figure".
    let figure: BTreeSet<char> = sample_texts()
        .iter()
        .flat_map(|(_, spans, _)| spans.iter().flat_map(|s| s.text.chars()))
        .filter(|&c| c != ' ' && !has(&arimo, c))
        .collect();

    let mut json = String::from("{\n");
    let mut md = String::new();
    writeln!(json, "\"symbols\":{},", js(&all.iter().collect::<String>())).ok();
    writeln!(
        json,
        "\"arimo_missing\":{},",
        js(&missing.iter().collect::<String>())
    )
    .ok();
    writeln!(
        json,
        "\"figure_chars\":{},",
        js(&figure.iter().collect::<String>())
    )
    .ok();
    json.push_str("\"fonts\":[\n");

    writeln!(
        md,
        "Symbols checked: {} in {} groups.",
        all.len(),
        symbol_groups().len()
    )
    .ok();
    writeln!(
        md,
        "Arimo Regular lacks {}: {}\n",
        missing.len(),
        missing.iter().collect::<String>()
    )
    .ok();
    writeln!(md, "Group coverage (characters covered / total):\n").ok();
    let mut header = String::from("| Font |");
    let mut sep = String::from("|---|");
    for (g, s) in symbol_groups() {
        write!(header, " {g} ({}) |", s.chars().count()).ok();
        sep.push_str("---|");
    }
    header.push_str(" Adds to Arimo | Still missing |");
    sep.push_str("---|---|");
    writeln!(md, "{header}\n{sep}").ok();
    let mut md2 = String::from(
        "| Font | License (name table) | File KB | Glyphs | UPM | x-height/em | cap/em | minus bar/em | Figure subset KB (raw / deflate) | Subset of the missing KB | Symbol blocks subset KB (raw / deflate) |\n|---|---|---|---|---|---|---|---|---|---|---|\n",
    );

    for (id, name) in FONT_FILES.iter().enumerate() {
        let data = fonts[id];
        let face = ttf_parser::Face::parse(data, 0).expect("font");
        let m = s1_rb::metrics(data).expect("metrics");
        let upem = m.units_per_em as f32;
        let groups: Vec<(usize, usize)> = symbol_groups()
            .iter()
            .map(|(_, s)| {
                (
                    s.chars().filter(|&c| has(&face, c)).count(),
                    s.chars().count(),
                )
            })
            .collect();
        let adds: String = missing.iter().copied().filter(|&c| has(&face, c)).collect();
        let still: String = missing
            .iter()
            .copied()
            .filter(|&c| !has(&face, c))
            .collect();
        // Subsets: the figure characters, all characters Arimo lacks, and whole
        // Unicode blocks of symbols (a rough size for a bundled symbol subset).
        let subset = |chars: &mut dyn Iterator<Item = char>| -> (usize, usize, usize) {
            let mut remap = subsetter::GlyphRemapper::new();
            let mut used = 0;
            for c in chars {
                if let Some(g) = face.glyph_index(c).filter(|g| g.0 != 0) {
                    remap.remap(g.0);
                    used += 1;
                }
            }
            if used == 0 {
                return (0, 0, 0);
            }
            match subsetter::subset(data, 0, &remap) {
                Ok(s) => (
                    used,
                    s.len(),
                    miniz_oxide::deflate::compress_to_vec_zlib(&s, 6).len(),
                ),
                Err(_) => (used, 0, 0),
            }
        };
        let (used, sub_raw, sub_z) = subset(&mut figure.iter().copied());
        let (used_m, sub_m, _) = subset(&mut missing.iter().copied());
        let (used_b, sub_b, sub_bz) = subset(
            &mut BLOCKS
                .iter()
                .flat_map(|r| r.clone())
                .filter_map(char::from_u32),
        );
        let minus = s1_rb::char_bbox(data, '−').map(|b| (b.3 - b.1) as f32 / upem);
        let x_h = m.x_height.map(|v| v as f32 / upem);
        let cap = m.cap_height.map(|v| v as f32 / upem);
        let lic = s1_rb::license(data);
        let f3 = |v: Option<f32>| {
            v.map(|v| format!("{v:.3}"))
                .unwrap_or_else(|| "null".into())
        };
        writeln!(
            json,
            "{{\"id\":{id},\"file\":{},\"bytes\":{},\"license\":{},\"glyphs\":{},\"upem\":{},\"x_height_em\":{},\"cap_height_em\":{},\"minus_bar_em\":{},\"groups\":[{}],\"adds\":{},\"still_missing\":{},\"figure_glyphs\":{used},\"figure_subset_bytes\":{sub_raw},\"figure_subset_deflate_bytes\":{sub_z},\"missing_glyphs\":{used_m},\"missing_subset_bytes\":{sub_m},\"block_glyphs\":{used_b},\"block_subset_bytes\":{sub_b},\"block_subset_deflate_bytes\":{sub_bz}}}{}",
            js(name),
            data.len(),
            js(&lic),
            m.num_glyphs,
            m.units_per_em,
            f3(x_h),
            f3(cap),
            f3(minus),
            groups.iter().map(|(a, _)| a.to_string()).collect::<Vec<_>>().join(","),
            js(&adds),
            js(&still),
            if id + 1 < FONT_FILES.len() { "," } else { "" }
        )
        .ok();
        let mut row = format!("| {name} |");
        for (a, t) in &groups {
            write!(row, " {a}/{t} |").ok();
        }
        write!(
            row,
            " {} | {} |",
            adds.chars().count(),
            if still.is_empty() {
                "-".into()
            } else {
                still.clone()
            }
        )
        .ok();
        writeln!(md, "{row}").ok();
        let short_lic = if lic.contains("openfontlicense")
            || lic.contains("OFL")
            || lic.contains("Open Font")
        {
            "OFL-1.1"
        } else if lic.contains("apache") || lic.contains("Apache") {
            "Apache-2.0"
        } else {
            "see file"
        };
        writeln!(
            md2,
            "| {name} | {short_lic} | {:.0} | {} | {} | {} | {} | {} | {:.1} / {:.1} ({used} glyphs) | {:.1} ({used_m} glyphs) | {:.0} / {:.0} ({used_b} glyphs) |",
            data.len() as f32 / 1024.0,
            m.num_glyphs,
            m.units_per_em,
            f3(x_h),
            f3(cap),
            f3(minus),
            sub_raw as f32 / 1024.0,
            sub_z as f32 / 1024.0,
            sub_m as f32 / 1024.0,
            sub_b as f32 / 1024.0,
            sub_bz as f32 / 1024.0
        )
        .ok();
    }
    json.push_str("]\n}\n");
    // Vertical glyph extents (y min to y max, in em) of a few symbols. These show
    // the size of the glyphs better than the OS/2 x-height and cap height.
    let probe = ['x', '±', '∝', '∈', '⊥', '⇒', '⟨', '★'];
    md2.push_str("\nVertical extents in em (y min to y max; - = no glyph):\n\n| Font |");
    for c in probe {
        write!(md2, " {c} |").ok();
    }
    md2.push_str("\n|---|");
    md2.push_str(&"---|".repeat(probe.len()));
    md2.push('\n');
    for (id, name) in FONT_FILES.iter().enumerate() {
        let data = fonts[id];
        let face = ttf_parser::Face::parse(data, 0).expect("font");
        let upem = face.units_per_em() as f32;
        write!(md2, "| {name} |").ok();
        for c in probe {
            match face
                .glyph_index(c)
                .filter(|g| g.0 != 0)
                .and_then(|g| face.glyph_bounding_box(g))
            {
                Some(b) if has(&face, c) => {
                    write!(
                        md2,
                        " {:.3}–{:.3} |",
                        b.y_min as f32 / upem,
                        b.y_max as f32 / upem
                    )
                    .ok();
                }
                _ => md2.push_str(" - |"),
            }
        }
        md2.push('\n');
    }
    md.push('\n');
    writeln!(
        md,
        "Figure characters (sample texts, not in Arimo): {}\n",
        figure.iter().collect::<String>()
    )
    .ok();
    md.push_str(&md2);
    std::fs::write(root().join("results/coverage.json"), json).expect("write");
    std::fs::write(root().join("results/coverage.md"), &md).expect("write");
    print!("{md}");
}
