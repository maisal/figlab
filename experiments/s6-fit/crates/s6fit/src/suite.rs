//! The test runs. Each returns JSON text, so the native and the wasm builds
//! write the same records and can be compared bit for bit.

use crate::fit::{ALL_CANDS, Analysis, Cand, Deriv, Spec, analyze, jacobian, lre, run};
use crate::models::Model;
use crate::nist::{self, Nist};
use crate::problem::{Data, Problem};
use core::fmt::Write;

// ---------------------------------------------------------------- JSON

fn num(v: f64) -> String {
    if v.is_finite() {
        format!("{v:?}")
    } else {
        "null".into()
    }
}

fn arr(v: &[f64]) -> String {
    let items: Vec<String> = v.iter().map(|x| num(*x)).collect();
    format!("[{}]", items.join(","))
}

fn opt_arr(v: &Option<Vec<f64>>) -> String {
    v.as_ref().map_or("null".into(), |v| arr(v))
}

fn bits(vs: &[&[f64]]) -> String {
    let mut s = String::new();
    for v in vs {
        for x in *v {
            let _ = write!(s, "{:016x}", x.to_bits());
        }
        s.push('|');
    }
    s
}

fn min(v: &[f64]) -> f64 {
    v.iter().fold(f64::INFINITY, |a, b| a.min(*b))
}

/// The common fields of a record.
fn record_fields(a: &Analysis) -> String {
    let o = &a.out;
    let lib_err = o.lib_err.clone().unwrap_or_default();
    format!(
        "\"status\":\"{}\",\"converged\":{},\"failed\":{},\"iterations\":{},\"nfev\":{},\"njev\":{},\
         \"params\":{},\"err\":{},\"lib_err\":{},\"rss\":{},\"bits\":\"{}\"",
        o.status,
        o.converged,
        o.failed,
        o.iterations,
        o.nfev,
        o.njev,
        arr(&o.params),
        arr(&a.err),
        opt_arr(&o.lib_err),
        num(a.rss),
        bits(&[
            &o.params,
            &a.err,
            &lib_err,
            &[a.rss],
            &[o.iterations as f64, o.nfev as f64]
        ]),
    )
}

// ---------------------------------------------------------------- NIST

/// A box that holds both starting values and the certified value, with
/// room on both sides. No bound is active at the solution.
pub fn loose_box(nist: &Nist, start: &[f64]) -> (Vec<f64>, Vec<f64>) {
    let mut lo = vec![];
    let mut hi = vec![];
    for (&c, &s) in nist.cert.iter().zip(start) {
        let pad = c.abs() + s.abs();
        lo.push(c.min(s) - pad);
        hi.push(c.max(s) + pad);
    }
    (lo, hi)
}

/// One NIST record as JSON.
pub fn nist_record(nist: &Nist, start_no: u32, c: Cand, d: Deriv, boxed: bool) -> String {
    let start = if start_no == 1 {
        &nist.start1
    } else {
        &nist.start2
    };
    let p = Problem {
        model: nist.model,
        data: &nist.data,
    };
    let mut s = Spec::free(start, d);
    if boxed {
        let (lo, hi) = loose_box(nist, start);
        s.lower = lo;
        s.upper = hi;
    }
    let a = analyze(&p, &s, run(c, &p, &s));
    let n = nist.cert.len();
    let lre_p: Vec<f64> = (0..n)
        .map(|j| lre(a.out.params[j], nist.cert[j], nist.cert_digits[j]))
        .collect();
    let lre_e: Vec<f64> = (0..n)
        .map(|j| lre(a.err[j], nist.cert_sd[j], nist.cert_sd_digits[j]))
        .collect();
    let lre_le: Option<Vec<f64>> = a.out.lib_err.as_ref().map(|e| {
        (0..n)
            .map(|j| lre(e[j], nist.cert_sd[j], nist.cert_sd_digits[j]))
            .collect()
    });
    let lre_rss = lre(a.rss, nist.rss, nist.rss_digits);
    format!(
        "{{\"problem\":\"{}\",\"level\":\"{}\",\"start\":{},\"cand\":\"{}\",\"deriv\":\"{}\",\"boxed\":{},{},\
         \"lre_params\":{},\"lre_err\":{},\"lre_lib_err\":{},\"lre_rss\":{},\
         \"min_lre_params\":{},\"min_lre_err\":{},\"min_lre_lib_err\":{}}}",
        nist.name,
        nist.level,
        start_no,
        c.name(),
        d.name(),
        boxed,
        record_fields(&a),
        arr(&lre_p),
        arr(&lre_e),
        opt_arr(&lre_le),
        num(lre_rss),
        num(min(&lre_p)),
        num(min(&lre_e)),
        lre_le.as_ref().map_or("null".into(), |v| num(min(v))),
    )
}

/// All NIST runs. Without bounds: A0, A2, B, C (A1 is the same as A0
/// without bounds). In a loose box: A1, A2, B, C.
pub fn nist_json(cands: &[Cand]) -> String {
    let all = nist::all();
    let mut recs = vec![];
    for nist in &all {
        for start in [1, 2] {
            for &c in cands {
                for d in [Deriv::Analytic, Deriv::Forward] {
                    for boxed in [false, true] {
                        if (c == Cand::LmTransform && !boxed) || (c == Cand::Lm && boxed) {
                            continue;
                        }
                        recs.push(nist_record(nist, start, c, d, boxed));
                    }
                }
            }
        }
    }
    format!("[\n{}\n]\n", recs.join(",\n"))
}

// ---------------------------------------------------------------- bounds

/// A small deterministic random number generator (splitmix64).
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed)
    }
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }
    /// Uniform in (0, 1).
    fn uniform(&mut self) -> f64 {
        ((self.next_u64() >> 11) as f64 + 0.5) / (1u64 << 53) as f64
    }
    /// Standard normal (Box-Muller with libm).
    pub fn normal(&mut self) -> f64 {
        let u1 = self.uniform();
        let u2 = self.uniform();
        (-2.0 * libm::log(u1)).sqrt() * libm::cos(2.0 * core::f64::consts::PI * u2)
    }
}

/// Synthetic data: `model(x | truth)` plus normal noise.
pub fn synth(model: Model, xs: &[f64], truth: &[f64], noise: f64, seed: u64) -> Data {
    let mut rng = Rng::new(seed);
    let y = xs
        .iter()
        .map(|&x| model.eval(&[x], truth) + noise * rng.normal())
        .collect();
    Data {
        ncols: 1,
        x: xs.to_vec(),
        y,
        w: None,
    }
}

/// A test with bounds that are active at the solution.
pub struct BoundCase {
    pub name: &'static str,
    pub model: Model,
    pub data: Data,
    pub init: Vec<f64>,
    pub lower: Vec<f64>,
    pub upper: Vec<f64>,
}

fn grid(a: f64, step: f64, n: usize) -> Vec<f64> {
    (0..n).map(|i| a + step * i as f64).collect()
}

pub fn bound_cases() -> Vec<BoundCase> {
    let inf = f64::INFINITY;
    let mut v = vec![];
    // Exponential decay, true tau = 2, tau <= 1.5.
    v.push(BoundCase {
        name: "expdecay tau<=1.5",
        model: Model::ExpDecay,
        data: synth(
            Model::ExpDecay,
            &grid(0.0, 0.05, 201),
            &[0.5, 3.0, 2.0],
            0.02,
            1,
        ),
        init: vec![0.3, 2.0, 1.0],
        lower: vec![-inf; 3],
        upper: vec![inf, inf, 1.5],
    });
    // Narrow Gaussian, true w = 0.05, w >= 0.1.
    let g = synth(
        Model::Gauss,
        &grid(-2.0, 0.01, 401),
        &[0.1, 2.0, 0.1, 0.05],
        0.02,
        2,
    );
    v.push(BoundCase {
        name: "gauss w>=0.1",
        model: Model::Gauss,
        data: g.clone(),
        init: vec![0.0, 1.5, 0.0, 0.3],
        lower: vec![-inf, -inf, -inf, 0.1],
        upper: vec![inf; 4],
    });
    // The same data with two active bounds: x0 <= 0.05 and w >= 0.1.
    v.push(BoundCase {
        name: "gauss x0<=0.05 w>=0.1",
        model: Model::Gauss,
        data: g,
        init: vec![0.0, 1.5, 0.0, 0.3],
        lower: vec![-inf, -inf, -inf, 0.1],
        upper: vec![inf, inf, 0.05, inf],
    });
    // NIST problems with a bound between the start and the certified value.
    let m = nist::get("Misra1a");
    v.push(BoundCase {
        name: "Misra1a start1 b1>=300",
        model: m.model,
        init: m.start1.clone(),
        data: m.data,
        lower: vec![300.0, -inf],
        upper: vec![inf; 2],
    });
    let b = nist::get("BoxBOD");
    v.push(BoundCase {
        name: "BoxBOD start2 b2>=0.65",
        model: b.model,
        init: b.start2.clone(),
        data: b.data,
        lower: vec![-inf, 0.65],
        upper: vec![inf; 2],
    });
    v
}

/// Fit with the parameters in `active` fixed at the given values, by A0
/// with analytic derivatives. Returns the analysis, whether the free
/// parameters stay inside the bounds, and whether the gradient points out
/// of the box at every fixed bound (so each bound really is active).
fn fit_with_active(bc: &BoundCase, active: &[(usize, f64)]) -> (Analysis, bool, bool) {
    let p = Problem {
        model: bc.model,
        data: &bc.data,
    };
    let mut s = Spec::free(&bc.init, Deriv::Analytic);
    for &(j, v) in active {
        s.init[j] = v;
        s.fixed[j] = true;
    }
    let a = analyze(&p, &s, run(Cand::Lm, &p, &s));
    let b = &a.out.params;
    let inside = (0..b.len()).all(|j| bc.lower[j] <= b[j] && b[j] <= bc.upper[j]);
    // Gradient of rss/2: J^T r.
    let m = p.m();
    let mut r = vec![0.0; m];
    p.resid(b, &mut r);
    let jac = jacobian(&p, b, &s.upper, Deriv::Analytic);
    let kkt = active.iter().all(|&(j, v)| {
        let g: f64 = (0..m)
            .map(|i| jac[j * m + i] * r[i])
            .fold(0.0, |x, y| x + y);
        if v == bc.lower[j] { g > 0.0 } else { g < 0.0 }
    });
    (a, inside, kkt)
}

/// The reference solution of a bound case. It tries every set of active
/// bounds: the active parameters are fixed at their bounds and the others
/// are fitted without bounds. It keeps the solution with the lowest rss
/// among those that stay inside the box and whose fixed parameters push
/// against their bounds. Returns the analysis and the active set.
pub fn reference(bc: &BoundCase) -> (Analysis, Vec<(usize, f64)>) {
    let n = bc.init.len();
    // Options per parameter: free, at the lower bound, at the upper bound.
    let mut sets: Vec<Vec<(usize, f64)>> = vec![vec![]];
    for j in 0..n {
        let mut next = vec![];
        for set in &sets {
            next.push(set.clone());
            for b in [bc.lower[j], bc.upper[j]] {
                if b.is_finite() {
                    let mut s2 = set.clone();
                    s2.push((j, b));
                    next.push(s2);
                }
            }
        }
        sets = next;
    }
    let mut best: Option<(Analysis, Vec<(usize, f64)>)> = None;
    for set in sets {
        let (a, inside, kkt) = fit_with_active(bc, &set);
        if inside && kkt && a.rss.is_finite() && best.as_ref().is_none_or(|(b, _)| a.rss < b.rss) {
            best = Some((a, set));
        }
    }
    best.expect("no reference solution")
}

pub fn bounds_json() -> String {
    let mut recs = vec![];
    for bc in bound_cases() {
        let (r, act) = reference(&bc);
        let act_names: Vec<String> = act
            .iter()
            .map(|(j, v)| format!("\"b{}={}\"", j + 1, num(*v)))
            .collect();
        let n = bc.init.len();
        let p = Problem {
            model: bc.model,
            data: &bc.data,
        };
        // Reference errors: the active parameters are fixed.
        recs.push(format!(
            "{{\"case\":\"{}\",\"cand\":\"reference\",\"deriv\":\"analytic\",\"active\":[{}],{}}}",
            bc.name,
            act_names.join(","),
            record_fields(&r)
        ));
        for c in ALL_CANDS.into_iter().filter(|c| c.has_bounds()) {
            for d in [Deriv::Analytic, Deriv::Forward] {
                let mut s = Spec::free(&bc.init, d);
                s.lower = bc.lower.clone();
                s.upper = bc.upper.clone();
                let a = analyze(&p, &s, run(c, &p, &s));
                let lre_p: Vec<f64> = (0..n)
                    .map(|j| lre(a.out.params[j], r.out.params[j], 15))
                    .collect();
                let lre_e: Vec<f64> = (0..n)
                    .filter(|&j| !act.iter().any(|&(k, _)| k == j))
                    .map(|j| lre(a.err[j], r.err[j], 15))
                    .collect();
                let lre_le: Option<Vec<f64>> = a.out.lib_err.as_ref().map(|e| {
                    (0..n)
                        .filter(|&j| !act.iter().any(|&(k, _)| k == j))
                        .map(|j| lre(e[j], r.err[j], 15))
                        .collect()
                });
                let at: Vec<f64> = a
                    .at_bound
                    .iter()
                    .map(|&b| if b { 1.0 } else { 0.0 })
                    .collect();
                recs.push(format!(
                    "{{\"case\":\"{}\",\"cand\":\"{}\",\"deriv\":\"{}\",{},\"at_bound\":{},\
                     \"lre_params\":{},\"lre_err_free\":{},\"lre_lib_err_free\":{},\"lre_rss\":{},\
                     \"min_lre_params\":{},\"min_lre_err_free\":{},\"min_lre_lib_err_free\":{}}}",
                    bc.name,
                    c.name(),
                    d.name(),
                    record_fields(&a),
                    arr(&at),
                    arr(&lre_p),
                    arr(&lre_e),
                    opt_arr(&lre_le),
                    num(lre(a.rss, r.rss, 15)),
                    num(min(&lre_p)),
                    num(min(&lre_e)),
                    lre_le.as_ref().map_or("null".into(), |v| num(min(v))),
                ));
            }
        }
    }
    format!("[\n{}\n]\n", recs.join(",\n"))
}

// ---------------------------------------------------------------- speed

/// The Quick Fit speed test: a gauss fit (docs/spec.md 6.5) to `n` points.
pub fn gauss_data(n: usize) -> Data {
    let xs: Vec<f64> = (0..n).map(|i| 10.0 * i as f64 / (n - 1) as f64).collect();
    synth(Model::Gauss, &xs, &[1.0, 5.0, 4.7, 0.8], 0.1, 7)
}

pub fn gauss_spec(d: Deriv) -> Spec {
    let mut s = Spec::free(&[0.5, 3.0, 5.2, 1.2], d);
    s.maxiter = 200;
    s
}

/// One gauss fit as JSON (for the determinism check of the speed test).
pub fn gauss_json(data: &Data, c: Cand, d: Deriv) -> String {
    let p = Problem {
        model: Model::Gauss,
        data,
    };
    let s = gauss_spec(d);
    let a = analyze(&p, &s, run(c, &p, &s));
    format!(
        "{{\"case\":\"gauss {}\",\"cand\":\"{}\",\"deriv\":\"{}\",{}}}",
        data.y.len(),
        c.name(),
        d.name(),
        record_fields(&a)
    )
}
