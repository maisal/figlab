//! Native timing of the decimation methods, for comparison with wasm.
//!
//! Run: `cargo run --release --bin bench` (in experiments/s2-draw).
//! Prints a JSON object with the median and p95 of each case in ms, and
//! writes it to results/native.json.

use s2_draw::{
    Pyramid, Trace, decimate_pyramid, decimate_scan, decimate_unsorted, is_sorted, make_trace,
};
use std::fmt::Write as _;
use std::time::Instant;

const N: usize = 10_000_000;
const WIDTH: usize = 3200;
const RUNS: usize = 30;

fn stats(mut v: Vec<f64>) -> String {
    v.sort_by(|a, b| a.partial_cmp(b).expect("no NaN"));
    let med = v[v.len() / 2];
    let p95 = v[((v.len() as f64 * 0.95) as usize).min(v.len() - 1)];
    format!(
        "{{ \"median\": {med:.3}, \"p95\": {p95:.3}, \"n\": {} }}",
        v.len()
    )
}

fn time_ms(runs: usize, mut f: impl FnMut()) -> String {
    let mut v = Vec::with_capacity(runs);
    for _ in 0..runs {
        let t = Instant::now();
        f();
        v.push(t.elapsed().as_secs_f64() * 1e3);
    }
    stats(v)
}

/// The same views as the web page (web/bench.ts): centered at 37% of the span.
fn views(t: &Trace) -> Vec<(&'static str, f64, f64)> {
    let x0 =
        t.x.iter()
            .cloned()
            .filter(|v| !v.is_nan())
            .fold(f64::INFINITY, f64::min);
    let x1 =
        t.x.iter()
            .cloned()
            .filter(|v| !v.is_nan())
            .fold(f64::NEG_INFINITY, f64::max);
    let span = x1 - x0;
    let c = x0 + span * 0.37;
    let mut v = vec![("full", x0, x1)];
    for (name, frac) in [("10%", 0.1), ("1%", 0.01), ("0.01%", 0.0001)] {
        v.push((name, c - span * frac / 2.0, c + span * frac / 2.0));
    }
    v
}

fn main() {
    let mut out = Vec::new();
    let mut j = String::new();
    let t0 = Instant::now();
    let t = make_trace(N, 1, true, 0);
    j.push_str("{\n");
    writeln!(j, "  \"n\": {N}, \"width\": {WIDTH}, \"runs\": {RUNS},").unwrap();
    writeln!(j, "  \"make_ms\": {:.1},", t0.elapsed().as_secs_f64() * 1e3).unwrap();
    let s = time_ms(10, || assert!(std::hint::black_box(is_sorted(&t.x))));
    writeln!(j, "  \"check_sorted_ms\": {s},").unwrap();
    let s = time_ms(10, || {
        let p = Pyramid::build(&t.x, &t.y, 16);
        std::hint::black_box(p.bytes());
    });
    let p = Pyramid::build(&t.x, &t.y, 16);
    writeln!(j, "  \"pyramid_build_ms\": {s},").unwrap();
    writeln!(j, "  \"pyramid_bytes\": {},", p.bytes()).unwrap();
    j.push_str("  \"cases\": [\n");
    let mut rows = Vec::new();
    for (name, x0, x1) in views(&t) {
        let sc = time_ms(RUNS, || decimate_scan(&t, x0, x1, WIDTH, &mut out));
        let py = time_ms(RUNS, || decimate_pyramid(&t, &p, x0, x1, WIDTH, &mut out));
        rows.push(format!(
            "    {{ \"data\": \"test trace\", \"view\": \"{name}\", \"scan_ms\": {sc}, \"pyramid_ms\": {py}, \"points\": {} }}",
            out.len() / 2
        ));
    }
    drop(p);
    drop(t);
    for every in [1000usize, 100, 10] {
        let t = make_trace(N, 1, true, every);
        let p = Pyramid::build(&t.x, &t.y, 16);
        let (name, x0, x1) = views(&t)[0];
        let sc = time_ms(RUNS, || decimate_scan(&t, x0, x1, WIDTH, &mut out));
        let py = time_ms(RUNS, || decimate_pyramid(&t, &p, x0, x1, WIDTH, &mut out));
        rows.push(format!(
            "    {{ \"data\": \"NaN every {every} points\", \"view\": \"{name}\", \"scan_ms\": {sc}, \"pyramid_ms\": {py}, \"points\": {} }}",
            out.len() / 2
        ));
    }
    j.push_str(&rows.join(",\n"));
    j.push_str("\n  ],\n");
    let u = make_trace(N, 1, false, 0);
    let s = time_ms(10, || assert!(!std::hint::black_box(is_sorted(&u.x))));
    writeln!(j, "  \"check_sorted_unsorted_ms\": {s},").unwrap();
    let mut urows = Vec::new();
    for (name, x0, x1) in views(&u) {
        let s = time_ms(RUNS, || decimate_unsorted(&u, x0, x1, WIDTH, &mut out));
        urows.push(format!(
            "    {{ \"view\": \"{name}\", \"ms\": {s}, \"points\": {} }}",
            out.len() / 2
        ));
    }
    writeln!(j, "  \"unsorted_full_scan\": [\n{}\n  ]", urows.join(",\n")).unwrap();
    j.push_str("}\n");
    print!("{j}");
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/results/native.json");
    std::fs::write(path, &j).expect("write results/native.json");
    eprintln!("written: {path}");
}
