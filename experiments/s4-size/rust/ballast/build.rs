//! Generates S4_BALLAST_FNS functions of varied arithmetic and control flow.
//!
//! The code does nothing useful. It only gives a module a realistic size,
//! so that download and compile times can be measured with an allowance
//! for figlab's own code. A fixed seed makes the output reproducible.

use std::fmt::Write as _;

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        // xorshift64*
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn float(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64 * 4.0 - 2.0
    }
}

fn stmt(r: &mut Rng, o: &mut String, depth: u32, me: u64) {
    match r.below(if depth > 1 { 6 } else { 9 }) {
        0 => writeln!(o, "a = a * {:?} + s[{}];", r.float(), r.below(8)).unwrap(),
        1 => writeln!(o, "s[{}] = a - b * {:?};", r.below(8), r.float()).unwrap(),
        2 => writeln!(
            o,
            "b = libm::{}(a * {:?});",
            ["sin", "exp", "sqrt", "log1p", "atan", "cbrt"][r.below(6) as usize],
            r.float()
        )
        .unwrap(),
        3 => writeln!(
            o,
            "n = n.wrapping_mul({}).rotate_left({}) ^ (a.to_bits() as u32);",
            r.next() as u32 | 1,
            r.below(31)
        )
        .unwrap(),
        4 => writeln!(o, "a += s[(n as usize) & 7] * {:?};", r.float()).unwrap(),
        5 if me > 0 => writeln!(
            o,
            "if n & {} == 0 {{ b += f{}(a, s); }}",
            1u32 << r.below(16),
            r.below(me)
        )
        .unwrap(),
        5 => writeln!(o, "b -= {:?};", r.float()).unwrap(),
        6 => {
            writeln!(o, "if a > {:?} {{", r.float()).unwrap();
            for _ in 0..1 + r.below(3) {
                stmt(r, o, depth + 1, me);
            }
            o.push_str("} else {\n");
            for _ in 0..1 + r.below(3) {
                stmt(r, o, depth + 1, me);
            }
            o.push_str("}\n");
        }
        7 => {
            writeln!(o, "for i in 0..{} {{", 2 + r.below(6)).unwrap();
            writeln!(
                o,
                "s[i & 7] = s[(i + {}) & 7] * {:?} + a;",
                r.below(8),
                r.float()
            )
            .unwrap();
            stmt(r, o, depth + 1, me);
            o.push_str("}\n");
        }
        _ => {
            writeln!(o, "match n % 4 {{").unwrap();
            for k in 0..3 {
                write!(o, "{k} => {{ ").unwrap();
                stmt(r, o, depth + 1, me);
                o.push_str("}\n");
            }
            o.push_str("_ => { a = -a; }\n}\n");
        }
    }
}

fn main() {
    println!("cargo:rerun-if-env-changed=S4_BALLAST_FNS");
    let n: u64 = std::env::var("S4_BALLAST_FNS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let mut r = Rng(0x9E37_79B9_7F4A_7C15);
    let mut o = String::new();
    for i in 0..n {
        writeln!(
            o,
            "#[inline(never)]\nfn f{i}(x: f64, s: &mut [f64; 8]) -> f64 {{"
        )
        .unwrap();
        o.push_str("let mut a = x; let mut b = 0.0f64; let mut n: u32 = a.to_bits() as u32;\n");
        for _ in 0..4 + r.below(10) {
            stmt(&mut r, &mut o, 0, i);
        }
        o.push_str("let _ = n; a + b\n}\n");
    }
    write!(o, "static FNS: [fn(f64, &mut [f64; 8]) -> f64; {n}] = [").unwrap();
    for i in 0..n {
        write!(o, "f{i},").unwrap();
    }
    o.push_str("];\n");
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("ballast.rs");
    std::fs::write(out, o).unwrap();
}
