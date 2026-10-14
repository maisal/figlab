// Check the formal definition of the command language (docs/language.md 10).
// Run by `mise run check:lang`.
//
// - spec/commands.json and spec/errors.json match their JSON Schemas.
// - Rules that a schema cannot express: unique names, no reserved words,
//   names used in model formulas exist, and so on.
// - Every error code written in the documents exists in spec/errors.json.
// - The expected results of the conformance tests (tests/lang) match their
//   schema and use only known error codes.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const problems = [];
const problem = (where, message) => problems.push(`${where}: ${message}`);

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** All files under a folder whose names end with the suffix. */
function filesUnder(dir, suffix) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(suffix))
    .map((e) => join(e.parentPath, e.name))
    .sort();
}

// ---- JSON Schemas ----------------------------------------------------------

// Unknown keywords in the schemas are errors (strict). strictTypes and
// strictRequired are off: the if/then rules in the schemas leave out "type"
// and "properties" on purpose.
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  strictTypes: false,
  strictRequired: false,
});
function validate(schemaPath, dataPath) {
  const check = ajv.compile(readJson(schemaPath));
  const data = readJson(dataPath);
  if (!check(data)) {
    for (const e of check.errors ?? []) {
      problem(dataPath, `${e.instancePath || "/"} ${e.message ?? ""}`);
    }
  }
  return data;
}

const errors = validate("spec/schema/errors.schema.json", "spec/errors.json");
const table = validate("spec/schema/commands.schema.json", "spec/commands.json");

// ---- spec/errors.json --------------------------------------------------------

const codes = new Set();
{
  let previous = "";
  const names = new Set();
  for (const e of errors.errors ?? []) {
    if (codes.has(e.code)) problem("spec/errors.json", `${e.code} is listed twice`);
    if (e.code <= previous) problem("spec/errors.json", `${e.code} is not in order after ${previous}`);
    if (names.has(e.name)) problem("spec/errors.json", `name ${e.name} is used twice`);
    codes.add(e.code);
    names.add(e.name);
    previous = e.code;
    checkSection("spec/errors.json", `${e.code} section`, e.section);
  }
}

/** Check that a reference such as "language.md 2.1" names an existing heading. */
function checkSection(where, what, reference) {
  const [file, number] = String(reference ?? "").split(" ");
  const path = join("docs", file ?? "");
  if (!file || !number || !existsSync(path)) {
    problem(where, `${what}: "${reference}" does not name a document and a section`);
    return;
  }
  const heading = new RegExp(`^#{2,4} ${number.replace(/\./g, "\\.")}\\.? `, "m");
  if (!heading.test(readFileSync(path, "utf8"))) {
    problem(where, `${what}: ${file} has no section ${number}`);
  }
}

// ---- spec/commands.json ------------------------------------------------------

// docs/language.md 2.4
const reserved = new Set(
  "let array for in do end fn if then else and or not vs true false nan inf pi root".split(" "),
);
const entries = table.entries ?? [];
const byName = new Map();
for (const entry of entries) {
  const where = `spec/commands.json ${entry.kind} ${entry.name}`;
  if (byName.has(entry.name)) problem(where, "the name is used twice");
  if (reserved.has(entry.name)) problem(where, "the name is a reserved word");
  byName.set(entry.name, entry);
}
const functionNames = new Set(entries.filter((e) => e.kind === "function").map((e) => e.name));

const isLength = (s) => /^[0-9]+(\.[0-9]+)?(mm|cm|in|pt)$/.test(s);
const isColor = (s) => /^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(s) || Object.hasOwn(table.colors ?? {}, s);

function checkDefault(where, item) {
  if (!("default" in item)) return;
  const types = [item.type].flat();
  const value = item.default;
  const fits = types.some((t) => {
    switch (t) {
      case "number":
        return typeof value === "number";
      case "integer":
        return Number.isInteger(value);
      case "bool":
        return typeof value === "boolean";
      case "string":
        return typeof value === "string";
      case "length":
        return typeof value === "string" && isLength(value);
      case "color":
        return typeof value === "string" && isColor(value);
      case "enum":
        return (item.values ?? []).includes(value);
      default:
        return false;
    }
  });
  if (!fits) problem(where, `default ${JSON.stringify(value)} does not fit type ${types.join("|")}`);
  if (typeof value === "number") {
    if (item.min !== undefined && value < item.min) problem(where, `default ${value} is below min ${item.min}`);
    if (item.max !== undefined && value > item.max) problem(where, `default ${value} is above max ${item.max}`);
  }
}

/** Fields that only some types use. */
function checkFieldsFit(where, item) {
  const types = [item.type].flat();
  const uses = (...ts) => types.some((t) => ts.includes(t));
  if ("of" in item && !uses("list", "record")) problem(where, "of is only for list and record");
  if (("min" in item || "max" in item) && !uses("number", "integer")) problem(where, "min and max are only for number and integer");
  if ("dims" in item && !uses("array")) problem(where, "dims is only for array");
  for (const v of item.values ?? []) {
    if (reserved.has(v)) problem(where, `the value ${v} is a reserved word, so it cannot be written (language.md 2.4)`);
  }
}

/**
 * Identifiers in an expression, as [name, followed by "("]. Strings and
 * numbers (including exponents such as 1e-3) are skipped.
 */
function identifiers(expr) {
  const stripped = expr
    .replace(/"([^"]|"")*"/g, " ")
    .replace(/\b[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/g, " ");
  return [...stripped.matchAll(/[A-Za-z_][A-Za-z0-9_]*(\s*\()?/g)].map((m) => [
    m[0].replace(/\s*\($/, ""),
    m[1] !== undefined,
  ]);
}

function balanced(expr) {
  let depth = 0;
  for (const c of expr.replace(/"([^"]|"")*"/g, "")) {
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

/** Check names in an expression. Returns the names used. */
function checkExpression(where, expr, known) {
  const used = new Set();
  if (!balanced(expr)) problem(where, "the parentheses do not match");
  for (const [name, isCall] of identifiers(expr)) {
    if (isCall) {
      if (!functionNames.has(name)) problem(where, `${name}() is not a built-in function`);
    } else if (!known.has(name) && !reserved.has(name)) {
      problem(where, `${name} is not an input or a parameter`);
    }
    used.add(name);
  }
  return used;
}

/**
 * Option names written at the top level of a command example, in order.
 * Text inside strings, parentheses, and brackets is skipped.
 */
function exampleOptions(example) {
  const names = [];
  let depth = 0;
  for (let i = 0; i < example.length; i++) {
    const c = example[i];
    if (c === '"') {
      i = example.indexOf('"', i + 1);
      while (example[i + 1] === '"') i = example.indexOf('"', i + 2);
      continue;
    }
    if (c === "(" || c === "[") depth++;
    if (c === ")" || c === "]") depth--;
    if (depth === 0 && c === " ") {
      const m = /^ ([a-z][a-z0-9_]*)=(?!=)/.exec(example.slice(i));
      if (m) names.push(m[1]);
    }
  }
  return names;
}

// Commands that create these kinds of names need the replace option (language.md 5.4).
const replaceable = new Set(["array", "variable", "folder", "graph", "trace"]);

for (const entry of entries) {
  const where = `spec/commands.json ${entry.kind} ${entry.name}`;
  if (entry.kind === "command") {
    const names = new Set();
    let sawOptional = false;
    for (const a of entry.args ?? []) {
      if (names.has(a.name)) problem(where, `argument ${a.name} is listed twice`);
      names.add(a.name);
      if (a.optional) sawOptional = true;
      else if (sawOptional) problem(where, `required argument ${a.name} follows an optional one`);
      if (a.parent && entry.name !== "cd") problem(where, "only cd takes .. (language.md 3.1)");
      checkFieldsFit(`${where} argument ${a.name}`, a);
    }
    const optionOrder = (entry.options ?? []).map((o) => o.name);
    for (const o of entry.options ?? []) {
      if (names.has(o.name)) problem(where, `option ${o.name} has the name of another argument or option`);
      names.add(o.name);
      checkDefault(`${where} option ${o.name}`, o);
      checkFieldsFit(`${where} option ${o.name}`, o);
    }
    for (const c of entry.creates ?? []) {
      for (const n of c.name_from ?? []) {
        if (!names.has(n)) problem(where, `creates.name_from names ${n}, which is not an argument or an option`);
      }
      if (replaceable.has(c.kind) && !optionOrder.includes("replace")) {
        problem(where, `it creates a ${c.kind} but has no replace option (language.md 5.4)`);
      }
    }
    for (const example of entry.examples ?? []) {
      if (example.split(" ")[0] !== entry.name) problem(where, `the example "${example}" does not start with ${entry.name}`);
      let last = -1;
      for (const n of exampleOptions(example)) {
        const index = optionOrder.indexOf(n);
        if (index < 0) problem(where, `the example "${example}" uses the unknown option ${n}`);
        else if (index < last) problem(where, `the example "${example}" is not in the canonical option order (language.md 10.3)`);
        last = Math.max(last, index);
      }
    }
  } else if (entry.kind === "function") {
    const names = new Set();
    let sawNamed = false;
    for (const a of entry.args ?? []) {
      if (names.has(a.name)) problem(where, `argument ${a.name} is listed twice`);
      names.add(a.name);
      if (a.named) sawNamed = true;
      else if (sawNamed) problem(where, `positional argument ${a.name} follows a named one`);
      checkDefault(`${where} argument ${a.name}`, a);
    }
    for (const example of entry.examples ?? []) {
      if (!example.includes(`${entry.name}(`)) problem(where, `the example "${example}" does not call ${entry.name}`);
    }
  } else if (entry.kind === "model") {
    const known = new Set(entry.inputs ?? []);
    for (const p of entry.params ?? []) {
      if (known.has(p.name)) problem(where, `parameter ${p.name} is listed twice`);
      known.add(p.name);
    }
    const used = checkExpression(`${where} body`, entry.body ?? "", known);
    for (const name of known) {
      if (!used.has(name)) problem(where, `${name} is not used in the body`);
    }
    const params = new Set((entry.params ?? []).map((p) => p.name));
    for (const d of entry.derived ?? []) {
      checkExpression(`${where} derived ${d.name}`, d.expr, params);
    }
    for (const p of entry.params ?? []) {
      if (p.constraint) checkExpression(`${where} constraint`, p.constraint, known);
    }
  }
}

// ---- Error codes in the documents --------------------------------------------

for (const path of [...filesUnder("docs", ".md"), "AGENTS.md", "README.md"]) {
  const text = readFileSync(path, "utf8");
  for (const m of text.matchAll(/\bE[1-5][0-9]{3}\b/g)) {
    if (!codes.has(m[0])) problem(path, `${m[0]} is not in spec/errors.json`);
  }
}

// ---- Conformance tests ---------------------------------------------------------

const testSchema = "tests/lang/expected.schema.json";
if (existsSync(testSchema)) {
  const check = ajv.compile(readJson(testSchema));
  for (const path of filesUnder("tests/lang", ".expected.json")) {
    const data = readJson(path);
    if (!check(data)) {
      for (const e of check.errors ?? []) problem(path, `${e.instancePath || "/"} ${e.message ?? ""}`);
    }
    const errorsList = data.errors ?? [];
    for (const e of errorsList) {
      if (!codes.has(e.code)) problem(path, `${e.code} is not in spec/errors.json`);
      if (data.mode === "parse" && !/^E[12]/.test(e.code)) {
        problem(path, `${e.code} cannot occur in parse mode (only E1xxx and E2xxx)`);
      }
    }
    // The folder rules in tests/lang/README.md.
    if (path.includes("/syntax/accept/") && errorsList.length !== 0) problem(path, "files in syntax/accept must have no errors");
    if (path.includes("/syntax/reject/") && errorsList.length !== 1) problem(path, "files in syntax/reject must have exactly one error");
    const base = path.replace(/\.expected\.json$/, "");
    const source = [`${base}.figc`, `${base}.figf`].find((p) => existsSync(p));
    if (!source) {
      problem(path, "there is no matching .figc or .figf file");
    } else {
      const lines = readFileSync(source, "latin1").split(/\r\n|\n/).length;
      for (const e of errorsList) {
        if (e.line > lines) problem(path, `line ${e.line} is past the end of ${source}`);
      }
    }
  }
  for (const path of [...filesUnder("tests/lang", ".figc"), ...filesUnder("tests/lang", ".figf")]) {
    if (!existsSync(path.replace(/\.fig[cf]$/, ".expected.json"))) {
      problem(path, "there is no matching .expected.json file");
    }
  }
}

// ---- Result -------------------------------------------------------------------

if (problems.length > 0) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
console.log(
  `spec ok: ${codes.size} error codes, ${entries.length} entries in commands.json`,
);
