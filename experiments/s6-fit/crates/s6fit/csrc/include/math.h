/* Minimal header for building cmpfit for wasm32-unknown-unknown.
   cmpfit uses sqrt, fabs, and isfinite. sqrt and fabs are wasm instructions
   (f64.sqrt and f64.abs), exact or correctly rounded. */
#pragma once
#define sqrt(x) __builtin_sqrt(x)
#define fabs(x) __builtin_fabs(x)
/* mpfit.h uses isfinite for its check of non-finite values. */
#define isfinite(x) __builtin_isfinite(x)
