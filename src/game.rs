use chrono::Utc;
use rand::{seq::SliceRandom, SeedableRng};
use rand_chacha::ChaCha8Rng;
use thiserror::Error;

use crate::{
    model::{
        team_of, Card, CompletedTrick, Contract, Difficulty, DoublingCall, DoublingDecision,
        DoublingRecord, Game, GameMode, HandResult, Phase, PlayedCard, PublicGameState, Rank, Seat,
        Suit,
    },
    rules::{hand_award, legal_cards, trick_points, winning_play},
};

#[derive(Debug, Error)]
pub enum GameError {
    #[error("La partida no espera un contracte")]
    NotBidding,
    #[error("Ara no és el teu torn")]
    NotYourTurn,
    #[error("La carta no és a la mà")]
    CardMissing,
    #[error("La jugada no compleix les obligacions de la botifarra occidental")]
    IllegalCard,
    #[error("La mà encara no ha acabat")]
    HandNotOver,
    #[error("La partida no espera una resposta de contro")]
    NotDoubling,
    #[error("La partida espera una decisió humana")]
    HumanDecisionRequired,
    #[error("Ara no hi ha cap acció automàtica pendent")]
    NoAutomaticAction,
}

impl Game {
    pub fn new(id: String, seed: u64, mode: GameMode, difficulty: Difficulty) -> Self {
        Self::new_with_dealer(id, seed, mode, difficulty, 0)
    }

    pub fn new_with_dealer(
        id: String,
        seed: u64,
        mode: GameMode,
        difficulty: Difficulty,
        dealer: Seat,
    ) -> Self {
        debug_assert!(dealer < 4);
        let mut game = Self {
            id,
            version: 1,
            seed,
            mode,
            difficulty,
            human_seat: 0,
            dealer,
            hand_number: 1,
            phase: Phase::Bidding,
            contract: None,
            declarer: None,
            doubling_level: 0,
            doubling_passes: 0,
            doubling_history: Vec::new(),
            current_player: 0,
            hands: std::array::from_fn(|_| Vec::new()),
            current_trick: Vec::new(),
            completed_tricks: Vec::new(),
            team_points: [0, 0],
            match_score: [0, 0],
            void_suits: [[false; 4]; 4],
            hand_result: None,
            processed_keys: Vec::new(),
            updated_at: Utc::now().timestamp(),
        };
        game.deal();
        game
    }

    fn deal(&mut self) {
        let hand_seed = self.seed ^ (self.hand_number as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
        let mut rng = ChaCha8Rng::seed_from_u64(hand_seed);
        let mut deck = Card::deck();
        deck.shuffle(&mut rng);
        self.hands = std::array::from_fn(|seat| {
            let mut hand = deck[seat * 12..(seat + 1) * 12].to_vec();
            hand.sort_by_key(|card| (card.suit.index(), card.rank.strength()));
            hand
        });
        self.current_trick.clear();
        self.completed_tricks.clear();
        self.team_points = [0, 0];
        self.void_suits = [[false; 4]; 4];
        self.contract = None;
        self.declarer = None;
        self.doubling_level = 0;
        self.doubling_passes = 0;
        self.doubling_history.clear();
        self.hand_result = None;
        self.phase = Phase::Bidding;
        self.current_player = self.dealer;
        self.updated_at = Utc::now().timestamp();
    }

    pub fn multiplier(&self) -> u8 {
        self.contract
            .map(|contract| contract.base_multiplier() * (1u8 << self.doubling_level.min(3)))
            .unwrap_or(1)
    }

    pub fn choose_contract(
        &mut self,
        contract: Option<Contract>,
        delegate: bool,
    ) -> Result<(), GameError> {
        if self.phase != Phase::Bidding {
            return Err(GameError::NotBidding);
        }
        let (declarer, selected) = if delegate {
            let partner = (self.dealer + 2) % 4;
            (partner, best_contract(&self.hands[partner]))
        } else {
            (
                self.dealer,
                contract.unwrap_or_else(|| best_contract(&self.hands[self.dealer])),
            )
        };
        self.contract = Some(selected);
        self.declarer = Some(declarer);
        self.doubling_level = 0;
        self.doubling_passes = 0;
        self.doubling_history.clear();
        self.phase = Phase::Doubling;
        self.current_player = (declarer + 1) % 4;
        self.bump_version();
        Ok(())
    }

    pub fn choose_ai_contract_if_needed(&mut self) -> Result<(), GameError> {
        if self.phase == Phase::Bidding && self.dealer != self.human_seat {
            self.choose_contract(None, false)?;
        }
        Ok(())
    }

    pub fn current_doubling_call(&self) -> Option<DoublingCall> {
        if self.phase != Phase::Doubling {
            return None;
        }
        match self.doubling_level {
            0 => Some(DoublingCall::Contro),
            1 => Some(DoublingCall::Recontro),
            2 if !matches!(self.contract, Some(Contract::Botifarra)) => {
                Some(DoublingCall::SantVicenc)
            }
            _ => None,
        }
    }

    pub fn respond_doubling(
        &mut self,
        seat: Seat,
        decision: DoublingDecision,
    ) -> Result<(), GameError> {
        if self.phase != Phase::Doubling || self.current_player != seat {
            return Err(GameError::NotDoubling);
        }
        let call = self.current_doubling_call().ok_or(GameError::NotDoubling)?;
        self.doubling_history.push(DoublingRecord {
            seat,
            decision,
            call: Some(call),
        });

        match decision {
            DoublingDecision::Pass => {
                self.doubling_passes += 1;
                if self.doubling_passes >= 2 {
                    self.begin_play();
                } else {
                    self.current_player = (seat + 2) % 4;
                }
            }
            DoublingDecision::Raise => {
                self.doubling_level += 1;
                self.doubling_passes = 0;
                let final_call = self.doubling_level >= 3
                    || (self.doubling_level >= 2
                        && matches!(self.contract, Some(Contract::Botifarra)));
                if final_call {
                    self.begin_play();
                } else {
                    self.current_player = (seat + 1) % 4;
                }
            }
        }
        self.bump_version();
        Ok(())
    }

    pub fn choose_ai_doubling_if_needed(&mut self) -> Result<(), GameError> {
        if self.phase != Phase::Doubling || self.current_player == self.human_seat {
            return Err(GameError::NotDoubling);
        }
        let seat = self.current_player;
        let decision = if should_raise(self, seat) {
            DoublingDecision::Raise
        } else {
            DoublingDecision::Pass
        };
        self.respond_doubling(seat, decision)
    }

    fn begin_play(&mut self) {
        self.phase = Phase::Playing;
        self.current_player = (self.dealer + 1) % 4;
    }

    pub fn play(&mut self, seat: Seat, card_id: u8) -> Result<(), GameError> {
        if self.phase != Phase::Playing || self.current_player != seat {
            return Err(GameError::NotYourTurn);
        }
        let index = self.hands[seat]
            .iter()
            .position(|card| card.id == card_id)
            .ok_or(GameError::CardMissing)?;
        let card = self.hands[seat][index];
        let contract = self.contract.expect("playing games always have a contract");
        let legal = legal_cards(&self.hands[seat], &self.current_trick, contract, seat);
        if !legal.iter().any(|candidate| candidate.id == card_id) {
            return Err(GameError::IllegalCard);
        }

        if let Some(lead) = self.current_trick.first().map(|play| play.card.suit) {
            if card.suit != lead {
                self.void_suits[seat][lead.index()] = true;
            }
        }
        self.hands[seat].remove(index);
        self.current_trick.push(PlayedCard { seat, card });

        if self.current_trick.len() == 4 {
            let winner =
                winning_play(&self.current_trick, contract).expect("complete trick has a winner");
            let points = trick_points(&self.current_trick);
            self.team_points[team_of(winner.seat)] += points as u16;
            self.completed_tricks.push(CompletedTrick {
                leader: self.current_trick[0].seat,
                winner: winner.seat,
                cards: self.current_trick.clone(),
                points,
            });
            self.current_trick.clear();
            self.current_player = winner.seat;
            if self.hands.iter().all(Vec::is_empty) {
                self.finish_hand();
            }
        } else {
            self.current_player = (seat + 1) % 4;
        }
        self.bump_version();
        Ok(())
    }

    fn finish_hand(&mut self) {
        debug_assert_eq!(self.team_points[0] + self.team_points[1], 72);
        let multiplier = self.multiplier();
        let awarded = hand_award(self.team_points, multiplier);
        self.match_score[0] += awarded[0];
        self.match_score[1] += awarded[1];
        let summary = if awarded == [0, 0] {
            "Empat a 36: ningú no suma punts.".to_string()
        } else {
            let team = if awarded[0] > 0 {
                "Nord-Sud"
            } else {
                "Est-Oest"
            };
            let value = awarded[0].max(awarded[1]);
            format!("{team} guanya la mà i suma {value} punts.")
        };
        self.hand_result = Some(HandResult {
            team_points: self.team_points,
            awarded,
            multiplier,
            summary,
        });
        self.phase =
            if self.mode == GameMode::Match && self.match_score.iter().any(|score| *score >= 101) {
                Phase::MatchOver
            } else {
                Phase::HandOver
            };
    }

    pub fn next_hand(&mut self) -> Result<(), GameError> {
        if self.phase != Phase::HandOver {
            return Err(GameError::HandNotOver);
        }
        self.hand_number += 1;
        self.dealer = (self.dealer + 1) % 4;
        self.deal();
        self.bump_version();
        Ok(())
    }

    pub fn is_duplicate(&self, key: &str) -> bool {
        self.processed_keys.iter().any(|stored| stored == key)
    }

    pub fn remember_key(&mut self, key: String) {
        self.processed_keys.push(key);
        if self.processed_keys.len() > 64 {
            self.processed_keys.remove(0);
        }
    }

    pub fn bump_version(&mut self) {
        self.version += 1;
        self.updated_at = Utc::now().timestamp();
    }

    pub fn public_state(&self) -> PublicGameState {
        let mut hand = self.hands[self.human_seat].clone();
        hand.sort_by_key(|card| (card.suit.index(), card.rank.strength()));
        let legal = if self.phase == Phase::Playing && self.current_player == self.human_seat {
            legal_cards(
                &hand,
                &self.current_trick,
                self.contract.expect("playing games have a contract"),
                self.human_seat,
            )
            .into_iter()
            .map(|card| card.id)
            .collect()
        } else {
            Vec::new()
        };
        PublicGameState {
            id: self.id.clone(),
            version: self.version,
            mode: self.mode,
            difficulty: self.difficulty,
            human_seat: self.human_seat,
            dealer: self.dealer,
            hand_number: self.hand_number,
            phase: self.phase,
            contract: self.contract,
            declarer: self.declarer,
            doubling_level: self.doubling_level,
            doubling_history: self.doubling_history.clone(),
            multiplier: self.multiplier(),
            current_player: self.current_player,
            hand,
            hand_counts: std::array::from_fn(|seat| self.hands[seat].len()),
            legal_cards: legal,
            current_trick: self.current_trick.clone(),
            completed_tricks: self.completed_tricks.clone(),
            team_points: self.team_points,
            match_score: self.match_score,
            hand_result: self.hand_result.clone(),
            can_analyze: self.phase == Phase::Playing && self.current_player == self.human_seat,
        }
    }
}

fn rank_value(rank: Rank) -> f64 {
    match rank {
        Rank::Dos => 0.05,
        Rank::Tres => 0.08,
        Rank::Quatre => 0.12,
        Rank::Cinc => 0.18,
        Rank::Sis => 0.25,
        Rank::Set => 0.35,
        Rank::Vuit => 0.45,
        Rank::Sota => 1.0,
        Rank::Cavall => 1.8,
        Rank::Rei => 2.8,
        Rank::As => 4.4,
        Rank::Manilla => 6.2,
    }
}

pub fn contract_strength(hand: &[Card], contract: Contract) -> f64 {
    let mut score = hand.iter().map(|card| rank_value(card.rank)).sum::<f64>();
    match contract {
        Contract::Trump(trump) => {
            let trumps = hand.iter().filter(|card| card.suit == trump).collect::<Vec<_>>();
            score += trumps.len() as f64 * 0.38;
            score += trumps
                .iter()
                .map(|card| card.rank.strength() as f64 * 0.035)
                .sum::<f64>();
            score += trumps.len().saturating_sub(3) as f64 * 1.15;
            if trumps.iter().any(|card| card.rank == Rank::Manilla)
                && trumps.iter().any(|card| card.rank == Rank::As)
            {
                score += 1.4;
            }
            for suit in Suit::ALL.into_iter().filter(|suit| *suit != trump) {
                match hand.iter().filter(|card| card.suit == suit).count() {
                    0 => score += 0.9,
                    1 => score += 0.35,
                    _ => {}
                }
            }
        }
        Contract::Botifarra => {
            for suit in Suit::ALL {
                let cards = hand.iter().filter(|card| card.suit == suit).collect::<Vec<_>>();
                match cards.len() {
                    0 => score -= 2.4,
                    1 => score -= 0.8,
                    4..=12 => score += 0.35,
                    _ => {}
                }
                if cards.iter().any(|card| card.rank == Rank::Manilla) {
                    score += 0.45;
                }
                if cards.iter().any(|card| card.rank == Rank::Manilla)
                    && cards.iter().any(|card| card.rank == Rank::As)
                {
                    score += 0.55;
                }
            }
        }
    }
    score
}

pub fn hand_strength(hand: &[Card], suit: Suit) -> f64 {
    contract_strength(hand, Contract::Trump(suit))
}

pub fn best_contract(hand: &[Card]) -> Contract {
    let best_trump = Suit::ALL
        .into_iter()
        .map(|suit| (Contract::Trump(suit), hand_strength(hand, suit)))
        .collect::<Vec<_>>()
        .into_iter()
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .unwrap_or((Contract::Trump(Suit::Oros), 0.0));
    let botifarra_score = contract_strength(hand, Contract::Botifarra);
    let balanced = Suit::ALL
        .iter()
        .all(|suit| hand.iter().filter(|card| card.suit == *suit).count() >= 2);
    if balanced && botifarra_score >= 22.0 && botifarra_score + 2.5 >= best_trump.1 {
        Contract::Botifarra
    } else {
        best_trump.0
    }
}

pub fn should_raise(game: &Game, seat: Seat) -> bool {
    let Some(contract) = game.contract else {
        return false;
    };
    let difficulty_margin = match game.difficulty {
        Difficulty::Easy => 2.2,
        Difficulty::Medium => 0.8,
        Difficulty::Strong => 0.0,
    };
    let declaring_team = team_of(game.declarer.unwrap_or(game.dealer));
    let on_declaring_team = team_of(seat) == declaring_team;
    let threshold = match game.current_doubling_call() {
        Some(DoublingCall::Contro) => 28.0,
        Some(DoublingCall::Recontro) => {
            if on_declaring_team { 27.5 } else { 29.0 }
        }
        Some(DoublingCall::SantVicenc) => 33.0,
        None => return false,
    } + difficulty_margin;
    contract_strength(&game.hands[seat], contract) >= threshold
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pass_doubling(game: &mut Game) {
        while game.phase == Phase::Doubling {
            let seat = game.current_player;
            game.respond_doubling(seat, DoublingDecision::Pass)
                .unwrap();
        }
    }

    #[test]
    fn every_seed_deals_every_card_once() {
        for seed in 0..500 {
            let game = Game::new("test".into(), seed, GameMode::Quick, Difficulty::Medium);
            let mut ids = game
                .hands
                .iter()
                .flatten()
                .map(|card| card.id)
                .collect::<Vec<_>>();
            ids.sort_unstable();
            ids.dedup();
            assert_eq!(ids.len(), 48);
            assert!(game.hands.iter().all(|hand| hand.len() == 12));
        }
    }

    #[test]
    fn public_state_never_contains_hidden_hands() {
        let game = Game::new("test".into(), 7, GameMode::Quick, Difficulty::Strong);
        let json = serde_json::to_value(game.public_state()).unwrap();
        assert!(json.get("hands").is_none());
        assert_eq!(json["hand"].as_array().unwrap().len(), 12);
    }

    #[test]
    fn games_saved_before_the_doubling_round_remain_compatible() {
        let game = Game::new("legacy".into(), 7, GameMode::Quick, Difficulty::Strong);
        let mut json = serde_json::to_value(game).unwrap();
        let object = json.as_object_mut().unwrap();
        object.remove("doublingPasses");
        object.remove("doublingHistory");
        let restored: Game = serde_json::from_value(json).unwrap();
        assert_eq!(restored.doubling_passes, 0);
        assert!(restored.doubling_history.is_empty());
    }

    #[test]
    fn initial_dealer_controls_bidding_and_first_leader() {
        for dealer in 0..4 {
            let mut game = Game::new_with_dealer(
                "test".into(),
                17,
                GameMode::Quick,
                Difficulty::Strong,
                dealer,
            );
            assert_eq!(game.dealer, dealer);
            assert_eq!(game.current_player, dealer);
            game.choose_contract(Some(Contract::Trump(Suit::Oros)), false)
                .unwrap();
            assert_eq!(game.phase, Phase::Doubling);
            assert_eq!(game.current_player, (dealer + 1) % 4);
            assert_eq!(game.declarer, Some(dealer));
            pass_doubling(&mut game);
            assert_eq!(game.phase, Phase::Playing);
            assert_eq!(game.current_player, (dealer + 1) % 4);
        }
    }

    #[test]
    fn contro_recontro_and_sant_vicenc_follow_the_regulatory_order() {
        let mut game = Game::new("test".into(), 17, GameMode::Quick, Difficulty::Strong);
        game.choose_contract(Some(Contract::Trump(Suit::Oros)), false)
            .unwrap();

        assert_eq!(game.current_doubling_call(), Some(DoublingCall::Contro));
        game.respond_doubling(1, DoublingDecision::Raise).unwrap();
        assert_eq!(game.multiplier(), 2);
        assert_eq!(game.current_player, 2);
        assert_eq!(game.current_doubling_call(), Some(DoublingCall::Recontro));
        game.respond_doubling(2, DoublingDecision::Raise).unwrap();
        assert_eq!(game.multiplier(), 4);
        assert_eq!(game.current_player, 3);
        assert_eq!(game.current_doubling_call(), Some(DoublingCall::SantVicenc));
        game.respond_doubling(3, DoublingDecision::Raise).unwrap();
        assert_eq!(game.multiplier(), 8);
        assert_eq!(game.phase, Phase::Playing);
        assert_eq!(game.current_player, 1);
    }

    #[test]
    fn botifarra_stops_after_recontro_and_keeps_its_base_double() {
        let mut game = Game::new("test".into(), 19, GameMode::Quick, Difficulty::Strong);
        game.choose_contract(Some(Contract::Botifarra), false)
            .unwrap();
        assert_eq!(game.multiplier(), 2);
        game.respond_doubling(1, DoublingDecision::Raise).unwrap();
        assert_eq!(game.multiplier(), 4);
        game.respond_doubling(2, DoublingDecision::Raise).unwrap();
        assert_eq!(game.multiplier(), 8);
        assert_eq!(game.phase, Phase::Playing);
        assert_eq!(game.current_doubling_call(), None);
    }

    #[test]
    fn two_passes_close_each_doubling_opportunity() {
        let mut game = Game::new("test".into(), 23, GameMode::Quick, Difficulty::Strong);
        game.choose_contract(Some(Contract::Trump(Suit::Copes)), false)
            .unwrap();
        game.respond_doubling(1, DoublingDecision::Pass).unwrap();
        assert_eq!(game.current_player, 3);
        game.respond_doubling(3, DoublingDecision::Pass).unwrap();
        assert_eq!(game.phase, Phase::Playing);
        assert_eq!(game.multiplier(), 1);
    }

    #[test]
    fn contract_and_doubling_heuristics_distinguish_strong_hands() {
        let balanced = Suit::ALL
            .into_iter()
            .flat_map(|suit| [Rank::Rei, Rank::As, Rank::Manilla].map(|rank| Card::new(suit, rank)))
            .collect::<Vec<_>>();
        assert_eq!(best_contract(&balanced), Contract::Botifarra);

        let mut game = Game::new("test".into(), 31, GameMode::Quick, Difficulty::Strong);
        game.choose_contract(Some(Contract::Trump(Suit::Oros)), false)
            .unwrap();
        game.hands[1] = balanced;
        assert!(should_raise(&game, 1));

        game.hands[1] = Suit::ALL
            .into_iter()
            .flat_map(|suit| [Rank::Dos, Rank::Tres, Rank::Quatre].map(|rank| Card::new(suit, rank)))
            .collect();
        assert!(!should_raise(&game, 1));
    }

    #[test]
    fn strong_engine_uses_contro_selectively_across_many_deals() {
        let mut calls = 0;
        let mut opportunities = 0;
        for seed in 0..500 {
            let mut game = Game::new("test".into(), seed, GameMode::Quick, Difficulty::Strong);
            let suit = Suit::ALL[seed as usize % Suit::ALL.len()];
            game.choose_contract(Some(Contract::Trump(suit)), false)
                .unwrap();
            for seat in [1, 3] {
                opportunities += 1;
                calls += usize::from(should_raise(&game, seat));
            }
        }
        assert!((80..=180).contains(&calls), "{calls} contros de {opportunities}");
    }

    #[test]
    fn engine_uses_botifarra_only_for_a_selective_share_of_balanced_deals() {
        let calls = (0..500)
            .filter(|seed| {
                let game = Game::new("test".into(), *seed, GameMode::Quick, Difficulty::Strong);
                best_contract(&game.hands[game.dealer]) == Contract::Botifarra
            })
            .count();
        assert!((20..=70).contains(&calls), "{calls} botifarres de 500 mans");
    }

    #[test]
    fn legal_play_completes_hands_with_exactly_72_points() {
        for seed in 0..250 {
            let mut game = Game::new("test".into(), seed, GameMode::Quick, Difficulty::Medium);
            game.choose_contract(Some(Contract::Trump(Suit::Bastos)), false)
                .unwrap();
            pass_doubling(&mut game);
            let mut safety = 0;
            while game.phase == Phase::Playing {
                let seat = game.current_player;
                let legal = legal_cards(
                    &game.hands[seat],
                    &game.current_trick,
                    game.contract.unwrap(),
                    seat,
                );
                game.play(seat, legal[0].id).unwrap();
                safety += 1;
                assert!(safety <= 48);
            }
            assert_eq!(game.completed_tricks.len(), 12);
            assert_eq!(game.team_points[0] + game.team_points[1], 72);
            assert_eq!(
                game.hand_result.as_ref().unwrap().team_points,
                game.team_points
            );
        }
    }
}
