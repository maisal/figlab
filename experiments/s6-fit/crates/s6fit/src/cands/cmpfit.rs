//! Candidate B: cmpfit 1.5 (C), built by build.rs from downloads/cmpfit.
//!
//! Analytic derivatives use `side = 3`. Forward differences use `side = 0`
//! (one-sided, backward next to an upper bound), cmpfit's default.

use core::cell::Cell;
use core::ffi::{c_char, c_int, c_void};

use crate::fit::{Deriv, Out, Spec};
use crate::problem::Problem;

#[repr(C)]
struct MpPar {
    fixed: c_int,
    limited: [c_int; 2],
    limits: [f64; 2],
    parname: *mut c_char,
    step: f64,
    relstep: f64,
    side: c_int,
    deriv_debug: c_int,
    deriv_reltol: f64,
    deriv_abstol: f64,
}

#[repr(C)]
struct MpConfig {
    ftol: f64,
    xtol: f64,
    gtol: f64,
    epsfcn: f64,
    stepfactor: f64,
    covtol: f64,
    maxiter: c_int,
    maxfev: c_int,
    nprint: c_int,
    douserscale: c_int,
    nofinitecheck: c_int,
    iterproc: Option<extern "C" fn()>,
}

#[repr(C)]
struct MpResult {
    bestnorm: f64,
    orignorm: f64,
    niter: c_int,
    nfev: c_int,
    status: c_int,
    npar: c_int,
    nfree: c_int,
    npegged: c_int,
    nfunc: c_int,
    resid: *mut f64,
    xerror: *mut f64,
    covar: *mut f64,
    version: [c_char; 20],
}

type MpFunc = extern "C" fn(c_int, c_int, *mut f64, *mut f64, *mut *mut f64, *mut c_void) -> c_int;

unsafe extern "C" {
    fn mpfit(
        funct: MpFunc,
        m: c_int,
        npar: c_int,
        xall: *mut f64,
        pars: *mut MpPar,
        config: *mut MpConfig,
        private_data: *mut c_void,
        result: *mut MpResult,
    ) -> c_int;
}

struct Ctx<'a> {
    p: &'a Problem<'a>,
    nfev: Cell<usize>,
    njev: Cell<usize>,
    jac: core::cell::RefCell<Vec<f64>>,
}

extern "C" fn callback(
    m: c_int,
    n: c_int,
    x: *mut f64,
    fvec: *mut f64,
    dvec: *mut *mut f64,
    private: *mut c_void,
) -> c_int {
    let (m, n) = (m as usize, n as usize);
    // SAFETY: cmpfit passes the pointers it was given and arrays of the
    // sizes m and n, as its documentation says.
    unsafe {
        let ctx = &*(private as *const Ctx);
        let x = core::slice::from_raw_parts(x, n);
        let f = core::slice::from_raw_parts_mut(fvec, m);
        ctx.p.resid(x, f);
        ctx.nfev.set(ctx.nfev.get() + 1);
        if !dvec.is_null() {
            let dv = core::slice::from_raw_parts(dvec, n);
            if dv.iter().any(|d| !d.is_null()) {
                ctx.njev.set(ctx.njev.get() + 1);
                let mut jac = ctx.jac.borrow_mut();
                ctx.p.jac(x, &mut jac);
                for (j, d) in dv.iter().enumerate() {
                    if !d.is_null() {
                        let col = core::slice::from_raw_parts_mut(*d, m);
                        col.copy_from_slice(&jac[j * m..(j + 1) * m]);
                    }
                }
            }
        }
    }
    0
}

fn status_name(s: c_int) -> &'static str {
    match s {
        1 => "OK_CHI",
        2 => "OK_PAR",
        3 => "OK_BOTH",
        4 => "OK_DIR",
        5 => "MAXITER",
        6 => "FTOL",
        7 => "XTOL",
        8 => "GTOL",
        -16 => "ERR_NAN",
        -21 => "ERR_INITBOUNDS",
        -22 => "ERR_BOUNDS",
        -24 => "ERR_DOF",
        _ => "ERR",
    }
}

pub fn fit(p: &Problem, s: &Spec) -> Out {
    let n = p.npar();
    let m = p.m();
    let mut pars: Vec<MpPar> = (0..n)
        .map(|j| MpPar {
            fixed: s.fixed[j] as c_int,
            limited: [
                s.lower[j].is_finite() as c_int,
                s.upper[j].is_finite() as c_int,
            ],
            limits: [
                if s.lower[j].is_finite() {
                    s.lower[j]
                } else {
                    0.0
                },
                if s.upper[j].is_finite() {
                    s.upper[j]
                } else {
                    0.0
                },
            ],
            parname: core::ptr::null_mut(),
            step: 0.0,
            relstep: 0.0,
            side: if s.deriv == Deriv::Analytic { 3 } else { 0 },
            deriv_debug: 0,
            deriv_reltol: 0.0,
            deriv_abstol: 0.0,
        })
        .collect();
    let mut config = MpConfig {
        ftol: s.tol,
        xtol: s.tol,
        gtol: s.tol,
        epsfcn: 0.0,
        stepfactor: 0.0,
        covtol: 0.0,
        maxiter: s.maxiter as c_int,
        maxfev: 0,
        nprint: 0,
        douserscale: 0,
        nofinitecheck: 0,
        iterproc: None,
    };
    let mut xerror = vec![0.0; n];
    let mut covar = vec![0.0; n * n];
    let mut result = MpResult {
        bestnorm: 0.0,
        orignorm: 0.0,
        niter: 0,
        nfev: 0,
        status: 0,
        npar: 0,
        nfree: 0,
        npegged: 0,
        nfunc: 0,
        resid: core::ptr::null_mut(),
        xerror: xerror.as_mut_ptr(),
        covar: covar.as_mut_ptr(),
        version: [0; 20],
    };
    let ctx = Ctx {
        p,
        nfev: Cell::new(0),
        njev: Cell::new(0),
        jac: core::cell::RefCell::new(vec![0.0; m * n]),
    };
    let mut x = s.init.clone();
    // SAFETY: all arrays have the sizes cmpfit expects (n parameters,
    // n*n covariance), and `ctx` lives until mpfit returns.
    let status = unsafe {
        mpfit(
            callback,
            m as c_int,
            n as c_int,
            x.as_mut_ptr(),
            pars.as_mut_ptr(),
            &mut config,
            &ctx as *const Ctx as *mut c_void,
            &mut result,
        )
    };
    let failed = status <= 0;
    Out {
        params: x,
        lib_err: if failed { None } else { Some(xerror) },
        lib_cov: if failed { None } else { Some(covar) },
        iterations: result.niter as usize,
        nfev: ctx.nfev.get(),
        njev: ctx.njev.get(),
        status: status_name(status).into(),
        converged: (1..=4).contains(&status),
        failed,
    }
}
