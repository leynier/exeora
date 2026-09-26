//! Keeping the machine awake exactly while it has something to do.
//!
//! A Sprite pauses when no request has reached it for a while; nothing the CLI
//! does from inside counts, except registering a task with the runtime. So
//! the CLI holds a task while it has work (a call in flight, a process it
//! started, a terminal someone left open) and refreshes it as work keeps
//! arriving. When the work stops, the task is left to expire, and the machine
//! goes to sleep on its own a few minutes later. It is never deleted by hand:
//! a restart for an upgrade must not put the machine to sleep halfway through.

use super::sprite::SpriteApi;
use crate::protocol::{KEEPALIVE_EXPIRE, KEEPALIVE_MIN_INTERVAL_MS, KEEPALIVE_TASK};
use std::{future::Future, pin::Pin, sync::Arc, time::Duration};
use tokio::sync::{Mutex, Notify};

/// How long a failure to refresh stays quiet before it is reported again.
const FAILURE_REPORT_INTERVAL: Duration = Duration::from_secs(300);

pub type Busy = Arc<dyn Fn() -> Pin<Box<dyn Future<Output = bool> + Send>> + Send + Sync>;

pub struct Keepalive {
    api: SpriteApi,
    notify: Notify,
    last_refresh: Mutex<Option<tokio::time::Instant>>,
    last_failure_report: Mutex<Option<tokio::time::Instant>>,
}

impl Keepalive {
    pub fn new(api: SpriteApi) -> Arc<Self> {
        Arc::new(Self {
            api,
            notify: Notify::new(),
            last_refresh: Mutex::new(None),
            last_failure_report: Mutex::new(None),
        })
    }

    /// Something just arrived that means work. Never blocks the caller: the
    /// refresh itself happens on the keepalive task.
    pub fn touch(&self) {
        self.notify.notify_one();
    }

    /// Runs until the process ends: refreshes on every touch and, while the
    /// machine is busy, on a timer, each at most once per interval.
    pub async fn run(self: Arc<Self>, busy: Busy, report: impl Fn(bool, Option<String>)) {
        let mut tick = tokio::time::interval(Duration::from_millis(KEEPALIVE_MIN_INTERVAL_MS));
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                _ = self.notify.notified() => self.refresh_if_due(&report).await,
                _ = tick.tick() => {
                    if busy().await {
                        self.refresh_if_due(&report).await;
                    }
                }
            }
        }
    }

    async fn refresh_if_due(&self, report: &impl Fn(bool, Option<String>)) {
        let mut last = self.last_refresh.lock().await;
        if last.is_some_and(|at| at.elapsed() < Duration::from_millis(KEEPALIVE_MIN_INTERVAL_MS)) {
            return;
        }
        match self.api.put_task(KEEPALIVE_TASK, KEEPALIVE_EXPIRE).await {
            Ok(_) => {
                *last = Some(tokio::time::Instant::now());
                let mut failed = self.last_failure_report.lock().await;
                if failed.take().is_some() {
                    report(true, None);
                }
            }
            Err(error) => {
                let mut failed = self.last_failure_report.lock().await;
                if failed.is_none_or(|at| at.elapsed() >= FAILURE_REPORT_INTERVAL) {
                    *failed = Some(tokio::time::Instant::now());
                    report(false, Some(error.to_string()));
                }
            }
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::{Busy, Keepalive};
    use crate::cloud::sprite::SpriteApi;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// A runtime socket that counts task refreshes.
    fn fake_runtime() -> (std::path::PathBuf, Arc<AtomicUsize>, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("api.sock");
        let listener = tokio::net::UnixListener::bind(&path).unwrap();
        let count = Arc::new(AtomicUsize::new(0));
        let counter = count.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener.accept().await else {
                    break;
                };
                let mut buffer = vec![0_u8; 4096];
                let _ = stream.read(&mut buffer).await;
                counter.fetch_add(1, Ordering::SeqCst);
                let _ = stream
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}",
                    )
                    .await;
            }
        });
        (path, count, dir)
    }

    #[tokio::test]
    async fn touches_within_the_interval_cost_one_refresh() {
        let (path, count, _dir) = fake_runtime();
        let keepalive = Keepalive::new(SpriteApi::new(path));
        let idle: Busy = Arc::new(|| Box::pin(async { false }));
        let runner = tokio::spawn(keepalive.clone().run(idle, |_, _| {}));

        keepalive.touch();
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        keepalive.touch();
        keepalive.touch();
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        assert_eq!(count.load(Ordering::SeqCst), 1);
        runner.abort();
    }
}
