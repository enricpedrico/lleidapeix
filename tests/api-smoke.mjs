import assert from "node:assert/strict";

const base = process.env.BASE_URL || "http://127.0.0.1:18085";

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...options.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  return body;
}

const playedCount = (game) => game.completedTricks.length * 4 + game.currentTrick.length;

async function passHumanDoubling(game) {
  return request(`/api/games/${game.id}/doubling`, {
    method: "POST",
    body: JSON.stringify({ version: game.version, idempotencyKey: crypto.randomUUID(), raise: false }),
  });
}

async function advanceOne(game) {
  const before = playedCount(game);
  const next = await request(`/api/games/${game.id}/advance`, {
    method: "POST",
    body: JSON.stringify({ version: game.version, idempotencyKey: crypto.randomUUID() }),
  });
  if (game.phase === "playing") assert.equal(playedCount(next), before + 1);
  return next;
}

const health = await request("/api/health");
assert.equal(health.status, "ok");

const defaults = await request("/api/games", {
  method: "POST",
  body: JSON.stringify({ mode: "quick", seed: 99 }),
});
assert.equal(defaults.difficulty, "strong");
assert.equal(defaults.dealer, 0);

const alternateDealer = await request("/api/games", {
  method: "POST",
  body: JSON.stringify({ mode: "quick", initialDealer: 3, seed: 99 }),
});
assert.equal(alternateDealer.dealer, 3);
assert.equal(alternateDealer.phase, "doubling");
assert.equal(alternateDealer.currentPlayer, 0);
assert.ok(alternateDealer.contract);
assert.equal(alternateDealer.currentTrick.length, 0);
assert.equal(alternateDealer.completedTricks.length, 0);
const raisedByHuman = await request(`/api/games/${alternateDealer.id}/doubling`, {
  method: "POST",
  body: JSON.stringify({ version: alternateDealer.version, idempotencyKey: crypto.randomUUID(), raise: true }),
});
assert.equal(raisedByHuman.doublingHistory[0].seat, 0);
assert.equal(raisedByHuman.doublingHistory[0].decision, "raise");
assert.ok(raisedByHuman.multiplier >= 2);
assert.equal(playedCount(raisedByHuman), 0);

const humanRecontroGame = await request("/api/games", {
  method: "POST",
  body: JSON.stringify({ mode: "quick", difficulty: "strong", initialDealer: 0, seed: 3 }),
});
const humanRecontroTurn = await request(`/api/games/${humanRecontroGame.id}/contract`, {
  method: "POST",
  body: JSON.stringify({
    version: humanRecontroGame.version,
    idempotencyKey: crypto.randomUUID(),
    contract: { kind: "trump", suit: "oros" },
    delegate: false,
  }),
});
assert.equal(humanRecontroTurn.phase, "doubling");
assert.equal(humanRecontroTurn.currentPlayer, 0);
assert.equal(humanRecontroTurn.doublingLevel, 1);
assert.ok(humanRecontroTurn.doublingHistory.some((entry) => entry.call === "contro" && entry.decision === "raise"));
assert.equal(playedCount(humanRecontroTurn), 0);

const aiRecontroGame = await request("/api/games", {
  method: "POST",
  body: JSON.stringify({ mode: "quick", difficulty: "strong", initialDealer: 3, seed: 3 }),
});
const aiRecontroTurn = await request(`/api/games/${aiRecontroGame.id}/doubling`, {
  method: "POST",
  body: JSON.stringify({ version: aiRecontroGame.version, idempotencyKey: crypto.randomUUID(), raise: true }),
});
assert.ok(aiRecontroTurn.doublingHistory.some((entry) => entry.call === "recontro" && entry.decision === "raise"));
assert.equal(aiRecontroTurn.doublingLevel, 2);
assert.equal(playedCount(aiRecontroTurn), 0);

let game = await request("/api/games", {
  method: "POST",
  body: JSON.stringify({ mode: "quick", difficulty: "easy", seed: 20260903 }),
});
assert.equal(game.phase, "bidding");
assert.equal(game.hand.length, 12);
assert.equal(game.hands, undefined);

game = await request(`/api/games/${game.id}/contract`, {
  method: "POST",
  body: JSON.stringify({
    version: game.version,
    idempotencyKey: crypto.randomUUID(),
    contract: { kind: "trump", suit: "oros" },
    delegate: false,
  }),
});

let humanTurns = 0;
let partialAnalysis;
while (game.phase !== "handOver") {
  if (game.phase === "doubling") {
    assert.equal(game.currentPlayer, 0);
    game = await passHumanDoubling(game);
  } else if (game.phase === "playing" && game.currentPlayer !== 0) {
    game = await advanceOne(game);
  } else if (game.phase === "playing") {
    assert.ok(game.legalCards.length > 0);
    if (!partialAnalysis && game.completedTricks.length >= 5 && game.canAnalyze) {
    const history = game.completedTricks.flatMap((trick) => trick.cards)
      .concat(game.currentTrick)
      .map((play) => ({ seat: play.seat, cardId: play.card.id }));
    partialAnalysis = await request("/api/positions/analyze", {
      method: "POST",
      body: JSON.stringify({
        actorSeat: game.humanSeat,
        actorHand: game.hand.map((candidate) => candidate.id),
        firstLeader: game.completedTricks[0]?.leader ?? game.currentTrick[0]?.seat ?? 1,
        history,
        contract: game.contract,
        budgetMs: 100,
        seed: 44,
      }),
    });
    assert.ok(game.hand.length < 12);
    assert.equal(partialAnalysis.status, "complete");
    assert.ok(partialAnalysis.candidates.length > 0);
    }
    const card = game.hand.find((candidate) => game.legalCards.includes(candidate.id));
    assert.ok(card);
    const before = playedCount(game);
    game = await request(`/api/games/${game.id}/play`, {
      method: "POST",
      body: JSON.stringify({ version: game.version, idempotencyKey: crypto.randomUUID(), cardId: card.id }),
    });
    assert.equal(playedCount(game), before + 1);
    humanTurns += 1;
    assert.ok(humanTurns <= 12);
  } else {
    throw new Error(`Fase inesperada: ${game.phase}`);
  }
}

assert.equal(game.phase, "handOver");
assert.equal(game.completedTricks.length, 12);
assert.equal(game.handResult.teamPoints[0] + game.handResult.teamPoints[1], 72);

const hand = Array.from({ length: 12 }, (_, index) => index);
const analysis = await request("/api/positions/analyze", {
  method: "POST",
  body: JSON.stringify({ hand, contract: { kind: "trump", suit: "oros" }, budgetMs: 100, seed: 44 }),
});
assert.equal(analysis.status, "complete");
assert.ok(analysis.simulations >= 200);
assert.ok(analysis.candidates.length > 0);
assert.equal(analysis.terminalReason, "completed");
assert.ok(analysis.analysisId);

const impossible = await fetch(`${base}/api/positions/analyze`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    actorSeat: 0,
    actorHand: hand,
    firstLeader: 1,
    history: [],
    contract: { kind: "trump", suit: "oros" },
    budgetMs: 100,
  }),
});
assert.equal(impossible.status, 422);

console.log(JSON.stringify({
  status: "ok",
  gameId: game.id,
  humanTurns,
  score: game.handResult.teamPoints,
  analyzedMoves: analysis.candidates.length,
  partialMoves: partialAnalysis.candidates.length,
}));
