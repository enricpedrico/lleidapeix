export type Suit = "oros" | "copes" | "espases" | "bastos";
export type Rank = "dos" | "tres" | "quatre" | "cinc" | "sis" | "set" | "vuit" | "sota" | "cavall" | "rei" | "as" | "manilla";
export type GameMode = "quick" | "match" | "training";
export type Difficulty = "easy" | "medium" | "strong";
export type Phase = "bidding" | "doubling" | "playing" | "handOver" | "matchOver";
export type DoublingCall = "contro" | "recontro" | "santVicenc";
export type DoublingDecision = "pass" | "raise";

export interface Card {
  id: number;
  suit: Suit;
  rank: Rank;
}

export type Contract = { kind: "trump"; suit: Suit } | { kind: "botifarra" };

export interface PlayedCard {
  seat: number;
  card: Card;
}

export interface CompletedTrick {
  leader: number;
  winner: number;
  cards: PlayedCard[];
  points: number;
}

export interface DoublingRecord {
  seat: number;
  decision: DoublingDecision;
  call: DoublingCall | null;
}

export interface HandResult {
  teamPoints: [number, number];
  awarded: [number, number];
  multiplier: number;
  summary: string;
}

export interface GameState {
  id: string;
  version: number;
  mode: GameMode;
  difficulty: Difficulty;
  humanSeat: number;
  dealer: number;
  handNumber: number;
  phase: Phase;
  contract: Contract | null;
  declarer: number | null;
  doublingLevel: number;
  doublingHistory: DoublingRecord[];
  multiplier: number;
  currentPlayer: number;
  hand: Card[];
  handCounts: [number, number, number, number];
  legalCards: number[];
  currentTrick: PlayedCard[];
  completedTricks: CompletedTrick[];
  teamPoints: [number, number];
  matchScore: [number, number];
  handResult: HandResult | null;
  canAnalyze: boolean;
}

export interface CandidateMove {
  card: Card;
  expectedPoints: number;
  winProbability: number;
  confidence: number;
  visits: number;
  explanation: string;
}

export interface AnalysisUpdate {
  analysisId?: string;
  sequence?: number;
  status: "queued" | "analyzing" | "complete" | "cancelled" | "error";
  terminalReason?: "completed" | "cancelled" | "busy" | "engineError" | "invalidPosition" | "connectionLost";
  elapsedMs?: number;
  simulations?: number;
  nodesPerSecond?: number;
  confidence?: number;
  candidates?: CandidateMove[];
  message?: string;
}

export interface PositionHistoryPlay {
  seat: number;
  cardId: number;
}

export interface PositionAnalysisRequest {
  actorSeat: number;
  actorHand: number[];
  contract: Contract;
  firstLeader: number;
  history: PositionHistoryPlay[];
  budgetMs: number;
  seed?: number;
}
