# figlab Command Language Definition (draft)

- Role: the formal definition behind spec.md Section 6. The language is defined by exactly two sources: this document and the command and function table (`spec/commands.json`, 10.1). The parser, completion, help, and checking tools are all generated from these two.
- Principles: a custom syntax that is easy to write and read. Each statement can be read in only one way, so machines (including AI) can verify it. The main concepts are arrays, folders, and coordinates.
- Status: Draft. Points that need the owner's confirmation are marked **[To confirm]** and collected in Section 11.

## 1. Design principles

1. **Readable at a glance.**
   - Options are written as `key=value`, with values as words (`style=markers`, `scale=log`)
   - Lengths carry units (`60mm`, `3pt`)
2. **The first word decides the kind of statement.** A statement starts with `let`, `array`, `for`, `fn`, or a command name. Anything else is an assignment or an expression.
3. **One way to write one thing.** No alternative ways to write the same thing.
4. **No implicit behavior.**
   - Names are created only by `let`, `array`, `fn`, and commands that create names (`load`, `fit`, etc.)
   - Operations between arrays of different shapes, conflicting coordinates, implicit type conversion, out-of-range indices, and unknown options are errors
5. **The grammar is an unambiguous context-free grammar.** The EBNF in Section 3 is complete. The parser always follows it exactly. Confusing combinations (mixing `and` and `or`, chained comparisons) cannot be written.
6. **Every statement finishes, and results are deterministic.**
   - The only loop is `for`. It goes over a collection of known size. There is no `while` loop that runs while a condition holds. There is no recursion either. So every statement finishes in finite time
   - The same input gives bit-identical results in the browser and on the command line (10.2)
7. **Verifiable.**
   - Syntax, names, and types can be checked without running (`figlab check`)
   - There is a canonical format (10.3)
   - There are conformance tests (10.4)

## 2. Lexical structure

### 2.1 Lines, indentation, and blocks

- Source files are UTF-8. Line endings are LF or CRLF. Indentation uses spaces only; a tab at the start of a line is an error (E1002).
- A statement consists of its first line and any continuation lines indented deeper than that first line.
- The lines from `for … do` to `end` form a block. Statements in the body are indented exactly 4 spaces deeper than the `for` line.

Rules:

1. Blank lines and comment-only lines do not count for indentation. But a blank line ends a statement. A statement cannot continue across a blank line.
2. The first line of a statement must be indented exactly at the current block depth. The top-level depth is 0; the depth of a `for` body is the depth of the `for` line + 4.
3. A line indented deeper than the first line of a statement continues that statement. The line break and the leading whitespace are treated as a single space. Continuation lines can be indented freely (they may be aligned inside parentheses).
4. The header of a `for` ends at the line whose last token is `do`. The body starts on the next line.
5. `end` is written at the same depth as its `for`.
6. Indentation that matches no block depth is an error (E1001).

```
plot fig1 norm vs energy                 // first line of a statement (depth 0)
    style=markers marker=circle          // deeper than the first line: a continuation
axis fig1 bottom scale=log               // a new statement (depth 0)

for d in folders(root.scans) do          // start of a block
    fit d.norm vs d.energy model=gauss2  // statement in the body (depth 4)
        init=(a1=1, c1=0.5, w1=0.1,      // continuation of this statement (depth 8)
              a2=0.5, c2=1.2, w2=0.1)    // may be aligned inside parentheses
        into=d.fit
    plot fig1 d.norm vs d.energy as=nameof(d)   // next statement in the body (depth 4)
end                                      // same depth as for
```

### 2.2 Comments

From `//` to the end of the line (except inside strings). Lines starting with `///` are documentation comments; in `.figf` files they become the help of a function (Section 6).

### 2.3 Names

- Form: a letter followed by letters, digits, and `_`. At most 255 characters.
- **Names are case-sensitive.** But two names in the same folder cannot differ only in case. macOS file systems are case-insensitive, and this rule prevents clashes when saving.
- Reserved words (2.4) and command names (those listed in `commands.json`) cannot be used as names of arrays, variables, folders, or functions.
- An array may have the same name as a built-in function (e.g. `area`). Functions are always called as `name(`, so the two can be told apart.

### 2.4 Reserved words

```
let  array  for  in  do  end  fn  if  then  else  and  or  not  vs  true  false  nan  inf  pi  root
```

### 2.5 Literals

```ebnf
number_lit  = digit { digit } [ "." digit { digit } ] [ ( "e" | "E" ) [ "+" | "-" ] digit { digit } ] ;
length_lit  = number_lit ( "mm" | "cm" | "in" | "pt" ) ;       (* no space between the number and the unit *)
color_lit   = "#" hex hex hex hex hex hex [ hex hex ] ;        (* #rrggbb or #rrggbbaa *)
string_lit  = '"' { character | '""' } '"' ;
```

- Numbers: `.5` and `1.` cannot be written (write `0.5`, `1.0`). Signs are unary operators. `1..9` is three tokens: `1`, `..`, `9`.
- Lengths: written as `60mm` or `3pt`. Usable only as option values. Converted to pt internally.
- Colors: written as `#d62728`. Named colors (`black`, `red`, etc.) are written as words in option values.
- Strings:
  - A `"` inside a string is written as `""`
  - There are no other escapes; `\` is an ordinary character (so label formatting such as `"\it{E}"` can be written as is)
  - Strings cannot span lines. Long strings are joined with `+`
- `true` and `false` are the numbers `1` and `0`. `nan` and `inf` are floating-point NaN and infinity. `pi` is π.

## 3. Grammar (EBNF)

Applies to logical lines after joining lines according to 2.1. Notation: `=` definition, `|` alternative, `[ ]` optional, `{ }` zero or more repetitions, `( )` grouping, `" "` terminal.

```ebnf
(* ===== Files ===== *)
command_file    = { statement newline } ;                  (* command line, history, scripts (.figc) *)
procedure_file  = { fn_def newline } ;                     (* function definitions (.figf) *)

(* ===== Statements ===== *)
statement       = let_stmt | array_stmt | for_stmt | command | assign_or_expr ;

let_stmt        = "let" ref "=" expr ;
array_stmt      = "array" ref "=" expr ;                   (* if ref is a.b, defines it inside folder a *)
for_stmt        = "for" name "in" iterable "do" newline
                  { statement newline }
                  "end" ;                                  (* indentation follows the rules in 2.1 *)
iterable        = range | expr ;                           (* integer range, list, folders(…), arrays(…) *)
assign_or_expr  = expr [ assign_op expr ] ;                (* the left side must be ref [ index ] (3.1) *)
assign_op       = "=" | "+=" | "-=" | "*=" | "/=" ;

command         = cmd_name { cmd_arg } { option } ;        (* options come after positional arguments *)
cmd_arg         = target | "vs" target | string_lit | [ "-" ] number_lit | ".." ;
target          = ref [ index ] ;
option          = name "=" opt_value ;
opt_value       = range | expr | length_lit | color_lit | record | list ;
range           = [ expr ] ".." [ expr ] ;                 (* both ends included; a missing end means first / last *)
record          = "(" name "=" opt_value { "," name "=" opt_value } ")" ;
list            = "[" [ opt_value { "," opt_value } ] "]" ;

(* ===== Functions ===== *)
fn_def          = "fn" name "(" name { "," name } [ "|" name { "," name } ] ")" "=" expr ;

(* ===== Expressions ===== *)
expr            = if_expr | logic_expr ;
if_expr         = "if" expr "then" expr "else" expr ;
logic_expr      = not_expr [ "and" not_expr { "and" not_expr }
                           | "or" not_expr { "or" not_expr } ] ;   (* mixing and/or requires parentheses *)
not_expr        = "not" not_expr | cmp_expr ;
cmp_expr        = add_expr [ cmp_op add_expr ] ;           (* comparisons cannot be chained *)
cmp_op          = "==" | "!=" | "<" | "<=" | ">" | ">=" ;
add_expr        = mul_expr { ( "+" | "-" ) mul_expr } ;
mul_expr        = neg_expr { ( "*" | "/" ) neg_expr } ;
neg_expr        = "-" neg_expr | pow_expr ;
pow_expr        = postfix [ "^" neg_expr ] ;               (* right-associative; -2^2 is -(2^2) *)
postfix         = primary [ index ] ;
primary         = number_lit | string_lit | "true" | "false" | "nan" | "inf"
                | call | ref | array_lit | "(" expr ")" ;
call            = name "(" [ call_arg { "," call_arg } ] ")" ;
call_arg        = expr | name "=" expr ;                   (* named arguments come after positional ones *)
array_lit       = "[" expr { "," expr } "]" ;

(* ===== Indexing ===== *)
index           = "[" idx { "," idx } "]" ;
idx             = coord_name "=" ( range | expr )          (* by coordinate value *)
                | range                                    (* range of point indices *)
                | expr ;                                   (* point index *)
coord_name      = "x" | "y" | "z" | "t" ;                  (* coordinates of dimensions 1 to 4 *)

(* ===== Names and paths ===== *)
ref             = "root" { "." name } | name { "." name } ;
```

### 3.1 Notes

- **Kind of statement**: the first token decides it. `let`, `array`, and `for` start those statements. A command name starts a command. Anything else starts an assignment or an expression. Command names are reserved (2.3).
- **Assignments and expressions**: an `assign_or_expr` with an `assign_op` is an assignment. Its left side must have the form `ref [ index ]` (otherwise E2xxx). Without an `assign_op`, it is an expression statement. It shows its value and does not change data (useful for checking values on the command line).
- **Command arguments and options**: a `name` directly followed by `=` is an option; otherwise it is a positional argument. Positional arguments cannot follow options.
- **Option values**: a word such as `markers`, `log`, or `true` can be an enum value, an array name, or a parameter name. The type of the option in `commands.json` decides which.
- **`range` vs `expr`**: if `..` appears, it is a range; otherwise an expression.
- **`record` vs parenthesized expression**: if `(` is directly followed by `name =`, it is a record.
- **`array_lit` vs index**: a `[` after a value is an index; a `[` where a value is expected is an array literal. Expressions cannot place values side by side (an operator is required), so this is unambiguous.
- **`..` as a positional argument**: exists only for `cd ..` (move to the parent folder).
- **`if`**: cannot be an operand of a binary operator without parentheses (`1 + (if a then b else c)`).
- **`fn`**: can be written only in `.figf` files, not on the command line or in `.figc` files.
- **`for`**: can be written only on the command line and in `.figc` files, not in `.figf` files or in the body of an `fn`. On the command line, it runs after `end` has been entered.

## 4. Expressions

### 4.1 Operator precedence

From strongest to weakest:

| Rank | Operator | Associativity | Notes |
|---|---|---|---|
| 1 | Index `w[…]` | | |
| 2 | `^` | Right | |
| 3 | Unary `-` | Right | `-2^2` is `-4` |
| 4 | `*` `/` | Left | |
| 5 | `+` `-` | Left | `+` between strings concatenates |
| 6 | `==` `!=` `<` `<=` `>` `>=` | None | `a < b < c` is a syntax error |
| 7 | `not` | Right | `not a > b` is `not (a > b)` |
| 8 | `and` or `or` | Left | Only repetitions of the same operator; mixing requires parentheses |
| 9 | `if … then … else …` | | Parentheses required when used as an operand |

### 4.2 Types

| Type | Description |
|---|---|
| Number | Double-precision floating point (IEEE 754 binary64) |
| String | UTF-8 string |
| Numeric array | Element types as in spec.md 5.1 |
| String array | An array whose elements are strings |

- Conversion between numbers and strings is explicit, with functions (`str`, `num`).
- Arithmetic always gives double-precision floating point, even for integer arrays. Integer types are only for storage.
- Comparisons and logical operations give `1` (true) or `0` (false). Where a condition is expected, any non-zero value is true.

### 4.3 Array operations

Expressions are written as operations on whole arrays (there is no implicit per-point loop variable).

- **Shape**: operations between arrays are errors unless their shapes (number of dimensions and points per dimension) are the same. Operations with a scalar apply to every element. Other combinations of shapes must be aligned explicitly with functions (`repeat`, etc.).
- **Coordinates**: the coordinates of each dimension are either "not set" or "set".
  - The coordinates of the result are those of the first array in the expression whose coordinates are set
  - Operations between arrays with conflicting coordinates that are set are errors
  - To use only the values, remove the coordinates with `values(w)`
- **Coordinates and indices**: `xvalues(w)` (dimension 1; `yvalues`, etc. for later dimensions) gives the coordinates, and `index(w)` gives the point indices, as arrays of the same shape as w.
  ```
  array model = exp(-axis(200, start=0, step=0.05, unit="meV") / 2.5)   // axis() makes an array whose values equal its coordinates
  array shifted = model - xvalues(model) * 0.1
  ```
- **Conditional selection**: `if cond then a else b` selects element by element. The condition, a, and b must each be an array of the same shape or a scalar.

### 4.4 Indexing

| Form | Meaning |
|---|---|
| `w[3]` | Point 3 (0-based) |
| `w[0..9]`, `w[10..]`, `w[..9]` | Range of points (both ends included) |
| `m[2, ..]`, `m[.., 3]` | A row / column of a 2D array |
| `w[x=1.5]` | Value at coordinate 1.5 (linear interpolation). Read-only |
| `w[x=1.0..2.0]` | Points whose coordinate is between 1.0 and 2.0 inclusive |
| `m[x=0.5..1.0, 3]` | Combination of coordinates and indices |

- The number of indices must equal the number of dimensions of the array.
- A range that extends outside the array is an error. A coordinate range that contains no points is also an error.

## 5. Semantics of statements

### 5.1 Definitions (let, array)

| Statement | Meaning |
|---|---|
| `let k = expr` | Defines variable k. The expression must be a number or a string. Replaces k if it exists |
| `array w = expr` | Defines array w. The expression must be an array. Shape, element type, coordinates, and unit come from the result of the expression. Replaces w if it exists |

- Created in the current folder.
- If something of a different kind with the same name exists (e.g. `let norm = 1` while an array norm exists), it is an error. The kind of a name never changes implicitly.
- An array cannot be created from a scalar. Arrays with fixed values are created with `zeros(…)` or `fill(…)`.

### 5.2 Assignment

| Statement | Meaning |
|---|---|
| `k = expr` | Stores a value in the existing variable k. An error if the types differ |
| `w = expr` | Stores values in the whole of the existing array w. The expression must be a scalar or an array of the same shape as w. The shape and coordinates of w do not change |
| `w[range] = expr` | Stores values in the points of the range. The expression must be a scalar or an array of the same shape as the range |
| `w += expr`, etc. | Same as `w = w + expr` |

- The whole right side is computed from the values before the assignment, and then written.
- If an array on the right side has set coordinates that conflict with those of w, it is an error (remove them with `values()`).
- Storing a non-integer value, NaN, or an out-of-range value in an integer array is an error (make the conversion explicit with `round` or `trunc`).
- A single-coordinate index (`w[x=1.5] = …`) cannot be the target of an assignment.
- Assigning to a name that does not exist is an error (define it with `array` / `let`).

### 5.3 Expression statements

- A statement consisting only of an expression shows its value. It does not change data.
- Used to check values on the command line. In a `.figc` file, the value is written to the execution log.

### 5.4 Commands

- `commands.json` defines, for each command:
  - the kinds and number of positional arguments
  - the name, type, value range, and default of each option, and whether it is required
- Anything else is an error.
- Giving the same option twice is an error.
- The names a command creates (e.g. `fit2.curve` created by `fit … into=fit2`) are listed in `commands.json`. The checking tools use this for name resolution in later statements.
- A command that creates names fails if the name already exists. Add `replace=true` to replace it.

### 5.5 Loops (for)

```
for d in folders(root.scans) do
    array d.norm = d.intensity / max(d.intensity)
    fit d.norm vs d.energy model=gauss into=d.fit
end
for i in 0..4 do
    let t = 10 * i
end
```

Only these four kinds of collections can be iterated:

| Collection | Loop variable | Order |
|---|---|---|
| `a..b` (integer range) | Number | Ascending, both ends included. Zero iterations if a > b |
| `[…]` (list) | Elements (numbers, strings) | As written |
| `folders(folder)` | Direct subfolders | By name |
| `arrays(folder)` | Arrays directly in the folder | By name |

- Name order is Unicode code point order.
- The collection is evaluated once, when the loop starts. Creating folders or arrays in the body does not change what is iterated.
- The loop variable is valid only inside the body. It cannot use (E3xxx):
  - a name that exists in the current folder
  - the name of an enclosing loop variable
- The loop variable cannot be assigned to.
- When the loop variable is a folder or an array, it refers to that object itself (not a copy). Names inside it can be followed, as in `d.norm`. `nameof(d)` gives its name as a string (e.g. for trace names).
- `cd` cannot be used in the body (E4xxx), so that name resolution does not change in the middle of a loop.
- `for` loops can be nested.
- Errors: execution stops at the first error, and the results of earlier iterations remain. The error includes which iteration failed (the value of the loop variable).
- Interruption: possible between iterations (spec.md Section 4). The results so far remain.
- Undo: the whole loop can be undone as one operation.
- History: recorded as written (not expanded).
- Checking: `figlab check` checks the body once. With `--project`, if the collection is determined by the project's contents (e.g. `folders(root.scans)`), name resolution is checked for each element.

## 6. Functions (fn)

```
fn linbg(x | a, b) = a + b*x
fn gauss2(x | a1, c1, w1, a2, c2, w2) =
    a1*exp(-((x - c1)/w1)^2) + a2*exp(-((x - c2)/w2)^2)
fn ratio(a, b) = if b == 0 then nan else a / b
```

- Inputs come before `|` and parameters after it. A function with `|` and one input can be used as a fit model.
- When called, all inputs and parameters are passed as positional arguments in this order (e.g. `linbg(x, 1.0, 0.5)`).
- Arguments may be numbers or arrays; the body is computed element by element.
- Functions are pure.
  - They can refer only to their arguments, built-in functions, and other `fn`s
  - They cannot refer to arrays or variables in folders
- Cycles in the call graph (recursion) are errors.
- Written in `.figf` files, and usable as soon as the file is saved.

### 6.1 Documentation comments

The `///` lines right before an `fn` become the help of that function.

```
/// Gaussian peak on a linear baseline
/// a: peak height
/// c: peak center
/// w: width (√2 times the standard deviation)
/// b0: intercept of the baseline
/// b1: slope of the baseline
fn gauss_linbg(x | a, c, w, b0, b1) = a*exp(-((x - c)/w)^2) + b0 + b1*x
```

- A line of the form `/// name: description` describes the input or parameter with that name. Other lines describe the function as a whole.
- Writing, as `name:`, a name that is not an input or parameter of the function is an error (E3xxx).
- Describing the same name twice is an error.
- Inputs and parameters without a description are not an error. `figlab check` reports them as notes.

## 7. Name resolution

| Form | Where it is looked up |
|---|---|
| `name` (in commands and expressions) | The current folder |
| `name(…)` | Built-in functions → `fn` |
| `name` (in the body of an `fn`) | The arguments of that function only |
| `root.a.b` | Absolute path |
| `a.b` | Path relative to the current folder |

- An `fn` cannot have the same name as a built-in function, so the lookup order never changes the result.
- If a name is not found, it is an error. No folder other than the current one is searched implicitly.

## 8. Errors

- Format: `<file>:<line>:<column>: <code>: <message>` (`<file>` is left out on the command line). Lines and columns refer to physical lines, before joining.
- Code classes:

| Range | Kind |
|---|---|
| E1xxx | Lexical and line errors (invalid characters; invalid numbers, lengths, or colors; wrong indentation; a tab at the start of a line; unmatched `end`) |
| E2xxx | Syntax (does not match the EBNF; invalid assignment target) |
| E3xxx | Names (undefined, duplicate, differing only in case, use of a reserved word) |
| E4xxx | Types and arguments (type mismatch; unknown command or option; repeated option; wrong number of arguments; shape or coordinate conflicts that can be detected statically) |
| E5xxx | Runtime (out of range, shape mismatch, numeric conversion, fit not converging) |

- E1xxx to E4xxx can be detected without running. E5xxx need the project's data or appear only when running.
- A statement with an error is not executed. Running a command file stops at the first error. When checking, every statement is checked and all errors are reported.
- Messages are written in English (spec.md Section 13). Example: `plot.figc:3:12: E3001: undefined name 'intensty' (did you mean 'intensity'?)`
- The list of codes and their meanings is kept in `spec/errors.json`, next to `spec/commands.json`.

## 9. Main commands (MVP proposal)

Details (list of options, types, defaults) are defined in `commands.json`.

| Category | Commands | Examples |
|---|---|---|
| Folders | `mkdir`, `cd`, `rm`, `mv` | `mkdir sample1`, `cd sample1`, `cd ..`, `rm old recursive=true` |
| Import | `source`, `load` | `source raw`, `load "scan01.csv" from=raw format=csv header=1 into=sample1` |
| Array attributes | `setcoord`, `setunit`, `note` | `setcoord model dim=x start=0 step=0.05 unit="meV"` |
| Graphs | `graph`, `plot`, `image`, `colorbar`, `unplot`, `style`, `axis`, `legend`, `export` | spec.md 8.1 |
| Fitting | `fit` | spec.md 6.5 |
| Help | `help` | `help`, `help gauss`, `help fit` (spec.md 6.8) |

In `plot`, an axis becomes a category axis in two cases (spec.md 8.3.1). One is a string array given as x (after `vs`). The other is an array with dimension labels given without `vs`. A numeric array never gives a category axis.

`source <name>` registers a source folder under a name. The first time, a folder picker opens and the access permission is stored in the browser.

## 10. Verification

### 10.1 Command and function table (spec/commands.json)

For every command and built-in function, the name, arguments, options, names created, and descriptions are kept in machine-readable form. Parser checks, completion, help, documentation, and the checking tools all use this table.

```json
{
  "name": "plot",
  "kind": "command",
  "args": [
    { "name": "graph", "type": "graph" },
    { "name": "y", "type": "array", "dims": [1] },
    { "name": "x", "type": "array", "dims": [1], "prefix": "vs", "optional": true }
  ],
  "options": [
    { "name": "as", "type": "name", "doc": "Trace name. Defaults to the name of y." },
    { "name": "style", "type": "enum", "values": ["line", "markers", "lines_markers", "sticks", "steps", "bars"], "default": "line" },
    { "name": "marker", "type": "enum", "values": ["circle", "square", "triangle", "diamond", "cross", "plus"], "default": "circle" },
    { "name": "size", "type": "length", "default": "3pt" },
    { "name": "color", "type": "color", "default": "black" }
  ],
  "creates": [ { "kind": "trace", "name_from": ["as", "y"] } ]
}
```

Fit models carry their formula in command-language syntax (`body`). Help is shown from this table, and the conformance tests check `body` against the implementation's results.

```json
{
  "name": "gauss",
  "kind": "model",
  "doc": "Gaussian peak on a constant baseline",
  "inputs": ["x"],
  "params": [
    { "name": "y0", "doc": "Baseline", "unit": "y" },
    { "name": "a",  "doc": "Peak height above the baseline", "unit": "y" },
    { "name": "x0", "doc": "Peak center", "unit": "x" },
    { "name": "w",  "doc": "Width (√2 times the standard deviation)", "unit": "x", "constraint": "w > 0" }
  ],
  "body": "y0 + a*exp(-((x - x0)/w)^2)",
  "display": "y_{0} + a exp(-((x - x_{0})/w)^{2})",
  "derived": [
    { "name": "fwhm", "doc": "Full width at half maximum", "expr": "2*sqrt(ln(2))*w" },
    { "name": "area", "doc": "Peak area above the baseline", "expr": "a*w*sqrt(pi)" }
  ],
  "guess": "y0: median of the points at both ends. a: maximum minus y0. x0: position of the maximum. w: from the full width at half maximum."
}
```

- A `unit` of `"x"` / `"y"` means the same unit as the x / y data used for the fit.

### 10.2 Command-line tool (figlab)

The computational core (Rust) is also built, from the same source as the browser version (wasm), as a native command-line tool. People and AI can verify things without a browser.

| Command | Description |
|---|---|
| `figlab check <file> [--project <dir>]` | Checks syntax, names, and types (without running). With a project, names are resolved against its arrays and variables |
| `figlab run <script.figc> --project <dir> [--dry-run]` | Runs commands without a browser |
| `figlab fmt <file> [--check]` | Formats to the canonical format. `--check` fails if there would be changes |
| `figlab help [<name>] [--json]` | Shows the help of commands, functions, and fit models (the same content as `help` in the app) |
| `figlab lsp` | Runs as a Language Server Protocol server. VS Code, Neovim, etc. get the same highlighting, completion, help, and diagnostics as the app (v1) |
| `figlab test <dir>` | Runs the conformance tests |

To make results bit-identical between the browser and the command line:

- Math functions use a pure Rust implementation (such as the `libm` crate) in both, never the OS library
- The order of additions in reductions (`sum`, etc.) is fixed
- Random numbers are used only with an explicit seed, with a fixed algorithm

### 10.3 Canonical format

- Options follow the positional arguments, in the order listed in `commands.json`
- One space between tokens. One space around binary and assignment operators and after commas. No spaces around `..`, `^`, and `.`, or just inside brackets
- Numbers use the shortest representation that reproduces the value exactly
- The body of a `for` is indented by 4 spaces
- A statement longer than 100 characters is broken before each option, with continuation lines indented 4 spaces deeper than the statement's first line

The history is always saved in the canonical format. Formatting is idempotent (`fmt(fmt(s)) = fmt(s)`) and does not change the syntax tree (`parse(fmt(s)) = parse(s)`).

### 10.4 Conformance tests

`tests/lang/` holds pairs of inputs (`.figc` / `.figf`) and expected results (values of the arrays created, or the expected error codes and positions). When the language specification changes, this document and the tests change together.

- Grammar: examples that must be accepted and examples that must be rejected (wrong indentation, mixing `and`/`or`, chained comparisons, invalid assignment targets, etc.)
- Loops: iteration order, evaluating the collection once at the start, behavior when an error occurs midway, nesting
- Semantics: definitions and assignments, shape and coordinate rules, indexing, name resolution
- Numerics: values of built-in functions. Fits are compared with the certified values of the NIST Statistical Reference Datasets (StRD) for nonlinear regression

## 11. Open questions

| # | Question | Current answer |
|---|---|---|
| 1 | Handling of complex numbers (literals, arithmetic) | Not in the MVP (complex arrays can only be read, written, and displayed) |
| 2 | File extensions | `.figc` for commands, `.figf` for functions |
| 3 | Is it acceptable that commands that create names require `replace=true` to overwrite, while `array` / `let` replace? | Yes (`array` / `let` are statements for redefining) |
| 4 | Should there be an `if … then … end` statement for executing statements conditionally inside a `for` body? | No (expression `if` can select values) |
