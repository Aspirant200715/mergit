//! Files under the data directory: `bundles/<body_hash>.json` and `by-task/<task_id>` (holding the body hash).
//! Writes go to a temporary file and are renamed into place, so a reader never sees half a bundle.

use alloy_primitives::B256;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use tokio::sync::Mutex;

pub enum Stored {
    New,
    Same,
    Conflict,
}

pub struct Disk {
    root: PathBuf,
    /// Serialises writes so two uploads for one task cannot both win.
    write: Mutex<()>,
}

impl Disk {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            write: Mutex::new(()),
        }
    }

    fn bundle_path(&self, body_hash: B256) -> PathBuf {
        self.root.join("bundles").join(format!("{body_hash}.json"))
    }

    fn task_path(&self, task: B256) -> PathBuf {
        self.root.join("by-task").join(task.to_string())
    }

    pub async fn store(&self, task: B256, body_hash: B256, json: &[u8]) -> std::io::Result<Stored> {
        let _guard = self.write.lock().await;
        match read(&self.task_path(task)).await? {
            Some(existing) if existing == body_hash.to_string().as_bytes() => {
                return Ok(Stored::Same);
            }
            Some(_) => return Ok(Stored::Conflict),
            None => {}
        }
        atomic_write(&self.bundle_path(body_hash), json).await?;
        atomic_write(&self.task_path(task), body_hash.to_string().as_bytes()).await?;
        Ok(Stored::New)
    }

    pub async fn bundle(&self, body_hash: B256) -> std::io::Result<Option<Vec<u8>>> {
        read(&self.bundle_path(body_hash)).await
    }

    pub async fn bundle_for_task(&self, task: B256) -> std::io::Result<Option<Vec<u8>>> {
        match read(&self.task_path(task)).await? {
            Some(h) => {
                let h: B256 = String::from_utf8_lossy(&h)
                    .parse()
                    .map_err(|_| std::io::Error::other("corrupt task index"))?;
                self.bundle(h).await
            }
            None => Ok(None),
        }
    }
}

async fn read(p: &Path) -> std::io::Result<Option<Vec<u8>>> {
    match tokio::fs::read(p).await {
        Ok(b) => Ok(Some(b)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

async fn atomic_write(p: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let dir = p.parent().expect("store paths have a parent");
    tokio::fs::create_dir_all(dir).await?;
    let tmp = p.with_extension("tmp");
    tokio::fs::write(&tmp, bytes).await?;
    tokio::fs::rename(&tmp, p).await
}
