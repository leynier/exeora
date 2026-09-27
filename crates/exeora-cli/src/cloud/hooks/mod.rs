//! The scripts a project runs inside its instances.
//!
//! `install` makes a checkout ready once: dependencies, a database, whatever
//! the repository needs before anybody can work in it. `resume` puts back
//! what a sleep took away, and runs every time the instance comes back.
//!
//! When they run is decided here and nowhere else:
//!
//! - Only after a `hello.ack` that carried `cloudHooks`. A gateway that
//!   sends none knows nothing of scripts, and then none runs and nothing is
//!   reported.
//! - `install` when its script is not the one that was last attempted. An
//!   install that failed is therefore not run again at every resume; a
//!   person runs it again, or changes it.
//! - `resume` once for each time the instance came back, counted by the
//!   generation of `CloudRuntime`. Not once for each connection: a socket
//!   that dropped and came back is not an instance that slept.
//! - One at a time, install before resume, and a run somebody asked for
//!   waits its turn behind whatever is running.
//!
//! While any of it runs the gate is closed (see `gate`) and the machine is
//! held awake.

pub mod command;
pub mod gate;
pub mod requests;
pub mod script;
pub mod state;

use crate::{
    cgroup::{CommandLimits, Leaf, oom_notice},
    connection::emit_event,
    protocol::{CLOUD_HOOK_OUTPUT_BYTES, CLOUD_HOOK_SETTLE_MS, now_ms},
    tools::{ScriptOutcome, ScriptSpec, run_script},
    workspace::clone::quiet_environment,
};
use anyhow::Result;
use gate::Gate;
use requests::{Answer, Request};
use script::{Hook, HooksConfig, Script, Scripts, Source};
use serde_json::{Value, json};
use state::{HookRun, HookState, Status, Trigger};
use std::{
    ffi::{OsStr, OsString},
    path::{Path, PathBuf},
    sync::{Arc, Mutex as StdMutex, MutexGuard},
    time::Duration,
};
use tokio::sync::{Mutex, mpsc, watch};
use tokio_util::sync::CancellationToken;

const SHELL: &str = "/bin/bash";
/// How long a stopping service waits for its script to be gone.
const STOP_WAIT: Duration = Duration::from_secs(5);

/// `~/.exeora/hooks`, where the state, the page's scripts and the requests
/// are kept. `EXEORA_HOOKS_DIR` names another place.
pub fn directory() -> Result<PathBuf> {
    if let Some(path) = std::env::var_os("EXEORA_HOOKS_DIR") {
        return Ok(PathBuf::from(path));
    }
    Ok(crate::config::home_dir()?.join(".exeora/hooks"))
}

#[derive(Debug, Clone)]
pub struct HookSettings {
    /// Where the state, the page's scripts and the requests are kept.
    pub directory: PathBuf,
    /// The checkout the scripts run in.
    pub checkout: PathBuf,
    pub install_timeout: Duration,
    pub resume_timeout: Duration,
    /// How long output is still read once the script itself is over.
    pub settle: Duration,
}

impl HookSettings {
    /// The limits of the contract.
    pub fn new(directory: PathBuf, checkout: PathBuf) -> Self {
        Self {
            directory,
            checkout,
            install_timeout: Duration::from_millis(Hook::Install.timeout_ms()),
            resume_timeout: Duration::from_millis(Hook::Resume.timeout_ms()),
            settle: Duration::from_millis(CLOUD_HOOK_SETTLE_MS),
        }
    }

    fn timeout(&self, hook: Hook) -> Duration {
        match hook {
            Hook::Install => self.install_timeout,
            Hook::Resume => self.resume_timeout,
        }
    }
}

/// What the gateway last said, with the kept copy standing in for scripts
/// it could not read.
#[derive(Debug, Clone)]
struct Known {
    /// None when the gateway could not read them and no copy was kept.
    scripts: Option<Scripts>,
    repository: bool,
}

struct Inner {
    state: HookState,
    /// None until a `hello.ack` said whether this gateway sends scripts.
    enabled: Option<bool>,
    known: Option<Known>,
    outgoing: Option<mpsc::UnboundedSender<Value>>,
    /// The generation whose resume has run. Zero is none.
    resumed: u64,
    /// Leaves in which a script left something running. Removed once empty.
    lingering: Vec<Arc<Leaf>>,
}

/// One run that was decided on.
struct Plan {
    hook: Hook,
    script: Script,
    trigger: Trigger,
    run_id: String,
    /// For a resume: whether the instance came back cold or warm.
    kind: Option<&'static str>,
}

pub struct HookRunner {
    settings: HookSettings,
    limits: Option<Arc<CommandLimits>>,
    json_output: bool,
    gate: Gate,
    generation: watch::Receiver<u64>,
    /// Held by whatever is running a script, so there is never a second.
    flight: Mutex<()>,
    inner: StdMutex<Inner>,
    stop: CancellationToken,
}

impl HookRunner {
    pub fn new(
        settings: HookSettings,
        limits: Option<Arc<CommandLimits>>,
        generation: watch::Receiver<u64>,
        json_output: bool,
    ) -> Arc<Self> {
        let (mut state, problem) = state::load(&settings.directory);
        if let Some(problem) = problem {
            notice(json_output, &problem);
        }
        // A run the file still calls running belongs to a process that is
        // gone, and nothing will ever finish it. It is closed as interrupted.
        // An interrupted install was not attempted to its end, so it is not
        // remembered as attempted and runs again.
        let mut interrupted = false;
        for hook in Hook::ALL {
            if let Some(run) = state.last(hook).filter(|run| !run.status.is_final()) {
                let run = HookRun {
                    status: Status::Failed,
                    finished_at: Some(now_ms()),
                    output: Some(
                        "[exeora] Interrupted: the service stopped while the script was running."
                            .to_owned(),
                    ),
                    ..run.clone()
                };
                state.set_last(hook, run);
                interrupted = true;
            }
        }
        if interrupted && let Err(error) = state::save(&settings.directory, &state) {
            notice(
                json_output,
                &format!("Could not save the state of the scripts: {error}."),
            );
        }
        Arc::new(Self {
            settings,
            limits,
            json_output,
            gate: Gate::new(),
            generation,
            flight: Mutex::new(()),
            inner: StdMutex::new(Inner {
                state,
                enabled: None,
                known: None,
                outgoing: None,
                resumed: 0,
                lingering: Vec::new(),
            }),
            stop: CancellationToken::new(),
        })
    }

    pub fn gate(&self) -> Gate {
        self.gate.clone()
    }

    /// Whether a script is running or about to, which holds the machine awake.
    pub fn busy(&self) -> bool {
        self.gate.is_closed()
    }

    /// Ends the script that is running, with everything it started, and
    /// waits a moment for that to have happened. For when the service itself
    /// is told to stop: the process ends right after, and a script only
    /// told to end would leave behind what it had started.
    pub async fn stop(&self) {
        self.stop.cancel();
        self.gate.wait(STOP_WAIT).await;
    }

    pub fn state(&self) -> HookState {
        self.lock().state.clone()
    }

    /// A `hello.ack` arrived. `cloud_hooks` is its field of that name, which
    /// an older gateway does not send.
    ///
    /// Whether anything is due is decided before this returns, and the gate
    /// is closed then, not when the script starts: the gateway sends work
    /// right behind the acknowledgement, and a command that arrived in
    /// between would find the gate open and run in a checkout not yet made.
    pub fn hello(
        self: &Arc<Self>,
        cloud_hooks: Option<&Value>,
        outgoing: mpsc::UnboundedSender<Value>,
    ) {
        let Some(value) = cloud_hooks else {
            let mut inner = self.lock();
            inner.enabled = Some(false);
            inner.known = None;
            inner.outgoing = None;
            return;
        };
        let config = match HooksConfig::from_value(value) {
            Ok(config) => config,
            Err(problem) => {
                notice(self.json_output, &problem);
                return;
            }
        };
        let due = {
            let mut inner = self.lock();
            inner.enabled = Some(true);
            inner.outgoing = Some(outgoing);
            self.adopt(&mut inner, config);
            // The gateway may have missed how a run ended, or that it began:
            // the connection that would have told it is the one that dropped.
            for hook in Hook::ALL {
                if let Some(run) = inner.state.last(hook)
                    && (run.status.is_final() || hook == Hook::Install)
                {
                    send(&inner, hook, run);
                }
            }
            self.install_due(&inner).is_some() || self.resume_due(&inner).is_some()
        };
        if !due {
            return;
        }
        let hold = self.gate.hold();
        let runner = self.clone();
        tokio::spawn(async move {
            let _hold = hold;
            let _flight = runner.flight.lock().await;
            // Decided again now that it is this run's turn: the one before
            // may have done the same work.
            let install = runner.install_due(&runner.lock());
            if let Some(plan) = install {
                runner.execute(plan).await;
            }
            let resume = runner.resume_due(&runner.lock());
            if let Some(plan) = resume {
                runner.execute(plan).await;
            }
        });
    }

    /// A `cloud.hook.run` arrived: a person asked for a script to run again.
    pub fn run_requested(
        self: &Arc<Self>,
        message: &Value,
        outgoing: mpsc::UnboundedSender<Value>,
    ) {
        let Some(hook) = message
            .get("hook")
            .and_then(Value::as_str)
            .and_then(Hook::parse)
        else {
            notice(
                self.json_output,
                "The gateway asked for a script this CLI does not know. Upgrade the CLI.",
            );
            return;
        };
        let config = match message
            .get("config")
            .ok_or_else(|| "The gateway asked for a script to run and sent no scripts.".to_owned())
            .and_then(HooksConfig::from_value)
        {
            Ok(config) => config,
            Err(problem) => {
                notice(self.json_output, &problem);
                return;
            }
        };
        {
            let mut inner = self.lock();
            inner.enabled = Some(true);
            inner.outgoing = Some(outgoing);
            self.adopt(&mut inner, config);
        }
        self.spawn_manual(hook, uuid::Uuid::new_v4().simple().to_string(), false);
    }

    /// Looks for what `exeora cloud-hook run` left, once a second. See
    /// `requests` for why it is a file.
    pub fn poll_requests(self: &Arc<Self>) {
        for request in requests::waiting(&self.settings.directory) {
            let enabled = self.lock().enabled;
            // Before the first acknowledgement nobody knows whether this
            // gateway sends scripts. The request waits for the answer.
            let Some(enabled) = enabled else {
                continue;
            };
            if !requests::take(&self.settings.directory, &request.id) {
                continue;
            }
            let Request { id, hook, .. } = request;
            if !enabled {
                self.answer(Answer {
                    id,
                    hook,
                    run: None,
                    error: Some(
                        "The gateway this instance talks to sends no scripts, so none runs. Upgrade the gateway."
                            .to_owned(),
                    ),
                });
                continue;
            }
            self.spawn_manual(hook, id, true);
        }
    }

    fn spawn_manual(self: &Arc<Self>, hook: Hook, run_id: String, answer: bool) {
        let hold = self.gate.hold();
        let runner = self.clone();
        tokio::spawn(async move {
            let _hold = hold;
            let _flight = runner.flight.lock().await;
            let plan = runner.manual(hook, run_id.clone());
            let run = runner.execute(plan).await;
            if answer {
                runner.answer(Answer {
                    id: run_id,
                    hook,
                    run: Some(run),
                    error: None,
                });
            }
        });
    }

    fn answer(&self, answer: Answer) {
        if let Err(error) = requests::answer(&self.settings.directory, &answer) {
            notice(
                self.json_output,
                &format!("Could not answer a request to run a script: {error}."),
            );
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }

    /// Takes what the gateway said as what is known, and keeps a copy of it
    /// for the day it cannot read the scripts. On that day the copy is what
    /// is gone by, whole: what the gateway sends then says nothing about the
    /// project, and must not switch the repository's files back on.
    fn adopt(&self, inner: &mut Inner, config: HooksConfig) {
        let adopted = config.or_kept(inner.state.config.as_ref());
        inner.known = Some(Known {
            scripts: adopted.as_ref().and_then(|config| config.scripts.clone()),
            repository: adopted.as_ref().is_some_and(|config| config.repository),
        });
        if adopted.is_some() && inner.state.config != adopted {
            inner.state.config = adopted;
            self.save(&inner.state);
        }
    }

    fn save(&self, state: &HookState) {
        if let Err(error) = state::save(&self.settings.directory, state) {
            notice(
                self.json_output,
                &format!("Could not save the state of the scripts: {error}."),
            );
        }
    }

    /// The script of a hook as things stand, or none when nothing is known.
    fn script(&self, inner: &Inner, hook: Hook) -> Option<Script> {
        let known = inner.known.as_ref()?;
        let scripts = known.scripts.as_ref()?;
        Some(script::resolve(
            hook,
            scripts,
            known.repository,
            &self.settings.checkout,
        ))
    }

    fn install_due(&self, inner: &Inner) -> Option<Plan> {
        let script = self.script(inner, Hook::Install)?;
        if inner.state.install_attempted.as_deref() == Some(script.key().as_str()) {
            return None;
        }
        Some(Plan {
            hook: Hook::Install,
            script,
            trigger: if inner.state.install_attempted.is_none() {
                Trigger::Setup
            } else {
                Trigger::Changed
            },
            run_id: uuid::Uuid::new_v4().simple().to_string(),
            kind: None,
        })
    }

    fn resume_due(&self, inner: &Inner) -> Option<Plan> {
        let generation = *self.generation.borrow();
        if inner.resumed >= generation {
            return None;
        }
        let script = self.script(inner, Hook::Resume)?;
        // That there is no script is said once, not every time the instance
        // comes back: there is nothing new in it.
        if matches!(script, Script::None)
            && inner
                .state
                .resume
                .as_ref()
                .is_some_and(|run| run.status == Status::Skipped)
        {
            return None;
        }
        let cold = generation <= 1;
        Some(Plan {
            hook: Hook::Resume,
            script,
            trigger: if cold { Trigger::Cold } else { Trigger::Warm },
            run_id: uuid::Uuid::new_v4().simple().to_string(),
            kind: Some(if cold { "cold" } else { "warm" }),
        })
    }

    fn manual(&self, hook: Hook, run_id: String) -> Plan {
        let script = self
            .script(&self.lock(), hook)
            .unwrap_or_else(|| Script::Unusable {
                source: Source::None,
                reason: "The gateway could not read the project's scripts, and this instance has no copy of them yet. Try again in a moment.".to_owned(),
            });
        Plan {
            hook,
            script,
            trigger: Trigger::Manual,
            run_id,
            kind: (hook == Hook::Resume).then(|| {
                if *self.generation.borrow() <= 1 {
                    "cold"
                } else {
                    "warm"
                }
            }),
        }
    }

    /// Runs what was decided and says how it went. The caller holds the
    /// flight.
    async fn execute(&self, plan: Plan) -> HookRun {
        let Plan {
            hook,
            script,
            trigger,
            run_id,
            kind,
        } = plan;
        let started_at = now_ms();
        let mut run = HookRun {
            run_id,
            status: Status::Running,
            source: script.source(),
            trigger,
            script_sha256: script.sha256().map(str::to_owned),
            exit_code: None,
            started_at,
            finished_at: None,
            output: None,
            truncated: false,
        };
        if hook == Hook::Resume {
            // Counted as run for this generation when it starts, so that a
            // connection made again while it runs does not start another.
            let generation = *self.generation.borrow();
            let mut inner = self.lock();
            inner.resumed = inner.resumed.max(generation);
        }
        let mut attempted = true;
        match &script {
            Script::None => run.status = Status::Skipped,
            Script::Unusable { reason, .. } => {
                run.status = Status::Failed;
                run.output = Some(reason.clone());
            }
            Script::Dashboard { .. } | Script::Repository { .. } => {
                {
                    let mut inner = self.lock();
                    inner.state.set_last(hook, run.clone());
                    self.save(&inner.state);
                    // A resume is over in moments and is reported once, when
                    // it is. An install is long enough to be worth saying
                    // that it began.
                    if hook == Hook::Install {
                        send(&inner, hook, &run);
                    }
                }
                self.report(hook, &run);
                attempted = self.run(hook, &script, kind, &mut run).await;
            }
        }
        run.finished_at = Some(now_ms());
        {
            let mut inner = self.lock();
            inner.state.set_last(hook, run.clone());
            if hook == Hook::Install && attempted {
                inner.state.install_attempted = Some(script.key());
            }
            self.save(&inner.state);
            send(&inner, hook, &run);
        }
        self.report(hook, &run);
        run
    }

    /// Runs the script and fills in how it ended. Answers whether the
    /// script was given its chance: one the service ended by stopping was
    /// not.
    async fn run(
        &self,
        hook: Hook,
        script: &Script,
        kind: Option<&'static str>,
        run: &mut HookRun,
    ) -> bool {
        self.clear_lingering().await;
        let file = match self.file(hook, script) {
            Ok(file) => file,
            Err(problem) => {
                run.status = Status::Failed;
                run.output = Some(problem);
                return true;
            }
        };
        let mut env = vec![
            ("CI".to_owned(), "1".to_owned()),
            ("DEBIAN_FRONTEND".to_owned(), "noninteractive".to_owned()),
            ("EXEORA_HOOK".to_owned(), hook.as_str().to_owned()),
            (
                "EXEORA_HOOK_SOURCE".to_owned(),
                script.source().as_str().to_owned(),
            ),
        ];
        if let Some(kind) = kind {
            env.push(("EXEORA_RESUME_KIND".to_owned(), kind.to_owned()));
        }
        // Nobody is there to answer git, so git is told not to ask.
        env.extend(
            quiet_environment(&self.settings.checkout)
                .await
                .into_iter()
                .map(|(name, value)| (name.to_owned(), value)),
        );
        let timeout = self.settings.timeout(hook);
        let outcome = run_script(
            self.limits.as_deref(),
            ScriptSpec {
                program: OsStr::new(SHELL),
                args: vec![OsString::from(&file)],
                cwd: &self.settings.checkout,
                env,
                timeout,
                output_bytes: CLOUD_HOOK_OUTPUT_BYTES,
                merged: true,
                settle: Some(self.settings.settle),
                leaf_prefix: "hook",
            },
            self.stop.clone(),
        )
        .await;
        let ScriptOutcome {
            exit_code,
            timed_out,
            cancelled,
            output,
            oom_limit,
            lingering,
        } = match outcome {
            Ok(outcome) => outcome,
            Err(error) => {
                run.status = Status::Failed;
                run.output = Some(format!(
                    "[exeora] The script could not be started: {}",
                    error.message
                ));
                return true;
            }
        };
        if let Some(leaf) = lingering {
            self.lock().lingering.push(leaf);
        }
        let mut notes = String::new();
        if let Some(limit) = oom_limit {
            notes.push_str(&oom_notice(limit));
        }
        if timed_out {
            notes.push_str(&format!(
                "\n[exeora] Stopped: the script ran for more than {}.",
                spell(timeout)
            ));
        }
        if cancelled {
            notes.push_str(
                "\n[exeora] Interrupted: the service stopped while the script was running.",
            );
        }
        run.truncated = output.truncated;
        let mut text = output.into_merged();
        // What is said about the run is the last thing a person should lose,
        // so it takes its room out of the script's output, not the reverse.
        let room = CLOUD_HOOK_OUTPUT_BYTES.saturating_sub(notes.len());
        if !notes.is_empty() && text.len() > room {
            let mut cut = text.len() - room;
            while !text.is_char_boundary(cut) {
                cut += 1;
            }
            text.drain(..cut);
            run.truncated = true;
        }
        text.push_str(&notes);
        run.output = Some(text);
        run.exit_code = exit_code;
        run.status = if timed_out {
            Status::TimedOut
        } else if exit_code == Some(0) {
            Status::Ok
        } else {
            Status::Failed
        };
        !cancelled
    }

    /// The file bash is given: the repository's own, or the page's script
    /// written where only this user can read or change it.
    fn file(&self, hook: Hook, script: &Script) -> Result<PathBuf, String> {
        match script {
            Script::Repository { path, .. } => Ok(path.clone()),
            Script::Dashboard { text, .. } => {
                let path = self.settings.directory.join(format!("{hook}.sh"));
                crate::private::directory(&self.settings.directory)
                    .and_then(|()| crate::private::write(&path, text.as_bytes(), 0o700))
                    .map_err(|error| {
                        format!(
                            "[exeora] The script could not be written to {}: {error}. Check that the folder can be written to.",
                            path.display()
                        )
                    })?;
                Ok(path)
            }
            Script::None | Script::Unusable { .. } => {
                Err("[exeora] There is no script to run.".to_owned())
            }
        }
    }

    /// Removes the leaves that emptied since a script left something in
    /// them. The ones still in use stay, and what runs in them is not
    /// touched.
    async fn clear_lingering(&self) {
        let leaves = std::mem::take(&mut self.lock().lingering);
        if leaves.is_empty() {
            return;
        }
        let kept = tokio::task::spawn_blocking(move || {
            leaves
                .into_iter()
                .filter(|leaf| !leaf.remove_if_empty())
                .collect::<Vec<_>>()
        })
        .await
        .unwrap_or_default();
        self.lock().lingering.extend(kept);
    }

    /// For the log of the service. What the gateway hears goes with `send`.
    fn report(&self, hook: Hook, run: &HookRun) {
        emit_event(
            self.json_output,
            "hook",
            json!({
                "hook": hook.as_str(),
                "runId": run.run_id,
                "status": run.status.as_str(),
                "source": run.source.as_str(),
                "trigger": run.trigger.as_str(),
                "exitCode": run.exit_code,
                "durationMs": run.finished_at.map(|finished| finished.saturating_sub(run.started_at)),
            }),
        );
        if !self.json_output {
            println!("{} script: {}", hook.as_str(), run.status.as_str());
        }
    }
}

/// Tells the gateway, when this gateway is one that listens. A connection
/// that is gone loses the frame, and the next acknowledgement sends the
/// state again.
fn send(inner: &Inner, hook: Hook, run: &HookRun) {
    if inner.enabled != Some(true) {
        return;
    }
    if let Some(outgoing) = &inner.outgoing {
        let _ = outgoing.send(state_frame(hook, run));
    }
}

pub fn state_frame(hook: Hook, run: &HookRun) -> Value {
    json!({ "type": "cloud.hook.state", "hook": hook.as_str(), "run": run })
}

fn notice(json_output: bool, message: &str) {
    emit_event(json_output, "notice", json!({ "message": message }));
    if !json_output {
        eprintln!("warning: {message}");
    }
}

fn spell(duration: Duration) -> String {
    let seconds = duration.as_secs();
    if seconds >= 60 && seconds.is_multiple_of(60) {
        format!("{} minutes", seconds / 60)
    } else if seconds >= 1 {
        format!("{seconds} seconds")
    } else {
        format!("{} milliseconds", duration.as_millis())
    }
}

/// The checkout the scripts of this machine run in: the root of its one
/// project, as the config names it.
pub fn checkout(projects: &[crate::config::ProjectEntry]) -> Option<&Path> {
    projects.first().map(|project| project.root.as_path())
}

#[cfg(all(test, unix))]
mod tests;
