//! Writes the native outputs that the wasm build must match byte for byte:
//! - the sample page as PDF with krilla and with pdf-writer, with Noto Sans Math
//!   (TrueType) and with Fira Math (CFF) as the fallback, each written twice
//! - the draw data of the sample page with rustybuzz and with harfrust
//!
//! Output: target/out/. scripts/check-wasm-native.mjs compares them with wasm.

use s1_core::{encode_draw_data, font, layout_page, sample_page};
use s1_native::{load_fonts, root};

fn main() {
    let fonts = load_fonts();
    let rb = s1_rb::RbShaper::new(&fonts);
    let hr = s1_hr::HrShaper::new(&fonts);
    let dir = root().join("target/out");
    std::fs::create_dir_all(&dir).expect("mkdir");
    for (tag, fallback) in [("noto", font::NOTO_MATH), ("fira", font::FIRA_MATH)] {
        let page = sample_page(fallback);
        let runs = layout_page(&hr, &page);
        let k1 = s1_pdf_krilla::write_pdf(&page, &runs, &fonts);
        let k2 = s1_pdf_krilla::write_pdf(&page, &runs, &fonts);
        let w1 = s1_pdf_writer::write_pdf(&page, &runs, &fonts);
        let w2 = s1_pdf_writer::write_pdf(&page, &runs, &fonts);
        std::fs::write(dir.join(format!("krilla-{tag}.pdf")), &k1).expect("write");
        std::fs::write(dir.join(format!("pdfwriter-{tag}.pdf")), &w1).expect("write");
        println!(
            "krilla-{tag}.pdf: {} bytes, repeated run identical: {}",
            k1.len(),
            k1 == k2
        );
        println!(
            "pdfwriter-{tag}.pdf: {} bytes, repeated run identical: {}",
            w1.len(),
            w1 == w2
        );
    }
    let page = sample_page(font::NOTO_MATH);
    for (tag, s) in [("rb", &rb as &dyn s1_core::Shaper), ("hr", &hr)] {
        let runs = layout_page(s, &page);
        let d = encode_draw_data(s, &runs, &page.lines);
        std::fs::write(dir.join(format!("drawdata-{tag}.bin")), &d).expect("write");
        println!("drawdata-{tag}.bin: {} bytes", d.len());
    }
}
