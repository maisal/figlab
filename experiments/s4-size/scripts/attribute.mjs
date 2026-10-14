// Groups the code of a wasm file by Rust crate, using the name section.
//
// Usage: node scripts/attribute.mjs file.wasm   (the file must keep its names, wasm-opt -g)
//
// Function names are Rust symbol names (legacy mangling). The crate of a
// function is the first known crate name in its demangled path. Generic code
// is counted where it was instantiated by the compiler's naming, so the split
// is approximate. Data segments are counted as "(data)".

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function leb(buf, pos) {
  let result = 0;
  let shift = 0;
  let b;
  do {
    b = buf[pos++];
    result += (b & 0x7f) * 2 ** shift;
    shift += 7;
  } while (b & 0x80);
  return [result, pos];
}

function readName(buf, pos) {
  let len;
  [len, pos] = leb(buf, pos);
  return [buf.toString("utf8", pos, pos + len), pos + len];
}

/** Section sizes, function body sizes, and function names of a wasm file. */
export function parse(buf) {
  let pos = 8;
  const sections = {};
  let imported = 0;
  const bodies = [];
  const names = new Map();
  let data = 0;
  const ids = ["custom", "type", "import", "function", "table", "memory", "global", "export", "start", "elem", "code", "data", "datacount", "tag"];
  while (pos < buf.length) {
    const id = buf[pos++];
    let size;
    [size, pos] = leb(buf, pos);
    const end = pos + size;
    let key = ids[id] ?? `id${id}`;
    if (id === 0) {
      const [n] = readName(buf, pos);
      key = `custom:${n}`;
      if (n === "name") {
        let p = readName(buf, pos)[1];
        while (p < end) {
          const sub = buf[p++];
          let len;
          [len, p] = leb(buf, p);
          const subEnd = p + len;
          if (sub === 1) {
            let count;
            [count, p] = leb(buf, p);
            for (let i = 0; i < count; i++) {
              let idx, name;
              [idx, p] = leb(buf, p);
              [name, p] = readName(buf, p);
              names.set(idx, name);
            }
          }
          p = subEnd;
        }
      }
    } else if (id === 2) {
      let p = pos;
      let count;
      [count, p] = leb(buf, p);
      for (let i = 0; i < count; i++) {
        [, p] = readName(buf, p);
        [, p] = readName(buf, p);
        const kind = buf[p++];
        if (kind === 0) {
          [, p] = leb(buf, p);
          imported++;
        } else if (kind === 1) {
          p++;
          const flags = buf[p++];
          [, p] = leb(buf, p);
          if (flags & 1) [, p] = leb(buf, p);
        } else if (kind === 2) {
          const flags = buf[p++];
          [, p] = leb(buf, p);
          if (flags & 1) [, p] = leb(buf, p);
        } else if (kind === 3) {
          p += 2;
        } else if (kind === 4) {
          p++;
          [, p] = leb(buf, p);
        }
      }
    } else if (id === 10) {
      let p = pos;
      let count;
      [count, p] = leb(buf, p);
      for (let i = 0; i < count; i++) {
        let len;
        const start = p;
        [len, p] = leb(buf, p);
        bodies.push(p - start + len);
        p += len;
      }
    } else if (id === 11) {
      data = size;
    }
    sections[key] = (sections[key] ?? 0) + size;
    pos = end;
  }
  return { sections, imported, bodies, names, data };
}

/** Turns a legacy Rust symbol into a readable path. */
export function demangle(sym) {
  let s = sym;
  const m = /^_?_ZN(.*)E$/.exec(s);
  if (m) {
    const parts = [];
    let rest = m[1];
    while (rest.length) {
      const d = /^(\d+)/.exec(rest);
      if (!d) break;
      const n = Number(d[1]);
      parts.push(rest.slice(d[1].length, d[1].length + n));
      rest = rest.slice(d[1].length + n);
    }
    if (parts.length && /^h[0-9a-f]{16}$/.test(parts[parts.length - 1])) parts.pop();
    s = parts.join("::");
  }
  return s
    .replace(/\$LT\$/g, "<")
    .replace(/\$GT\$/g, ">")
    .replace(/\$RF\$/g, "&")
    .replace(/\$BP\$/g, "*")
    .replace(/\$C\$/g, ",")
    .replace(/\$u20\$/g, " ")
    .replace(/\$u27\$/g, "'")
    .replace(/\$u5b\$/g, "[")
    .replace(/\$u5d\$/g, "]")
    .replace(/\$u7b\$/g, "{")
    .replace(/\$u7d\$/g, "}")
    .replace(/\$u3b\$/g, ";")
    .replace(/\$u2b\$/g, "+")
    .replace(/\$u22\$/g, '"')
    .replace(/\.\./g, "::");
}

const STD = new Set(["core", "alloc", "std", "compiler_builtins", "dlmalloc", "panic_abort", "hashbrown", "rustc_demangle", "std_detect"]);

/**
 * The crate a symbol belongs to. Names from wasm-opt -g look like
 * `<alloc[hash]::vec::Vec<rustybuzz[hash]::Foo>>::drop`. The first crate
 * that is not part of std wins, so generic std code is counted for the crate
 * whose types it was made for.
 */
export function crateOf(sym, module = "(module)") {
  const d = demangle(sym);
  if (/^(__wbindgen|__wbg|__externref|wasm_bindgen)/.test(d)) return "wasm-bindgen";
  const crates = [...d.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\[[0-9a-f]+\]::/g)].map((m) => m[1]);
  if (crates.length === 0) {
    if (/ multivalue shim$/.test(d)) return module;
    if (/^<(\[|str>|char>|bool>|[iuf](8|16|32|64|128|size)>)/.test(d)) return "std/core/alloc";
    // No path: exported functions, libm and compiler builtins, or unknown.
    if (/^(mem(cpy|move|set|cmp)|bcmp|__[a-z0-9]+[0-9]|[a-z]+f?)$/.test(d) && /^(mem|bcmp|__|sin|cos|tan|exp|log|pow|sqrt|fmod|hypot|round|floor|ceil|trunc|cbrt|atan|asin|acos|fma)/.test(d)) {
      return "std (builtins, libm)";
    }
    return /^[a-z_][a-z0-9_]*$/.test(d) ? module : "(other)";
  }
  const own = crates.find((c) => !STD.has(c));
  if (own) return own;
  return crates[0] === "dlmalloc" ? "std (allocator)" : "std/core/alloc";
}

/** Bytes per crate for a wasm file with a name section. */
export function attribute(buf, module = "(module exports)") {
  const { sections, imported, bodies, names, data } = parse(buf);
  const by = new Map();
  bodies.forEach((size, i) => {
    const name = names.get(i + imported) ?? "";
    const c = name ? crateOf(name, module) : "(unnamed)";
    by.set(c, (by.get(c) ?? 0) + size);
  });
  if (data) by.set("(data)", data);
  const other = Object.entries(sections)
    .filter(([k]) => k !== "code" && k !== "data" && k !== "custom:name")
    .reduce((a, [, v]) => a + v, 0);
  by.set("(other sections)", other);
  return Object.fromEntries([...by.entries()].sort((a, b) => b[1] - a[1]));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = attribute(readFileSync(process.argv[2]));
  const total = Object.values(a).reduce((x, y) => x + y, 0);
  for (const [k, v] of Object.entries(a)) {
    console.log(`${k.padEnd(28)} ${String(v).padStart(9)}  ${((100 * v) / total).toFixed(1).padStart(5)}%`);
  }
  console.log(`${"total (without names)".padEnd(28)} ${String(total).padStart(9)}`);
}
