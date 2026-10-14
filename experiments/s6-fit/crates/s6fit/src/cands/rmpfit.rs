//! Candidate C: the `rmpfit` crate (a Rust port of cmpfit).

use rmpfit::{MPConfig, MPError, MPFitter, MPMaxFev, MPPar, MPResult, MPSide, MPSuccess};

use crate::fit::{Deriv, Out, Spec};
use crate::problem::Problem;

struct F<'a> {
    p: &'a Problem<'a>,
    pars: Vec<MPPar>,
    config: MPConfig,
    nfev: usize,
    njev: usize,
    jac: Vec<f64>,
}

impl MPFitter for F<'_> {
    fn eval(&mut self, params: &[f64], deviates: &mut [f64]) -> MPResult<()> {
        self.nfev += 1;
        self.p.resid(params, deviates);
        Ok(())
    }
    fn number_of_points(&self) -> usize {
        self.p.m()
    }
    fn config(&self) -> &MPConfig {
        &self.config
    }
    fn parameters(&self) -> &[MPPar] {
        &self.pars
    }
    fn jacobian(
        &mut self,
        params: &[f64],
        deviates: &mut [f64],
        derivs: &mut [Option<Vec<f64>>],
    ) -> MPResult<()> {
        self.nfev += 1;
        self.njev += 1;
        self.p.resid(params, deviates);
        let m = self.p.m();
        self.p.jac(params, &mut self.jac);
        for (j, d) in derivs.iter_mut().enumerate() {
            if let Some(col) = d {
                col.copy_from_slice(&self.jac[j * m..(j + 1) * m]);
            }
        }
        Ok(())
    }
}

fn success_name(s: &MPSuccess) -> &'static str {
    match s {
        MPSuccess::NotDone => "NotDone",
        MPSuccess::Chi => "Chi",
        MPSuccess::Par => "Par",
        MPSuccess::Both => "Both",
        MPSuccess::Dir => "Dir",
        MPSuccess::MaxIter => "MaxIter",
        MPSuccess::Ftol => "Ftol",
        MPSuccess::Xtol => "Xtol",
        MPSuccess::Gtol => "Gtol",
    }
}

fn error_name(e: &MPError) -> &'static str {
    match e {
        MPError::Input => "ErrInput",
        MPError::Nan => "ErrNan",
        MPError::Empty => "ErrEmpty",
        MPError::NoFree => "ErrNoFree",
        MPError::InitBounds => "ErrInitBounds",
        MPError::Bounds => "ErrBounds",
        MPError::DoF => "ErrDoF",
        MPError::Eval => "ErrEval",
    }
}

pub fn fit(p: &Problem, s: &Spec) -> Out {
    let n = p.npar();
    let pars = (0..n)
        .map(|j| {
            let mut q = MPPar::new();
            q.fixed = s.fixed[j];
            q.limited_low = s.lower[j].is_finite();
            q.limited_up = s.upper[j].is_finite();
            q.limit_low = if q.limited_low { s.lower[j] } else { 0.0 };
            q.limit_up = if q.limited_up { s.upper[j] } else { 0.0 };
            q.side = if s.deriv == Deriv::Analytic {
                MPSide::User
            } else {
                MPSide::Auto
            };
            q
        })
        .collect();
    let mut config = MPConfig::new();
    config.ftol = s.tol;
    config.xtol = s.tol;
    config.gtol = s.tol;
    config.max_iter = s.maxiter;
    config.max_fev = MPMaxFev::NoLimit;
    let mut f = F {
        p,
        pars,
        config,
        nfev: 0,
        njev: 0,
        jac: vec![0.0; p.m() * n],
    };
    let mut x = s.init.clone();
    match f.mpfit(&mut x) {
        Ok(st) => Out {
            params: x,
            lib_err: Some(st.xerror),
            lib_cov: Some(st.covar),
            iterations: st.n_iter,
            nfev: f.nfev,
            njev: f.njev,
            status: success_name(&st.success).into(),
            converged: matches!(
                st.success,
                MPSuccess::Chi | MPSuccess::Par | MPSuccess::Both | MPSuccess::Dir
            ),
            failed: false,
        },
        Err(e) => Out {
            params: x,
            iterations: 0,
            nfev: f.nfev,
            njev: f.njev,
            status: error_name(&e).into(),
            failed: true,
            ..Out::default()
        },
    }
}
