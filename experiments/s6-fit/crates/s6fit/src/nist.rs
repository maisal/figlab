//! The NIST StRD nonlinear regression problems (data/*.dat).
//!
//! The files are embedded, so the wasm build needs no file access.

use crate::models::Model;
use crate::problem::Data;

/// One NIST problem with its certified values.
pub struct Nist {
    pub name: &'static str,
    /// "lower", "average", or "higher" difficulty.
    pub level: &'static str,
    pub model: Model,
    pub start1: Vec<f64>,
    pub start2: Vec<f64>,
    pub cert: Vec<f64>,
    pub cert_sd: Vec<f64>,
    /// Significant digits of each certified parameter value.
    pub cert_digits: Vec<u32>,
    pub cert_sd_digits: Vec<u32>,
    pub rss: f64,
    pub rss_digits: u32,
    pub data: Data,
}

macro_rules! file {
    ($name:literal, $level:literal, $model:ident) => {
        (
            $name,
            $level,
            Model::$model,
            include_str!(concat!("../../../data/", $name, ".dat")),
        )
    };
}

/// All 27 problems, in the order of the NIST web page.
pub const FILES: [(&str, &str, Model, &str); 27] = [
    file!("Misra1a", "lower", Misra1a),
    file!("Chwirut2", "lower", Chwirut),
    file!("Chwirut1", "lower", Chwirut),
    file!("Lanczos3", "lower", Lanczos),
    file!("Gauss1", "lower", Gauss2Peaks),
    file!("Gauss2", "lower", Gauss2Peaks),
    file!("DanWood", "lower", DanWood),
    file!("Misra1b", "lower", Misra1b),
    file!("Kirby2", "average", Kirby2),
    file!("Hahn1", "average", Rational33),
    file!("Nelson", "average", Nelson),
    file!("MGH17", "average", Mgh17),
    file!("Lanczos1", "average", Lanczos),
    file!("Lanczos2", "average", Lanczos),
    file!("Gauss3", "average", Gauss2Peaks),
    file!("Misra1c", "average", Misra1c),
    file!("Misra1d", "average", Misra1d),
    file!("Roszman1", "average", Roszman1),
    file!("ENSO", "average", Enso),
    file!("MGH09", "higher", Mgh09),
    file!("Thurber", "higher", Rational33),
    file!("BoxBOD", "higher", Misra1a),
    file!("Rat42", "higher", Rat42),
    file!("MGH10", "higher", Mgh10),
    file!("Eckerle4", "higher", Eckerle4),
    file!("Rat43", "higher", Rat43),
    file!("Bennett5", "higher", Bennett5),
];

/// Significant digits of a number written as in the NIST files.
fn digits(s: &str) -> u32 {
    let mantissa = s.split(['E', 'e']).next().unwrap_or("");
    let ds: String = mantissa.chars().filter(|c| c.is_ascii_digit()).collect();
    ds.trim_start_matches('0').len() as u32
}

fn num(s: &str) -> f64 {
    s.parse().unwrap_or_else(|_| panic!("bad number {s:?}"))
}

/// The two line numbers in "(lines 41 to 42)".
fn line_range(line: &str) -> (usize, usize) {
    let i = line.find("(lines").expect("line range");
    let ws: Vec<&str> = line[i + 6..]
        .trim_end_matches([')', ' ', '\r'])
        .split_whitespace()
        .collect();
    (
        ws[0].parse().unwrap(),
        ws[2].trim_end_matches(')').parse().unwrap(),
    )
}

/// Parse one .dat file.
pub fn parse(name: &'static str, level: &'static str, model: Model, text: &str) -> Nist {
    let lines: Vec<&str> = text.lines().map(|l| l.trim_end_matches('\r')).collect();
    let mut start = (0, 0);
    let mut data = (0, 0);
    for l in &lines[..12] {
        if l.contains("Starting Values") {
            start = line_range(l);
        } else if l.contains("Data ") && l.contains("(lines") {
            data = line_range(l);
        }
    }
    let p = model.npar();
    assert_eq!(start.1 - start.0 + 1, p, "{name}: parameter count");
    let (mut start1, mut start2, mut cert, mut cert_sd) = (vec![], vec![], vec![], vec![]);
    let (mut cert_digits, mut cert_sd_digits) = (vec![], vec![]);
    for l in &lines[start.0 - 1..start.1] {
        let ws: Vec<&str> = l.split_whitespace().collect();
        // b1 = start1 start2 certified sd
        assert_eq!(ws[1], "=", "{name}: {l}");
        start1.push(num(ws[2]));
        start2.push(num(ws[3]));
        cert.push(num(ws[4]));
        cert_sd.push(num(ws[5]));
        cert_digits.push(digits(ws[4]));
        cert_sd_digits.push(digits(ws[5]));
    }
    let rss_line = lines
        .iter()
        .find(|l| l.starts_with("Residual Sum of Squares"))
        .expect("rss");
    let rss_s = rss_line.split_whitespace().last().unwrap();
    let ncols = model.ncols();
    let mut x = vec![];
    let mut y = vec![];
    for l in &lines[data.0 - 1..data.1] {
        let ws: Vec<f64> = l.split_whitespace().map(num).collect();
        assert_eq!(ws.len(), ncols + 1, "{name}: data row {l}");
        // Nelson fits log(y).
        y.push(if model == Model::Nelson {
            libm::log(ws[0])
        } else {
            ws[0]
        });
        x.extend_from_slice(&ws[1..]);
    }
    Nist {
        name,
        level,
        model,
        start1,
        start2,
        cert,
        cert_sd,
        cert_digits,
        cert_sd_digits,
        rss: num(rss_s),
        rss_digits: digits(rss_s),
        data: Data {
            ncols,
            x,
            y,
            w: None,
        },
    }
}

/// Parse all embedded problems.
pub fn all() -> Vec<Nist> {
    FILES
        .iter()
        .map(|&(n, l, m, t)| parse(n, l, m, t))
        .collect()
}

/// Find one problem by name.
pub fn get(name: &str) -> Nist {
    let &(n, l, m, t) = FILES.iter().find(|f| f.0 == name).expect("problem name");
    parse(n, l, m, t)
}
