/* Minimal header for building cmpfit for wasm32-unknown-unknown. */
#pragma once
#include <stddef.h>
void *malloc(size_t size);
void free(void *p);
void *calloc(size_t n, size_t size);
