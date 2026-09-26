//! Noticing that the machine was frozen.
//!
//! A cloud machine is paused whole, and from inside nothing announces it. What
//! gives it away is time: either the wall clock jumps while the monotonic
//! clock does not, or a ticker that should fire every second finds a long gap
//! since it last ran. Either one past the threshold means the relay socket has
//! been dead for at least that long, and the right move is to reconnect now
//! rather than wait for the heartbeat to time out.

use crate::protocol::{RESUME_GAP_MS, now_ms};
use std::time::Instant;

pub struct ResumeDetector {
    wall_ms: u64,
    mono: Instant,
}

impl Default for ResumeDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl ResumeDetector {
    pub fn new() -> Self {
        Self {
            wall_ms: now_ms(),
            mono: Instant::now(),
        }
    }

    /// Records that the connection was just heard from, so time before this
    /// point no longer counts as a gap.
    pub fn mark(&mut self) {
        self.wall_ms = now_ms();
        self.mono = Instant::now();
    }

    /// How long the machine appears to have been away since the last mark.
    pub fn gap_ms(&self) -> u64 {
        Self::gap(now_ms(), Instant::now(), self.wall_ms, self.mono)
    }

    /// Marks, and reports a gap when it crossed the threshold.
    pub fn check(&mut self) -> Option<u64> {
        let gap = self.gap_ms();
        self.mark();
        (gap > RESUME_GAP_MS).then_some(gap)
    }

    fn gap(wall_now: u64, mono_now: Instant, wall_then: u64, mono_then: Instant) -> u64 {
        let wall_delta = wall_now.saturating_sub(wall_then);
        let mono_delta = mono_now.duration_since(mono_then).as_millis() as u64;
        // A monotonic clock that stopped with the machine shows as wall time
        // the monotonic clock never saw; one that kept counting shows as a
        // long stretch since the last mark. Both are the same pause.
        wall_delta.saturating_sub(mono_delta).max(mono_delta)
    }
}

#[cfg(test)]
mod tests {
    use super::ResumeDetector;
    use std::time::{Duration, Instant};

    #[test]
    fn a_wall_clock_jump_without_monotonic_time_is_a_gap() {
        let then = Instant::now();
        assert_eq!(ResumeDetector::gap(61_000, then, 1_000, then), 60_000);
    }

    #[test]
    fn a_long_stretch_of_monotonic_time_is_a_gap_too() {
        let then = Instant::now() - Duration::from_secs(60);
        assert!(ResumeDetector::gap(61_000, Instant::now(), 1_000, then) >= 60_000);
    }

    #[test]
    fn an_ordinary_tick_is_not() {
        let then = Instant::now() - Duration::from_millis(1_000);
        assert!(ResumeDetector::gap(2_000, Instant::now(), 1_000, then) < 1_100);
        let mut detector = ResumeDetector::new();
        assert_eq!(detector.check(), None);
    }
}
