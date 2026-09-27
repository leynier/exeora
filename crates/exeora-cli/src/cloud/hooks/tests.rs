//! The scripts, run for real: every test has a machine of its own, which is
//! a folder for the state, a folder for the checkout and a runner over both.
//! Nothing is shared between two tests, and nothing is read from the
//! environment of the test process.

use super::{
    HookRunner, HookSettings, requests,
    script::{Hook, sha256},
    state::{self, HookRun, HookState, Status, Trigger},
};
use crate::cloud::hooks::script::Source;
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::{mpsc, watch};

struct Machine {
    home: tempfile::TempDir,
    runner: Arc<HookRunner>,
    generation: watch::Sender<u64>,
    outgoing: mpsc::UnboundedSender<Value>,
    frames: mpsc::UnboundedReceiver<Value>,
}

/// Long enough that a test never meets them unless it is about them.
const AMPLE: Duration = Duration::from_secs(60);

impl Machine {
    fn new() -> Self {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join("workspace/.exeora")).unwrap();
        Self::over(home, |_| {})
    }

    /// A process started on a disk that another left: what a cold start is.
    fn over(home: tempfile::TempDir, adjust: impl FnOnce(&mut HookSettings)) -> Self {
        let mut settings = HookSettings {
            directory: home.path().join("hooks"),
            checkout: home.path().join("workspace"),
            install_timeout: AMPLE,
            resume_timeout: AMPLE,
            settle: Duration::from_millis(300),
        };
        adjust(&mut settings);
        let (generation, generations) = watch::channel(1);
        let (outgoing, frames) = mpsc::unbounded_channel();
        Self {
            runner: HookRunner::new(settings, None, generations, true),
            home,
            generation,
            outgoing,
            frames,
        }
    }

    fn with(adjust: impl FnOnce(&mut HookSettings)) -> Self {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join("workspace/.exeora")).unwrap();
        Self::over(home, adjust)
    }

    fn restarted(self) -> Self {
        Self::over(self.home, |_| {})
    }

    fn checkout(&self) -> PathBuf {
        self.home.path().join("workspace")
    }

    fn file(&self, hook: Hook, text: &str) {
        std::fs::write(self.checkout().join(hook.file()), text).unwrap();
    }

    /// The lines a script left in a file of the checkout.
    fn lines(&self, name: &str) -> Vec<String> {
        std::fs::read_to_string(self.checkout().join(name))
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    /// Says hello as the connection does, and waits for what that started.
    async fn hello(&mut self, cloud_hooks: Option<Value>) -> Vec<Value> {
        self.runner
            .hello(cloud_hooks.as_ref(), self.outgoing.clone());
        self.settled().await
    }

    async fn asked_to_run(&mut self, hook: Hook, config: Value) -> Vec<Value> {
        self.runner.run_requested(
            &json!({ "type": "cloud.hook.run", "hook": hook.as_str(), "config": config }),
            self.outgoing.clone(),
        );
        self.settled().await
    }

    async fn settled(&mut self) -> Vec<Value> {
        assert!(
            self.runner.gate().wait(AMPLE).await,
            "the scripts did not finish"
        );
        let mut frames = Vec::new();
        while let Ok(frame) = self.frames.try_recv() {
            frames.push(frame);
        }
        frames
    }

    /// The instance came back from a pause.
    fn resumed(&self) {
        self.generation.send_modify(|generation| *generation += 1);
    }
}

fn page(install: Option<&str>, resume: Option<&str>) -> Value {
    json!({ "scripts": { "install": install, "resume": resume }, "repository": true })
}

fn run_of(frame: &Value) -> HookRun {
    assert_eq!(frame["type"], "cloud.hook.state", "{frame}");
    serde_json::from_value(frame["run"].clone()).expect("a run as the contract names it")
}

/// The runs of one hook among the frames, in the order they were sent.
fn runs(frames: &[Value], hook: Hook) -> Vec<HookRun> {
    frames
        .iter()
        .filter(|frame| frame["hook"] == hook.as_str())
        .map(run_of)
        .collect()
}

fn alive(pid: i32) -> bool {
    // A process that ended and was not yet collected still answers a
    // signal; its state says it is gone.
    if let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) {
        let state = stat
            .rsplit(')')
            .next()
            .and_then(|rest| rest.trim().chars().next());
        return state != Some('Z');
    }
    if Path::new("/proc/self/stat").exists() {
        return false;
    }
    // SAFETY: signal zero sends nothing; it only asks whether the process is there.
    unsafe { libc::kill(pid, 0) == 0 }
}

async fn gone(pid: i32) -> bool {
    for _ in 0..100 {
        if !alive(pid) {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    false
}

fn pid_in(path: &Path) -> i32 {
    std::fs::read_to_string(path)
        .expect("the script wrote the pid of what it started")
        .trim()
        .parse()
        .expect("a pid")
}

/// Ends what a test left running on purpose.
struct Reaped(i32);

impl Drop for Reaped {
    fn drop(&mut self) {
        // SAFETY: a signal to a process this test started.
        unsafe {
            libc::kill(self.0, libc::SIGKILL);
        }
    }
}

#[tokio::test]
async fn the_page_replaces_the_file_of_the_repository() {
    let mut machine = Machine::new();
    machine.file(Hook::Install, "echo file >> installs\n");
    machine.file(Hook::Resume, "echo file >> resumes\n");

    let frames = machine
        .hello(Some(page(Some("echo page >> installs\n"), None)))
        .await;

    assert_eq!(machine.lines("installs"), ["page"]);
    // The page has nothing for resume, so the file of resume is what runs.
    assert_eq!(machine.lines("resumes"), ["file"]);
    let install = runs(&frames, Hook::Install);
    assert_eq!(
        install.iter().map(|run| run.status).collect::<Vec<_>>(),
        [Status::Running, Status::Ok]
    );
    assert_eq!(install[1].source, Source::Dashboard);
    assert_eq!(install[1].trigger, Trigger::Setup);
    assert_eq!(
        install[1].script_sha256.as_deref(),
        Some(sha256(b"echo page >> installs\n").as_str())
    );
    assert_eq!(install[1].exit_code, Some(0));
    assert_eq!(install[0].run_id, install[1].run_id);
    // A run that is not over says nothing of its output.
    assert_eq!(install[0].output, None);
    assert_eq!(install[0].finished_at, None);
    assert!(install[1].finished_at.is_some());

    // A resume is reported once, when it is over.
    let resume = runs(&frames, Hook::Resume);
    assert_eq!(resume.len(), 1);
    assert_eq!(resume[0].status, Status::Ok);
    assert_eq!(resume[0].source, Source::Repository);
    assert_eq!(resume[0].trigger, Trigger::Cold);
}

#[tokio::test]
async fn a_project_that_turned_its_files_off_never_runs_them() {
    let mut machine = Machine::new();
    machine.file(Hook::Install, "echo file >> installs\n");
    machine.file(Hook::Resume, "echo file >> resumes\n");

    let frames = machine
        .hello(Some(json!({
            "scripts": { "install": null, "resume": "echo page >> resumes\n" },
            "repository": false,
        })))
        .await;

    assert!(machine.lines("installs").is_empty());
    assert_eq!(machine.lines("resumes"), ["page"]);
    let install = runs(&frames, Hook::Install);
    assert_eq!(install.len(), 1);
    assert_eq!(install[0].status, Status::Skipped);
    assert_eq!(install[0].source, Source::None);
    assert_eq!(install[0].script_sha256, None);
}

#[tokio::test]
async fn scripts_the_gateway_could_not_read_are_the_ones_kept_from_last_time() {
    let mut machine = Machine::new();
    machine.file(Hook::Install, "echo file >> installs\n");
    machine.file(Hook::Resume, "echo file >> resumes\n");
    machine
        .hello(Some(page(
            Some("echo page >> installs\n"),
            Some("echo page >> resumes\n"),
        )))
        .await;
    assert_eq!(machine.lines("installs"), ["page"]);
    assert_eq!(machine.lines("resumes"), ["page"]);

    // A cold start, and a gateway that cannot read the scripts.
    let mut machine = machine.restarted();
    let frames = machine
        .hello(Some(json!({ "scripts": null, "repository": true })))
        .await;

    // The install is the one already attempted, so it does not run; the
    // resume is the page's, from the copy that was kept. Neither file of
    // the repository ran, as they would have for an empty page.
    assert_eq!(machine.lines("installs"), ["page"]);
    assert_eq!(machine.lines("resumes"), ["page", "page"]);
    let resume = runs(&frames, Hook::Resume);
    assert_eq!(resume.last().unwrap().source, Source::Dashboard);
}

#[tokio::test]
async fn a_gateway_that_could_not_read_does_not_switch_the_repository_back_on() {
    let mut machine = Machine::new();
    machine.file(Hook::Install, "echo file >> installs\n");
    machine.file(Hook::Resume, "echo file >> resumes\n");
    // The page is empty and the repository's files are switched off.
    let frames = machine
        .hello(Some(
            json!({ "scripts": { "install": null, "resume": null }, "repository": false }),
        ))
        .await;
    assert!(machine.lines("installs").is_empty());
    assert!(machine.lines("resumes").is_empty());
    assert_eq!(
        runs(&frames, Hook::Install).last().unwrap().source,
        Source::None
    );

    // A cold start, and then a resume, with a gateway that cannot read the
    // scripts and says in their place what it says by default.
    let mut machine = machine.restarted();
    machine
        .hello(Some(json!({ "scripts": null, "repository": true })))
        .await;
    machine.hello(Some(json!({ "scripts": null }))).await;

    assert!(machine.lines("installs").is_empty());
    assert!(machine.lines("resumes").is_empty());

    // Asked to run one again meanwhile, it still runs nothing of the repository.
    let frames = machine
        .asked_to_run(
            Hook::Install,
            json!({ "scripts": null, "repository": true }),
        )
        .await;
    assert!(machine.lines("installs").is_empty());
    assert!(
        runs(&frames, Hook::Install)
            .iter()
            .all(|run| run.source == Source::None),
        "{frames:?}"
    );
}

#[tokio::test]
async fn scripts_that_were_never_read_run_nothing() {
    let mut machine = Machine::new();
    machine.file(Hook::Install, "echo file >> installs\n");
    machine.file(Hook::Resume, "echo file >> resumes\n");

    let frames = machine
        .hello(Some(json!({ "scripts": null, "repository": true })))
        .await;

    assert!(machine.lines("installs").is_empty());
    assert!(machine.lines("resumes").is_empty());
    assert!(frames.is_empty(), "{frames:?}");

    // Once the gateway can read them, the machine is set up as if new.
    let frames = machine.hello(Some(page(None, None))).await;
    assert_eq!(machine.lines("installs"), ["file"]);
    assert_eq!(machine.lines("resumes"), ["file"]);
    assert_eq!(runs(&frames, Hook::Install)[1].trigger, Trigger::Setup);
}

#[tokio::test]
async fn an_older_gateway_runs_nothing_and_hears_nothing() {
    let mut machine = Machine::new();
    machine.file(Hook::Install, "echo file >> installs\n");
    machine.file(Hook::Resume, "echo file >> resumes\n");

    let frames = machine.hello(None).await;

    assert!(frames.is_empty(), "{frames:?}");
    assert!(machine.lines("installs").is_empty());
    assert!(machine.lines("resumes").is_empty());
    assert_eq!(machine.runner.state(), HookState::default());
    assert!(!state::path(&machine.home.path().join("hooks")).exists());
}

#[tokio::test]
async fn install_runs_again_when_the_script_changes_and_not_after_it_failed() {
    let mut machine = Machine::new();
    let failing = "echo attempt >> installs\nexit 3\n";

    let frames = machine.hello(Some(page(Some(failing), None))).await;
    let first = runs(&frames, Hook::Install);
    assert_eq!(first[1].status, Status::Failed);
    assert_eq!(first[1].exit_code, Some(3));
    assert_eq!(first[1].trigger, Trigger::Setup);
    assert_eq!(machine.lines("installs").len(), 1);

    // The connection dropped and came back: the same script is not tried
    // again, and the gateway is told once more how the attempt ended.
    let frames = machine.hello(Some(page(Some(failing), None))).await;
    assert_eq!(machine.lines("installs").len(), 1);
    assert_eq!(runs(&frames, Hook::Install), [first[1].clone()]);

    // Nor after a pause, nor after a cold start.
    machine.resumed();
    machine.hello(Some(page(Some(failing), None))).await;
    let mut machine = machine.restarted();
    let frames = machine.hello(Some(page(Some(failing), None))).await;
    assert_eq!(machine.lines("installs").len(), 1);
    assert_eq!(runs(&frames, Hook::Install), [first[1].clone()]);

    // A person asks: it runs, as many times as they ask.
    let frames = machine
        .asked_to_run(Hook::Install, page(Some(failing), None))
        .await;
    let manual = runs(&frames, Hook::Install);
    assert_eq!(manual[1].trigger, Trigger::Manual);
    assert_eq!(manual[1].status, Status::Failed);
    assert_ne!(manual[1].run_id, first[1].run_id);
    assert_eq!(machine.lines("installs").len(), 2);

    // The script changed: it runs without being asked.
    let mended = "echo mended >> installs\n";
    let frames = machine.hello(Some(page(Some(mended), None))).await;
    let changed = runs(&frames, Hook::Install);
    // First the last word on the run before, then the new run.
    assert_eq!(changed[0], manual[1]);
    assert_eq!(changed[2].trigger, Trigger::Changed);
    assert_eq!(changed[2].status, Status::Ok);
    assert_eq!(machine.lines("installs").len(), 3);

    // And having run, stays run.
    machine.hello(Some(page(Some(mended), None))).await;
    assert_eq!(machine.lines("installs").len(), 3);
}

#[tokio::test]
async fn a_changed_file_of_the_repository_is_a_changed_script() {
    let mut machine = Machine::new();
    machine.file(Hook::Install, "echo one >> installs\n");
    machine.hello(Some(page(None, None))).await;
    machine.hello(Some(page(None, None))).await;
    assert_eq!(machine.lines("installs"), ["one"]);

    machine.file(Hook::Install, "echo two >> installs\n");
    let frames = machine.hello(Some(page(None, None))).await;
    assert_eq!(machine.lines("installs"), ["one", "two"]);
    let install = runs(&frames, Hook::Install);
    assert_eq!(install.last().unwrap().trigger, Trigger::Changed);
    assert_eq!(install.last().unwrap().source, Source::Repository);
}

#[tokio::test]
async fn resume_runs_once_for_each_time_the_instance_came_back() {
    let mut machine = Machine::new();
    let script = "echo \"$EXEORA_RESUME_KIND\" >> resumes\n";

    let frames = machine.hello(Some(page(None, Some(script)))).await;
    assert_eq!(runs(&frames, Hook::Resume)[0].trigger, Trigger::Cold);
    assert_eq!(machine.lines("resumes"), ["cold"]);

    // Connections come and go; the instance did not sleep.
    for _ in 0..3 {
        machine.hello(Some(page(None, Some(script)))).await;
    }
    assert_eq!(machine.lines("resumes"), ["cold"]);

    machine.resumed();
    let frames = machine.hello(Some(page(None, Some(script)))).await;
    assert_eq!(machine.lines("resumes"), ["cold", "warm"]);
    assert_eq!(
        runs(&frames, Hook::Resume).last().unwrap().trigger,
        Trigger::Warm
    );
    machine.hello(Some(page(None, Some(script)))).await;
    assert_eq!(machine.lines("resumes"), ["cold", "warm"]);

    // A cold start is a new process, and its first resume is cold again.
    let mut machine = machine.restarted();
    machine.hello(Some(page(None, Some(script)))).await;
    assert_eq!(machine.lines("resumes"), ["cold", "warm", "cold"]);
}

#[tokio::test]
async fn a_resume_that_fails_is_not_tried_again_until_the_next_pause() {
    let mut machine = Machine::new();
    let script = "echo attempt >> resumes\nexit 1\n";
    let frames = machine.hello(Some(page(None, Some(script)))).await;
    assert_eq!(runs(&frames, Hook::Resume)[0].status, Status::Failed);
    machine.hello(Some(page(None, Some(script)))).await;
    assert_eq!(machine.lines("resumes").len(), 1);
    machine.resumed();
    machine.hello(Some(page(None, Some(script)))).await;
    assert_eq!(machine.lines("resumes").len(), 2);
}

#[tokio::test]
async fn having_no_script_is_said_once() {
    let mut machine = Machine::new();

    let frames = machine.hello(Some(page(None, None))).await;
    let install = runs(&frames, Hook::Install);
    let resume = runs(&frames, Hook::Resume);
    assert_eq!(install.len(), 1);
    assert_eq!(install[0].status, Status::Skipped);
    assert_eq!(install[0].trigger, Trigger::Setup);
    assert_eq!(install[0].source, Source::None);
    assert_eq!(install[0].output, None);
    assert!(install[0].finished_at.is_some());
    assert_eq!(resume.len(), 1);
    assert_eq!(resume[0].status, Status::Skipped);

    // Every hello after that repeats the last word and adds no run, however
    // many times the instance sleeps and however many times it starts.
    machine.resumed();
    let frames = machine.hello(Some(page(None, None))).await;
    assert_eq!(runs(&frames, Hook::Install), install);
    assert_eq!(runs(&frames, Hook::Resume), resume);
    let mut machine = machine.restarted();
    let frames = machine.hello(Some(page(None, None))).await;
    assert_eq!(runs(&frames, Hook::Install), install);
    assert_eq!(runs(&frames, Hook::Resume), resume);
}

#[tokio::test]
async fn a_script_runs_in_the_checkout_and_knows_what_it_is() {
    let mut machine = Machine::new();
    let script = "pwd -P > where\nprintf '%s %s %s %s %s\\n' \"$EXEORA_HOOK\" \"$EXEORA_HOOK_SOURCE\" \"$CI\" \"$DEBIAN_FRONTEND\" \"${GIT_ASKPASS-unset}\" > what\ncat > stdin\n";
    let frames = machine.hello(Some(page(Some(script), None))).await;

    assert_eq!(runs(&frames, Hook::Install)[1].status, Status::Ok);
    assert_eq!(
        PathBuf::from(&machine.lines("where")[0]),
        std::fs::canonicalize(machine.checkout()).unwrap()
    );
    assert_eq!(
        machine.lines("what"),
        ["install dashboard 1 noninteractive "]
    );
    // Nothing to read from: a script that asks a question gets no answer
    // rather than a wait.
    assert!(machine.lines("stdin").is_empty());
}

#[tokio::test]
async fn the_page_s_script_is_kept_where_only_its_owner_reads_it() {
    use std::os::unix::fs::PermissionsExt;
    let mut machine = Machine::new();
    machine.hello(Some(page(Some("true\n"), None))).await;
    let hooks = machine.home.path().join("hooks");
    let mode = |path: &Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(&hooks), 0o700);
    assert_eq!(mode(&hooks.join("install.sh")), 0o700);
    assert_eq!(mode(&hooks.join("state.json")), 0o600);
    assert_eq!(
        std::fs::read_to_string(hooks.join("install.sh")).unwrap(),
        "true\n"
    );
}

#[tokio::test]
async fn a_script_that_runs_too_long_is_stopped_with_everything_it_started() {
    let mut machine = Machine::with(|settings| {
        settings.install_timeout = Duration::from_secs(1);
    });
    let script = "sleep 300 &\necho $! > child.pid\necho started\nsleep 300\n";

    let started = Instant::now();
    let frames = machine.hello(Some(page(Some(script), None))).await;

    assert!(started.elapsed() < Duration::from_secs(20));
    let install = runs(&frames, Hook::Install);
    assert_eq!(install[1].status, Status::TimedOut);
    assert_eq!(install[1].exit_code, None);
    let output = install[1].output.as_deref().unwrap();
    assert!(output.starts_with("started\n"), "{output}");
    assert!(
        output.ends_with("[exeora] Stopped: the script ran for more than 1 seconds."),
        "{output}"
    );
    let child = pid_in(&machine.checkout().join("child.pid"));
    assert!(gone(child).await, "what the script started outlived it");

    // It was given its chance, so it is not tried again by itself.
    let frames = machine.hello(Some(page(Some(script), None))).await;
    assert_eq!(runs(&frames, Hook::Install), [install[1].clone()]);
}

#[tokio::test]
async fn a_script_that_leaves_something_running_is_over_when_it_is_over() {
    // With the wait of the contract, which is what an instance has.
    let mut machine = Machine::with(|settings| {
        settings.settle = Duration::from_millis(crate::protocol::CLOUD_HOOK_SETTLE_MS);
    });
    // The child inherits the script's output, so the pipe stays open for
    // as long as the child lives.
    let script = "sleep 300 &\necho $! > child.pid\necho started\n";

    let started = Instant::now();
    let frames = machine.hello(Some(page(None, Some(script)))).await;
    let took = started.elapsed();

    let child = Reaped(pid_in(&machine.checkout().join("child.pid")));
    assert!(took < Duration::from_secs(15), "took {took:?}");
    let resume = runs(&frames, Hook::Resume);
    assert_eq!(resume[0].status, Status::Ok);
    assert_eq!(resume[0].exit_code, Some(0));
    assert_eq!(resume[0].output.as_deref(), Some("started\n"));
    assert!(alive(child.0), "what the script left running was killed");
    assert!(!machine.runner.busy());

    // Still there after the next script has come and gone.
    machine.resumed();
    machine.hello(Some(page(None, Some("true\n")))).await;
    assert!(alive(child.0), "what the script left running was killed");
}

#[tokio::test]
async fn what_is_left_running_may_go_on_printing() {
    let mut machine = Machine::new();
    // Prints after the script is over. With the pipe closed behind the
    // script, the first of these would end it.
    let script = "( sleep 1; echo late; sleep 1; echo later; touch finished ) &\necho started\n";

    let frames = machine.hello(Some(page(None, Some(script)))).await;
    let resume = runs(&frames, Hook::Resume);
    assert_eq!(resume[0].status, Status::Ok);
    // What it prints after the script is over belongs to no run.
    assert_eq!(resume[0].output.as_deref(), Some("started\n"));

    let finished = machine.checkout().join("finished");
    for _ in 0..100 {
        if finished.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(finished.exists(), "what was left running did not finish");
    assert_eq!(machine.runner.state().resume, Some(resume[0].clone()));
}

#[tokio::test]
async fn keeps_the_end_of_the_output_with_both_streams_in_order() {
    let mut machine = Machine::new();
    let script =
        "i=0\nwhile [ $i -lt 2000 ]; do i=$((i+1)); echo \"out $i\"; echo \"err $i\" >&2; done\n";

    let frames = machine.hello(Some(page(Some(script), None))).await;

    let install = runs(&frames, Hook::Install);
    assert_eq!(install[1].status, Status::Ok);
    assert!(install[1].truncated);
    let output = install[1].output.as_deref().unwrap();
    assert!(output.len() <= crate::protocol::CLOUD_HOOK_OUTPUT_BYTES);
    assert!(output.len() > crate::protocol::CLOUD_HOOK_OUTPUT_BYTES - 16);
    assert!(output.ends_with("out 2000\nerr 2000\n"), "{output}");
    assert!(!output.contains("out 1\n"));
    // Each line of one stream is followed by the line of the other that
    // was written after it.
    let lines: Vec<&str> = output.lines().skip(1).collect();
    let first = lines
        .iter()
        .position(|line| line.starts_with("out "))
        .unwrap();
    for pair in lines[first..].chunks(2) {
        let number = pair[0].strip_prefix("out ").expect("a line of stdout");
        assert_eq!(pair[1], format!("err {number}"));
    }
}

#[tokio::test]
async fn output_that_fits_is_kept_whole() {
    let mut machine = Machine::new();
    let frames = machine
        .hello(Some(page(
            Some("echo one\necho two >&2\necho três\n"),
            None,
        )))
        .await;
    let install = runs(&frames, Hook::Install);
    assert_eq!(install[1].output.as_deref(), Some("one\ntwo\ntrês\n"));
    assert!(!install[1].truncated);
}

#[tokio::test]
async fn one_script_at_a_time_and_a_run_that_was_asked_for_waits_its_turn() {
    let mut machine = Machine::new();
    let install = "echo install-begins >> order\nsleep 1\necho install-ends >> order\n";
    let resume = "echo resume-begins >> order\nsleep 0.2\necho resume-ends >> order\n";
    let config = page(Some(install), Some(resume));

    machine
        .runner
        .hello(Some(&config), machine.outgoing.clone());
    // Asked for while the install is running.
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(machine.runner.busy());
    machine.runner.run_requested(
        &json!({ "type": "cloud.hook.run", "hook": "resume", "config": config }),
        machine.outgoing.clone(),
    );
    let frames = machine.settled().await;

    assert_eq!(
        machine.lines("order"),
        [
            "install-begins",
            "install-ends",
            "resume-begins",
            "resume-ends",
            "resume-begins",
            "resume-ends",
        ]
    );
    let resumes = runs(&frames, Hook::Resume);
    assert_eq!(
        resumes.iter().map(|run| run.trigger).collect::<Vec<_>>(),
        [Trigger::Cold, Trigger::Manual]
    );
    assert!(!machine.runner.busy());
}

#[tokio::test]
async fn the_gate_is_closed_from_the_hello_until_the_scripts_are_over() {
    let mut machine = Machine::new();
    let gate = machine.runner.gate();
    assert!(!gate.is_closed());

    machine.runner.hello(
        Some(&page(Some("sleep 1\n"), None)),
        machine.outgoing.clone(),
    );
    // Closed before the script has even started: nothing was awaited yet.
    assert!(gate.is_closed());
    assert!(machine.runner.busy());
    assert!(!gate.wait(Duration::from_millis(100)).await);

    let started = Instant::now();
    assert!(gate.wait(AMPLE).await);
    assert!(started.elapsed() < Duration::from_secs(20));
    assert!(!machine.runner.busy());

    // A hello with nothing to run does not close it.
    machine.runner.hello(
        Some(&page(Some("sleep 1\n"), None)),
        machine.outgoing.clone(),
    );
    assert!(!gate.is_closed());
    machine.settled().await;
}

#[tokio::test]
async fn a_run_asked_for_from_a_shell_is_run_by_the_service() {
    let mut machine = Machine::new();
    let directory = machine.home.path().join("hooks");
    machine
        .hello(Some(page(Some("echo ran >> installs\n"), None)))
        .await;
    assert_eq!(machine.lines("installs").len(), 1);

    let request = requests::ask(&directory, Hook::Install).unwrap();
    machine.runner.poll_requests();
    assert!(!requests::is_waiting(&directory, &request.id));
    let frames = machine.settled().await;

    assert_eq!(machine.lines("installs").len(), 2);
    let answer = requests::collect(&directory, &request.id).expect("an answer");
    let run = answer.run.expect("a run");
    assert_eq!(answer.error, None);
    assert_eq!(run.run_id, request.id);
    assert_eq!(run.trigger, Trigger::Manual);
    assert_eq!(run.status, Status::Ok);
    // The gateway hears of it like of any other run.
    assert_eq!(runs(&frames, Hook::Install).last(), Some(&run));

    // Looking again finds nothing to run twice.
    machine.runner.poll_requests();
    machine.settled().await;
    assert_eq!(machine.lines("installs").len(), 2);
}

#[tokio::test]
async fn a_run_asked_for_from_a_shell_needs_a_gateway_that_sends_scripts() {
    let mut machine = Machine::new();
    let directory = machine.home.path().join("hooks");
    machine.file(Hook::Install, "echo file >> installs\n");

    // Before the first hello nobody knows: the request waits.
    let request = requests::ask(&directory, Hook::Install).unwrap();
    machine.runner.poll_requests();
    assert!(requests::is_waiting(&directory, &request.id));
    assert_eq!(requests::collect(&directory, &request.id), None);

    // An older gateway: it is answered, and nothing runs.
    machine.hello(None).await;
    machine.runner.poll_requests();
    machine.settled().await;
    let answer = requests::collect(&directory, &request.id).expect("an answer");
    assert_eq!(answer.run, None);
    assert!(
        answer
            .error
            .is_some_and(|error| error.contains("sends no scripts"))
    );
    assert!(machine.lines("installs").is_empty());
}

#[tokio::test]
async fn a_run_the_service_died_in_the_middle_of_is_closed_and_run_again() {
    let machine = Machine::new();
    let directory = machine.home.path().join("hooks");
    let script = "echo ran >> installs\n";
    let interrupted = HookRun {
        run_id: "run_interrupted".to_owned(),
        status: Status::Running,
        source: Source::Dashboard,
        trigger: Trigger::Setup,
        script_sha256: Some(sha256(script.as_bytes())),
        exit_code: None,
        started_at: 5,
        finished_at: None,
        output: None,
        truncated: false,
    };
    state::save(
        &directory,
        &HookState {
            install: Some(interrupted.clone()),
            ..HookState::default()
        },
    )
    .unwrap();

    let mut machine = machine.restarted();
    let closed = machine.runner.state().install.expect("the run");
    assert_eq!(closed.run_id, interrupted.run_id);
    assert_eq!(closed.status, Status::Failed);
    assert!(closed.finished_at.is_some());
    assert!(
        closed
            .output
            .is_some_and(|output| output.contains("Interrupted"))
    );

    let frames = machine.hello(Some(page(Some(script), None))).await;
    assert_eq!(machine.lines("installs"), ["ran"]);
    let install = runs(&frames, Hook::Install);
    assert_eq!(install[0].run_id, interrupted.run_id);
    assert_eq!(install.last().unwrap().status, Status::Ok);
    assert_eq!(install.last().unwrap().trigger, Trigger::Setup);
}

#[tokio::test]
async fn a_service_told_to_stop_ends_the_script_and_what_it_started() {
    let mut machine = Machine::new();
    let script = "sleep 300 &\necho $! > child.pid\nsleep 300\n";
    machine
        .runner
        .hello(Some(&page(Some(script), None)), machine.outgoing.clone());
    let pid_file = machine.checkout().join("child.pid");
    for _ in 0..100 {
        if pid_file.exists() && !std::fs::read_to_string(&pid_file).unwrap().is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    let started = Instant::now();
    machine.runner.stop().await;
    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(!machine.runner.busy(), "the script outlived the service");
    let frames = machine.settled().await;

    let install = runs(&frames, Hook::Install);
    assert_eq!(install[1].status, Status::Failed);
    assert!(
        install[1]
            .output
            .as_deref()
            .is_some_and(|output| output.contains("Interrupted"))
    );
    assert!(gone(pid_in(&pid_file)).await);
    // Not given its chance, so it runs when the service is back.
    assert_eq!(machine.runner.state().install_attempted, None);
}

#[tokio::test]
async fn a_checkout_that_is_not_there_is_a_failure_with_a_reason() {
    let mut machine = Machine::with(|settings| {
        settings.checkout = settings.checkout.join("gone");
    });
    let frames = machine.hello(Some(page(Some("true\n"), None))).await;
    let install = runs(&frames, Hook::Install);
    assert_eq!(install.last().unwrap().status, Status::Failed);
    assert!(
        install
            .last()
            .unwrap()
            .output
            .as_deref()
            .is_some_and(|output| output.contains("could not be started")),
    );
}

#[tokio::test]
async fn scripts_that_are_not_the_contract_are_refused_whole() {
    let mut machine = Machine::new();
    machine.file(Hook::Install, "echo file >> installs\n");
    let frames = machine
        .hello(Some(json!({ "scripts": "echo", "repository": true })))
        .await;
    assert!(frames.is_empty());
    assert!(machine.lines("installs").is_empty());
}
