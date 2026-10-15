//! Stand-in for the language service module.
//!
//! The features choose how spec/commands.json gets into the module: not at
//! all, as raw text, as text read by serde_json at startup, or as Rust
//! tables made by build.rs.

use wasm_bindgen::prelude::*;

/// The raw text of spec/commands.json.
#[cfg(any(feature = "spec-raw", feature = "spec-serde"))]
static COMMANDS_JSON: &str = include_str!(concat!(env!("OUT_DIR"), "/commands.json"));

/// The embedded commands.json as text (empty if it is not embedded). The
/// language service would send it to the UI, so the text must stay in the module.
#[wasm_bindgen]
pub fn spec_text() -> String {
    #[cfg(any(feature = "spec-raw", feature = "spec-serde"))]
    return COMMANDS_JSON.to_string();
    #[cfg(not(any(feature = "spec-raw", feature = "spec-serde")))]
    return String::new();
}

#[cfg(feature = "spec-tables")]
#[allow(dead_code)]
mod table {
    use standin::check::{OptType, Table};
    use standin::parse::CommandNames;

    #[derive(PartialEq, Eq)]
    pub enum Kind {
        Command,
        Function,
        Model,
    }
    pub struct Arg {
        pub name: &'static str,
        pub doc: &'static str,
        pub optional: bool,
    }
    pub struct Opt {
        pub name: &'static str,
        pub ty: OptType,
        pub doc: &'static str,
        pub values: &'static [&'static str],
    }
    pub struct Entry {
        pub name: &'static str,
        pub kind: Kind,
        pub doc: &'static str,
        pub args: &'static [Arg],
        pub options: &'static [Opt],
        pub params: &'static [(&'static str, &'static str)],
        pub examples: &'static [&'static str],
    }

    include!(concat!(env!("OUT_DIR"), "/tables.rs"));

    pub struct Spec;

    fn find(name: &str, kind: Kind) -> Option<&'static Entry> {
        ENTRIES.iter().find(|e| e.name == name && e.kind == kind)
    }

    impl CommandNames for Spec {
        fn is_command(&self, name: &str) -> bool {
            find(name, Kind::Command).is_some()
        }
    }

    impl Table for Spec {
        fn options(&self, command: &str) -> Option<Vec<(&str, OptType)>> {
            find(command, Kind::Command).map(|e| e.options.iter().map(|o| (o.name, o.ty)).collect())
        }
        fn enum_values(&self, command: &str, option: &str) -> Vec<&str> {
            find(command, Kind::Command)
                .and_then(|e| e.options.iter().find(|o| o.name == option))
                .map(|o| o.values.to_vec())
                .unwrap_or_default()
        }
        fn arg_count(&self, command: &str) -> (usize, usize) {
            match find(command, Kind::Command) {
                Some(e) => (e.args.iter().filter(|a| !a.optional).count(), e.args.len()),
                None => (0, 0),
            }
        }
        fn is_function(&self, name: &str) -> bool {
            find(name, Kind::Function).is_some()
        }
        fn doc(&self, name: &str) -> Option<&str> {
            ENTRIES.iter().find(|e| e.name == name).map(|e| e.doc)
        }
    }

    /// Hover help: the documentation of an entry, its arguments, options,
    /// parameters, and examples.
    pub fn hover(name: &str) -> String {
        let Some(e) = ENTRIES.iter().find(|e| e.name == name) else {
            return String::new();
        };
        let mut out = format!("{}\n\n{}\n", e.name, e.doc);
        for a in e.args {
            out.push_str(&format!("\n- {}: {}", a.name, a.doc));
        }
        for o in e.options {
            out.push_str(&format!("\n- {}=: {}", o.name, o.doc));
            if !o.values.is_empty() {
                out.push_str(&format!(" ({})", o.values.join(", ")));
            }
        }
        for (p, d) in e.params {
            out.push_str(&format!("\n- {p}: {d}"));
        }
        for x in e.examples {
            out.push_str(&format!("\n    {x}"));
        }
        out
    }

    /// All names, for completion.
    pub fn names() -> impl Iterator<Item = &'static str> {
        ENTRIES.iter().map(|e| e.name)
    }
}

#[cfg(all(feature = "spec-serde", not(feature = "spec-tables")))]
#[allow(dead_code)]
mod table {
    use serde::Deserialize;
    use standin::check::{OptType, Table};
    use standin::parse::CommandNames;
    use std::sync::OnceLock;

    #[derive(Deserialize)]
    pub struct Arg {
        pub name: String,
        #[serde(default)]
        pub doc: String,
        #[serde(default)]
        pub optional: bool,
        #[serde(default)]
        pub default: Option<serde_json::Value>,
    }
    #[derive(Deserialize)]
    pub struct Opt {
        pub name: String,
        #[serde(rename = "type")]
        pub ty: serde_json::Value,
        #[serde(default)]
        pub doc: String,
        #[serde(default)]
        pub values: Vec<String>,
    }
    #[derive(Deserialize)]
    pub struct Param {
        pub name: String,
        #[serde(default)]
        pub doc: String,
    }
    #[derive(Deserialize)]
    pub struct Entry {
        pub name: String,
        pub kind: String,
        #[serde(default)]
        pub doc: String,
        #[serde(default)]
        pub args: Vec<Arg>,
        #[serde(default)]
        pub options: Vec<Opt>,
        #[serde(default)]
        pub params: Vec<Param>,
        #[serde(default)]
        pub examples: Vec<String>,
    }
    #[derive(Deserialize)]
    struct File {
        entries: Vec<Entry>,
    }

    fn entries() -> &'static [Entry] {
        static E: OnceLock<Vec<Entry>> = OnceLock::new();
        E.get_or_init(|| {
            serde_json::from_str::<File>(super::COMMANDS_JSON)
                .map(|f| f.entries)
                .unwrap_or_default()
        })
    }

    fn opt_type(t: &serde_json::Value) -> OptType {
        let t = match t {
            serde_json::Value::Array(a) => a.first().and_then(|v| v.as_str()).unwrap_or(""),
            other => other.as_str().unwrap_or(""),
        };
        match t {
            "bool" => OptType::Bool,
            "number" | "integer" => OptType::Number,
            "length" => OptType::Length,
            "color" => OptType::Color,
            "enum" => OptType::Enum,
            "array" => OptType::Array,
            _ => OptType::Other,
        }
    }

    fn find(name: &str, kind: &str) -> Option<&'static Entry> {
        entries().iter().find(|e| e.name == name && e.kind == kind)
    }

    pub struct Spec;

    impl CommandNames for Spec {
        fn is_command(&self, name: &str) -> bool {
            find(name, "command").is_some()
        }
    }

    impl Table for Spec {
        fn options(&self, command: &str) -> Option<Vec<(&str, OptType)>> {
            find(command, "command").map(|e| {
                e.options
                    .iter()
                    .map(|o| (o.name.as_str(), opt_type(&o.ty)))
                    .collect()
            })
        }
        fn enum_values(&self, command: &str, option: &str) -> Vec<&str> {
            find(command, "command")
                .and_then(|e| e.options.iter().find(|o| o.name == option))
                .map(|o| o.values.iter().map(String::as_str).collect())
                .unwrap_or_default()
        }
        fn arg_count(&self, command: &str) -> (usize, usize) {
            match find(command, "command") {
                Some(e) => (
                    e.args
                        .iter()
                        .filter(|a| !a.optional && a.default.is_none())
                        .count(),
                    e.args.len(),
                ),
                None => (0, 0),
            }
        }
        fn is_function(&self, name: &str) -> bool {
            find(name, "function").is_some()
        }
        fn doc(&self, name: &str) -> Option<&str> {
            entries()
                .iter()
                .find(|e| e.name == name)
                .map(|e| e.doc.as_str())
        }
    }

    /// Hover help, as in the tables version.
    pub fn hover(name: &str) -> String {
        let Some(e) = entries().iter().find(|e| e.name == name) else {
            return String::new();
        };
        let mut out = format!("{}\n\n{}\n", e.name, e.doc);
        for a in &e.args {
            out.push_str(&format!("\n- {}: {}", a.name, a.doc));
        }
        for o in &e.options {
            out.push_str(&format!("\n- {}=: {}", o.name, o.doc));
            if !o.values.is_empty() {
                out.push_str(&format!(" ({})", o.values.join(", ")));
            }
        }
        for p in &e.params {
            out.push_str(&format!("\n- {}: {}", p.name, p.doc));
        }
        for x in &e.examples {
            out.push_str(&format!("\n    {x}"));
        }
        out
    }

    /// All names, for completion.
    pub fn names() -> impl Iterator<Item = &'static str> {
        entries().iter().map(|e| e.name.as_str())
    }
}

/// A table with a few fixed commands and no options, used when
/// commands.json is not compiled in.
#[cfg(not(any(feature = "spec-tables", feature = "spec-serde")))]
#[allow(dead_code)]
mod table {
    use standin::check::{OptType, Table};
    use standin::parse::{CommandNames, DefaultCommands};

    pub struct Spec;

    impl CommandNames for Spec {
        fn is_command(&self, name: &str) -> bool {
            DefaultCommands.is_command(name)
        }
    }

    impl Table for Spec {
        fn options(&self, command: &str) -> Option<Vec<(&str, OptType)>> {
            self.is_command(command).then(Vec::new)
        }
        fn enum_values(&self, _: &str, _: &str) -> Vec<&str> {
            Vec::new()
        }
        fn arg_count(&self, _: &str) -> (usize, usize) {
            (0, 8)
        }
        fn is_function(&self, name: &str) -> bool {
            matches!(name, "sin" | "cos" | "exp" | "ln" | "sqrt")
        }
        fn doc(&self, _: &str) -> Option<&str> {
            None
        }
    }

    pub fn hover(_: &str) -> String {
        String::new()
    }

    pub fn names() -> impl Iterator<Item = &'static str> {
        ["load", "plot", "fit", "export"].into_iter()
    }
}

/// Checks a command file. Returns one diagnostic per line: code, start, end, message.
#[cfg(feature = "parser")]
#[wasm_bindgen]
pub fn check(src: &str) -> String {
    let known = std::collections::BTreeSet::new();
    let diags = standin::check::check(src, &table::Spec, &known);
    let mut out = String::new();
    for d in diags {
        out.push_str(&format!(
            "{}\t{}\t{}\t{}\n",
            d.code, d.span.start, d.span.end, d.message
        ));
    }
    out
}

/// Completion candidates for a prefix, one per line.
#[wasm_bindgen]
pub fn complete(prefix: &str) -> String {
    standin::check::complete(prefix, table::names()).join("\n")
}

/// Hover help for a name.
#[wasm_bindgen]
pub fn hover(name: &str) -> String {
    table::hover(name)
}

/// Calls generated function `i`. Only there so the generated code is kept.
#[cfg(feature = "ballast")]
#[wasm_bindgen]
pub fn ballast(i: u32, x: f64) -> f64 {
    ballast::call(i, x)
}
