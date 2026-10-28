import type { AnalysisUpdate, Card, Contract, Difficulty, GameMode, GameState, PositionAnalysisRequest } from "./types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers },
    });
  } catch {
    throw new Error("No hi ha connexió amb la taula. Comprova la xarxa i torna-ho a provar.");
  }
  const body = await response.json().catch(() => {
    throw new Error("El servidor no ha pogut respondre correctament. Torna-ho a provar d’aquí a uns instants.");
  });
  if (!response.ok) {
    const error = new Error(body.error || "No s’ha pogut completar la petició") as Error & { current?: GameState };
    error.current = body.current;
    throw error;
  }
  return body as T;
}

const mutation = () => crypto.randomUUID();

export const api = {
  createGame: (mode: GameMode, difficulty: Difficulty = "strong", initialDealer = 0) =>
    request<GameState>("/api/games", { method: "POST", body: JSON.stringify({ mode, difficulty, initialDealer }) }),
  getGame: (id: string) => request<GameState>(`/api/games/${id}`),
  contract: (game: GameState, contract: Contract | null, delegate = false) =>
    request<GameState>(`/api/games/${game.id}/contract`, {
      method: "POST",
      body: JSON.stringify({ version: game.version, idempotencyKey: mutation(), contract, delegate }),
    }),
  doubling: (game: GameState, raise: boolean) =>
    request<GameState>(`/api/games/${game.id}/doubling`, {
      method: "POST",
      body: JSON.stringify({ version: game.version, idempotencyKey: mutation(), raise }),
    }),
  play: (game: GameState, card: Card) =>
    request<GameState>(`/api/games/${game.id}/play`, {
      method: "POST",
      body: JSON.stringify({ version: game.version, idempotencyKey: mutation(), cardId: card.id }),
    }),
  advance: (game: GameState) =>
    request<GameState>(`/api/games/${game.id}/advance`, {
      method: "POST",
      body: JSON.stringify({ version: game.version, idempotencyKey: mutation() }),
    }),
  nextHand: (game: GameState) =>
    request<GameState>(`/api/games/${game.id}/next`, {
      method: "POST",
      body: JSON.stringify({ version: game.version, idempotencyKey: mutation() }),
    }),
  analyzePosition: (position: PositionAnalysisRequest) =>
    request<AnalysisUpdate>("/api/positions/analyze", {
      method: "POST",
      body: JSON.stringify(position),
    }),
};

export function analysisSocket(gameId: string, budgetMs: number): WebSocket {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(`${protocol}//${location.host}/api/games/${gameId}/analysis?budgetMs=${budgetMs}`);
}
