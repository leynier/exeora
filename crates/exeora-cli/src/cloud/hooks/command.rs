//! `exeora cloud-hook`: the scripts from a shell on the instance.
//!
//! `status` reads what the service wrote. `run` does not run anything
//! itself: it asks the service to, so the run takes its turn with the ones
//! the service starts, holds the machine awake, and is reported to the
//! gateway like any other.

use super::{
    requests,
    script::Hook,
    state::{self, Status},
};
use anyhow::{Result, anyhow, bail};
use clap::{Subcommand, ValueEnum};
use std::time::{Duration, Instant};

const POLL: Duration = Duration::from_millis(250);
/// An install may run for twenty minutes behind another that does.
const ANSWER_BUDGET: Duration = Duration::from_secs(45 * 60);

#[derive(Debug, Subcommand)]
pub enum HookCommand {
    #[command(about = "Print what this instance remembers of its scripts, as JSON")]
    Status,
    #[command(about = "Ask the service on this instance to run a script again")]
    Run {
        #[arg(value_enum, help = "The script to run")]
        hook: HookName,
        #[arg(
            long,
            help = "Leave the request and return without waiting for the run"
        )]
        no_wait: bool,
        #[arg(
            long,
            hide = true,
            default_value_t = 15_000,
            help = "How long the service is given to take the request, in milliseconds"
        )]
        pickup_ms: u64,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum HookName {
    Install,
    Resume,
}

impl From<HookName> for Hook {
    fn from(name: HookName) -> Self {
        match name {
            HookName::Install => Self::Install,
            HookName::Resume => Self::Resume,
        }
    }
}

pub async fn run(command: HookCommand) -> Result<()> {
    let directory = super::directory()?;
    match command {
        HookCommand::Status => {
            let (state, problem) = state::load(&directory);
            if let Some(problem) = problem {
                bail!(problem);
            }
            println!("{}", serde_json::to_string_pretty(&state)?);
            Ok(())
        }
        HookCommand::Run {
            hook,
            no_wait,
            pickup_ms,
        } => {
            let hook = Hook::from(hook);
            let request = requests::ask(&directory, hook).map_err(|error| {
                anyhow!(
                    "Could not leave the request in {}: {error}. Check that the folder can be written to.",
                    requests::folder(&directory).display()
                )
            })?;
            if no_wait {
                println!(
                    "{}",
                    serde_json::json!({ "requested": hook.as_str(), "runId": request.id })
                );
                return Ok(());
            }
            let asked = Instant::now();
            loop {
                if let Some(answer) = requests::collect(&directory, &request.id) {
                    if let Some(error) = answer.error {
                        bail!(error);
                    }
                    let run = answer
                        .run
                        .ok_or_else(|| anyhow!("The service answered without a run."))?;
                    println!("{}", serde_json::to_string_pretty(&run)?);
                    return match run.status {
                        Status::Ok | Status::Skipped => Ok(()),
                        status => Err(anyhow!(
                            "The {hook} script ended as {}. Its output is above.",
                            status.as_str()
                        )),
                    };
                }
                let waited = asked.elapsed();
                // Taken back rather than left: a request that ran whenever
                // the service next started would surprise whoever asked.
                if waited > Duration::from_millis(pickup_ms)
                    && requests::is_waiting(&directory, &request.id)
                    && requests::take(&directory, &request.id)
                {
                    bail!(
                        "The Exeora service on this machine did not take the request. Scripts run only on an instance of Exeora Cloud whose service is running and connected. Check the service, then try again."
                    );
                }
                if waited > ANSWER_BUDGET {
                    bail!(
                        "The {hook} script has not finished after {} minutes. `exeora cloud-hook status` shows how it ends.",
                        ANSWER_BUDGET.as_secs() / 60
                    );
                }
                tokio::time::sleep(POLL).await;
            }
        }
    }
}
