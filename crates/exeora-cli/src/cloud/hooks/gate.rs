//! What holds a command back while a script of the project is running.
//!
//! The scripts make the checkout ready: dependencies, a database, whatever a
//! sleep took away. A command that arrives in the middle of one would run in
//! a checkout that is half made, so it waits. It does not wait for ever: the
//! client behind it gives up after about a minute, and an install is allowed
//! twenty. Past the bound the command goes ahead and the script goes on
//! beside it.
//!
//! Only what starts something waits: a command, a call to a proxied tool, a
//! terminal. Reading a file or asking git for a status tells the truth about
//! a checkout in any state, so those never come here.

use crate::protocol::{CLOUD_HOOK_GATE_MARGIN_MS, CLOUD_HOOK_GATE_MS};
use std::{sync::Arc, time::Duration};
use tokio::sync::watch;

/// Counts the scripts that are running or about to. Open at zero.
#[derive(Clone)]
pub struct Gate {
    held: Arc<watch::Sender<usize>>,
}

impl Default for Gate {
    fn default() -> Self {
        Self::new()
    }
}

impl Gate {
    pub fn new() -> Self {
        let (held, _) = watch::channel(0);
        Self {
            held: Arc::new(held),
        }
    }

    /// Closes the gate until what is returned is dropped. Taken when a run
    /// is decided on, before the script starts, so a command that arrives in
    /// between finds the gate already closed.
    pub fn hold(&self) -> Hold {
        self.held.send_modify(|held| *held += 1);
        Hold {
            held: self.held.clone(),
        }
    }

    pub fn is_closed(&self) -> bool {
        *self.held.borrow() > 0
    }

    /// Waits for the gate to open, for `bound` at most. Answers whether it
    /// opened; the caller goes ahead either way.
    pub async fn wait(&self, bound: Duration) -> bool {
        let mut held = self.held.subscribe();
        tokio::time::timeout(bound, held.wait_for(|held| *held == 0))
            .await
            .is_ok_and(|opened| opened.is_ok())
    }
}

pub struct Hold {
    held: Arc<watch::Sender<usize>>,
}

impl Drop for Hold {
    fn drop(&mut self) {
        self.held.send_modify(|held| *held = held.saturating_sub(1));
    }
}

/// How long a call may wait at the gate: the shared bound, or what is left
/// before the call's own deadline less a margin for the call itself,
/// whichever is shorter. A call already that close to its deadline does not
/// wait at all.
pub fn bound(expires_at: Option<u64>, now: u64) -> Duration {
    let own = expires_at.map_or(CLOUD_HOOK_GATE_MS, |expires_at| {
        expires_at
            .saturating_sub(now)
            .saturating_sub(CLOUD_HOOK_GATE_MARGIN_MS)
    });
    Duration::from_millis(own.min(CLOUD_HOOK_GATE_MS))
}

#[cfg(test)]
mod tests {
    use super::{Gate, bound};
    use std::time::{Duration, Instant};

    #[tokio::test]
    async fn an_open_gate_holds_nobody() {
        let gate = Gate::new();
        assert!(!gate.is_closed());
        let started = Instant::now();
        assert!(gate.wait(Duration::from_secs(30)).await);
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[tokio::test]
    async fn opens_when_the_script_finishes() {
        let gate = Gate::new();
        let hold = gate.hold();
        assert!(gate.is_closed());
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            drop(hold);
        });
        let started = Instant::now();
        assert!(gate.wait(Duration::from_secs(30)).await);
        let waited = started.elapsed();
        assert!(waited >= Duration::from_millis(90), "waited {waited:?}");
        assert!(waited < Duration::from_secs(5), "waited {waited:?}");
        assert!(!gate.is_closed());
    }

    #[tokio::test]
    async fn opens_at_the_bound_when_the_script_does_not_finish() {
        let gate = Gate::new();
        let _hold = gate.hold();
        let started = Instant::now();
        assert!(!gate.wait(Duration::from_millis(150)).await);
        let waited = started.elapsed();
        assert!(waited >= Duration::from_millis(150), "waited {waited:?}");
        assert!(waited < Duration::from_secs(5), "waited {waited:?}");
        // The script is still running: the gate stays closed for the next.
        assert!(gate.is_closed());
    }

    #[tokio::test]
    async fn stays_closed_until_the_last_script_is_over() {
        let gate = Gate::new();
        let install = gate.hold();
        let resume = gate.hold();
        drop(install);
        assert!(gate.is_closed());
        assert!(!gate.wait(Duration::from_millis(50)).await);
        drop(resume);
        assert!(gate.wait(Duration::from_millis(50)).await);
    }

    #[test]
    fn the_bound_is_the_shorter_of_the_shared_one_and_the_call_s_own() {
        let now = 1_000_000;
        assert_eq!(bound(None, now), Duration::from_secs(30));
        // A call the relay gives five minutes waits the shared thirty seconds.
        assert_eq!(bound(Some(now + 310_000), now), Duration::from_secs(30));
        // One with twenty seconds left waits fifteen and keeps five.
        assert_eq!(bound(Some(now + 20_000), now), Duration::from_secs(15));
        // One with less than the margin left does not wait.
        assert_eq!(bound(Some(now + 4_000), now), Duration::ZERO);
        assert_eq!(bound(Some(now - 1), now), Duration::ZERO);
    }
}
