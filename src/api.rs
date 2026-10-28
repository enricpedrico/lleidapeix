use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Instant,
};

use axum::{
    body::Body,
    extract::{
        ws::{close_code, CloseFrame, Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    http::{header, HeaderMap, Method, Request, StatusCode, Uri},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tower_http::{
    limit::RequestBodyLimitLayer,
    services::{ServeDir, ServeFile},
    trace::TraceLayer,
};
use uuid::Uuid;

use crate::{
    security::{Limits, MAX_CACHED_GAMES, MAX_STORED_GAMES, valid_admin_token},
    database::Database,
    engine::{choose_move, has_compatible_world, Analyzer, InformationSet},
    game::GameError,
    model::{
        team_of, Card, CompletedTrick, Contract, Difficulty, DoublingDecision, Game, GameMode,
        Phase, PlayedCard, PublicGameState, Seat,
    },
    rules::{trick_points, winning_play},
};

#[derive(Clone)]
pub struct AppState {
    pub games: Arc<RwLock<HashMap<String, Game>>>,
    pub database: Arc<Database>,
    pub analysis_slots: Arc<Semaphore>,
    pub analysis_waiters: Arc<AtomicUsize>,
    pub started: Instant,
    pub admin_token: Arc<String>,
    pub limits: Arc<Limits>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiError {
    error: String,
    current: Option<Box<PublicGameState>>,
}

type ApiResult<T> = Result<T, (StatusCode, Json<ApiError>)>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGameRequest {
    mode: GameMode,
    #[serde(default = "strong_difficulty")]
    difficulty: Difficulty,
    initial_dealer: Option<Seat>,
    seed: Option<u64>,
}

const fn strong_difficulty() -> Difficulty {
    Difficulty::Strong
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractRequest {
    version: u64,
    idempotency_key: String,
    contract: Option<Contract>,
    delegate: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayRequest {
    version: u64,
    idempotency_key: String,
    card_id: u8,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoublingRequest {
    version: u64,
    idempotency_key: String,
    raise: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvanceRequest {
    version: u64,
    idempotency_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NextHandRequest {
    version: u64,
    idempotency_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisQuery {
    budget_ms: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionAnalysisRequest {
    #[serde(default, alias = "hand")]
    actor_hand: Vec<u8>,
    #[serde(default)]
    actor_seat: Seat,
    #[serde(default)]
    first_leader: Seat,
    #[serde(default)]
    history: Vec<PositionHistoryPlay>,
    contract: Contract,
    budget_ms: Option<u64>,
    seed: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionHistoryPlay {
    seat: Seat,
    card_id: u8,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
    uptime_seconds: u64,
}

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/health", get(health))
        .route("/games", post(create_game))
        .route("/games/{id}", get(get_game))
        .route("/games/{id}/contract", post(set_contract))
        .route("/games/{id}/doubling", post(respond_doubling))
        .route("/games/{id}/play", post(play_card))
        .route("/games/{id}/advance", post(advance_game))
        .route("/games/{id}/next", post(next_hand))
        .route("/games/{id}/analysis", get(analysis_socket))
        .route("/positions/analyze", post(analyze_position))
        .route("/admin/status", get(admin_status));

    Router::new()
        .nest("/api", api)
        .fallback_service(
            ServeDir::new("web-dist")
                .append_index_html_on_directories(true)
                .not_found_service(ServeFile::new("web-dist/index.html")),
        )
        .layer(RequestBodyLimitLayer::new(64 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(), security_headers))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn security_headers(State(state): State<AppState>, request: Request<Body>, next: Next) -> Response {
    let path = request.uri().path();
    let api = path.starts_with("/api/");
    let mut response = if api && !allowed_origin(request.headers()) {
        api_error(StatusCode::FORBIDDEN, "Origen no permès", None).into_response()
    } else if api && path != "/api/health" && !state.limits.allow(request.method() == Method::POST && path == "/api/games") {
        api_error(StatusCode::TOO_MANY_REQUESTS, "Massa peticions; torna-ho a provar més tard", None).into_response()
    } else {
        let guarded = api && path != "/api/health";
        let slot = if guarded { state.limits.request_slots.clone().try_acquire_owned().ok() } else { None };
        if guarded && slot.is_none() {
            api_error(StatusCode::TOO_MANY_REQUESTS, "Servidor ocupat; torna-ho a provar més tard", None).into_response()
        } else {
            let _slot = slot;
            next.run(request).await
        }
    };
    let headers = response.headers_mut();
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());
    headers.insert(header::X_FRAME_OPTIONS, "DENY".parse().unwrap());
    headers.insert(header::REFERRER_POLICY, "no-referrer".parse().unwrap());
    if api { headers.insert(header::CACHE_CONTROL, "no-store".parse().unwrap()); }
    response
}

fn allowed_origin(headers: &HeaderMap) -> bool {
    let Some(origin) = headers.get(header::ORIGIN) else { return true; };
    let Ok(origin) = origin.to_str() else { return false; };
    let Ok(uri) = origin.parse::<Uri>() else { return false; };
    if !matches!(uri.scheme_str(), Some("http" | "https")) || uri.path() != "/" || uri.query().is_some() {
        return false;
    }
    let Some(authority) = uri.authority() else { return false; };
    headers.get(header::HOST).and_then(|v| v.to_str().ok())
        .is_some_and(|host| authority.as_str().eq_ignore_ascii_case(host))
}

pub(crate) fn cache_game(games: &mut HashMap<String, Game>, game: Game) {
    if !games.contains_key(&game.id) && games.len() >= MAX_CACHED_GAMES {
        if let Some(oldest) = games.iter().min_by_key(|(_, game)| game.updated_at).map(|(id, _)| id.clone()) {
            games.remove(&oldest);
        }
    }
    games.insert(game.id.clone(), game);
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
        uptime_seconds: state.started.elapsed().as_secs(),
    })
}

async fn create_game(
    State(state): State<AppState>,
    Json(request): Json<CreateGameRequest>,
) -> ApiResult<(StatusCode, Json<PublicGameState>)> {
    let seed = request.seed.unwrap_or_else(rand::random);
    let dealer = request.initial_dealer.unwrap_or(0);
    if dealer >= 4 {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "El repartidor inicial no és vàlid",
            None,
        ));
    }
    let id = Uuid::new_v4().simple().to_string();
    let mut game = if dealer == 0 {
        Game::new(id.clone(), seed, request.mode, request.difficulty)
    } else {
        Game::new_with_dealer(id.clone(), seed, request.mode, request.difficulty, dealer)
    };
    auto_progress(&mut game);
    let public = game.public_state();
    if !state.database.create_game_with_limit(&game, MAX_STORED_GAMES).map_err(internal_error)? {
        return Err(api_error(StatusCode::SERVICE_UNAVAILABLE, "Capacitat de partides assolida; torna-ho a provar més tard", None));
    }
    cache_game(&mut state.games.write(), game);
    Ok((StatusCode::CREATED, Json(public)))
}

async fn get_game(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> ApiResult<Json<PublicGameState>> {
    let game = load_game(&state, &id)?;
    Ok(Json(game.public_state()))
}

async fn set_contract(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<ContractRequest>,
) -> ApiResult<Json<PublicGameState>> {
    mutate_game(
        &state,
        &id,
        request.version,
        &request.idempotency_key,
        |game| game.choose_contract(request.contract, request.delegate),
    )
}

async fn play_card(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<PlayRequest>,
) -> ApiResult<Json<PublicGameState>> {
    mutate_game(
        &state,
        &id,
        request.version,
        &request.idempotency_key,
        |game| game.play(game.human_seat, request.card_id),
    )
}

async fn respond_doubling(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<DoublingRequest>,
) -> ApiResult<Json<PublicGameState>> {
    mutate_game(
        &state,
        &id,
        request.version,
        &request.idempotency_key,
        |game| {
            game.respond_doubling(
                game.human_seat,
                if request.raise {
                    DoublingDecision::Raise
                } else {
                    DoublingDecision::Pass
                },
            )
        },
    )
}

async fn advance_game(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<AdvanceRequest>,
) -> ApiResult<Json<PublicGameState>> {
    mutate_game(
        &state,
        &id,
        request.version,
        &request.idempotency_key,
        advance_one_ai_action,
    )
}

async fn next_hand(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<NextHandRequest>,
) -> ApiResult<Json<PublicGameState>> {
    mutate_game(
        &state,
        &id,
        request.version,
        &request.idempotency_key,
        |game| game.next_hand(),
    )
}

fn mutate_game<F>(
    state: &AppState,
    id: &str,
    version: u64,
    idempotency_key: &str,
    mutation: F,
) -> ApiResult<Json<PublicGameState>>
where
    F: FnOnce(&mut Game) -> Result<(), GameError>,
{
    if idempotency_key.len() < 8 || idempotency_key.len() > 100 {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "Clau d’idempotència no vàlida",
            None,
        ));
    }
    let mut games = state.games.write();
    if !games.contains_key(id) {
        if let Some(game) = state.database.load_game(id).map_err(internal_error)? {
            cache_game(&mut games, game);
        }
    }
    let game = games.get_mut(id).ok_or_else(not_found)?;
    if game.is_duplicate(idempotency_key) {
        return Ok(Json(game.public_state()));
    }
    if game.version != version {
        return Err(api_error(
            StatusCode::CONFLICT,
            "La partida ha canviat; s’ha retornat l’estat actual",
            Some(game.public_state()),
        ));
    }
    // Publish the new state only after durable storage accepts the action.
    let mut next = game.clone();
    mutation(&mut next).map_err(|error| {
        api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            &error.to_string(),
            Some(game.public_state()),
        )
    })?;
    next.remember_key(idempotency_key.to_string());
    auto_progress(&mut next);
    state.database.save_game(&next).map_err(internal_error)?;
    *game = next;
    Ok(Json(game.public_state()))
}

fn auto_progress(game: &mut Game) {
    for _ in 0..12 {
        let result = match game.phase {
            Phase::Bidding if game.dealer != game.human_seat => {
                game.choose_ai_contract_if_needed()
            }
            Phase::Doubling if game.current_player != game.human_seat => {
                game.choose_ai_doubling_if_needed()
            }
            _ => break,
        };
        if result.is_err() {
            break;
        }
    }
}

fn advance_one_ai_action(game: &mut Game) -> Result<(), GameError> {
    if game.current_player == game.human_seat {
        return Err(GameError::HumanDecisionRequired);
    }
    match game.phase {
        Phase::Bidding => game.choose_ai_contract_if_needed(),
        Phase::Doubling => game.choose_ai_doubling_if_needed(),
        Phase::Playing => {
            let seat = game.current_player;
            let iterations = match game.difficulty {
                Difficulty::Easy => 40,
                Difficulty::Medium => 120,
                Difficulty::Strong => 320,
            };
            let card = choose_move(game, seat, iterations).or_else(|| {
                let contract = game.contract?;
                crate::rules::legal_cards(
                    &game.hands[seat],
                    &game.current_trick,
                    contract,
                    seat,
                )
                .first()
                .copied()
            });
            let card = card.ok_or(GameError::NoAutomaticAction)?;
            game.play(seat, card.id)
        }
        Phase::HandOver | Phase::MatchOver => Err(GameError::NoAutomaticAction),
    }
}

async fn analysis_socket(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<AnalysisQuery>,
) -> ApiResult<impl IntoResponse> {
    let admission = state.limits.analysis_admissions.clone().try_acquire_owned()
        .map_err(|_| api_error(StatusCode::TOO_MANY_REQUESTS, "La cua del motor és plena", None))?;
    let game = load_game(&state, &id)?;
    if !game.public_state().can_analyze {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Només es pot analitzar quan és el teu torn",
            Some(game.public_state()),
        ));
    }
    let budget = query.budget_ms.unwrap_or(1500).clamp(150, 10_000);
    let analysis_id = Uuid::new_v4().simple().to_string();
    Ok(ws.max_message_size(1024).max_frame_size(1024).on_upgrade(move |socket| async move {
        let _admission = admission;
        run_analysis_socket(socket, state, game, budget, analysis_id).await;
    }))
}

struct AnalysisWaiter(Arc<AtomicUsize>);

impl Drop for AnalysisWaiter {
    fn drop(&mut self) { self.0.fetch_sub(1, Ordering::SeqCst); }
}

async fn run_analysis_socket(
    mut socket: WebSocket,
    state: AppState,
    game: Game,
    budget_ms: u64,
    analysis_id: String,
) {
    if let Ok(permit) = state.analysis_slots.clone().try_acquire_owned() {
        run_analysis_with_permit(socket, game, budget_ms, analysis_id, 0, permit).await;
        return;
    }
    if state.analysis_waiters.fetch_add(1, Ordering::SeqCst) >= 3 {
        state.analysis_waiters.fetch_sub(1, Ordering::SeqCst);
        let busy = serde_json::json!({"analysisId": analysis_id, "sequence": 1,
            "status": "error", "terminalReason": "busy", "message": "La cua del motor és plena."});
        let _ = socket.send(Message::Text(busy.to_string().into())).await;
        return;
    }
    let waiter = AnalysisWaiter(state.analysis_waiters.clone());
    let queued = serde_json::json!({"analysisId": analysis_id, "sequence": 1,
        "status": "queued", "message": "Motor ocupat; ets a la cua."});
    if socket.send(Message::Text(queued.to_string().into())).await.is_err() { return; }
    let acquire = state.analysis_slots.clone().acquire_owned();
    tokio::pin!(acquire);
    let permit = loop {
        tokio::select! {
            permit = &mut acquire => break permit,
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Ping(_) | Message::Pong(_))) => {},
                _ => return,
            }
        }
    };
    drop(waiter);
    if let Ok(permit) = permit {
        run_analysis_with_permit(socket, game, budget_ms, analysis_id, 1, permit).await;
    }
}

async fn run_analysis_with_permit(
    mut socket: WebSocket,
    game: Game,
    budget_ms: u64,
    analysis_id: String,
    mut sequence: u64,
    mut permit: OwnedSemaphorePermit,
) {
    let Some(info) = InformationSet::from_game(&game, game.human_seat) else {
        let failure = serde_json::json!({
            "analysisId": analysis_id,
            "sequence": sequence + 1,
            "status": "error",
            "terminalReason": "invalidPosition",
            "message": "La posició no es pot analitzar."
        });
        let _ = socket.send(Message::Text(failure.to_string().into())).await;
        let _ = socket
            .send(Message::Close(Some(CloseFrame {
                code: close_code::ERROR,
                reason: "invalid-position".into(),
            })))
            .await;
        return;
    };
    let mut analyzer = Analyzer::new(info);
    let start = Instant::now();
    loop {
        let mut work = tokio::task::spawn_blocking(move || {
            analyzer.step(180);
            let update = analyzer.update("analyzing");
            (analyzer, update, permit)
        });
        let result = loop {
            tokio::select! {
                result = &mut work => break result,
                incoming = socket.recv() => match incoming {
                    Some(Ok(Message::Ping(_) | Message::Pong(_))) => {},
                    // The blocking task retains its permit until this batch exits.
                    _ => return,
                }
            }
        };
        let Ok((returned, mut update, returned_permit)) = result else {
            sequence += 1;
            let failure = serde_json::json!({
                "analysisId": analysis_id,
                "sequence": sequence,
                "status": "error",
                "terminalReason": "engineError",
                "message": "El motor no ha pogut completar l’anàlisi."
            });
            let _ = socket.send(Message::Text(failure.to_string().into())).await;
            let _ = socket
                .send(Message::Close(Some(CloseFrame {
                    code: close_code::ERROR,
                    reason: "engine-error".into(),
                })))
                .await;
            return;
        };
        analyzer = returned;
        permit = returned_permit;
        let done = start.elapsed().as_millis() as u64 >= budget_ms;
        sequence += 1;
        update.analysis_id.clone_from(&analysis_id);
        update.sequence = sequence;
        if done {
            update.status = "complete".into();
            update.terminal_reason = Some("completed".into());
            update.message = Some("Anàlisi completada.".into());
        }
        let Ok(json) = serde_json::to_string(&update) else {
            return;
        };
        if !matches!(tokio::time::timeout(std::time::Duration::from_secs(2), socket.send(Message::Text(json.into()))).await, Ok(Ok(()))) {
            return;
        }
        if done {
            let _ = socket
                .send(Message::Close(Some(CloseFrame {
                    code: close_code::NORMAL,
                    reason: "analysis-complete".into(),
                })))
                .await;
            return;
        }
        tokio::task::yield_now().await;
    }
}

async fn analyze_position(
    State(state): State<AppState>,
    Json(request): Json<PositionAnalysisRequest>,
) -> ApiResult<Json<crate::model::AnalysisUpdate>> {
    let budget = request.budget_ms.unwrap_or(500).clamp(100, 3000);
    let mut info = build_position_information(&request)?;
    info.seed = request.seed.unwrap_or(73);
    let _permit = state
        .analysis_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| {
            api_error(
                StatusCode::TOO_MANY_REQUESTS,
                "El motor està ocupat; torna-ho a provar en uns instants",
                None,
            )
        })?;
    let mut update = tokio::task::spawn_blocking(move || {
        // Retain the slot until the actual CPU task exits, even if its HTTP client disconnects.
        let _permit = _permit;
        if !has_compatible_world(&info) {
            return Err(api_error(StatusCode::UNPROCESSABLE_ENTITY, "No existeix cap repartiment compatible amb aquesta mà i l’historial", None));
        }
        let mut analyzer = Analyzer::new(info);
        let iterations = (budget as usize * 2).clamp(200, 6000);
        analyzer.step(iterations);
        Ok(analyzer.update("complete"))
    })
    .await
    .map_err(internal_error)??;
    update.analysis_id = Uuid::new_v4().simple().to_string();
    update.sequence = 1;
    update.terminal_reason = Some("completed".into());
    update.message = Some("Anàlisi completada.".into());
    Ok(Json(update))
}

fn build_position_information(request: &PositionAnalysisRequest) -> ApiResult<InformationSet> {
    if request.actor_seat >= 4 || request.first_leader >= 4 {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "El seient seleccionat no és vàlid",
            None,
        ));
    }
    if request.actor_hand.is_empty() || request.actor_hand.len() > 12 {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "La mà actual ha de contenir entre 1 i 12 cartes",
            None,
        ));
    }

    let deck = Card::deck();
    let mut seen = HashSet::new();
    let mut actor_hand = Vec::with_capacity(request.actor_hand.len());
    for id in &request.actor_hand {
        if *id >= 48 || !seen.insert(*id) {
            return Err(api_error(
                StatusCode::BAD_REQUEST,
                "La mà conté cartes repetides o desconegudes",
                None,
            ));
        }
        actor_hand.push(deck[*id as usize]);
    }

    let mut history = Vec::with_capacity(request.history.len());
    let mut played_counts = [0usize; 4];
    let mut expected_seat = request.first_leader;
    let mut current_trick = Vec::new();
    let mut completed_tricks = Vec::new();
    let mut team_points = [0u16; 2];
    let mut void_suits = [[false; 4]; 4];

    for entry in &request.history {
        if entry.seat >= 4 || entry.card_id >= 48 || !seen.insert(entry.card_id) {
            return Err(api_error(
                StatusCode::BAD_REQUEST,
                "L’historial conté una carta o un seient repetit o desconegut",
                None,
            ));
        }
        if entry.seat != expected_seat {
            return Err(api_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "L’ordre dels torns de l’historial no és possible",
                None,
            ));
        }
        played_counts[entry.seat] += 1;
        if played_counts[entry.seat] > 12 {
            return Err(api_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Un participant ha jugat més de dotze cartes",
                None,
            ));
        }
        let card = deck[entry.card_id as usize];
        if let Some(lead) = current_trick.first().map(|play: &PlayedCard| play.card.suit) {
            if card.suit != lead {
                void_suits[entry.seat][lead.index()] = true;
            }
        }
        let play = PlayedCard {
            seat: entry.seat,
            card,
        };
        current_trick.push(play);
        history.push(play);

        if current_trick.len() == 4 {
            let winner = winning_play(&current_trick, request.contract)
                .expect("a complete trick always has a winner");
            let points = trick_points(&current_trick);
            team_points[team_of(winner.seat)] += points as u16;
            completed_tricks.push(CompletedTrick {
                leader: current_trick[0].seat,
                winner: winner.seat,
                cards: current_trick.clone(),
                points,
            });
            current_trick.clear();
            expected_seat = winner.seat;
        } else {
            expected_seat = (entry.seat + 1) % 4;
        }
    }

    let hand_counts = std::array::from_fn(|seat| 12usize.saturating_sub(played_counts[seat]));
    if hand_counts[request.actor_seat] != actor_hand.len() {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "La quantitat de cartes de la mà no concorda amb l’historial",
            None,
        ));
    }
    if expected_seat != request.actor_seat {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "La posició no correspon al torn del participant analitzat",
            None,
        ));
    }

    let info = InformationSet {
        actor: request.actor_seat,
        actor_hand,
        hand_counts,
        first_leader: request.first_leader,
        history,
        current_player: expected_seat,
        current_trick,
        completed_tricks,
        team_points,
        contract: request.contract,
        void_suits,
        seed: 0,
    };
    if info.legal_moves().is_empty() {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "La posició no conté cap jugada legal",
            None,
        ));
    }
    Ok(info)
}

async fn admin_status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<serde_json::Value>> {
    let supplied = headers
        .get("x-admin-token")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !valid_admin_token(&state.admin_token)
        || !constant_time_eq(supplied.as_bytes(), state.admin_token.as_bytes())
    {
        return Err(api_error(
            StatusCode::UNAUTHORIZED,
            "Credencial administrativa incorrecta",
            None,
        ));
    }
    Ok(Json(serde_json::json!({
        "status": "ok",
        "uptimeSeconds": state.started.elapsed().as_secs(),
        "games": state.database.game_count().map_err(internal_error)?,
        "analysisBusy": state.analysis_slots.available_permits() == 0,
        "analysisQueue": state.analysis_waiters.load(Ordering::Relaxed),
        "engine": "LleidaPeix Monte Carlo IS + final exacte 0.2"
    })))
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

fn load_game(state: &AppState, id: &str) -> ApiResult<Game> {
    if let Some(game) = state.games.read().get(id).cloned() {
        return Ok(game);
    }
    let game = state
        .database
        .load_game(id)
        .map_err(internal_error)?
        .ok_or_else(not_found)?;
    cache_game(&mut state.games.write(), game.clone());
    Ok(game)
}

fn not_found() -> (StatusCode, Json<ApiError>) {
    api_error(StatusCode::NOT_FOUND, "Partida no trobada o caducada", None)
}

fn internal_error(error: impl ToString) -> (StatusCode, Json<ApiError>) {
    tracing::error!(error = %error.to_string(), "internal API error");
    api_error(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Error intern del servidor",
        None,
    )
}

fn api_error(
    status: StatusCode,
    message: &str,
    current: Option<PublicGameState>,
) -> (StatusCode, Json<ApiError>) {
    (
        status,
        Json(ApiError {
            error: message.to_string(),
            current: current.map(Box::new),
        }),
    )
}

#[cfg(test)]
mod persistence_tests {
    use super::*;

    #[test]
    fn failed_save_does_not_advance_or_consume_idempotency_key() {
        let path = std::env::temp_dir().join(format!("lleidapeix-{}.sqlite", Uuid::new_v4()));
        let database = Arc::new(Database::open(path.to_str().unwrap()).unwrap());
        let game = Game::new("persistence-test".into(), 42, GameMode::Quick, Difficulty::Easy);
        database.save_game(&game).unwrap();
        let before = serde_json::to_value(&game).unwrap();
        let state = AppState {
            games: Arc::new(RwLock::new(HashMap::from([(game.id.clone(), game.clone())]))),
            database,
            analysis_slots: Arc::new(Semaphore::new(1)),
            analysis_waiters: Arc::new(AtomicUsize::new(0)),
            started: Instant::now(),
            admin_token: Arc::new(String::new()),
            limits: Arc::new(Limits::new()),
        };
        let connection = rusqlite::Connection::open(&path).unwrap();
        connection.execute_batch("CREATE TRIGGER reject_save BEFORE UPDATE ON games BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END;").unwrap();
        let key = "retry-safe-action";
        let result = mutate_game(&state, &game.id, game.version, key, |next| {
            next.version += 1;
            Ok(())
        });
        assert_eq!(result.unwrap_err().0, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(serde_json::to_value(state.games.read().get(&game.id).unwrap()).unwrap(), before);
        assert_eq!(serde_json::to_value(state.database.load_game(&game.id).unwrap().unwrap()).unwrap(), before);
        connection.execute_batch("DROP TRIGGER reject_save;").unwrap();
        let retried = mutate_game(&state, &game.id, game.version, key, |next| {
            next.version += 1;
            Ok(())
        }).unwrap();
        assert_eq!(retried.0.version, game.version + 1);
        let duplicate = mutate_game(&state, &game.id, game.version, key, |_| {
            panic!("An already persisted action must not run twice")
        }).unwrap();
        assert_eq!(duplicate.0.version, retried.0.version);
        drop(connection);
        drop(state);
        std::fs::remove_file(path).unwrap();
    }
}
