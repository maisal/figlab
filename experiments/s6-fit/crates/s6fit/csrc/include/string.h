/* Minimal header for building cmpfit for wasm32-unknown-unknown. */
#pragma once
#include <stddef.h>
char *strcpy(char *dst, const char *src);
void *memset(void *s, int c, size_t n);
void *memcpy(void *dst, const void *src, size_t n);
