//! Compiles spec/commands.json into Rust tables (feature `spec-tables`).
//! The JSON is read here, at build time, so serde_json is not in the wasm.

use std::fmt::Write as _;
use std::path::PathBuf;

fn s(v: &serde_json::Value) -> String {
    format!("{:?}", v.as_str().unwrap_or(""))
}

fn opt_type(t: &serde_json::Value) -> &'static str {
    let t = match t {
        serde_json::Value::Array(a) => a.first().and_then(|v| v.as_str()).unwrap_or(""),
        other => other.as_str().unwrap_or(""),
    };
    match t {
        "bool" => "OptType::Bool",
        "number" | "integer" => "OptType::Number",
        "length" => "OptType::Length",
        "color" => "OptType::Color",
        "enum" => "OptType::Enum",
        "array" => "OptType::Array",
        _ => "OptType::Other",
    }
}

fn main() {
    let src = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("../../../../spec/commands.json");
    println!("cargo:rerun-if-changed={}", src.display());
    let text = std::fs::read_to_string(&src).expect("read spec/commands.json");
    let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    std::fs::write(out_dir.join("commands.json"), &text).unwrap();
    let j: serde_json::Value = serde_json::from_str(&text).unwrap();
    let empty = Vec::new();
    let mut o = String::from("pub static ENTRIES: &[Entry] = &[\n");
    for e in j["entries"].as_array().unwrap() {
        let kind = match e["kind"].as_str().unwrap() {
            "command" => "Kind::Command",
            "function" => "Kind::Function",
            _ => "Kind::Model",
        };
        write!(
            o,
            "Entry {{ name: {}, kind: {kind}, doc: {}, args: &[",
            s(&e["name"]),
            s(&e["doc"])
        )
        .unwrap();
        for a in e["args"].as_array().unwrap_or(&empty) {
            let optional = a["optional"].as_bool().unwrap_or(false) || !a["default"].is_null();
            write!(
                o,
                "Arg {{ name: {}, doc: {}, optional: {optional} }},",
                s(&a["name"]),
                s(&a["doc"])
            )
            .unwrap();
        }
        o.push_str("], options: &[");
        for p in e["options"].as_array().unwrap_or(&empty) {
            write!(
                o,
                "Opt {{ name: {}, ty: {}, doc: {}, values: &[",
                s(&p["name"]),
                opt_type(&p["type"]),
                s(&p["doc"])
            )
            .unwrap();
            for v in p["values"].as_array().unwrap_or(&empty) {
                write!(o, "{},", s(v)).unwrap();
            }
            o.push_str("] },");
        }
        o.push_str("], params: &[");
        for p in e["params"].as_array().unwrap_or(&empty) {
            write!(o, "({}, {}),", s(&p["name"]), s(&p["doc"])).unwrap();
        }
        o.push_str("], examples: &[");
        for x in e["examples"].as_array().unwrap_or(&empty) {
            write!(o, "{},", s(x)).unwrap();
        }
        o.push_str("] },\n");
    }
    o.push_str("];\n");
    std::fs::write(out_dir.join("tables.rs"), o).unwrap();
}
