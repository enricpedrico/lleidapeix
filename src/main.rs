mod api;
mod database;
mod engine;
mod game;
mod model;
mod rules;
mod security;
#[cfg(test)]
mod api_security_tests;
#[cfg(test)]
mod rules_audit;

use std::{
    collections::HashMap,
    env,
    sync::{atomic::AtomicUsize, Arc},
    time::Instant,
};

use api::AppState;
use database::Database;
use parking_lot::RwLock;
use tokio::{net::TcpListener, sync::Semaphore};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "lleidapeix=info,tower_http=info".into()),
        )
        .init();

    let port = env::var("PORT").unwrap_or_else(|_| "3085".into());
    let database_path =
        env::var("DATABASE_PATH").unwrap_or_else(|_| "data/lleidapeix.sqlite".into());
    let database = Arc::new(Database::open(&database_path).expect("cannot open database"));
    let arguments = env::args().collect::<Vec<_>>();
    if arguments.get(1).map(String::as_str) == Some("backup") {
        let destination = arguments
            .get(2)
            .expect("backup requires a destination path");
        database
            .backup_to(destination)
            .expect("database backup failed");
        println!("Backup consistent creat a {destination}");
        return;
    }
    let cutoff = chrono::Utc::now().timestamp() - 30 * 24 * 60 * 60;
    if let Err(error) = database.prune_old_games(cutoff) {
        tracing::warn!(%error, "could not prune old games");
    }

    let state = AppState {
        games: Arc::new(RwLock::new(HashMap::new())),
        database,
        analysis_slots: Arc::new(Semaphore::new(1)),
        analysis_waiters: Arc::new(AtomicUsize::new(0)),
        started: Instant::now(),
        admin_token: Arc::new(env::var("ADMIN_TOKEN").unwrap_or_default()),
        limits: Arc::new(security::Limits::new()),
    };
    let app = api::router(state);
    let bind_address = env::var("BIND_ADDRESS").unwrap_or_else(|_| "127.0.0.1".into());
    let listener = TcpListener::bind(format!("{bind_address}:{port}"))
        .await
        .expect("cannot bind HTTP listener");
    tracing::info!(port = %port, "LleidaPeix ready");
    axum::serve(listener, app)
        .await
        .expect("HTTP server failed");
}
