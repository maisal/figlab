//! Checks of the test code itself: the analytic gradients, the parser, and
//! the covariance.

use s6fit::fit::{Cand, Deriv, Spec, analyze, run};
use s6fit::models::Model;
use s6fit::nist;
use s6fit::problem::Problem;

/// Analytic gradients match central differences at both starts and at the
/// certified values of every NIST problem.
#[test]
fn gradients_match_central_differences() {
    for n in nist::all() {
        let p = Problem {
            model: n.model,
            data: &n.data,
        };
        for b in [&n.start1, &n.start2, &n.cert] {
            let m = p.m();
            let k = p.npar();
            let mut jac = vec![0.0; m * k];
            p.jac(b, &mut jac);
            for j in 0..k {
                let h = 1e-6 * b[j].abs().max(1e-6);
                let (mut bp, mut bm) = (b.clone(), b.clone());
                bp[j] += h;
                bm[j] -= h;
                let (mut rp, mut rm) = (vec![0.0; m], vec![0.0; m]);
                p.resid(&bp, &mut rp);
                p.resid(&bm, &mut rm);
                let scale = (0..m).map(|i| jac[j * m + i].abs()).fold(0.0, f64::max);
                let mut r0 = vec![0.0; m];
                p.resid(b, &mut r0);
                for i in 0..m {
                    let fd = (rp[i] - rm[i]) / (2.0 * h);
                    let d = (fd - jac[j * m + i]).abs();
                    // Truncation error plus the rounding error of the differences.
                    let round = 1e-14 * (r0[i].abs() + n.data.y[i].abs()) / h;
                    assert!(
                        d <= 1e-5 * scale + round + 1e-12,
                        "{} b{} row {i}: {fd} vs {}",
                        n.name,
                        j + 1,
                        jac[j * m + i]
                    );
                }
            }
        }
    }
}

#[test]
fn parser_reads_all_problems() {
    let all = nist::all();
    assert_eq!(all.len(), 27);
    let m = nist::get("Misra1a");
    assert_eq!(m.data.y.len(), 14);
    assert_eq!(m.cert[0], 2.3894212918E+02);
    assert_eq!(m.cert_digits[0], 11);
    assert_eq!(m.rss, 1.2455138894E-01);
    let n = nist::get("Nelson");
    assert_eq!(n.data.ncols, 2);
    assert_eq!(n.data.y.len(), 128);
}

/// At the certified values, the residual sum of squares matches and the
/// standard errors from the Jacobian match the certified ones.
#[test]
fn certified_values_give_certified_rss_and_errors() {
    for n in nist::all() {
        // Lanczos1 has rss 1.4e-25. Its 11-digit certified values cannot
        // reproduce that, nor the errors, which scale with sqrt(rss).
        if n.name == "Lanczos1" {
            continue;
        }
        let p = Problem {
            model: n.model,
            data: &n.data,
        };
        let s = Spec::free(&n.cert, Deriv::Analytic);
        let out = s6fit::fit::Out {
            params: n.cert.clone(),
            ..Default::default()
        };
        let a = analyze(&p, &s, out);
        let rel = ((a.rss - n.rss) / n.rss).abs();
        assert!(rel < 1e-8, "{}: rss {} vs {}", n.name, a.rss, n.rss);
        for j in 0..n.cert.len() {
            let rel = ((a.err[j] - n.cert_sd[j]) / n.cert_sd[j]).abs();
            assert!(
                rel < 1e-6,
                "{} b{}: err {} vs {}",
                n.name,
                j + 1,
                a.err[j],
                n.cert_sd[j]
            );
        }
    }
}

/// Without bounds, the fork (A2) takes exactly the same path as the crate (A0).
#[test]
fn fork_without_bounds_matches_crate() {
    for name in ["Misra1a", "Thurber", "MGH09"] {
        let n = nist::get(name);
        let p = Problem {
            model: n.model,
            data: &n.data,
        };
        let s = Spec::free(&n.start1, Deriv::Analytic);
        let a = run(Cand::Lm, &p, &s);
        let b = run(Cand::LmBounded, &p, &s);
        assert_eq!(a.params, b.params, "{name}");
        assert_eq!(a.nfev, b.nfev, "{name}");
    }
}

#[test]
fn gauss_model_is_spec_formula() {
    // y0 + a*exp(-((x - x0)/w)^2) at x = x0 + w is y0 + a/e.
    let v = Model::Gauss.eval(&[1.5], &[1.0, 2.0, 1.0, 0.5]);
    assert!((v - (1.0 + 2.0 / core::f64::consts::E)).abs() < 1e-15);
}

/// The fork refuses a start outside the bounds and bounds with
/// lower >= upper, even when the residuals at the start are zero.
#[test]
fn fork_checks_bounds_before_solving() {
    let n = nist::get("Misra1a");
    let p = Problem { model: n.model, data: &n.data };
    let mut s = Spec::free(&n.start1, Deriv::Analytic);
    s.lower[0] = 600.0; // start1 b1 = 500 is below it
    let out = run(Cand::LmBounded, &p, &s);
    assert_eq!(out.status, "User");
    assert!(!out.converged);
    assert_eq!(out.params, n.start1);
    let mut s = Spec::free(&n.start1, Deriv::Analytic);
    s.lower[1] = 1.0;
    s.upper[1] = 1.0; // lower == upper
    let out = run(Cand::LmBounded, &p, &s);
    assert_eq!(out.status, "User");
    // Zero residuals at the start: data made from the model itself.
    let data = s6fit::problem::Data {
        ncols: 1,
        x: n.data.x.clone(),
        y: n.data.x.iter().map(|&x| n.model.eval(&[x], &n.start1)).collect(),
        w: None,
    };
    let p0 = Problem { model: n.model, data: &data };
    let mut s = Spec::free(&n.start1, Deriv::Analytic);
    s.upper[0] = 400.0;
    assert_eq!(run(Cand::LmBounded, &p0, &s).status, "User");
}
