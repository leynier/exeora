//! A memory cap on every command tree the CLI starts.
//!
//! On a cloud machine the kernel believes it has twice the memory the host
//! will actually give it, so a build that grows past the real limit does not
//! get killed: the whole machine stalls. The cure is a cgroup v2 leaf per
//! command with its own `memory.max`, where the kernel's OOM killer does act,
//! and `memory.oom.group` so it takes the whole tree rather than one process
//! of it.
//!
//! Only the process that lives inside a delegated subtree can move its
//! children into that subtree, so at start-up the CLI asks a root helper to
//! put it there (`exeora-cgroup enter`, installed by the bootstrap). cgroupfs
//! is volatile, so this happens on every start. Off everywhere else: without
//! `EXEORA_CGROUP_ROOT` nothing here runs, and a laptop is exactly as before.

use std::{
    fs, io,
    path::{Path, PathBuf},
    time::Duration,
};

#[cfg(target_os = "linux")]
const HELPER: &str = "/usr/local/sbin/exeora-cgroup";

pub struct CommandLimits {
    root: PathBuf,
    memory_max: u64,
    /// Read only where `init` can cap the subtree, which is Linux.
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    memory_total: u64,
}

impl CommandLimits {
    pub fn new(root: PathBuf, memory_max: u64, memory_total: u64) -> Self {
        Self {
            root,
            memory_max,
            memory_total,
        }
    }

    pub fn memory_max(&self) -> u64 {
        self.memory_max
    }

    /// Enters the subtree, caps it as a whole, proves a leaf works, and
    /// clears leaves an earlier run left behind. Any failure is a reason the
    /// caller reports and then runs commands unlimited: a machine without
    /// limits is worse than one with them, and better than one that refuses
    /// every command.
    #[cfg(target_os = "linux")]
    pub async fn init(self) -> Result<Self, String> {
        let pid = std::process::id().to_string();
        let entered = tokio::time::timeout(
            Duration::from_secs(10),
            tokio::process::Command::new("sudo")
                .args(["-n", HELPER, "enter", &pid])
                .env_clear()
                .env(
                    "PATH",
                    "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                )
                .env("EXEORA_CGROUP_ROOT", &self.root)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::piped())
                .output(),
        )
        .await
        .map_err(|_| "the cgroup helper did not answer in time".to_owned())?
        .map_err(|error| format!("the cgroup helper could not run: {error}"))?;
        if !entered.status.success() {
            let stderr = String::from_utf8_lossy(&entered.stderr);
            return Err(format!(
                "the cgroup helper refused ({}): {}",
                entered.status,
                stderr.trim()
            ));
        }

        let expected = format!(
            "{}/cli",
            self.root
                .strip_prefix("/sys/fs/cgroup")
                .map(|relative| format!("/{}", relative.display()))
                .unwrap_or_else(|_| self.root.display().to_string())
        );
        let membership = fs::read_to_string("/proc/self/cgroup")
            .map_err(|error| format!("could not read /proc/self/cgroup: {error}"))?;
        if !membership.lines().any(|line| line.ends_with(&expected)) {
            return Err(format!("this process is not in {expected}"));
        }

        fs::write(self.root.join("memory.max"), self.memory_total.to_string())
            .map_err(|error| format!("could not cap the subtree: {error}"))?;

        let probe = self
            .leaf("probe")
            .map_err(|error| format!("could not make a test leaf: {error}"))?;
        let mut command = tokio::process::Command::new("/bin/true");
        probe
            .attach_pre_exec(&mut command)
            .map_err(|error| format!("could not attach a test leaf: {error}"))?;
        let ran = command
            .status()
            .await
            .map_err(|error| format!("a test command could not start: {error}"))?;
        probe.release();
        if !ran.success() {
            return Err("a test command failed inside its leaf".to_owned());
        }

        self.sweep();
        Ok(self)
    }

    #[cfg(not(target_os = "linux"))]
    pub async fn init(self) -> Result<Self, String> {
        Err("memory limits need cgroup v2, which exists on Linux only".to_owned())
    }

    /// A fresh leaf for one command tree.
    pub fn leaf(&self, prefix: &str) -> io::Result<Leaf> {
        let path = self
            .root
            .join(format!("{prefix}-{}", uuid::Uuid::new_v4().simple()));
        fs::create_dir(&path)?;
        fs::write(path.join("memory.max"), self.memory_max.to_string())?;
        // Absent without swap accounting; the limit above still holds.
        let _ = fs::write(path.join("memory.swap.max"), "0");
        let _ = fs::write(path.join("memory.oom.group"), "1");
        Ok(Leaf {
            path,
            limit: self.memory_max,
        })
    }

    /// Leaves from a run that ended without releasing them. Their processes
    /// are unreachable by now, so they are killed and the leaves removed.
    #[cfg(target_os = "linux")]
    fn sweep(&self) {
        let Ok(entries) = fs::read_dir(&self.root) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name.starts_with("cmd-") || name.starts_with("term-") || name.starts_with("probe-") {
                Leaf {
                    path: entry.path(),
                    limit: self.memory_max,
                }
                .release();
            }
        }
    }
}

pub struct Leaf {
    path: PathBuf,
    limit: u64,
}

impl Leaf {
    pub fn limit(&self) -> u64 {
        self.limit
    }

    /// Moves the child into the leaf between fork and exec, with one write
    /// on a file opened here in the parent, and hands back the OOM exemption
    /// the CLI runs with. Nothing allocates in the child.
    ///
    /// The helper that sets the CLI up gives it `oom_score_adj = -1000`, so a
    /// memory squeeze takes a command and not the process serving the relay.
    /// A child inherits that, and a command the kernel may not kill is one
    /// that stalls its whole leaf at the limit instead. Raising the score
    /// back to zero needs no privilege, so the child does it to itself.
    #[cfg(unix)]
    pub fn attach_pre_exec(&self, command: &mut tokio::process::Command) -> io::Result<()> {
        let procs = fs::OpenOptions::new()
            .write(true)
            .open(self.path.join("cgroup.procs"))?;
        // SAFETY: the closure writes to a file descriptor the parent opened
        // and makes three raw syscalls on a static path; it takes no locks
        // and allocates nothing, which is what a post-fork hook may do.
        unsafe {
            command.pre_exec(move || {
                use std::io::Write;
                (&procs).write_all(b"0")?;
                reset_oom_score_adj();
                Ok(())
            });
        }
        Ok(())
    }

    #[cfg(not(unix))]
    pub fn attach_pre_exec(&self, _command: &mut tokio::process::Command) -> io::Result<()> {
        Err(io::Error::other("cgroups exist on Linux only"))
    }

    /// For a process spawned without a hook, such as a PTY shell: a wrapper
    /// that moves itself into the leaf, gives up the CLI's OOM exemption (see
    /// `attach_pre_exec`) and then becomes the real program. `echo` is a
    /// builtin in every /bin/sh, so the writer is the shell itself.
    pub fn shell_wrapper(&self, program: &str) -> (String, Vec<String>) {
        (
            "/bin/sh".to_owned(),
            vec![
                "-c".to_owned(),
                "echo 0 > \"$1\" && echo 0 > /proc/self/oom_score_adj && exec \"$2\"".to_owned(),
                "exeora".to_owned(),
                self.path.join("cgroup.procs").display().to_string(),
                program.to_owned(),
            ],
        )
    }

    /// Whether the kernel killed something in this leaf for its memory.
    pub fn oom_killed(&self) -> bool {
        fs::read_to_string(self.path.join("memory.events"))
            .ok()
            .is_some_and(|events| oom_kills(&events) > 0)
    }

    /// Kills everything in the leaf, including what left the process group.
    pub fn kill(&self) {
        let _ = fs::write(self.path.join("cgroup.kill"), "1");
    }

    /// Kills and removes the leaf. Removal waits for the kernel to reap the
    /// last process, briefly; a leaf that stays is swept on the next start.
    pub fn release(&self) {
        self.kill();
        for _ in 0..50 {
            if fs::remove_dir(&self.path).is_ok() || !self.path.exists() {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

/// Raises the child's own `oom_score_adj` back to zero, between fork and
/// exec. Three raw syscalls on a static path: nothing allocates, nothing
/// locks. Best effort, since a CLI that was never exempted has nothing to
/// give back and the child must start regardless.
#[cfg(unix)]
fn reset_oom_score_adj() {
    // SAFETY: plain libc calls on a static C string and a stack buffer.
    unsafe {
        let fd = libc::open(
            c"/proc/self/oom_score_adj".as_ptr(),
            libc::O_WRONLY | libc::O_CLOEXEC,
        );
        if fd >= 0 {
            libc::write(fd, b"0".as_ptr().cast(), 1);
            libc::close(fd);
        }
    }
}

/// For every other child the CLI starts (git, a stdio MCP server): not in a
/// leaf of its own, but no longer immune to the OOM killer either. With the
/// exemption inherited, a git operation that outgrew the subtree could never
/// be the one killed, and the machine would stall instead.
#[cfg(unix)]
pub fn drop_oom_exemption(command: &mut tokio::process::Command) {
    // SAFETY: the hook only calls `reset_oom_score_adj`, which is safe to
    // run after fork.
    unsafe {
        command.pre_exec(|| {
            reset_oom_score_adj();
            Ok(())
        });
    }
}

#[cfg(not(unix))]
pub fn drop_oom_exemption(_command: &mut tokio::process::Command) {}

/// What a command's stderr gains when its tree was killed for memory.
pub fn oom_notice(limit: u64) -> String {
    format!(
        "\n[exeora] Killed: the command tree exceeded the {} memory limit.",
        format_size(limit)
    )
}

fn oom_kills(events: &str) -> u64 {
    events
        .lines()
        .find_map(|line| line.strip_prefix("oom_kill "))
        .and_then(|count| count.trim().parse().ok())
        .unwrap_or(0)
}

/// `6G`, `512M`, `1024K`, or plain bytes. Binary units, like the kernel.
pub fn parse_size(text: &str) -> Option<u64> {
    let text = text.trim();
    let (digits, unit) = match text.chars().last() {
        Some(unit) if unit.is_ascii_alphabetic() => (&text[..text.len() - 1], unit),
        _ => (text, 'B'),
    };
    let value: u64 = digits.trim().parse().ok()?;
    let factor: u64 = match unit.to_ascii_uppercase() {
        'B' => 1,
        'K' => 1 << 10,
        'M' => 1 << 20,
        'G' => 1 << 30,
        'T' => 1 << 40,
        _ => return None,
    };
    value.checked_mul(factor)
}

pub fn format_size(bytes: u64) -> String {
    for (unit, factor) in [("TiB", 1_u64 << 40), ("GiB", 1 << 30), ("MiB", 1 << 20)] {
        if bytes >= factor && bytes.is_multiple_of(factor) {
            return format!("{} {unit}", bytes / factor);
        }
    }
    format!("{bytes} bytes")
}

#[cfg(test)]
mod tests {
    use super::{format_size, oom_kills, oom_notice, parse_size};

    #[test]
    fn reads_sizes_in_binary_units() {
        assert_eq!(parse_size("6G"), Some(6 << 30));
        assert_eq!(parse_size("512m"), Some(512 << 20));
        assert_eq!(parse_size(" 1024 "), Some(1024));
        assert_eq!(parse_size("1.5G"), None);
        assert_eq!(parse_size("x"), None);
        assert_eq!(format_size(6 << 30), "6 GiB");
        assert_eq!(format_size(1500), "1500 bytes");
    }

    #[test]
    fn the_shell_wrapper_joins_the_leaf_and_gives_up_the_oom_exemption() {
        let leaf = super::Leaf {
            path: std::path::PathBuf::from("/sys/fs/cgroup/exeora/term-1"),
            limit: 1,
        };
        let (program, args) = leaf.shell_wrapper("/bin/bash");
        assert_eq!(program, "/bin/sh");
        let script = &args[1];
        assert!(script.contains("echo 0 > \"$1\""));
        assert!(script.contains("echo 0 > /proc/self/oom_score_adj"));
        assert!(script.ends_with("exec \"$2\""));
        assert_eq!(args[3], "/sys/fs/cgroup/exeora/term-1/cgroup.procs");
        assert_eq!(args[4], "/bin/bash");
    }

    #[test]
    fn counts_oom_kills_out_of_memory_events() {
        assert_eq!(oom_kills("low 0\nhigh 0\nmax 12\noom 1\noom_kill 1\n"), 1);
        assert_eq!(oom_kills("low 0\noom_kill 0\n"), 0);
        assert_eq!(oom_kills(""), 0);
        assert!(oom_notice(6 << 30).contains("6 GiB"));
    }
}
