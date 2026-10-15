//! SVG writer stand-in.

use crate::layout::{Draw, PathCmd};
use std::fmt::Write;

fn color(c: u32) -> String {
    format!("#{c:06x}")
}

fn escape(s: &str, out: &mut String) {
    for ch in s.chars() {
        match ch {
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '&' => out.push_str("&amp;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(ch),
        }
    }
}

/// Writes a number with at most 3 decimals and no trailing zeros.
pub fn num(v: f32, out: &mut String) {
    let r = libm::roundf(v * 1000.0) / 1000.0;
    let mut s = String::new();
    let _ = write!(s, "{r:.3}");
    let t = s.trim_end_matches('0').trim_end_matches('.');
    out.push_str(if t == "-0" { "0" } else { t });
}

/// Writes path commands as SVG path data.
pub fn path_data(cmds: &[PathCmd], out: &mut String) {
    for c in cmds {
        match *c {
            PathCmd::M(x, y) => {
                out.push('M');
                num(x, out);
                out.push(' ');
                num(y, out);
            }
            PathCmd::L(x, y) => {
                out.push('L');
                num(x, out);
                out.push(' ');
                num(y, out);
            }
            PathCmd::Q(a, b, x, y) => {
                out.push('Q');
                for (i, v) in [a, b, x, y].into_iter().enumerate() {
                    if i > 0 {
                        out.push(' ');
                    }
                    num(v, out);
                }
            }
            PathCmd::C(a, b, c2, d, x, y) => {
                out.push('C');
                for (i, v) in [a, b, c2, d, x, y].into_iter().enumerate() {
                    if i > 0 {
                        out.push(' ');
                    }
                    num(v, out);
                }
            }
            PathCmd::Z => out.push('Z'),
        }
    }
}

/// Writes the draw data as an SVG document.
pub fn svg(draw: &[Draw], width: f32, height: f32, font: &str) -> String {
    let mut out = String::new();
    let _ = writeln!(
        out,
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}pt\" height=\"{height}pt\" viewBox=\"0 0 {width} {height}\">"
    );
    for d in draw {
        match d {
            Draw::Line {
                points,
                width,
                color: c,
            } => {
                out.push_str("<polyline fill=\"none\" stroke=\"");
                out.push_str(&color(*c));
                out.push_str("\" stroke-width=\"");
                num(*width, &mut out);
                out.push_str("\" points=\"");
                for (i, (x, y)) in points.iter().enumerate() {
                    if i > 0 {
                        out.push(' ');
                    }
                    num(*x, &mut out);
                    out.push(',');
                    num(*y, &mut out);
                }
                out.push_str("\"/>\n");
            }
            Draw::Glyphs {
                size, text, x, y, ..
            } => {
                out.push_str("<text x=\"");
                num(*x, &mut out);
                out.push_str("\" y=\"");
                num(*y, &mut out);
                let _ = write!(out, "\" font-family=\"{font}\" font-size=\"");
                num(*size, &mut out);
                out.push_str("\">");
                escape(text, &mut out);
                out.push_str("</text>\n");
            }
            Draw::Path { cmds, color: c } => {
                if cmds.is_empty() {
                    continue;
                }
                out.push_str("<path fill=\"");
                out.push_str(&color(*c));
                out.push_str("\" d=\"");
                path_data(cmds, &mut out);
                out.push_str("\"/>\n");
            }
        }
    }
    out.push_str("</svg>\n");
    out
}
