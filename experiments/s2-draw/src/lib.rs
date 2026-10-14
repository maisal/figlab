//! M1 experiment S2: decimation of a 10-million-point trace.
//!
//! This crate is not part of figlab (experiments/README.md). It holds:
//!
//! - [`make_trace`]: a synthetic trace (x ascending with jitter, y a random
//!   walk with spikes and NaN gaps), and an unsorted variant
//! - [`decimate_scan`]: M4 decimation (first, min, max, last per pixel column)
//!   by a direct scan of the visible index range
//! - [`Pyramid`] and [`decimate_pyramid`]: the same output from a precomputed
//!   min/max pyramid, so a column costs about O(log n) at any zoom
//! - [`decimate_unsorted`]: a full scan for traces whose x is not sorted
//! - [`FixedX`] and [`gpu_chunk`]: the point data for WebGL markers, with x as
//!   integer fixed point so that the GPU positions match f64
//! - the `wasm` module: plain `extern "C"` exports used by the web worker
//!
//! The output of every decimation is one `Vec<f64>` of interleaved `x, y`
//! pairs. A pair of NaN marks a break in the line.
//!
//! Rules of the decimation (the scan and the pyramid give the same bits):
//!
//! - A point whose x or y is NaN is a break. A NaN x does not make a sorted
//!   trace unsorted; such a point belongs to the column of the point before it.
//! - Per column, the points before the first break and after the last break
//!   each get first, min, max, and last (M4). The points between the first and
//!   the last break of a column (between two breaks) are kept as one vertical
//!   line from their min to their max, followed by a break.
//! - One point beyond each edge of the view is included, so the segments that
//!   cross the plot edges are drawn.
//! - Ties in min or max go to the lower index.

/// A trace: `x` and `y` of the same length.
pub struct Trace {
    /// x values. Ascending (ignoring NaN) when `sorted` is true.
    pub x: Vec<f64>,
    /// y values. May contain NaN (gaps) and infinities.
    pub y: Vec<f64>,
    /// Whether `x` was made in ascending order.
    pub sorted: bool,
}

/// A small splitmix64 generator. No dependency is needed for the experiment.
pub struct Rng(u64);

impl Rng {
    /// Makes a generator from a seed.
    pub fn new(seed: u64) -> Self {
        Rng(seed)
    }

    /// The next 64 random bits.
    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// A uniform value in [0, 1).
    pub fn uniform(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 * (1.0 / (1u64 << 53) as f64)
    }

    /// A roughly normal value (sum of four uniforms, centered).
    pub fn normal_ish(&mut self) -> f64 {
        self.uniform() + self.uniform() + self.uniform() + self.uniform() - 2.0
    }
}

/// Where the x values start. Large, so that f32 loses the small steps
/// (the marker precision test in the web page).
pub const X_START: f64 = 1.0e6;
/// The mean x step.
pub const X_STEP: f64 = 1.0e-3;

/// Makes a synthetic trace of `n` points.
///
/// - `sorted`: x goes up by `X_STEP × (0.5 + u)` per point (u uniform), so it
///   is ascending with jitter. Otherwise x is a random walk (not sorted).
/// - y is a random walk. About one point in 100,000 is a spike.
/// - A NaN gap of n / 200 points starts at 60% of the trace. There are also a
///   few single NaN points (every 1,234,567th point), narrower than a pixel
///   column at full view.
/// - `nan_every > 0`: also every `nan_every`-th y is NaN (the NaN-dense case).
pub fn make_trace(n: usize, seed: u64, sorted: bool, nan_every: usize) -> Trace {
    let mut rng = Rng::new(seed);
    let mut x = Vec::with_capacity(n);
    let mut y = Vec::with_capacity(n);
    let mut xv = X_START;
    let mut yv = 0.0;
    let gap_start = n / 10 * 6;
    let gap_end = gap_start + n / 200;
    for i in 0..n {
        if sorted {
            xv += X_STEP * (0.5 + rng.uniform());
        } else {
            xv += X_STEP * 10.0 * (rng.uniform() - 0.5);
        }
        x.push(xv);
        yv += 0.01 * rng.normal_ish();
        let mut out = yv;
        if rng.next_u64().is_multiple_of(100_000) {
            out += if rng.next_u64() & 1 == 0 { 5.0 } else { -5.0 };
        }
        if (gap_start..gap_end).contains(&i) || i % 1_234_567 == 1_234_566 {
            out = f64::NAN;
        }
        if nan_every > 0 && i % nan_every == nan_every - 1 {
            out = f64::NAN;
        }
        y.push(out);
    }
    Trace { x, y, sorted }
}

/// The value the decimation uses for a point: NaN (a break) when x or y is NaN.
#[inline]
fn value(x: f64, y: f64) -> f64 {
    if x.is_nan() { f64::NAN } else { y }
}

/// Whether (v, i) is a better minimum than (cv, ci). Ties go to the lower index.
#[inline]
fn lower(v: f64, i: u32, cv: f64, ci: u32) -> bool {
    v < cv || (v == cv && i < ci)
}

/// Whether (v, i) is a better maximum than (cv, ci). Ties go to the lower index.
#[inline]
fn higher(v: f64, i: u32, cv: f64, ci: u32) -> bool {
    v > cv || (v == cv && i < ci)
}

/// The points of a column between two breaks (or the column edges).
/// `first == u32::MAX` means empty. The result does not depend on the order of
/// the calls.
#[derive(Clone, Copy)]
struct Seg {
    first: u32,
    last: u32,
    imin: u32,
    imax: u32,
    vmin: f64,
    vmax: f64,
}

impl Seg {
    const EMPTY: Seg = Seg {
        first: u32::MAX,
        last: 0,
        imin: 0,
        imax: 0,
        vmin: 0.0,
        vmax: 0.0,
    };

    fn is_empty(&self) -> bool {
        self.first == u32::MAX
    }

    /// Adds a finite (or infinite, but not NaN) point.
    #[inline]
    fn push(&mut self, i: u32, v: f64) {
        self.push_block(
            &Block {
                min: v,
                max: v,
                imin: i,
                imax: i,
            },
            i,
            i,
        );
    }

    /// Adds a block without breaks that covers the indices [first, last].
    #[inline]
    fn push_block(&mut self, b: &Block, first: u32, last: u32) {
        if self.is_empty() {
            *self = Seg {
                first,
                last,
                imin: b.imin,
                imax: b.imax,
                vmin: b.min,
                vmax: b.max,
            };
            return;
        }
        self.first = self.first.min(first);
        self.last = self.last.max(last);
        if lower(b.min, b.imin, self.vmin, self.imin) {
            self.vmin = b.min;
            self.imin = b.imin;
        }
        if higher(b.max, b.imax, self.vmax, self.imax) {
            self.vmax = b.max;
            self.imax = b.imax;
        }
    }

    /// Adds all points of another segment.
    fn merge(&mut self, o: &Seg) {
        if o.is_empty() {
            return;
        }
        let lo = Block {
            min: o.vmin,
            max: o.vmax,
            imin: o.imin,
            imax: o.imax,
        };
        self.push_block(&lo, o.first, o.last);
    }
}

/// The points of one pixel column, split at breaks.
///
/// `a` holds the points before the first break, `b` the points after the last
/// break, and `mid` the points between the first and the last break.
#[derive(Clone, Copy)]
struct Col {
    a: Seg,
    mid: Seg,
    b: Seg,
    has_break: bool,
}

impl Col {
    const EMPTY: Col = Col {
        a: Seg::EMPTY,
        mid: Seg::EMPTY,
        b: Seg::EMPTY,
        has_break: false,
    };

    /// Adds a point in index order. NaN is a break.
    #[inline]
    fn push(&mut self, i: u32, v: f64) {
        if v.is_nan() {
            if self.has_break {
                let b = self.b;
                self.mid.merge(&b);
            }
            self.has_break = true;
            self.b = Seg::EMPTY;
        } else if self.has_break {
            self.b.push(i, v);
        } else {
            self.a.push(i, v);
        }
    }

    /// Adds a block without breaks, in index order.
    #[inline]
    fn push_block(&mut self, blk: &Block, first: u32, last: u32) {
        if self.has_break {
            self.b.push_block(blk, first, last);
        } else {
            self.a.push_block(blk, first, last);
        }
    }
}

/// Writes decimated points as interleaved `x, y` pairs with NaN breaks.
struct Writer<'a> {
    x: &'a [f64],
    y: &'a [f64],
    out: &'a mut Vec<f64>,
    last_was_break: bool,
}

impl Writer<'_> {
    fn point(&mut self, i: u32) {
        self.out.push(self.x[i as usize]);
        self.out.push(self.y[i as usize]);
        self.last_was_break = false;
    }

    fn brk(&mut self) {
        if !self.last_was_break && !self.out.is_empty() {
            self.out.push(f64::NAN);
            self.out.push(f64::NAN);
            self.last_was_break = true;
        }
    }

    /// Writes the given indices in order, each once.
    fn points(&mut self, idx: &[u32]) {
        let mut prev = u32::MAX;
        for &i in idx {
            if i != prev {
                self.point(i);
                prev = i;
            }
        }
    }

    /// Writes first, min, max (in index order), last.
    fn seg(&mut self, s: &Seg) {
        if s.is_empty() {
            return;
        }
        let (p, q) = (s.imin.min(s.imax), s.imin.max(s.imax));
        self.points(&[s.first, p, q, s.last]);
    }

    fn col(&mut self, c: &Col) {
        self.seg(&c.a);
        if c.has_break {
            self.brk();
            if !c.mid.is_empty() {
                let m = &c.mid;
                self.points(&[m.imin.min(m.imax), m.imin.max(m.imax)]);
                self.brk();
            }
        }
        self.seg(&c.b);
    }
}

/// Maps x to pixel columns for one view.
#[derive(Clone, Copy)]
struct Columns {
    x0: f64,
    x1: f64,
    scale: f64,
    width: isize,
}

impl Columns {
    /// None if the view is empty or not a number.
    fn new(x0: f64, x1: f64, width: usize) -> Option<Columns> {
        if width == 0 || x0.is_nan() || x1.is_nan() || x1 <= x0 {
            return None;
        }
        Some(Columns {
            x0,
            x1,
            scale: width as f64 / (x1 - x0),
            width: width as isize,
        })
    }

    /// The column of x: 0..width-1 inside [x0, x1], -1 left of the view, and
    /// `width` right of it. Monotone in x, so column ends can be found by
    /// binary search. x must not be NaN.
    #[inline]
    fn of(&self, x: f64) -> isize {
        if x < self.x0 {
            -1
        } else if x > self.x1 {
            self.width
        } else {
            (((x - self.x0) * self.scale) as isize).min(self.width - 1)
        }
    }
}

/// The sort key of point i in a sorted trace: the last x that is not NaN at or
/// before i, or -inf if there is none. It is monotone even with NaN in x.
fn key_at(x: &[f64], i: usize) -> f64 {
    x[..=i]
        .iter()
        .rev()
        .find(|v| !v.is_nan())
        .copied()
        .unwrap_or(f64::NEG_INFINITY)
}

/// [`key_at`], but searching back only to `floor`, whose key is known.
#[inline]
fn key_back(x: &[f64], i: usize, floor: usize, floor_key: f64) -> f64 {
    let mut j = i;
    while j > floor {
        if !x[j].is_nan() {
            return x[j];
        }
        j -= 1;
    }
    floor_key
}

/// The first index whose key does not satisfy `pred` (keys are monotone).
/// A run of L NaN x values costs O(L) per probe.
fn partition_key(x: &[f64], pred: impl Fn(f64) -> bool) -> usize {
    let (mut lo, mut hi) = (0, x.len());
    while lo < hi {
        let mid = lo + (hi - lo) / 2;
        if pred(key_at(x, mid)) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    lo
}

/// The index range [lo, hi) to decimate for the view [x0, x1] of a sorted
/// trace: the points with x in the view, plus one point on each side.
pub fn visible_range(x: &[f64], x0: f64, x1: f64) -> (usize, usize) {
    if x.is_empty() {
        return (0, 0);
    }
    let lo = partition_key(x, |k| k < x0);
    let hi = partition_key(x, |k| k <= x1).max(lo);
    (lo.saturating_sub(1), (hi + 1).min(x.len()))
}

/// M4 decimation by a direct scan of the visible index range.
///
/// Cost: O(log n) for the binary search plus O(visible points).
/// `x` must be sorted (NaN allowed). `width` is the plot width in device pixels.
pub fn decimate_scan(t: &Trace, x0: f64, x1: f64, width: usize, out: &mut Vec<f64>) {
    out.clear();
    let Some(cols) = Columns::new(x0, x1, width) else {
        return;
    };
    let (lo, hi) = visible_range(&t.x, x0, x1);
    if lo >= hi {
        return;
    }
    let mut w = Writer {
        x: &t.x,
        y: &t.y,
        out,
        last_was_break: true,
    };
    let mut cur = cols.of(key_at(&t.x, lo));
    let mut col = Col::EMPTY;
    for i in lo..hi {
        let xi = t.x[i];
        let (c, v) = if xi.is_nan() {
            (cur, f64::NAN)
        } else {
            (cols.of(xi), t.y[i])
        };
        if c != cur {
            w.col(&col);
            col = Col::EMPTY;
            cur = c;
        }
        col.push(i as u32, v);
    }
    w.col(&col);
}

/// One block of the pyramid. `imin == u32::MAX` means the block has a break.
#[derive(Clone, Copy)]
pub struct Block {
    /// Smallest y in the block.
    pub min: f64,
    /// Largest y in the block.
    pub max: f64,
    /// Index of the smallest y (the lowest index on ties).
    pub imin: u32,
    /// Index of the largest y (the lowest index on ties).
    pub imax: u32,
}

impl Block {
    const BREAK: Block = Block {
        min: 0.0,
        max: 0.0,
        imin: u32::MAX,
        imax: u32::MAX,
    };

    fn has_break(&self) -> bool {
        self.imin == u32::MAX
    }

    fn merge(a: &Block, b: &Block) -> Block {
        if a.has_break() || b.has_break() {
            return Block::BREAK;
        }
        let mut m = *a;
        if lower(b.min, b.imin, m.min, m.imin) {
            m.min = b.min;
            m.imin = b.imin;
        }
        if higher(b.max, b.imax, m.max, m.imax) {
            m.max = b.max;
            m.imax = b.imax;
        }
        m
    }
}

/// A min/max pyramid over the points. Level 0 has blocks of `base` points,
/// level k has blocks of `base × 2^k` points. A block that holds a break (NaN
/// in x or y) is marked. A query goes down into such a block, so only the
/// level-0 blocks with a break are scanned.
pub struct Pyramid {
    base: usize,
    n: usize,
    levels: Vec<Vec<Block>>,
    break_blocks: usize,
}

impl Pyramid {
    /// Builds the pyramid. Cost: O(n).
    pub fn build(x: &[f64], y: &[f64], base: usize) -> Pyramid {
        assert!(base >= 2);
        let n = y.len();
        let mut level0 = Vec::with_capacity(n.div_ceil(base));
        let mut s = 0;
        while s < n {
            let e = (s + base).min(n);
            let mut b = Block {
                min: value(x[s], y[s]),
                max: value(x[s], y[s]),
                imin: s as u32,
                imax: s as u32,
            };
            let mut brk = b.min.is_nan();
            let mut i = s + 1;
            while !brk && i < e {
                let v = value(x[i], y[i]);
                if v.is_nan() {
                    brk = true;
                }
                if v < b.min {
                    b.min = v;
                    b.imin = i as u32;
                }
                if v > b.max {
                    b.max = v;
                    b.imax = i as u32;
                }
                i += 1;
            }
            level0.push(if brk { Block::BREAK } else { b });
            s = e;
        }
        let break_blocks = level0.iter().filter(|b| b.has_break()).count();
        let mut levels = vec![level0];
        while levels.last().is_some_and(|l| l.len() > 1) {
            let prev = levels.last().expect("not empty");
            let next: Vec<Block> = prev
                .chunks(2)
                .map(|p| {
                    if p.len() == 2 {
                        Block::merge(&p[0], &p[1])
                    } else {
                        p[0]
                    }
                })
                .collect();
            levels.push(next);
        }
        Pyramid {
            base,
            n,
            levels,
            break_blocks,
        }
    }

    /// Whether most level-0 blocks hold a break (NaN-dense data). Then the
    /// pyramid saves nothing, and [`decimate_pyramid`] uses the scan.
    pub fn mostly_breaks(&self) -> bool {
        self.break_blocks * 4 > self.levels[0].len()
    }

    /// Memory used by the blocks, in bytes.
    pub fn bytes(&self) -> usize {
        self.levels
            .iter()
            .map(|l| l.len() * size_of::<Block>())
            .sum()
    }

    /// Number of levels.
    pub fn levels(&self) -> usize {
        self.levels.len()
    }

    /// Adds the points [lo, hi) to `col`, in index order.
    ///
    /// A short range is scanned. Otherwise the query starts at the lowest
    /// level whose blocks are at least as long as the range, so the range lies
    /// in two neighboring blocks, and goes down from there.
    fn query(&self, x: &[f64], y: &[f64], lo: usize, hi: usize, col: &mut Col) {
        if hi <= lo {
            return;
        }
        if hi - lo <= 2 * self.base {
            for i in lo..hi {
                col.push(i as u32, value(x[i], y[i]));
            }
            return;
        }
        let blocks = (hi - lo).div_ceil(self.base);
        let level =
            (blocks.next_power_of_two().trailing_zeros() as usize).min(self.levels.len() - 1);
        let k = lo / (self.base << level);
        self.visit(level, k, lo, hi, x, y, col);
        if k + 1 < self.levels[level].len() {
            self.visit(level, k + 1, lo, hi, x, y, col);
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn visit(
        &self,
        level: usize,
        k: usize,
        lo: usize,
        hi: usize,
        x: &[f64],
        y: &[f64],
        col: &mut Col,
    ) {
        let span = self.base << level;
        let b0 = k * span;
        let b1 = (b0 + span).min(self.n);
        if b1 <= lo || b0 >= hi {
            return;
        }
        let blk = &self.levels[level][k];
        if lo <= b0 && b1 <= hi && !blk.has_break() {
            col.push_block(blk, b0 as u32, (b1 - 1) as u32);
            return;
        }
        if level == 0 {
            for i in lo.max(b0)..hi.min(b1) {
                col.push(i as u32, value(x[i], y[i]));
            }
            return;
        }
        self.visit(level - 1, 2 * k, lo, hi, x, y, col);
        self.visit(level - 1, 2 * k + 1, lo, hi, x, y, col);
    }
}

/// The end of the column that starts at `start`: the first index in
/// (start, hi) whose key is outside the column, or `hi`.
///
/// A galloping search: doubling steps from `start`, then a binary search in
/// the last step. A plain binary search over the whole visible range would
/// touch about log2(n) cache lines far apart for every column.
fn column_end(
    x: &[f64],
    start: usize,
    hi: usize,
    start_key: f64,
    in_col: impl Fn(f64) -> bool,
) -> usize {
    let key = |i: usize| key_back(x, i, start, start_key);
    let first_out = |a: usize, b: usize| {
        let (mut lo, mut hi) = (a, b);
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            if in_col(key(mid)) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        lo
    };
    let mut known_in = start;
    let mut step = 1;
    loop {
        let probe = start + step;
        if probe >= hi {
            return first_out(known_in + 1, hi);
        }
        if in_col(key(probe)) {
            known_in = probe;
            step *= 2;
        } else {
            return first_out(known_in + 1, probe);
        }
    }
}

/// M4 decimation from the pyramid. Same output as [`decimate_scan`].
///
/// Cost: per column, a galloping search for its end and O(log n) blocks, plus
/// a scan of the level-0 blocks that hold a break. When most blocks hold a
/// break (NaN-dense data), it runs [`decimate_scan`] instead.
pub fn decimate_pyramid(
    t: &Trace,
    p: &Pyramid,
    x0: f64,
    x1: f64,
    width: usize,
    out: &mut Vec<f64>,
) {
    if p.mostly_breaks() {
        return decimate_scan(t, x0, x1, width, out);
    }
    out.clear();
    let Some(cols) = Columns::new(x0, x1, width) else {
        return;
    };
    let (lo, hi) = visible_range(&t.x, x0, x1);
    let mut w = Writer {
        x: &t.x,
        y: &t.y,
        out,
        last_was_break: true,
    };
    let mut start = lo;
    let mut key = if lo < hi { key_at(&t.x, lo) } else { 0.0 };
    while start < hi {
        let c = cols.of(key);
        let end = column_end(&t.x, start, hi, key, |k| cols.of(k) <= c);
        let mut col = Col::EMPTY;
        p.query(&t.x, &t.y, start, end, &mut col);
        w.col(&col);
        start = end;
        if start < hi {
            // A NaN x has the key of the point before it, so it never starts
            // a column: x[start] is a number here.
            key = t.x[start];
        }
    }
}

/// Per-column M4 for a trace whose x is not sorted: a full scan of all points.
///
/// Cost: O(n) at every zoom. The result is the vertical envelope of each
/// column, with "first" and "last" the lowest and highest index in the column.
/// A point outside the view is kept when the segment to its neighbor in index
/// order crosses the view. Points with NaN x are skipped.
/// This is right for markers. For a line it is not: the line visits columns in
/// index order, and segments between columns are lost.
pub fn decimate_unsorted(t: &Trace, x0: f64, x1: f64, width: usize, out: &mut Vec<f64>) {
    out.clear();
    let Some(cols) = Columns::new(x0, x1, width) else {
        return;
    };
    let x = &t.x;
    let n = x.len();
    let mut acc = vec![Col::EMPTY; width + 2];
    for i in 0..n {
        let xv = x[i];
        // A point left of the view is kept when a neighbor is at or right of
        // x0 (the segment between them crosses the view), and the same on the
        // right. Comparisons with NaN are false, so a NaN neighbor never counts.
        let keep = if xv < x0 {
            (i > 0 && x[i - 1] >= x0) || (i + 1 < n && x[i + 1] >= x0)
        } else if xv > x1 {
            (i > 0 && x[i - 1] <= x1) || (i + 1 < n && x[i + 1] <= x1)
        } else {
            !xv.is_nan()
        };
        if keep {
            acc[(cols.of(xv) + 1) as usize].push(i as u32, t.y[i]);
        }
    }
    let mut w = Writer {
        x: &t.x,
        y: &t.y,
        out,
        last_was_break: true,
    };
    for c in &acc {
        w.col(c);
    }
}

/// Checks whether x is ascending, ignoring NaN. O(n).
pub fn is_sorted(x: &[f64]) -> bool {
    let mut last = f64::NEG_INFINITY;
    for &v in x {
        if v.is_nan() {
            continue;
        }
        if v < last {
            return false;
        }
        last = v;
    }
    true
}

/// x as integer fixed point for the GPU.
///
/// `q = round((x − origin) / step)` with `step = span / 2^40`, so the data
/// spans 2^40 steps. q is sent as two i32 words: `q = hi × 2^30 + lo` with
/// `0 ≤ lo < 2^30`. The shader subtracts the words of the view's x0 as
/// integers (exact), then converts to float (see [`shader_clip_f32`]).
/// q is clamped to ±2^53, so views up to about 8,000 data spans wide work.
#[derive(Clone, Copy, Debug)]
pub struct FixedX {
    /// The x of q = 0 (the smallest x of the data).
    pub origin: f64,
    /// The x step of one unit of q.
    pub step: f64,
}

/// 2^40: the number of steps over the data span.
pub const FIXED_STEPS: f64 = 1_099_511_627_776.0;
/// 2^30: the weight of the high word.
pub const WORD: i64 = 1 << 30;
const Q_LIMIT: f64 = 9_007_199_254_740_992.0;

impl FixedX {
    /// The scale for data from `xmin` to `xmax`.
    pub fn new(xmin: f64, xmax: f64) -> FixedX {
        let span = if xmax > xmin { xmax - xmin } else { 1.0 };
        FixedX {
            origin: xmin,
            step: span / FIXED_STEPS,
        }
    }

    /// q for x (0 for NaN).
    pub fn encode(&self, x: f64) -> i64 {
        let q = ((x - self.origin) / self.step).round();
        if q.is_nan() {
            0
        } else {
            q.clamp(-Q_LIMIT, Q_LIMIT) as i64
        }
    }

    /// The two words of q.
    pub fn split(q: i64) -> (i32, i32) {
        ((q >> 30) as i32, (q & (WORD - 1)) as i32)
    }
}

/// The vertex shader's x formula, emulated with the same f32 operations.
///
/// `w` are the point's words, `u` the words of the view's x0, and `scale` is
/// `f32(2 × step / (x1 − x0))`. Returns the clip-space x (−1 at x0, +1 at x1).
/// When the high words differ by at most 1, the difference is formed as one
/// int32 (exact) before the conversion; otherwise it is at least 2^30 steps,
/// and the f32 rounding of the low word is small against it.
pub fn shader_clip_f32(w: (i32, i32), u: (i32, i32), scale: f32) -> f32 {
    let dhi = w.0.wrapping_sub(u.0);
    let dlo = w.1.wrapping_sub(u.1);
    let d = if (-1..=1).contains(&dhi) {
        dhi.wrapping_mul(WORD as i32).wrapping_add(dlo) as f32
    } else {
        dhi as f32 * WORD as f32 + dlo as f32
    };
    d * scale - 1.0
}

/// What [`gpu_chunk`] writes per point.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum GpuKind {
    /// 3 words: x high word (i32), x low word (i32), y (f32 bits).
    Main,
    /// 2 words: f32(x), 0. The naive reference.
    Naive,
    /// 2 words: f32(x − origin), 0. One f64 offset.
    Offset,
    /// 2 words: hi = f32(x), lo = f32(x − hi). The hi/lo split.
    HiLo,
}

impl GpuKind {
    /// Words (u32) per point.
    pub fn words(self) -> usize {
        if self == GpuKind::Main { 3 } else { 2 }
    }
}

/// Writes the GPU data of the points [start, start + count) into `out`
/// (replaced). A point with NaN x gets y = NaN, so it is not drawn.
pub fn gpu_chunk(
    t: &Trace,
    fx: &FixedX,
    kind: GpuKind,
    start: usize,
    count: usize,
    out: &mut Vec<u32>,
) {
    out.clear();
    let end = (start + count).min(t.x.len());
    out.reserve((end - start.min(end)) * kind.words());
    for i in start..end {
        let x = t.x[i];
        match kind {
            GpuKind::Main => {
                let (hi, lo) = FixedX::split(fx.encode(x));
                let y = if x.is_nan() { f32::NAN } else { t.y[i] as f32 };
                out.push(hi as u32);
                out.push(lo as u32);
                out.push(y.to_bits());
            }
            GpuKind::Naive => {
                out.push((x as f32).to_bits());
                out.push(0);
            }
            GpuKind::Offset => {
                out.push(((x - fx.origin) as f32).to_bits());
                out.push(0);
            }
            GpuKind::HiLo => {
                let hi = x as f32;
                out.push(hi.to_bits());
                out.push(((x - hi as f64) as f32).to_bits());
            }
        }
    }
}

/// Plain `extern "C"` exports for the web worker. No wasm-bindgen glue is
/// needed: the worker reads the output from the exported memory.
#[cfg(target_arch = "wasm32")]
pub mod wasm {
    use super::*;
    use std::cell::RefCell;

    struct State {
        trace: Trace,
        pyramid: Option<Pyramid>,
        fixed: FixedX,
        out: Vec<f64>,
        gpu: Vec<u32>,
    }

    thread_local! {
        static STATE: RefCell<Option<State>> = const { RefCell::new(None) };
    }

    fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
        STATE.with(|s| f(s.borrow_mut().as_mut().expect("make() first")))
    }

    fn finite_min(v: &[f64]) -> f64 {
        v.iter()
            .copied()
            .filter(|v| v.is_finite())
            .fold(f64::INFINITY, f64::min)
    }

    fn finite_max(v: &[f64]) -> f64 {
        v.iter()
            .copied()
            .filter(|v| v.is_finite())
            .fold(f64::NEG_INFINITY, f64::max)
    }

    /// Makes the trace. Frees the previous one (and its pyramid).
    #[unsafe(no_mangle)]
    pub extern "C" fn make(n: u32, seed: u32, sorted: u32, nan_every: u32) {
        STATE.with(|s| *s.borrow_mut() = None);
        let trace = make_trace(n as usize, seed as u64, sorted != 0, nan_every as usize);
        let fixed = FixedX::new(finite_min(&trace.x), finite_max(&trace.x));
        STATE.with(|s| {
            *s.borrow_mut() = Some(State {
                trace,
                pyramid: None,
                fixed,
                out: Vec::new(),
                gpu: Vec::new(),
            })
        });
    }

    /// Number of points.
    #[unsafe(no_mangle)]
    pub extern "C" fn len() -> u32 {
        with(|s| s.trace.x.len() as u32)
    }

    /// Pointer to the x array (f64).
    #[unsafe(no_mangle)]
    pub extern "C" fn x_ptr() -> *const f64 {
        with(|s| s.trace.x.as_ptr())
    }

    /// Pointer to the y array (f64).
    #[unsafe(no_mangle)]
    pub extern "C" fn y_ptr() -> *const f64 {
        with(|s| s.trace.y.as_ptr())
    }

    /// Smallest finite x.
    #[unsafe(no_mangle)]
    pub extern "C" fn x_min() -> f64 {
        with(|s| finite_min(&s.trace.x))
    }

    /// Largest finite x.
    #[unsafe(no_mangle)]
    pub extern "C" fn x_max() -> f64 {
        with(|s| finite_max(&s.trace.x))
    }

    /// Smallest finite y.
    #[unsafe(no_mangle)]
    pub extern "C" fn y_min() -> f64 {
        with(|s| finite_min(&s.trace.y))
    }

    /// Largest finite y.
    #[unsafe(no_mangle)]
    pub extern "C" fn y_max() -> f64 {
        with(|s| finite_max(&s.trace.y))
    }

    /// 1 if x is ascending, ignoring NaN (checked by a scan), else 0.
    #[unsafe(no_mangle)]
    pub extern "C" fn check_sorted() -> u32 {
        with(|s| is_sorted(&s.trace.x) as u32)
    }

    /// Builds the pyramid with blocks of `base` points. Returns its size in bytes.
    #[unsafe(no_mangle)]
    pub extern "C" fn build_pyramid(base: u32) -> u32 {
        with(|s| {
            let p = Pyramid::build(&s.trace.x, &s.trace.y, base as usize);
            let bytes = p.bytes();
            s.pyramid = Some(p);
            bytes as u32
        })
    }

    /// Number of pyramid levels (0 if not built).
    #[unsafe(no_mangle)]
    pub extern "C" fn pyramid_levels() -> u32 {
        with(|s| s.pyramid.as_ref().map_or(0, |p| p.levels()) as u32)
    }

    /// Decimates for the view [x0, x1] and `width` device pixels.
    /// `method`: 0 = scan, 1 = pyramid, 2 = unsorted full scan.
    /// Returns the number of f64 values written (2 per point). Read them at
    /// [`out_ptr`].
    #[unsafe(no_mangle)]
    pub extern "C" fn decimate(method: u32, x0: f64, x1: f64, width: u32) -> u32 {
        with(|s| {
            let State {
                trace,
                pyramid,
                out,
                ..
            } = s;
            let w = width as usize;
            match method {
                0 => decimate_scan(trace, x0, x1, w, out),
                1 => decimate_pyramid(
                    trace,
                    pyramid.as_ref().expect("build_pyramid() first"),
                    x0,
                    x1,
                    w,
                    out,
                ),
                _ => decimate_unsorted(trace, x0, x1, w, out),
            }
            out.len() as u32
        })
    }

    /// Pointer to the decimation output (f64 pairs).
    #[unsafe(no_mangle)]
    pub extern "C" fn out_ptr() -> *const f64 {
        with(|s| s.out.as_ptr())
    }

    /// Start of [`visible_range`] for a sorted trace.
    #[unsafe(no_mangle)]
    pub extern "C" fn range_lo(x0: f64, x1: f64) -> u32 {
        with(|s| visible_range(&s.trace.x, x0, x1).0 as u32)
    }

    /// End of [`visible_range`] for a sorted trace.
    #[unsafe(no_mangle)]
    pub extern "C" fn range_hi(x0: f64, x1: f64) -> u32 {
        with(|s| visible_range(&s.trace.x, x0, x1).1 as u32)
    }

    /// The origin of the fixed-point x.
    #[unsafe(no_mangle)]
    pub extern "C" fn fixed_origin() -> f64 {
        with(|s| s.fixed.origin)
    }

    /// The step of the fixed-point x.
    #[unsafe(no_mangle)]
    pub extern "C" fn fixed_step() -> f64 {
        with(|s| s.fixed.step)
    }

    /// Writes the GPU data of [start, start + count) into a buffer that is
    /// reused by the next call. `kind`: 0 main, 1 naive, 2 offset, 3 hi/lo.
    /// Returns its pointer; the length is count × (3 or 2) u32 words.
    #[unsafe(no_mangle)]
    pub extern "C" fn gpu_chunk_build(kind: u32, start: u32, count: u32) -> *const u32 {
        let kind = match kind {
            0 => GpuKind::Main,
            1 => GpuKind::Naive,
            2 => GpuKind::Offset,
            _ => GpuKind::HiLo,
        };
        with(|s| {
            let State {
                trace, fixed, gpu, ..
            } = s;
            gpu_chunk(trace, fixed, kind, start as usize, count as usize, gpu);
            gpu.as_ptr()
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn small() -> Trace {
        make_trace(200_000, 7, true, 0)
    }

    /// Compares two outputs bit for bit (NaN equals NaN).
    fn same(a: &[f64], b: &[f64]) -> bool {
        a.len() == b.len() && a.iter().zip(b).all(|(u, v)| u.to_bits() == v.to_bits())
    }

    fn both(t: &Trace, base: usize, x0: f64, x1: f64, width: usize) -> (Vec<f64>, Vec<f64>) {
        let p = Pyramid::build(&t.x, &t.y, base);
        let mut a = Vec::new();
        let mut b = Vec::new();
        decimate_scan(t, x0, x1, width, &mut a);
        decimate_pyramid(t, &p, x0, x1, width, &mut b);
        (a, b)
    }

    fn line(x: Vec<f64>, y: Vec<f64>) -> Trace {
        Trace { x, y, sorted: true }
    }

    #[test]
    fn scan_and_pyramid_agree() {
        for t in [
            small(),
            make_trace(200_000, 9, true, 50),
            make_trace(50_000, 3, true, 3),
        ] {
            let x0 = t.x[0];
            let x1 = t.x[t.x.len() - 1];
            let span = x1 - x0;
            for base in [2usize, 8, 16, 64] {
                for (lo, hi, width) in [
                    (x0, x1, 3200),
                    (x0, x1, 7),
                    (x0 + span * 0.3, x0 + span * 0.4, 3200),
                    (x0 + span * 0.5999, x0 + span * 0.6001, 1600),
                    (x0 + span * 0.1, x0 + span * 0.100001, 3200),
                    (x0 - 10.0, x0 + 5.0, 10),
                    (x1 - 1e-4, x1 + 10.0, 10),
                    (x1 + 1.0, x1 + 2.0, 10),
                ] {
                    let (a, b) = both(&t, base, lo, hi, width);
                    assert!(same(&a, &b), "base {base} view {lo} {hi} {width}");
                }
            }
        }
    }

    #[test]
    fn output_has_at_most_four_points_per_column_segment() {
        let t = small();
        let p = Pyramid::build(&t.x, &t.y, 16);
        let mut out = Vec::new();
        decimate_pyramid(&t, &p, t.x[0], t.x[t.x.len() - 1], 3200, &mut out);
        let points = out.len() / 2;
        // a and b (4 points each), mid (2 points), and breaks, plus 2 edge points.
        assert!(points <= 3200 * 12 + 2, "{points}");
        assert!(points > 3200 * 2, "{points}");
    }

    #[test]
    fn nan_gap_breaks_the_line() {
        let t = small();
        let n = t.x.len();
        let gap_start = n / 10 * 6;
        let gap_end = gap_start + n / 200;
        let (scan, pyr) = both(&t, 16, t.x[0], t.x[n - 1], 3200);
        assert!(same(&scan, &pyr));
        let mut breaks = 0;
        let mut before = false;
        let mut after = false;
        for pair in scan.chunks(2) {
            if pair[0].is_nan() {
                assert!(pair[1].is_nan());
                breaks += 1;
                continue;
            }
            assert!(!pair[1].is_nan(), "a NaN y was written as a point");
            let inside = pair[0] >= t.x[gap_start] && pair[0] <= t.x[gap_end - 1];
            assert!(!inside, "point inside the gap");
            before |= pair[0] < t.x[gap_start];
            after |= pair[0] > t.x[gap_end - 1];
        }
        assert!(before && after);
        // The big gap and the single NaN points each give one break.
        let singles = (0..n).filter(|i| i % 1_234_567 == 1_234_566).count();
        assert_eq!(breaks, 1 + singles);
    }

    #[test]
    fn single_nan_inside_a_column_breaks_the_line() {
        let x: Vec<f64> = (0..10).map(|i| i as f64).collect();
        let y = vec![0.0, 1.0, 2.0, f64::NAN, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0];
        let t = line(x, y);
        // first 0 (also the min), max 2 (also the last) | break | first 4 (min), last 9 (max)
        let want = [0.0, 0.0, 2.0, 2.0, f64::NAN, f64::NAN, 4.0, 4.0, 9.0, 9.0];
        for base in [2, 4] {
            let (a, b) = both(&t, base, 0.0, 9.0, 1);
            assert!(same(&a, &want), "{a:?}");
            assert!(same(&b, &want), "{b:?}");
        }
    }

    #[test]
    fn segments_between_two_breaks_keep_their_extent() {
        let x: Vec<f64> = (0..7).map(|i| i as f64).collect();
        let y = vec![0.0, f64::NAN, 100.0, -100.0, 50.0, f64::NAN, 1.0];
        let t = line(x, y);
        let nan = f64::NAN;
        let want = [
            0.0, 0.0, nan, nan, 2.0, 100.0, 3.0, -100.0, nan, nan, 6.0, 1.0,
        ];
        for base in [2, 4, 8] {
            let (a, b) = both(&t, base, 0.0, 6.0, 1);
            assert!(same(&a, &want), "{a:?}");
            assert!(same(&b, &want), "{b:?}");
        }
    }

    #[test]
    fn segments_crossing_the_plot_edges_are_kept() {
        let x: Vec<f64> = (0..10).map(|i| i as f64 * 10.0).collect();
        let y: Vec<f64> = (0..10).map(|i| i as f64).collect();
        let t = line(x.clone(), y.clone());
        // No point inside the view: the segment from 40 to 50 crosses it.
        let (a, b) = both(&t, 2, 42.0, 48.0, 10);
        assert!(same(&a, &[40.0, 4.0, 50.0, 5.0]), "{a:?}");
        assert!(same(&b, &a));
        // One point inside: the neighbors on both sides are kept.
        let (a, _) = both(&t, 2, 25.0, 35.0, 10);
        assert!(same(&a, &[20.0, 2.0, 30.0, 3.0, 40.0, 4.0]), "{a:?}");
        // The unsorted path keeps the same edge points.
        let u = Trace {
            x,
            y,
            sorted: false,
        };
        let mut v = Vec::new();
        decimate_unsorted(&u, 42.0, 48.0, 10, &mut v);
        assert!(same(&v, &[40.0, 4.0, 50.0, 5.0]), "{v:?}");
    }

    #[test]
    fn infinities_and_ties() {
        let inf = f64::INFINITY;
        for y in [
            vec![1.0, 2.0, inf, inf, 3.0, 4.0],
            vec![1.0, 2.0, -inf, -inf, 3.0, 4.0],
            vec![inf, inf, inf, inf],
            vec![5.0, 5.0, 5.0, 5.0, 5.0],
        ] {
            let x: Vec<f64> = (0..y.len()).map(|i| i as f64).collect();
            let t = line(x, y.clone());
            for base in [2, 4] {
                let (a, b) = both(&t, base, 0.0, 10.0, 1);
                assert!(same(&a, &b), "{y:?} base {base}: {a:?} {b:?}");
            }
            let (a, _) = both(&t, 2, 0.0, 10.0, 1);
            // The first of equal extremes is chosen, so no point repeats and
            // the indices go up.
            let xs: Vec<f64> = a.chunks(2).map(|p| p[0]).collect();
            assert!(xs.windows(2).all(|w| w[0] < w[1]), "{y:?}: {a:?}");
        }
        // Many ties: y takes only four values.
        let mut rng = Rng::new(5);
        let x: Vec<f64> = (0..20_000).map(|i| i as f64).collect();
        let y: Vec<f64> = (0..20_000).map(|_| (rng.next_u64() % 4) as f64).collect();
        let t = line(x, y);
        for base in [2, 16] {
            for width in [1, 7, 300] {
                let (a, b) = both(&t, base, 0.0, 20_000.0, width);
                assert!(same(&a, &b), "base {base} width {width}");
            }
        }
    }

    #[test]
    fn nan_x_is_a_break_and_keeps_the_trace_sorted() {
        let mut t = make_trace(50_000, 11, true, 0);
        for i in [0usize, 1, 1000, 1001, 1002, 25_000, 49_999] {
            t.x[i] = f64::NAN;
        }
        assert!(is_sorted(&t.x));
        let x0 = t.x[2];
        let x1 = t.x[49_998];
        let span = x1 - x0;
        for (lo, hi, width) in [
            (x0, x1, 3200),
            (x0, x1, 5),
            (t.x[990], t.x[1010], 3200),
            (x0 + span * 0.49, x0 + span * 0.51, 100),
        ] {
            for base in [2, 16] {
                let (a, b) = both(&t, base, lo, hi, width);
                assert!(same(&a, &b), "view {lo} {hi} {width} base {base}");
                assert!(a.chunks(2).all(|p| p[0].is_nan() == p[1].is_nan()));
            }
        }
        // At full width, the points 1000..1002 sit in single columns: a break.
        let (a, _) = both(&t, 16, t.x[995], t.x[1006], 10_000);
        assert!(a.chunks(2).any(|p| p[0].is_nan()));
    }

    #[test]
    fn unsorted_scan_gives_the_column_envelope() {
        let t = make_trace(100_000, 3, false, 0);
        assert!(!is_sorted(&t.x));
        let x0 = t.x.iter().cloned().fold(f64::INFINITY, f64::min);
        let x1 = t.x.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
        let mut v = Vec::new();
        decimate_unsorted(&t, x0, x1, 100, &mut v);
        assert!(!v.is_empty());
        let cols = Columns::new(x0, x1, 100).expect("view");
        let mut lo = [f64::INFINITY; 100];
        let mut hi = [f64::NEG_INFINITY; 100];
        for (&x, &y) in t.x.iter().zip(&t.y) {
            if y.is_nan() {
                continue;
            }
            let c = cols.of(x) as usize;
            lo[c] = lo[c].min(y);
            hi[c] = hi[c].max(y);
        }
        let mut seen_lo = [f64::INFINITY; 100];
        let mut seen_hi = [f64::NEG_INFINITY; 100];
        for pair in v.chunks(2) {
            if pair[0].is_nan() {
                continue;
            }
            let c = cols.of(pair[0]) as usize;
            seen_lo[c] = seen_lo[c].min(pair[1]);
            seen_hi[c] = seen_hi[c].max(pair[1]);
        }
        for c in 0..100 {
            if lo[c].is_finite() {
                assert_eq!(lo[c], seen_lo[c], "column {c}");
                assert_eq!(hi[c], seen_hi[c], "column {c}");
            }
        }
    }

    /// The emulated shader formula against f64, at the views of the web page.
    #[test]
    fn fixed_point_matches_f64() {
        let t = make_trace(1_000_000, 1, true, 0);
        let n = t.x.len();
        let fx = FixedX::new(t.x[0], t.x[n - 1]);
        let step = (t.x[n - 1] - t.x[0]) / n as f64;
        let mut worst: f64 = 0.0;
        for (center, pts) in [
            (1000usize, 64.0),
            (n / 2, 64.0),
            (n - 1000, 64.0),
            (n / 2, 8.0),
            (n - 1000, 8.0),
            (n / 2, 1e5),
        ] {
            for shift in [0.0, 0.3, 0.77] {
                let x0 = t.x[center] - step * pts / 2.0 + step * shift;
                let x1 = x0 + step * pts;
                let u = FixedX::split(fx.encode(x0));
                let scale = (2.0 * fx.step / (x1 - x0)) as f32;
                let (lo, hi) = visible_range(&t.x, x0, x1);
                for i in lo..hi {
                    let w = FixedX::split(fx.encode(t.x[i]));
                    let clip = shader_clip_f32(w, u, scale) as f64;
                    let px = (clip + 1.0) / 2.0 * 3200.0;
                    let want = (t.x[i] - x0) / (x1 - x0) * 3200.0;
                    worst = worst.max((px - want).abs());
                }
            }
        }
        assert!(worst < 0.01, "worst error {worst} px");
        // Views far wider than the data still work.
        let x0 = t.x[0] - 1000.0 * (t.x[n - 1] - t.x[0]);
        let x1 = t.x[n - 1] + 1000.0 * (t.x[n - 1] - t.x[0]);
        let u = FixedX::split(fx.encode(x0));
        let scale = (2.0 * fx.step / (x1 - x0)) as f32;
        for i in [0, n / 2, n - 1] {
            let clip = shader_clip_f32(FixedX::split(fx.encode(t.x[i])), u, scale) as f64;
            let want = (t.x[i] - x0) / (x1 - x0) * 2.0 - 1.0;
            assert!((clip - want).abs() * 1600.0 < 0.01, "wide view point {i}");
        }
    }

    #[test]
    fn gpu_chunks_cover_all_points() {
        let t = make_trace(10_000, 1, true, 0);
        let fx = FixedX::new(t.x[0], t.x[t.x.len() - 1]);
        let mut all = Vec::new();
        let mut buf = Vec::new();
        for start in (0..t.x.len()).step_by(3000) {
            gpu_chunk(&t, &fx, GpuKind::Main, start, 3000, &mut buf);
            all.extend_from_slice(&buf);
        }
        assert_eq!(all.len(), t.x.len() * 3);
        for (i, w) in all.chunks(3).enumerate() {
            let q = (w[0] as i32 as i64) * WORD + w[1] as i64;
            assert_eq!(q, fx.encode(t.x[i]));
        }
    }
}
