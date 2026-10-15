//! Native timing (preliminary while other builds run; re-run on a quiet machine):
//! layout of 200 labels with each shaper, draw data for them, and the sample page
//! as PDF with each writer. Writes results/measure-native.json.

use s1_core::{Shaper, bench_labels, encode_draw_data, font, layout, layout_page, sample_page};
use s1_native::{load_fonts, root, time_ms};

const RUNS: usize = 200;

fn main() {
    let fonts = load_fonts();
    let rb = s1_rb::RbShaper::new(&fonts);
    let hr = s1_hr::HrShaper::new(&fonts);
    let hr08 = s1_hr08::Hr08Shaper::new(&fonts);
    let shapers: [(&str, &dyn Shaper); 3] = [
        ("rustybuzz-0.20", &rb),
        ("harfrust-0.14", &hr),
        ("harfrust-0.8", &hr08),
    ];
    let labels = bench_labels(200, font::NOTO_MATH);
    let mut rows = Vec::new();
    let mut push = |name: String, (med, p95, n): (f64, f64, usize)| {
        println!("{name:<40} median {med:8.3} ms  p95 {p95:8.3} ms  runs {n}");
        rows.push(format!(
            "{{\"name\":\"{name}\",\"median_ms\":{med:.4},\"p95_ms\":{p95:.4},\"runs\":{n}}}"
        ));
    };
    for (name, s) in shapers {
        push(
            format!("layout-200-labels/{name}"),
            time_ms(10, RUNS, || {
                std::hint::black_box(layout(s, &labels));
            }),
        );
        push(
            format!("layout+drawdata-200-labels/{name}"),
            time_ms(10, RUNS, || {
                let runs = layout(s, &labels);
                std::hint::black_box(encode_draw_data(s, &runs, &[]));
            }),
        );
    }
    let page = sample_page(font::NOTO_MATH);
    let runs = layout_page(&hr, &page);
    push(
        "pdf-sample-page/krilla-0.8.2".into(),
        time_ms(5, RUNS / 4, || {
            std::hint::black_box(s1_pdf_krilla::write_pdf(&page, &runs, &fonts));
        }),
    );
    push(
        "pdf-sample-page/pdf-writer-0.15".into(),
        time_ms(5, RUNS / 4, || {
            std::hint::black_box(s1_pdf_writer::write_pdf(&page, &runs, &fonts));
        }),
    );
    let json = format!(
        "{{\"machine\":\"{}\",\"note\":\"timing depends on machine load; see README\",\"results\":[\n{}\n]}}\n",
        std::env::consts::ARCH,
        rows.join(",\n")
    );
    std::fs::write(root().join("results/measure-native.json"), json).expect("write");
}
