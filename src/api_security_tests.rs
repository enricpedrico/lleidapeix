use std::{collections::HashMap, sync::{atomic::AtomicUsize, Arc}, time::Instant};
use axum::{body::{to_bytes, Body}, http::{Request, StatusCode}};
use parking_lot::RwLock;
use tokio::sync::{Barrier, Semaphore};
use tower::ServiceExt;
use crate::{api::{router, AppState}, database::Database, model::{Difficulty, Game, GameMode}, security::Limits};

fn state(token: &str) -> AppState {
    AppState {
        games: Arc::new(RwLock::new(HashMap::new())),
        database: Arc::new(Database::open(":memory:").unwrap()),
        analysis_slots: Arc::new(Semaphore::new(1)),
        analysis_waiters: Arc::new(AtomicUsize::new(0)),
        started: Instant::now(), admin_token: Arc::new(token.into()), limits: Arc::new(Limits::new()),
    }
}

fn post(path: &str, body: &str) -> Request<Body> {
    Request::builder().method("POST").uri(path).header("host", "test.local")
        .header("content-type", "application/json").body(Body::from(body.to_string())).unwrap()
}

#[tokio::test]
async fn rejects_foreign_origins_and_placeholder_admin_tokens() {
    let app = router(state("change-me-with-a-long-random-secret"));
    let mut request = post("/api/games", r#"{"mode":"quick"}"#);
    request.headers_mut().insert("origin", "https://other.example".parse().unwrap());
    assert_eq!(app.clone().oneshot(request).await.unwrap().status(), StatusCode::FORBIDDEN);
    let request = Request::builder().uri("/api/admin/status")
        .header("x-admin-token", "change-me-with-a-long-random-secret").body(Body::empty()).unwrap();
    assert_eq!(app.oneshot(request).await.unwrap().status(), StatusCode::UNAUTHORIZED);
    let token = "b".repeat(64);
    let app = router(state(&token));
    let request = Request::builder().uri("/api/admin/status").header("x-admin-token", &token).body(Body::empty()).unwrap();
    assert_eq!(app.oneshot(request).await.unwrap().status(), StatusCode::OK);
}

#[tokio::test]
async fn throttles_creation_and_preserves_health_checks() {
    let app = router(state(""));
    for _ in 0..20 {
        assert_eq!(app.clone().oneshot(post("/api/games", r#"{"mode":"quick"}"#)).await.unwrap().status(), StatusCode::CREATED);
    }
    assert_eq!(app.clone().oneshot(post("/api/games", r#"{"mode":"quick"}"#)).await.unwrap().status(), StatusCode::TOO_MANY_REQUESTS);
    let response = app.oneshot(Request::builder().uri("/api/health").body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn private_state_is_not_cached_and_hidden_cards_are_not_serialized() {
    let app = router(state(""));
    let response = app.oneshot(post("/api/games", r#"{"mode":"quick"}"#)).await.unwrap();
    assert_eq!(response.headers().get("cache-control").unwrap(), "no-store");
    let bytes = to_bytes(response.into_body(), 65536).await.unwrap();
    let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert!(value.get("seed").is_none());
    assert!(value.get("hands").is_none());
    assert_eq!(value["hand"].as_array().unwrap().len(), 12);
}

#[tokio::test]
async fn rejects_invalid_and_oversized_analysis_without_panicking() {
    let app = router(state(""));
    let invalid = r#"{"actorHand":[0,1],"actorSeat":999,"firstLeader":0,"history":[],"contract":{"kind":"botifarra"}}"#;
    assert_eq!(app.clone().oneshot(post("/api/positions/analyze", invalid)).await.unwrap().status(), StatusCode::BAD_REQUEST);
    let huge = serde_json::json!({"payload": "x".repeat(65 * 1024)}).to_string();
    assert_eq!(app.oneshot(post("/api/games", &huge)).await.unwrap().status(), StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn occupied_engine_rejects_new_analysis_without_starting_more_work() {
    let state = state("");
    let _permit = state.analysis_slots.clone().acquire_owned().await.unwrap();
    let app = router(state);
    let input = serde_json::json!({"actorHand": (0..12).collect::<Vec<u8>>(), "actorSeat":0,"firstLeader":0,"history":[],"contract":{"kind":"botifarra"}}).to_string();
    assert_eq!(app.oneshot(post("/api/positions/analyze", &input)).await.unwrap().status(), StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn simultaneous_analysis_admissions_never_exceed_four() {
    let limits = Arc::new(Limits::new());
    let start = Arc::new(Barrier::new(33));
    let attempted = Arc::new(Barrier::new(33));
    let mut handles = Vec::new();
    for _ in 0..32 {
        let (limits, start, attempted) = (limits.clone(), start.clone(), attempted.clone());
        handles.push(tokio::spawn(async move {
            start.wait().await;
            let permit = limits.analysis_admissions.clone().try_acquire_owned();
            let accepted = permit.is_ok();
            attempted.wait().await;
            drop(permit);
            accepted
        }));
    }
    start.wait().await;
    attempted.wait().await;
    let mut count = 0;
    for handle in handles { if handle.await.unwrap() { count += 1; } }
    assert_eq!(count, 4);
    assert_eq!(limits.analysis_admissions.available_permits(), 4);
}

#[test]
fn storage_capacity_does_not_overwrite_existing_games() {
    let database = Database::open(":memory:").unwrap();
    for i in 0..2 {
        assert!(database.create_game_with_limit(&Game::new(format!("test-{i}"), i, GameMode::Quick, Difficulty::Easy), 2).unwrap());
    }
    assert!(!database.create_game_with_limit(&Game::new("overflow".into(), 5, GameMode::Quick, Difficulty::Easy), 2).unwrap());
    assert_eq!(database.game_count().unwrap(), 2);
    assert!(database.load_game("test-0").unwrap().is_some());
}

#[tokio::test]
async fn cache_eviction_keeps_games_recoverable_from_storage() {
    let state = state("");
    let mut ids = Vec::new();
    for i in 0..=crate::security::MAX_CACHED_GAMES {
        let game = Game::new(format!("cached-{i}"), i as u64, GameMode::Quick, Difficulty::Easy);
        ids.push(game.id.clone());
        state.database.save_game(&game).unwrap();
        crate::api::cache_game(&mut state.games.write(), game);
    }
    assert_eq!(state.games.read().len(), crate::security::MAX_CACHED_GAMES);
    let evicted = ids.into_iter().find(|id| !state.games.read().contains_key(id)).unwrap();
    let request = Request::builder().uri(format!("/api/games/{evicted}")).body(Body::empty()).unwrap();
    assert_eq!(router(state.clone()).oneshot(request).await.unwrap().status(), StatusCode::OK);
    assert_eq!(state.games.read().len(), crate::security::MAX_CACHED_GAMES);
    assert_eq!(state.database.game_count().unwrap(), (crate::security::MAX_CACHED_GAMES + 1) as u64);
}

#[tokio::test]
async fn http_work_is_bounded_without_blocking_health() {
    let state = state("");
    let mut permits = Vec::new();
    for _ in 0..4 { permits.push(state.limits.request_slots.clone().try_acquire_owned().unwrap()); }
    let app = router(state);
    let request = Request::builder().uri("/api/games/unknown").body(Body::empty()).unwrap();
    assert_eq!(app.clone().oneshot(request).await.unwrap().status(), StatusCode::TOO_MANY_REQUESTS);
    let request = Request::builder().uri("/api/health").body(Body::empty()).unwrap();
    assert_eq!(app.oneshot(request).await.unwrap().status(), StatusCode::OK);
    drop(permits);
}
