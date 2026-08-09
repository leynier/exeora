use anyhow::{Context, Result};
use std::{env, fs, path::PathBuf, process::Command};
use typify::{TypeSpace, TypeSpaceSettings};

fn main() -> Result<()> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let schema_path = root.join("crates/exeora-cli/protocol/types.schema.json");
    let output_path = root.join("crates/exeora-cli/src/generated/protocol_types.rs");
    let schema: schemars::schema::RootSchema = serde_json::from_slice(
        &fs::read(&schema_path).with_context(|| format!("read {}", schema_path.display()))?,
    )?;
    let settings = TypeSpaceSettings::default();
    let mut space = TypeSpace::new(&settings);
    space.add_root_schema(schema)?;
    fs::create_dir_all(output_path.parent().expect("generated parent"))?;
    let syntax: syn::File = syn::parse2(space.to_stream())?;
    fs::write(&output_path, prettyplease::unparse(&syntax))?;
    let status = Command::new("rustfmt")
        .args(["--edition", "2024"])
        .arg(&output_path)
        .status()
        .context("run rustfmt for generated protocol types")?;
    anyhow::ensure!(
        status.success(),
        "rustfmt failed for generated protocol types"
    );
    println!("generated {}", output_path.display());
    Ok(())
}
