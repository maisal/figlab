//! Native runner of the S6 tests.
//!
//! Usage: s6cli <command> [--out DIR] [--runs N] [--maxiter N]
//!
//! - `all`: the NIST, bounds, and gauss runs; writes nist.json, bounds.json,
//!   and gauss.json to DIR (default target/s6-results/native).
//! - `speed`: times the gauss fit with 100,000 points; writes speed.json to
//!   DIR (default results) as speed-native.json.
//! - `mgh10`: MGH10 from start 1 in the loose box, with the iteration limit
//!   of the NIST runs (1000) and with a higher one (`--maxiter`, default
//!   20000); writes mgh10-box.json to DIR (default results).

use s6fit::fit::{ALL_CANDS, Cand, Deriv, Spec, analyze, run};
use s6fit::models::Model;
use s6fit::problem::Problem;
use s6fit::suite;
use std::time::Instant;

fn write(dir: &str, name: &str, text: &str) {
    std::fs::create_dir_all(dir).unwrap();
    let path = format!("{dir}/{name}");
    std::fs::write(&path, text).unwrap();
    eprintln!("wrote {path}");
}

/// The candidates in the gauss and speed tests. A1 is left out: without
/// bounds it is the same code as A0.
const SPEED_CANDS: [Cand; 4] = [Cand::Lm, Cand::LmBounded, Cand::Cmpfit, Cand::Rmpfit];

fn gauss_all(n: usize) -> String {
    let data = suite::gauss_data(n);
    let mut recs = vec![];
    for c in SPEED_CANDS {
        for d in [Deriv::Analytic, Deriv::Forward] {
            recs.push(suite::gauss_json(&data, c, d));
        }
    }
    format!("[\n{}\n]\n", recs.join(",\n"))
}

fn percentile(sorted: &[f64], q: f64) -> f64 {
    // Nearest-rank percentile.
    let k = ((q * sorted.len() as f64).ceil() as usize).clamp(1, sorted.len());
    sorted[k - 1]
}

/// Time `runs` calls of `f` after 2 warm-up calls. Returns sorted times in ms.
fn time_ms(runs: usize, mut f: impl FnMut()) -> Vec<f64> {
    for _ in 0..2 {
        f();
    }
    let mut ms: Vec<f64> = (0..runs)
        .map(|_| {
            let t = Instant::now();
            f();
            t.elapsed().as_secs_f64() * 1e3
        })
        .collect();
    ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
    ms
}

fn speed(runs: usize) -> String {
    let n = 100_000;
    let data = suite::gauss_data(n);
    let p = Problem {
        model: Model::Gauss,
        data: &data,
    };
    let mut items = vec![];
    for c in SPEED_CANDS {
        for d in [Deriv::Analytic, Deriv::Forward] {
            let s: Spec = suite::gauss_spec(d);
            // The fit alone, and the fit plus the error analysis (Jacobian
            // and QR at the solution) that figlab adds.
            let fit = time_ms(runs, || {
                std::hint::black_box(run(c, &p, &s));
            });
            let total = time_ms(runs, || {
                std::hint::black_box(analyze(&p, &s, run(c, &p, &s)));
            });
            let out = run(c, &p, &s);
            let (fm, tm, tp) = (
                percentile(&fit, 0.5),
                percentile(&total, 0.5),
                percentile(&total, 0.95),
            );
            println!(
                "native {:<11} {:<8} fit+errors median {:7.2} ms  p95 {:7.2} ms  (fit only {:7.2} ms)  runs {}  iterations {}  nfev {}",
                c.name(),
                d.name(),
                tm,
                tp,
                fm,
                runs,
                out.iterations,
                out.nfev
            );
            items.push(format!(
                "{{\"cand\":\"{}\",\"deriv\":\"{}\",\"median_ms\":{:.3},\"p95_ms\":{:.3},\"min_ms\":{:.3},\
                 \"fit_only_median_ms\":{:.3},\"fit_only_p95_ms\":{:.3},\"runs\":{},\"iterations\":{},\"nfev\":{},\"status\":\"{}\"}}",
                c.name(), d.name(), tm, tp, total[0], fm, percentile(&fit, 0.95), runs, out.iterations, out.nfev, out.status
            ));
        }
    }
    format!(
        "{{\"platform\":\"native {} {}\",\"points\":{},\"note\":\"median_ms and p95_ms time the fit plus the error analysis\",\"results\":[\n{}\n]}}\n",
        std::env::consts::ARCH,
        std::env::consts::OS,
        n,
        items.join(",\n")
    )
}

/// MGH10 from start 1 in the loose box: how many iterations the bounded
/// candidates need when they may run longer than the NIST limit of 1000.
fn mgh10(maxiter: usize) -> String {
    let n = s6fit::nist::get("MGH10");
    let p = Problem {
        model: n.model,
        data: &n.data,
    };
    let mut items = vec![];
    let (lo, hi) = suite::loose_box(&n, &n.start1);
    for limit in [1000, maxiter] {
        for c in [
            Cand::LmTransform,
            Cand::LmBounded,
            Cand::Cmpfit,
            Cand::Rmpfit,
        ] {
            let mut s = Spec::free(&n.start1, Deriv::Analytic);
            s.lower = lo.clone();
            s.upper = hi.clone();
            s.maxiter = limit;
            let out = run(c, &p, &s);
            items.push((c.name(), "loose box", limit, out));
        }
    }
    let mut s = Spec::free(&n.start1, Deriv::Analytic);
    s.maxiter = maxiter;
    items.push(("lm", "no bounds", maxiter, run(Cand::Lm, &p, &s)));
    let recs: Vec<String> = items
        .iter()
        .map(|(c, b, limit, out)| {
            let lre = (0..3)
                .map(|j| s6fit::fit::lre(out.params[j], n.cert[j], n.cert_digits[j]))
                .fold(f64::INFINITY, f64::min)
                + 0.0;
            println!(
                "MGH10 start 1 {b:<9} {c:<12} maxiter {limit:>6}: iterations {:>6}  {:<22} smallest LRE {lre:.1}",
                out.iterations, out.status
            );
            format!(
                "{{\"cand\":\"{c}\",\"bounds\":\"{b}\",\"deriv\":\"analytic\",\"maxiter\":{limit},\"iterations\":{},\"status\":\"{}\",\"min_lre_params\":{lre:.2}}}",
                out.iterations, out.status
            )
        })
        .collect();
    format!("[\n{}\n]\n", recs.join(",\n"))
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let cmd = args.get(1).map(String::as_str).unwrap_or("all");
    let opt = |name: &str| {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    match cmd {
        "all" => {
            let out = opt("--out").unwrap_or("target/s6-results/native".into());
            write(&out, "nist.json", &suite::nist_json(&ALL_CANDS));
            write(&out, "bounds.json", &suite::bounds_json());
            write(&out, "gauss.json", &gauss_all(100_000));
        }
        "speed" => {
            let out = opt("--out").unwrap_or("results".into());
            let runs = opt("--runs").map_or(21, |v| v.parse().unwrap());
            write(&out, "speed-native.json", &speed(runs));
        }
        "mgh10" => {
            let out = opt("--out").unwrap_or("results".into());
            let maxiter = opt("--maxiter").map_or(20_000, |v| v.parse().unwrap());
            write(&out, "mgh10-box.json", &mgh10(maxiter));
        }
        _ => {
            eprintln!("usage: s6cli all|speed|mgh10 [--out DIR] [--runs N] [--maxiter N]");
            std::process::exit(2);
        }
    }
}
