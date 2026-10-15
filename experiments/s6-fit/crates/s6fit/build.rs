//! Build cmpfit 1.5 (downloads/cmpfit, from scripts/fetch.sh) with the `cc`
//! crate.
//!
//! - `S6_FP_CONTRACT` sets `-ffp-contract` (default `off`). Use `on` or
//!   `fast` to let the C compiler fuse `a*b+c` into one FMA instruction, or
//!   `default` to pass no flag.
//! - For wasm32-unknown-unknown, clang from Homebrew LLVM is used, with the
//!   minimal headers in csrc/include and the functions in csrc/wasm_shim.c.
//!   `S6_WASM_CC` and `S6_WASM_AR` override the clang and llvm-ar paths.

fn main() {
    println!("cargo:rerun-if-env-changed=S6_FP_CONTRACT");
    println!("cargo:rerun-if-env-changed=S6_WASM_CC");
    println!("cargo:rerun-if-changed=csrc");
    if std::env::var_os("CARGO_FEATURE_CMPFIT").is_none() {
        return;
    }
    #[cfg(feature = "cmpfit")]
    build_cmpfit();
}

#[cfg(feature = "cmpfit")]
fn build_cmpfit() {
    let dir = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let src = dir.join("../../downloads/cmpfit/cmpfit-1.5");
    let file = src.join("mpfit.c");
    if !file.exists() {
        panic!("{} is missing: run scripts/fetch.sh first", file.display());
    }
    println!("cargo:rerun-if-changed={}", file.display());
    let target = std::env::var("TARGET").unwrap();
    let contract = std::env::var("S6_FP_CONTRACT").unwrap_or_else(|_| "off".into());
    let mut b = cc::Build::new();
    b.file(&file).include(&src).warnings(false);
    if contract != "default" {
        b.flag(format!("-ffp-contract={contract}"));
    }
    if target.starts_with("wasm32") {
        let cc = std::env::var("S6_WASM_CC")
            .unwrap_or_else(|_| "/opt/homebrew/opt/llvm/bin/clang".into());
        let ar = std::env::var("S6_WASM_AR")
            .unwrap_or_else(|_| "/opt/homebrew/opt/llvm/bin/llvm-ar".into());
        b.compiler(cc).archiver(ar);
        b.flag("-isystem")
            .flag(dir.join("csrc/include").to_str().unwrap());
        b.file(dir.join("csrc/wasm_shim.c"));
    }
    b.compile("mpfit");
}
