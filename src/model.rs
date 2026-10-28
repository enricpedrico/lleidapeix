use serde::{Deserialize, Serialize};

pub type Seat = usize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Suit {
    Oros,
    Copes,
    Espases,
    Bastos,
}

impl Suit {
    pub const ALL: [Suit; 4] = [Suit::Oros, Suit::Copes, Suit::Espases, Suit::Bastos];

    pub const fn index(self) -> usize {
        match self {
            Suit::Oros => 0,
            Suit::Copes => 1,
            Suit::Espases => 2,
            Suit::Bastos => 3,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Rank {
    Dos,
    Tres,
    Quatre,
    Cinc,
    Sis,
    Set,
    Vuit,
    Sota,
    Cavall,
    Rei,
    As,
    Manilla,
}

impl Rank {
    pub const ALL: [Rank; 12] = [
        Rank::Dos,
        Rank::Tres,
        Rank::Quatre,
        Rank::Cinc,
        Rank::Sis,
        Rank::Set,
        Rank::Vuit,
        Rank::Sota,
        Rank::Cavall,
        Rank::Rei,
        Rank::As,
        Rank::Manilla,
    ];

    pub const fn index(self) -> usize {
        match self {
            Rank::Dos => 0,
            Rank::Tres => 1,
            Rank::Quatre => 2,
            Rank::Cinc => 3,
            Rank::Sis => 4,
            Rank::Set => 5,
            Rank::Vuit => 6,
            Rank::Sota => 7,
            Rank::Cavall => 8,
            Rank::Rei => 9,
            Rank::As => 10,
            Rank::Manilla => 11,
        }
    }

    pub const fn strength(self) -> u8 {
        self.index() as u8
    }

    pub const fn points(self) -> u8 {
        match self {
            Rank::Manilla => 5,
            Rank::As => 4,
            Rank::Rei => 3,
            Rank::Cavall => 2,
            Rank::Sota => 1,
            _ => 0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Card {
    pub id: u8,
    pub suit: Suit,
    pub rank: Rank,
}

impl Card {
    pub fn new(suit: Suit, rank: Rank) -> Self {
        Self {
            id: (suit.index() * 12 + rank.index()) as u8,
            suit,
            rank,
        }
    }

    pub fn deck() -> Vec<Card> {
        Suit::ALL
            .into_iter()
            .flat_map(|suit| Rank::ALL.into_iter().map(move |rank| Card::new(suit, rank)))
            .collect()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "suit", rename_all = "camelCase")]
pub enum Contract {
    Trump(Suit),
    Botifarra,
}

impl Contract {
    pub const fn trump(self) -> Option<Suit> {
        match self {
            Contract::Trump(suit) => Some(suit),
            Contract::Botifarra => None,
        }
    }

    pub const fn base_multiplier(self) -> u8 {
        if matches!(self, Contract::Botifarra) {
            2
        } else {
            1
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GameMode {
    Quick,
    Match,
    Training,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Difficulty {
    Easy,
    Medium,
    Strong,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Bidding,
    Doubling,
    Playing,
    HandOver,
    MatchOver,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DoublingCall {
    Contro,
    Recontro,
    SantVicenc,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DoublingDecision {
    Pass,
    Raise,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoublingRecord {
    pub seat: Seat,
    pub decision: DoublingDecision,
    pub call: Option<DoublingCall>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayedCard {
    pub seat: Seat,
    pub card: Card,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedTrick {
    pub leader: Seat,
    pub winner: Seat,
    pub cards: Vec<PlayedCard>,
    pub points: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandResult {
    pub team_points: [u16; 2],
    pub awarded: [u16; 2],
    pub multiplier: u8,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    pub id: String,
    pub version: u64,
    pub seed: u64,
    pub mode: GameMode,
    pub difficulty: Difficulty,
    pub human_seat: Seat,
    pub dealer: Seat,
    pub hand_number: u32,
    pub phase: Phase,
    pub contract: Option<Contract>,
    pub declarer: Option<Seat>,
    pub doubling_level: u8,
    #[serde(default)]
    pub doubling_passes: u8,
    #[serde(default)]
    pub doubling_history: Vec<DoublingRecord>,
    pub current_player: Seat,
    pub hands: [Vec<Card>; 4],
    pub current_trick: Vec<PlayedCard>,
    pub completed_tricks: Vec<CompletedTrick>,
    pub team_points: [u16; 2],
    pub match_score: [u16; 2],
    pub void_suits: [[bool; 4]; 4],
    pub hand_result: Option<HandResult>,
    pub processed_keys: Vec<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicGameState {
    pub id: String,
    pub version: u64,
    pub mode: GameMode,
    pub difficulty: Difficulty,
    pub human_seat: Seat,
    pub dealer: Seat,
    pub hand_number: u32,
    pub phase: Phase,
    pub contract: Option<Contract>,
    pub declarer: Option<Seat>,
    pub doubling_level: u8,
    pub doubling_history: Vec<DoublingRecord>,
    pub multiplier: u8,
    pub current_player: Seat,
    pub hand: Vec<Card>,
    pub hand_counts: [usize; 4],
    pub legal_cards: Vec<u8>,
    pub current_trick: Vec<PlayedCard>,
    pub completed_tricks: Vec<CompletedTrick>,
    pub team_points: [u16; 2],
    pub match_score: [u16; 2],
    pub hand_result: Option<HandResult>,
    pub can_analyze: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateMove {
    pub card: Card,
    pub expected_points: f64,
    pub win_probability: f64,
    pub confidence: f64,
    pub visits: u64,
    pub explanation: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisUpdate {
    pub analysis_id: String,
    pub sequence: u64,
    pub status: String,
    pub terminal_reason: Option<String>,
    pub message: Option<String>,
    pub elapsed_ms: u64,
    pub simulations: u64,
    pub nodes_per_second: u64,
    pub confidence: f64,
    pub candidates: Vec<CandidateMove>,
}

pub const fn team_of(seat: Seat) -> usize {
    seat % 2
}
