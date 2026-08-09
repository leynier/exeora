use clap::Parser;
use exeora_cli::cli::{Cli, run};

fn main() {
    let cli = Cli::parse();
    let json_output = cli.json;
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("error: {error}");
            std::process::exit(1);
        }
    };
    if let Err(error) = runtime.block_on(run(cli)) {
        if json_output {
            eprintln!("{}", serde_json::json!({ "error": error.to_string() }));
        } else {
            eprintln!("error: {error}");
        }
        std::process::exit(1);
    }
}
