use std::{sync::Arc, time::Instant};
use parking_lot::Mutex;
use tokio::sync::Semaphore;

pub const MAX_CACHED_GAMES: usize = 256;
pub const MAX_STORED_GAMES: u64 = 10_000;

struct Bucket {
    tokens: f64,
    capacity: f64,
    per_second: f64,
    updated: Instant,
}

impl Bucket {
    fn new(capacity: f64, per_second: f64) -> Self {
        Self { tokens: capacity, capacity, per_second, updated: Instant::now() }
    }

    fn take(&mut self) -> bool {
        let now = Instant::now();
        self.tokens = (self.tokens + now.duration_since(self.updated).as_secs_f64() * self.per_second).min(self.capacity);
        self.updated = now;
        if self.tokens < 1.0 { return false; }
        self.tokens -= 1.0;
        true
    }
}

pub struct Limits {
    requests: Mutex<Bucket>,
    creations: Mutex<Bucket>,
    pub analysis_admissions: Arc<Semaphore>,
    pub request_slots: Arc<Semaphore>,
}

impl Limits {
    pub fn new() -> Self {
        Self {
            requests: Mutex::new(Bucket::new(120.0, 20.0)),
            creations: Mutex::new(Bucket::new(20.0, 1.0 / 60.0)),
            // One analysis executing, at most three waiting, including races.
            analysis_admissions: Arc::new(Semaphore::new(4)),
            request_slots: Arc::new(Semaphore::new(4)),
        }
    }

    pub fn allow(&self, creating: bool) -> bool {
        self.requests.lock().take() && (!creating || self.creations.lock().take())
    }
}

pub fn valid_admin_token(value: &str) -> bool {
    value.len() >= 32 && value.len() <= 256
        && !value.to_ascii_lowercase().contains("change-me")
        && !value.to_ascii_lowercase().contains("replace")
}
