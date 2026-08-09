pub mod api;
pub mod auth;
pub mod cli;
pub mod config;
pub mod connection;
pub mod error;
#[allow(dead_code, clippy::all)]
pub mod generated;
pub mod policy;
pub mod protocol;
pub mod tools;
pub mod upgrade;

pub const CLI_VERSION: &str = env!("CARGO_PKG_VERSION");
