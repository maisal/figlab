//! Layout stand-in: axes, ticks, labels, and a draw list in pt.

/// Something that measures and shapes text.
pub trait Shaper {
    /// Shapes `text` at `size` pt. Returns glyph ids with x offsets in pt,
    /// and the total advance in pt.
    fn shape(&mut self, text: &str, size: f32) -> (Vec<(u16, f32)>, f32);
    /// The outline of a glyph at `size` pt, as path commands.
    fn outline(&mut self, glyph: u16, size: f32, out: &mut Vec<PathCmd>);
}

/// A path command.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PathCmd {
    /// Move to.
    M(f32, f32),
    /// Line to.
    L(f32, f32),
    /// Quadratic curve to.
    Q(f32, f32, f32, f32),
    /// Cubic curve to.
    C(f32, f32, f32, f32, f32, f32),
    /// Close.
    Z,
}

/// One item of the draw data.
#[derive(Clone, Debug, PartialEq)]
pub enum Draw {
    /// A polyline.
    Line {
        /// Points in pt.
        points: Vec<(f32, f32)>,
        /// Width in pt.
        width: f32,
        /// RGB color.
        color: u32,
    },
    /// A run of glyphs.
    Glyphs {
        /// Glyph ids and positions in pt.
        glyphs: Vec<(u16, f32, f32)>,
        /// Size in pt.
        size: f32,
        /// The text, for SVG and PDF.
        text: String,
        /// Where the run starts.
        x: f32,
        /// The baseline.
        y: f32,
    },
    /// A filled path, such as a glyph outline or a marker.
    Path {
        /// Path commands in pt.
        cmds: Vec<PathCmd>,
        /// RGB color.
        color: u32,
    },
}

/// Settings of a simple xy graph.
#[derive(Clone, Debug)]
pub struct Graph {
    /// Width in pt.
    pub width: f32,
    /// Height in pt.
    pub height: f32,
    /// x data.
    pub x: Vec<f64>,
    /// y data.
    pub y: Vec<f64>,
    /// x axis label.
    pub xlabel: String,
    /// y axis label.
    pub ylabel: String,
    /// Font size in pt.
    pub font_size: f32,
    /// Whether to put glyph outlines in the draw data (for the screen).
    pub outlines: bool,
}

/// "Nice" tick values between `lo` and `hi`.
pub fn ticks(lo: f64, hi: f64, max_ticks: usize) -> Vec<f64> {
    if hi.partial_cmp(&lo) != Some(core::cmp::Ordering::Greater)
        || !lo.is_finite()
        || !hi.is_finite()
    {
        return vec![lo];
    }
    let span = hi - lo;
    let raw = span / max_ticks.max(1) as f64;
    let mag = libm::pow(10.0, libm::floor(libm::log10(raw)));
    let norm = raw / mag;
    let step = mag
        * if norm < 1.5 {
            1.0
        } else if norm < 3.0 {
            2.0
        } else if norm < 7.0 {
            5.0
        } else {
            10.0
        };
    let first = libm::ceil(lo / step - 1e-9) * step;
    let mut out = Vec::new();
    let mut i = 0;
    loop {
        let v = first + step * i as f64;
        if v > hi + step * 1e-9 {
            break;
        }
        out.push(if libm::fabs(v) < step * 1e-9 { 0.0 } else { v });
        i += 1;
    }
    out
}

/// Formats a tick value with the fewest decimals needed for its step.
pub fn tick_label(v: f64, step: f64) -> String {
    let decimals = if step >= 1.0 {
        0
    } else {
        (-libm::floor(libm::log10(step))) as usize
    };
    format!("{v:.decimals$}")
}

fn range(v: &[f64]) -> (f64, f64) {
    let mut lo = f64::INFINITY;
    let mut hi = f64::NEG_INFINITY;
    for &x in v {
        if x.is_finite() {
            lo = lo.min(x);
            hi = hi.max(x);
        }
    }
    if lo == hi {
        (lo - 1.0, hi + 1.0)
    } else {
        (lo, hi)
    }
}

fn text<S: Shaper>(
    s: &mut S,
    g: &Graph,
    out: &mut Vec<Draw>,
    t: &str,
    x: f32,
    y: f32,
    anchor: f32,
) {
    let (glyphs, adv) = s.shape(t, g.font_size);
    let x0 = x - adv * anchor;
    if g.outlines {
        let mut cmds = Vec::new();
        for &(gid, dx) in &glyphs {
            let start = cmds.len();
            s.outline(gid, g.font_size, &mut cmds);
            for c in &mut cmds[start..] {
                let shift = |px: &mut f32, py: &mut f32| {
                    *px += x0 + dx;
                    *py = y - *py;
                };
                match c {
                    PathCmd::M(a, b) | PathCmd::L(a, b) => shift(a, b),
                    PathCmd::Q(a, b, c2, d) => {
                        shift(a, b);
                        shift(c2, d);
                    }
                    PathCmd::C(a, b, c2, d, e, f) => {
                        shift(a, b);
                        shift(c2, d);
                        shift(e, f);
                    }
                    PathCmd::Z => {}
                }
            }
        }
        out.push(Draw::Path { cmds, color: 0 });
    }
    out.push(Draw::Glyphs {
        glyphs: glyphs.iter().map(|&(g, dx)| (g, x0 + dx, y)).collect(),
        size: g.font_size,
        text: t.to_string(),
        x: x0,
        y,
    });
}

/// Lays out a graph and returns the draw data.
pub fn layout<S: Shaper>(g: &Graph, s: &mut S) -> Vec<Draw> {
    let mut out = Vec::new();
    let left = g.font_size * 4.0;
    let bottom = g.height - g.font_size * 3.0;
    let right = g.width - g.font_size;
    let top = g.font_size;
    let (x0, x1) = range(&g.x);
    let (y0, y1) = range(&g.y);
    let sx = |v: f64| left + ((v - x0) / (x1 - x0)) as f32 * (right - left);
    let sy = |v: f64| bottom - ((v - y0) / (y1 - y0)) as f32 * (bottom - top);
    out.push(Draw::Line {
        points: vec![
            (left, top),
            (left, bottom),
            (right, bottom),
            (right, top),
            (left, top),
        ],
        width: 0.8,
        color: 0,
    });
    let xt = ticks(x0, x1, 6);
    let xstep = if xt.len() > 1 { xt[1] - xt[0] } else { 1.0 };
    for &t in &xt {
        let px = sx(t);
        out.push(Draw::Line {
            points: vec![(px, bottom), (px, bottom - 4.0)],
            width: 0.8,
            color: 0,
        });
        let label = tick_label(t, xstep);
        text(s, g, &mut out, &label, px, bottom + g.font_size * 1.2, 0.5);
    }
    let yt = ticks(y0, y1, 5);
    let ystep = if yt.len() > 1 { yt[1] - yt[0] } else { 1.0 };
    for &t in &yt {
        let py = sy(t);
        out.push(Draw::Line {
            points: vec![(left, py), (left + 4.0, py)],
            width: 0.8,
            color: 0,
        });
        let label = tick_label(t, ystep);
        text(
            s,
            g,
            &mut out,
            &label,
            left - 3.0,
            py + g.font_size * 0.35,
            1.0,
        );
    }
    let xl = g.xlabel.clone();
    text(
        s,
        g,
        &mut out,
        &xl,
        (left + right) / 2.0,
        g.height - 4.0,
        0.5,
    );
    let yl = g.ylabel.clone();
    text(s, g, &mut out, &yl, 2.0, top + g.font_size, 0.0);
    let points =
        g.x.iter()
            .zip(&g.y)
            .filter(|(x, y)| x.is_finite() && y.is_finite())
            .map(|(&x, &y)| (sx(x), sy(y)))
            .collect();
    out.push(Draw::Line {
        points,
        width: 1.0,
        color: 0x1f77b4,
    });
    out
}

/// Flattens the draw data into f32 values, as the screen code would read it.
pub fn flatten(draw: &[Draw]) -> Vec<f32> {
    let mut out = Vec::new();
    for d in draw {
        match d {
            Draw::Line {
                points,
                width,
                color,
            } => {
                out.extend([1.0, *width, *color as f32, points.len() as f32]);
                for (x, y) in points {
                    out.extend([*x, *y]);
                }
            }
            Draw::Glyphs { glyphs, size, .. } => {
                out.extend([2.0, *size, glyphs.len() as f32]);
                for (g, x, y) in glyphs {
                    out.extend([f32::from(*g), *x, *y]);
                }
            }
            Draw::Path { cmds, color } => {
                out.extend([3.0, *color as f32, cmds.len() as f32]);
                for c in cmds {
                    match *c {
                        PathCmd::M(a, b) => out.extend([0.0, a, b]),
                        PathCmd::L(a, b) => out.extend([1.0, a, b]),
                        PathCmd::Q(a, b, c, d) => out.extend([2.0, a, b, c, d]),
                        PathCmd::C(a, b, c, d, e, f) => out.extend([3.0, a, b, c, d, e, f]),
                        PathCmd::Z => out.push(4.0),
                    }
                }
            }
        }
    }
    out
}

/// Reads draw data back from the flat form made by [`flatten`].
pub fn unflatten(v: &[f32]) -> Vec<Draw> {
    let mut out = Vec::new();
    let mut i = 0;
    let next = |i: &mut usize| {
        let x = v.get(*i).copied().unwrap_or(0.0);
        *i += 1;
        x
    };
    while i < v.len() {
        match next(&mut i) as u32 {
            1 => {
                let width = next(&mut i);
                let color = next(&mut i) as u32;
                let n = next(&mut i) as usize;
                let points = (0..n).map(|_| (next(&mut i), next(&mut i))).collect();
                out.push(Draw::Line {
                    points,
                    width,
                    color,
                });
            }
            2 => {
                let size = next(&mut i);
                let n = next(&mut i) as usize;
                let glyphs: Vec<(u16, f32, f32)> = (0..n)
                    .map(|_| (next(&mut i) as u16, next(&mut i), next(&mut i)))
                    .collect();
                let (x, y) = glyphs.first().map(|g| (g.1, g.2)).unwrap_or((0.0, 0.0));
                out.push(Draw::Glyphs {
                    glyphs,
                    size,
                    text: String::new(),
                    x,
                    y,
                });
            }
            3 => {
                let color = next(&mut i) as u32;
                let n = next(&mut i) as usize;
                let mut cmds = Vec::with_capacity(n);
                for _ in 0..n {
                    cmds.push(match next(&mut i) as u32 {
                        0 => PathCmd::M(next(&mut i), next(&mut i)),
                        1 => PathCmd::L(next(&mut i), next(&mut i)),
                        2 => PathCmd::Q(next(&mut i), next(&mut i), next(&mut i), next(&mut i)),
                        3 => PathCmd::C(
                            next(&mut i),
                            next(&mut i),
                            next(&mut i),
                            next(&mut i),
                            next(&mut i),
                            next(&mut i),
                        ),
                        _ => PathCmd::Z,
                    });
                }
                out.push(Draw::Path { cmds, color });
            }
            _ => break,
        }
    }
    out
}
