//! Builds and seals Mergit receipts (format v0). The only implementation of receipt construction:
//! Python reaches it through `runtime/py`, and nothing else may build a receipt.

mod builder;
#[cfg(feature = "forgery-fixture")]
pub mod fixture;

pub use builder::{BuildError, ReceiptBuilder, StepInput};
