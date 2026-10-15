//! Stand-in for the automatic detection of CSV settings (docs/spec.md 10.1).

/// The detected settings.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Detected {
    /// The delimiter byte (`b' '` means runs of whitespace).
    pub delimiter: u8,
    /// Lines before the table.
    pub skip: usize,
    /// Whether the first table line is a header.
    pub header: bool,
    /// Whether the second table line is a unit row.
    pub units: bool,
    /// Whether the decimal separator is a comma.
    pub decimal_comma: bool,
    /// The number of columns.
    pub columns: usize,
}

fn is_comment(line: &str) -> bool {
    matches!(line.trim_start().bytes().next(), Some(b'#' | b'%' | b';'))
}

fn split(line: &str, d: u8) -> Vec<&str> {
    if d == b' ' {
        line.split_whitespace().collect()
    } else {
        line.split(d as char).collect()
    }
}

fn is_missing(f: &str) -> bool {
    matches!(f.trim(), "" | "NaN" | "nan" | "NA" | "N/A" | "-")
}

fn is_number(f: &str, decimal_comma: bool) -> bool {
    let f = f.trim();
    let mut digits = 0;
    let mut seen_point = false;
    let mut seen_e = false;
    for (i, b) in f.bytes().enumerate() {
        match b {
            b'0'..=b'9' => digits += 1,
            b'+' | b'-' if i == 0 || matches!(f.as_bytes()[i - 1], b'e' | b'E') => {}
            b'.' if !decimal_comma && !seen_point && !seen_e => seen_point = true,
            b',' if decimal_comma && !seen_point && !seen_e => seen_point = true,
            b'e' | b'E' if digits > 0 && !seen_e => seen_e = true,
            _ => return false,
        }
    }
    digits > 0
}

/// Detects the settings of a text table. `text` is already decoded.
pub fn detect(text: &str) -> Detected {
    let lines: Vec<&str> = text.lines().filter(|l| !is_comment(l)).collect();
    let mut best = (0usize, b',', 0usize, 0usize);
    for d in *b"\t;, " {
        let mut run = 0;
        let mut count = 0;
        let mut start = lines.len();
        for (i, l) in lines.iter().enumerate().rev() {
            if l.trim().is_empty() {
                continue;
            }
            let n = split(l, d).len();
            if n < 2 || (count != 0 && n != count) {
                break;
            }
            count = n;
            run += 1;
            start = i;
        }
        if run > best.0 {
            best = (run, d, start, count);
        }
    }
    let (_, delimiter, skip, columns) = best;
    let table = &lines[skip.min(lines.len())..];
    let mut point = false;
    let mut comma = false;
    for l in table.iter().take(200) {
        for f in split(l, delimiter) {
            let b = f.as_bytes();
            for i in 1..b.len().saturating_sub(1) {
                if b[i - 1].is_ascii_digit() && b[i + 1].is_ascii_digit() {
                    point |= b[i] == b'.';
                    comma |= b[i] == b',';
                }
            }
        }
    }
    let decimal_comma = delimiter != b',' && comma && !point;
    let fits = |l: &str| {
        split(l, delimiter)
            .iter()
            .all(|f| is_missing(f) || is_number(f, decimal_comma))
    };
    let header = table.first().is_some_and(|l| !fits(l));
    let units = header && table.get(1).is_some_and(|l| !fits(l));
    Detected {
        delimiter,
        skip,
        header,
        units,
        decimal_comma,
        columns,
    }
}

/// Reads the numeric columns of a table with the detected settings.
pub fn read_columns(text: &str, d: &Detected) -> Vec<Vec<f64>> {
    let mut cols = vec![Vec::new(); d.columns];
    let lines = text
        .lines()
        .filter(|l| !is_comment(l) && !l.trim().is_empty());
    let first = usize::from(d.header) + usize::from(d.units);
    for l in lines.skip(d.skip + first) {
        for (c, f) in split(l, d.delimiter).iter().enumerate().take(d.columns) {
            let v = if is_missing(f) {
                f64::NAN
            } else if d.decimal_comma {
                crate::lex::parse_number(&f.trim().replace(',', "."))
            } else {
                crate::lex::parse_number(f.trim().trim_start_matches('+'))
            };
            cols[c].push(if f.trim().starts_with('-') { -v } else { v });
        }
    }
    cols
}
