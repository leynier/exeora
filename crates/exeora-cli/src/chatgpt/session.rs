use std::time::Duration;

use anyhow::{Result, bail};
use tokio_util::sync::CancellationToken;

use super::{ChatgptService, store::Store};

pub(crate) type Revision = (Option<String>, Option<String>);

pub(crate) fn ensure_current(store: &Store, expected: &Revision) -> Result<()> {
    if revision(store)? != *expected {
        bail!("The ChatGPT request was interrupted.");
    }
    Ok(())
}

pub(crate) fn revision(store: &Store) -> Result<Revision> {
    Ok((store.active_revision()?, store.logout_revision()?))
}

pub(crate) async fn superseded(store: &Store, expected: &(Option<String>, Option<String>)) {
    loop {
        if revision(store).as_ref().ok() != Some(expected) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

pub(crate) async fn changed(
    service: &ChatgptService,
    expected: &(Option<String>, Option<String>),
    cancellation: &CancellationToken,
) {
    loop {
        if revision(&service.store).as_ref().ok() != Some(expected) {
            return;
        }
        tokio::select! {
            _ = cancellation.cancelled() => return,
            _ = tokio::time::sleep(Duration::from_millis(100)) => {}
        }
    }
}
