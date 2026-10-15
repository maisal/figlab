/* The few C library functions cmpfit needs in wasm32-unknown-unknown,
   besides malloc and free (src/wasm_libc.rs). printf is only used by the
   derivative debug mode, which the experiment does not use. clang turns
   malloc + memset into calloc, and printf of a constant line into puts,
   so those are here too. memset and memcpy come from Rust's
   compiler_builtins. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int printf(const char *fmt, ...) {
    (void)fmt;
    return 0;
}

int puts(const char *s) {
    (void)s;
    return 0;
}

void *calloc(size_t n, size_t size) {
    size_t total = n * size;
    if (size != 0 && total / size != n) {
        return 0;
    }
    void *p = malloc(total);
    if (p) {
        memset(p, 0, total);
    }
    return p;
}

char *strcpy(char *dst, const char *src) {
    char *d = dst;
    while ((*d++ = *src++) != 0) {
    }
    return dst;
}
