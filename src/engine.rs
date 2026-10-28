use std::{collections::HashSet, time::Instant};

use rand::{seq::SliceRandom, Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use serde::{Deserialize, Serialize};

use crate::{
    model::{
        team_of, AnalysisUpdate, CandidateMove, Card, CompletedTrick, Contract, Game, PlayedCard,
        Seat,
    },
    rules::{legal_cards, trick_points, winning_play},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InformationSet {
    pub actor: Seat,
    pub actor_hand: Vec<Card>,
    pub hand_counts: [usize; 4],
    pub first_leader: Seat,
    pub history: Vec<PlayedCard>,
    pub current_player: Seat,
    pub current_trick: Vec<PlayedCard>,
    pub completed_tricks: Vec<CompletedTrick>,
    pub team_points: [u16; 2],
    pub contract: Contract,
    pub void_suits: [[bool; 4]; 4],
    pub seed: u64,
}

impl InformationSet {
    pub fn from_game(game: &Game, actor: Seat) -> Option<Self> {
        let history = game
            .completed_tricks
            .iter()
            .flat_map(|trick| trick.cards.iter().copied())
            .chain(game.current_trick.iter().copied())
            .collect::<Vec<_>>();
        let first_leader = game
            .completed_tricks
            .first()
            .map(|trick| trick.leader)
            .or_else(|| game.current_trick.first().map(|play| play.seat))
            .unwrap_or((game.dealer + 1) % 4);
        Some(Self {
            actor,
            actor_hand: game.hands.get(actor)?.clone(),
            hand_counts: std::array::from_fn(|seat| game.hands[seat].len()),
            first_leader,
            history,
            current_player: game.current_player,
            current_trick: game.current_trick.clone(),
            completed_tricks: game.completed_tricks.clone(),
            team_points: game.team_points,
            contract: game.contract?,
            void_suits: game.void_suits,
            seed: game.seed ^ game.version.rotate_left(17) ^ actor as u64,
        })
    }

    pub fn legal_moves(&self) -> Vec<Card> {
        legal_cards(
            &self.actor_hand,
            &self.current_trick,
            self.contract,
            self.actor,
        )
    }

    fn played_ids(&self) -> HashSet<u8> {
        self.completed_tricks
            .iter()
            .flat_map(|trick| trick.cards.iter().map(|play| play.card.id))
            .chain(self.current_trick.iter().map(|play| play.card.id))
            .collect()
    }
}

#[derive(Debug, Clone)]
struct World {
    hands: [Vec<Card>; 4],
    current_player: Seat,
    current_trick: Vec<PlayedCard>,
    team_points: [u16; 2],
    contract: Contract,
}

impl World {
    fn play(&mut self, card: Card) -> bool {
        let seat = self.current_player;
        let Some(index) = self.hands[seat]
            .iter()
            .position(|candidate| candidate.id == card.id)
        else {
            return false;
        };
        let legal = legal_cards(&self.hands[seat], &self.current_trick, self.contract, seat);
        if !legal.iter().any(|candidate| candidate.id == card.id) {
            return false;
        }
        self.hands[seat].remove(index);
        self.current_trick.push(PlayedCard { seat, card });
        if self.current_trick.len() == 4 {
            let winner = winning_play(&self.current_trick, self.contract).expect("complete trick");
            self.team_points[team_of(winner.seat)] += trick_points(&self.current_trick) as u16;
            self.current_trick.clear();
            self.current_player = winner.seat;
        } else {
            self.current_player = (seat + 1) % 4;
        }
        true
    }

    fn finished(&self) -> bool {
        self.hands.iter().all(Vec::is_empty)
    }

    fn remaining_cards(&self) -> usize {
        self.hands.iter().map(Vec::len).sum()
    }
}

#[derive(Debug, Clone, Default)]
struct MoveStats {
    visits: u64,
    value_sum: f64,
    value_sq_sum: f64,
    wins: u64,
}

pub struct Analyzer {
    info: InformationSet,
    candidates: Vec<Card>,
    stats: Vec<MoveStats>,
    rng: ChaCha8Rng,
    started: Instant,
    simulations: u64,
    nodes: u64,
}

impl Analyzer {
    pub fn new(info: InformationSet) -> Self {
        let candidates = info.legal_moves();
        let seed = info.seed;
        Self {
            stats: vec![MoveStats::default(); candidates.len()],
            info,
            candidates,
            rng: ChaCha8Rng::seed_from_u64(seed),
            started: Instant::now(),
            simulations: 0,
            nodes: 0,
        }
    }

    pub fn step(&mut self, iterations: usize) {
        if self.candidates.is_empty() {
            return;
        }
        for _ in 0..iterations {
            let index = self.select_candidate();
            let Some(mut world) = sample_world(&self.info, &mut self.rng) else {
                continue;
            };
            if !world.play(self.candidates[index]) {
                continue;
            }
            let value = rollout(&mut world, self.info.actor, &mut self.rng, &mut self.nodes);
            let stats = &mut self.stats[index];
            stats.visits += 1;
            stats.value_sum += value;
            stats.value_sq_sum += value * value;
            if value > 0.0 {
                stats.wins += 1;
            }
            self.simulations += 1;
        }
    }

    fn select_candidate(&mut self) -> usize {
        if let Some(index) = self.stats.iter().position(|stats| stats.visits == 0) {
            return index;
        }
        let total = self.simulations.max(1) as f64;
        self.stats
            .iter()
            .enumerate()
            .map(|(index, stats)| {
                let mean = stats.value_sum / stats.visits as f64;
                let normalized = (mean + 72.0) / 144.0;
                let exploration = 1.15 * (total.ln() / stats.visits as f64).sqrt();
                (index, normalized + exploration)
            })
            .max_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(index, _)| index)
            .unwrap_or(0)
    }

    pub fn update(&self, status: &str) -> AnalysisUpdate {
        let elapsed_ms = self.started.elapsed().as_millis() as u64;
        let mut candidates = self
            .candidates
            .iter()
            .enumerate()
            .map(|(index, card)| {
                let stats = &self.stats[index];
                let mean = if stats.visits == 0 {
                    0.0
                } else {
                    stats.value_sum / stats.visits as f64
                };
                let variance = if stats.visits < 2 {
                    144.0
                } else {
                    (stats.value_sq_sum / stats.visits as f64 - mean * mean).max(0.0)
                };
                let standard_error = (variance / stats.visits.max(1) as f64).sqrt();
                CandidateMove {
                    card: *card,
                    expected_points: round2(mean),
                    win_probability: round2(stats.wins as f64 / stats.visits.max(1) as f64),
                    confidence: round2((1.0 - standard_error / 18.0).clamp(0.05, 0.99)),
                    visits: stats.visits,
                    explanation: explain_move(*card, &self.info),
                }
            })
            .collect::<Vec<_>>();
        candidates.sort_by(|a, b| b.expected_points.total_cmp(&a.expected_points));
        AnalysisUpdate {
            analysis_id: String::new(),
            sequence: 0,
            status: status.to_string(),
            terminal_reason: None,
            message: None,
            elapsed_ms,
            simulations: self.simulations,
            nodes_per_second: self.nodes.saturating_mul(1000) / elapsed_ms.max(1),
            confidence: candidates
                .first()
                .map(|candidate| candidate.confidence)
                .unwrap_or(0.0),
            candidates,
        }
    }

    pub fn best_card(&self) -> Option<Card> {
        self.candidates
            .iter()
            .enumerate()
            .filter(|(index, _)| self.stats[*index].visits > 0)
            .max_by(|(a, _), (b, _)| {
                let av = self.stats[*a].value_sum / self.stats[*a].visits as f64;
                let bv = self.stats[*b].value_sum / self.stats[*b].visits as f64;
                av.total_cmp(&bv)
            })
            .map(|(_, card)| *card)
            .or_else(|| self.candidates.first().copied())
    }
}

pub fn choose_move(game: &Game, seat: Seat, iterations: usize) -> Option<Card> {
    let info = InformationSet::from_game(game, seat)?;
    let mut analyzer = Analyzer::new(info);
    analyzer.step(iterations.max(1));
    analyzer.best_card()
}

fn sample_world(info: &InformationSet, rng: &mut ChaCha8Rng) -> Option<World> {
    let played = info.played_ids();
    let known = info
        .actor_hand
        .iter()
        .map(|card| card.id)
        .collect::<HashSet<_>>();
    let mut unknown = Card::deck()
        .into_iter()
        .filter(|card| !played.contains(&card.id) && !known.contains(&card.id))
        .collect::<Vec<_>>();
    let mut capacities = info.hand_counts;
    capacities[info.actor] = 0;
    if unknown.len() != capacities.iter().sum::<usize>() {
        return None;
    }

    unknown.shuffle(rng);
    unknown.sort_by_key(|card| {
        (0..4)
            .filter(|seat| *seat != info.actor && !info.void_suits[*seat][card.suit.index()])
            .count()
    });
    let mut hands: [Vec<Card>; 4] = std::array::from_fn(|_| Vec::new());
    hands[info.actor] = info.actor_hand.clone();
    let mut visited = 0usize;
    if !assign_unknown_cards(
        &unknown,
        0,
        info.actor,
        &info.void_suits,
        &mut capacities,
        &mut hands,
        rng,
        &mut visited,
    ) {
        return None;
    }
    if !history_is_compatible(info, &hands) {
        return None;
    }
    Some(World {
        hands,
        current_player: info.current_player,
        current_trick: info.current_trick.clone(),
        team_points: info.team_points,
        contract: info.contract,
    })
}

pub fn has_compatible_world(info: &InformationSet) -> bool {
    let mut rng = ChaCha8Rng::seed_from_u64(info.seed ^ 0xA11C_E5E7);
    (0..256).any(|_| sample_world(info, &mut rng).is_some())
}

fn history_is_compatible(info: &InformationSet, current_hands: &[Vec<Card>; 4]) -> bool {
    if info.history.is_empty() {
        return true;
    }

    let mut initial_hands = current_hands.clone();
    for play in &info.history {
        if play.seat >= 4 {
            return false;
        }
        initial_hands[play.seat].push(play.card);
    }
    let mut replay = World {
        hands: initial_hands,
        current_player: info.first_leader,
        current_trick: Vec::new(),
        team_points: [0, 0],
        contract: info.contract,
    };
    for play in &info.history {
        if replay.current_player != play.seat || !replay.play(play.card) {
            return false;
        }
    }

    replay.current_player == info.current_player
        && replay.current_trick == info.current_trick
        && replay.team_points == info.team_points
}

#[allow(clippy::too_many_arguments)]
fn assign_unknown_cards(
    cards: &[Card],
    index: usize,
    actor: Seat,
    void_suits: &[[bool; 4]; 4],
    capacities: &mut [usize; 4],
    hands: &mut [Vec<Card>; 4],
    rng: &mut ChaCha8Rng,
    visited: &mut usize,
) -> bool {
    if index == cards.len() {
        return capacities.iter().all(|capacity| *capacity == 0);
    }
    *visited += 1;
    if *visited > 25_000 {
        return false;
    }
    let card = cards[index];
    let mut seats = (0..4)
        .filter(|seat| {
            *seat != actor && capacities[*seat] > 0 && !void_suits[*seat][card.suit.index()]
        })
        .collect::<Vec<_>>();
    seats.shuffle(rng);
    for seat in seats {
        capacities[seat] -= 1;
        hands[seat].push(card);
        if assign_unknown_cards(
            cards,
            index + 1,
            actor,
            void_suits,
            capacities,
            hands,
            rng,
            visited,
        ) {
            return true;
        }
        hands[seat].pop();
        capacities[seat] += 1;
    }
    false
}

fn rollout(world: &mut World, actor: Seat, rng: &mut ChaCha8Rng, nodes: &mut u64) -> f64 {
    while !world.finished() {
        let seat = world.current_player;
        let legal = legal_cards(
            &world.hands[seat],
            &world.current_trick,
            world.contract,
            seat,
        );
        if legal.is_empty() {
            break;
        }
        let chosen = if world.remaining_cards() <= 8 {
            exact_best_move(world, seat, actor).unwrap_or(legal[0])
        } else {
            rollout_choice(world, seat, &legal, rng)
        };
        if !world.play(chosen) {
            break;
        }
        *nodes += 1;
    }
    let actor_team = team_of(actor);
    world.team_points[actor_team] as f64 - world.team_points[1 - actor_team] as f64
}

fn rollout_choice(world: &World, seat: Seat, legal: &[Card], rng: &mut ChaCha8Rng) -> Card {
    if legal.len() == 1 {
        return legal[0];
    }
    if rng.gen_bool(0.10) {
        return *legal.choose(rng).expect("non-empty legal set");
    }
    let winner = winning_play(&world.current_trick, world.contract);
    *legal
        .iter()
        .max_by(|a, b| {
            heuristic_card(world, seat, **a, winner)
                .total_cmp(&heuristic_card(world, seat, **b, winner))
        })
        .expect("non-empty legal set")
}

fn heuristic_card(world: &World, seat: Seat, card: Card, winner: Option<PlayedCard>) -> f64 {
    let mut score = 0.0;
    match winner {
        None => {
            score += card.rank.strength() as f64 * 0.35;
            score += card.rank.points() as f64 * 0.2;
            if Some(card.suit) == world.contract.trump() {
                score += 0.8;
            }
        }
        Some(current) if team_of(current.seat) == team_of(seat) => {
            score += card.rank.points() as f64 * 2.4;
            score -= card.rank.strength() as f64 * 0.08;
        }
        Some(current) => {
            let lead = world.current_trick[0].card.suit;
            if crate::rules::card_beats(card, current.card, lead, world.contract.trump()) {
                score += 8.0 - card.rank.strength() as f64 * 0.18;
            } else {
                score -= card.rank.points() as f64 * 1.8;
                score -= card.rank.strength() as f64 * 0.08;
            }
        }
    }
    score
}

fn exact_best_move(world: &World, seat: Seat, actor: Seat) -> Option<Card> {
    let legal = legal_cards(
        &world.hands[seat],
        &world.current_trick,
        world.contract,
        seat,
    );
    let maximizing = team_of(seat) == team_of(actor);
    legal.into_iter().max_by(|a, b| {
        let mut wa = world.clone();
        let mut wb = world.clone();
        wa.play(*a);
        wb.play(*b);
        let av = exact_value(&wa, actor, -200.0, 200.0);
        let bv = exact_value(&wb, actor, -200.0, 200.0);
        if maximizing {
            av.total_cmp(&bv)
        } else {
            bv.total_cmp(&av)
        }
    })
}

fn exact_value(world: &World, actor: Seat, mut alpha: f64, mut beta: f64) -> f64 {
    if world.finished() {
        let team = team_of(actor);
        return world.team_points[team] as f64 - world.team_points[1 - team] as f64;
    }
    let seat = world.current_player;
    let maximizing = team_of(seat) == team_of(actor);
    let legal = legal_cards(
        &world.hands[seat],
        &world.current_trick,
        world.contract,
        seat,
    );
    let mut best: f64 = if maximizing { -200.0 } else { 200.0 };
    for card in legal {
        let mut next = world.clone();
        next.play(card);
        let value = exact_value(&next, actor, alpha, beta);
        if maximizing {
            best = best.max(value);
            alpha = alpha.max(best);
        } else {
            best = best.min(value);
            beta = beta.min(best);
        }
        if beta <= alpha {
            break;
        }
    }
    best
}

fn explain_move(card: Card, info: &InformationSet) -> String {
    let Some(winner) = winning_play(&info.current_trick, info.contract) else {
        if Some(card.suit) == info.contract.trump() && card.rank.strength() >= 9 {
            return "Pren la iniciativa i pressiona els trumfos rivals.".into();
        }
        if card.rank.strength() >= 10 {
            return "Intenta cobrar una carta dominant abans que perdi valor.".into();
        }
        return "Desenvolupa el pal sense comprometre una figura cara.".into();
    };
    if team_of(winner.seat) == team_of(info.actor) {
        if card.rank.points() > 0 {
            "Carrega punts perquè ara mateix domina el company.".into()
        } else {
            "Assisteix gastant una carta baixa mentre domina el company.".into()
        }
    } else if crate::rules::card_beats(
        card,
        winner.card,
        info.current_trick[0].card.suit,
        info.contract.trump(),
    ) {
        "Guanya la basa amb el cost estratègic més favorable.".into()
    } else if card.rank.points() == 0 {
        "Descarta una carta sense punts que ja té poc recorregut.".into()
    } else {
        "Sacrifici controlat: les alternatives exposen més punts futurs.".into()
    }
}

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Difficulty, DoublingDecision, GameMode, Phase, Suit};

    fn finish_bidding(game: &mut Game) {
        while game.phase == Phase::Doubling {
            game.respond_doubling(game.current_player, DoublingDecision::Pass)
                .unwrap();
        }
    }

    #[test]
    fn information_set_serialization_has_no_hidden_hands() {
        let mut game = Game::new("x".into(), 42, GameMode::Quick, Difficulty::Strong);
        game.choose_contract(Some(Contract::Trump(Suit::Oros)), false)
            .unwrap();
        finish_bidding(&mut game);
        let info = InformationSet::from_game(&game, 1).unwrap();
        let json = serde_json::to_value(info).unwrap();
        assert!(json.get("hands").is_none());
        assert!(json.get("actorHand").is_some());
    }

    #[test]
    fn analyzer_only_recommends_legal_cards_for_many_seeds() {
        for seed in 0..100 {
            let mut game = Game::new("x".into(), seed, GameMode::Quick, Difficulty::Medium);
            game.choose_contract(Some(Contract::Trump(Suit::Copes)), false)
                .unwrap();
            finish_bidding(&mut game);
            let seat = game.current_player;
            let info = InformationSet::from_game(&game, seat).unwrap();
            let legal = info.legal_moves();
            let mut analyzer = Analyzer::new(info);
            analyzer.step(20);
            let best = analyzer.best_card().unwrap();
            assert!(legal.iter().any(|card| card.id == best.id));
        }
    }

    #[test]
    fn analysis_is_deterministic_for_same_state_and_budget() {
        let mut game = Game::new("x".into(), 91, GameMode::Quick, Difficulty::Strong);
        game.choose_contract(Some(Contract::Botifarra), false)
            .unwrap();
        finish_bidding(&mut game);
        let info = InformationSet::from_game(&game, game.current_player).unwrap();
        let mut first = Analyzer::new(info.clone());
        let mut second = Analyzer::new(info);
        first.step(100);
        second.step(100);
        assert_eq!(first.best_card(), second.best_card());
    }

    #[test]
    fn sampled_worlds_preserve_counts_and_void_constraints() {
        let mut game = Game::new("x".into(), 18, GameMode::Quick, Difficulty::Medium);
        game.choose_contract(Some(Contract::Trump(Suit::Espases)), false)
            .unwrap();
        finish_bidding(&mut game);
        let info = InformationSet::from_game(&game, game.current_player).unwrap();
        let mut rng = ChaCha8Rng::seed_from_u64(99);
        for _ in 0..100 {
            let world = sample_world(&info, &mut rng).unwrap();
            assert_eq!(
                world.hands.iter().map(Vec::len).collect::<Vec<_>>(),
                vec![12, 12, 12, 12]
            );
            assert_eq!(world.hands[info.actor], info.actor_hand);
            let mut ids = world
                .hands
                .iter()
                .flatten()
                .map(|card| card.id)
                .collect::<Vec<_>>();
            ids.sort_unstable();
            ids.dedup();
            assert_eq!(ids.len(), 48);
        }
    }

    #[test]
    fn sampled_worlds_replay_a_partial_hand_legally() {
        let mut game = Game::new_with_dealer(
            "x".into(),
            2026,
            GameMode::Quick,
            Difficulty::Strong,
            3,
        );
        game.choose_contract(Some(Contract::Trump(Suit::Bastos)), false)
            .unwrap();
        finish_bidding(&mut game);
        for _ in 0..20 {
            let seat = game.current_player;
            let card = legal_cards(
                &game.hands[seat],
                &game.current_trick,
                game.contract.unwrap(),
                seat,
            )[0];
            game.play(seat, card.id).unwrap();
        }
        let actor = game.current_player;
        let info = InformationSet::from_game(&game, actor).unwrap();
        assert!(info.actor_hand.len() < 12);
        let mut rng = ChaCha8Rng::seed_from_u64(44);
        let world = (0..256).find_map(|_| sample_world(&info, &mut rng));
        assert!(world.is_some());
    }

    #[test]
    fn every_remaining_hand_size_from_twelve_to_one_is_analyzable() {
        let mut game = Game::new("x".into(), 731, GameMode::Quick, Difficulty::Strong);
        game.choose_contract(Some(Contract::Trump(Suit::Oros)), false)
            .unwrap();
        finish_bidding(&mut game);

        for remaining in (1..=12).rev() {
            let actor = game.current_player;
            let info = InformationSet::from_game(&game, actor).unwrap();
            assert_eq!(info.actor_hand.len(), remaining);
            assert!(!info.legal_moves().is_empty());
            assert!(has_compatible_world(&info));

            if remaining > 1 {
                for _ in 0..4 {
                    let seat = game.current_player;
                    let card = legal_cards(
                        &game.hands[seat],
                        &game.current_trick,
                        game.contract.unwrap(),
                        seat,
                    )[0];
                    game.play(seat, card.id).unwrap();
                }
            }
        }
    }
}
