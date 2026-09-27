pub mod api;
pub mod auth;
pub mod cgroup;
pub mod cli;
pub mod cloud;
pub mod config;
pub mod connection;
pub mod error;
#[allow(dead_code, clippy::all)]
pub mod generated;
pub mod gh;
pub mod git_credential;
pub mod mcp;
pub mod policy;
pub(crate) mod private;
pub mod projects;
pub mod protocol;
pub mod repo;
#[cfg(test)]
pub(crate) mod testing;
pub mod tools;
pub mod upgrade;
pub mod workspace;
pub mod workspaces;

pub const CLI_VERSION: &str = env!("CARGO_PKG_VERSION");
