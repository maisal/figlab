//! Covariance from a Jacobian, with a Householder QR with column pivoting.
//!
//! This is the method figlab would use for every candidate: build the
//! Jacobian at the solution, then `cov = s^2 (J^T J)^-1` with
//! `s^2 = rss / (m - p)`. It never forms `J^T J`, so it keeps more digits on
//! ill-conditioned problems.

/// `(J^T J)^-1` for a column-major `m x k` matrix `a`.
///
/// Returns `None` if `J` is rank deficient (a diagonal element of `R` is at
/// most `1e-14` times the largest one).
pub fn inv_jtj(a: &[f64], m: usize, k: usize) -> Option<Vec<f64>> {
    let mut a = a.to_vec();
    let mut perm: Vec<usize> = (0..k).collect();
    let mut rdiag = vec![0.0; k];
    for i in 0..k {
        // Pick the remaining column with the largest norm below row i.
        let mut best = i;
        let mut best_norm = -1.0;
        for j in i..k {
            let mut s = 0.0;
            for r in i..m {
                s += a[j * m + r] * a[j * m + r];
            }
            if s > best_norm {
                best_norm = s;
                best = j;
            }
        }
        if best != i {
            for r in 0..m {
                a.swap(i * m + r, best * m + r);
            }
            perm.swap(i, best);
        }
        // Householder reflector for column i.
        let norm = best_norm.sqrt();
        if norm == 0.0 {
            return None;
        }
        let alpha = if a[i * m + i] > 0.0 { -norm } else { norm };
        let v0 = a[i * m + i] - alpha;
        // v = (v0, a[i+1..m, i]); H = I - 2 v v^T / (v^T v)
        let mut vtv = v0 * v0;
        for r in i + 1..m {
            vtv += a[i * m + r] * a[i * m + r];
        }
        a[i * m + i] = v0;
        for j in i + 1..k {
            let mut dot = 0.0;
            for r in i..m {
                dot += a[i * m + r] * a[j * m + r];
            }
            let f = 2.0 * dot / vtv;
            for r in i..m {
                a[j * m + r] -= f * a[i * m + r];
            }
        }
        rdiag[i] = alpha;
    }
    let rmax = rdiag.iter().fold(0.0f64, |acc, v| acc.max(v.abs()));
    if rdiag.iter().any(|v| v.abs() <= 1e-14 * rmax) {
        return None;
    }
    // R: diagonal in rdiag, strict upper part in a[j*m + i] for i < j.
    let r = |i: usize, j: usize| if i == j { rdiag[i] } else { a[j * m + i] };
    // Rinv, upper triangular, by back substitution.
    let mut rinv = vec![0.0; k * k]; // rinv[i*k + j], row-major
    for j in 0..k {
        rinv[j * k + j] = 1.0 / r(j, j);
        for i in (0..j).rev() {
            let mut s = 0.0;
            for l in i + 1..=j {
                s += r(i, l) * rinv[l * k + j];
            }
            rinv[i * k + j] = -s / r(i, i);
        }
    }
    // C = Rinv Rinv^T, then undo the permutation.
    let mut cov = vec![0.0; k * k];
    for i in 0..k {
        for j in 0..k {
            let mut s = 0.0;
            for l in i.max(j)..k {
                s += rinv[i * k + l] * rinv[j * k + l];
            }
            cov[perm[i] * k + perm[j]] = s;
        }
    }
    Some(cov)
}
