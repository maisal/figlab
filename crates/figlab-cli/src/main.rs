//! The `figlab` command (docs/language.md 10.2).
//!
//! The subcommands (`check`, `run`, `fmt`, `help`, `test`) are added as the
//! language is implemented.

use std::process::ExitCode;

const USAGE: &str = "usage: figlab --version";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.as_slice() {
        [arg] if arg == "--version" => {
            println!("figlab {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        _ => {
            eprintln!("{USAGE}");
            ExitCode::from(2)
        }
    }
}
