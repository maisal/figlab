//! Helpers shared by the native tools.

use std::path::PathBuf;
use std::time::Instant;

use s1_core::FONT_FILES;

/// The experiment folder (two levels above this crate).
pub fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Reads every font in `FONT_FILES` from `downloads/fonts/`. Missing files give an
/// error that says to run the fetch script.
pub fn load_fonts() -> Vec<&'static [u8]> {
    FONT_FILES
        .iter()
        .map(|name| {
            let p = root().join("downloads/fonts").join(name);
            let data = std::fs::read(&p)
                .unwrap_or_else(|_| panic!("missing {}: run scripts/fetch-fonts.sh", p.display()));
            &*Box::leak(data.into_boxed_slice())
        })
        .collect()
}

/// Times `f` `runs` times after `warmup` runs. Returns (median, p95, runs) in ms.
pub fn time_ms(warmup: usize, runs: usize, mut f: impl FnMut()) -> (f64, f64, usize) {
    for _ in 0..warmup {
        f();
    }
    let mut v: Vec<f64> = (0..runs)
        .map(|_| {
            let t = Instant::now();
            f();
            t.elapsed().as_secs_f64() * 1000.0
        })
        .collect();
    v.sort_by(|a, b| a.partial_cmp(b).expect("no NaN"));
    let p95 = v[((runs as f64 * 0.95) as usize).min(runs - 1)];
    (v[runs / 2], p95, runs)
}

/// Escapes a string for JSON.
pub fn js(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}
