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

let game = await request("/api/games", {
  method: "POST",
  body: JSON.stringify({ mode: "match", difficulty: "easy", seed: 101101 }),
});
let actions = 0;
let completedHands = 0;

while (game.phase !== "matchOver" && actions < 1500) {
  if (game.phase === "bidding") {
    game = await request(`/api/games/${game.id}/contract`, {
      method: "POST",
      body: JSON.stringify({
        version: game.version,
        idempotencyKey: crypto.randomUUID(),
        contract: { kind: "trump", suit: "bastos" },
        delegate: false,
      }),
    });
  } else if (game.phase === "doubling") {
    assert.equal(game.currentPlayer, 0);
    game = await request(`/api/games/${game.id}/doubling`, {
      method: "POST",
      body: JSON.stringify({ version: game.version, idempotencyKey: crypto.randomUUID(), raise: false }),
    });
  } else if (game.phase === "playing" && game.currentPlayer !== 0) {
    const before = game.completedTricks.length * 4 + game.currentTrick.length;
    game = await request(`/api/games/${game.id}/advance`, {
      method: "POST",
      body: JSON.stringify({ version: game.version, idempotencyKey: crypto.randomUUID() }),
    });
    assert.equal(game.completedTricks.length * 4 + game.currentTrick.length, before + 1);
  } else if (game.phase === "playing") {
    const card = game.hand.find((candidate) => game.legalCards.includes(candidate.id));
    assert.ok(card);
    game = await request(`/api/games/${game.id}/play`, {
      method: "POST",
      body: JSON.stringify({ version: game.version, idempotencyKey: crypto.randomUUID(), cardId: card.id }),
    });
  } else if (game.phase === "handOver") {
    assert.equal(game.handResult.teamPoints[0] + game.handResult.teamPoints[1], 72);
    completedHands += 1;
    game = await request(`/api/games/${game.id}/next`, {
      method: "POST",
      body: JSON.stringify({ version: game.version, idempotencyKey: crypto.randomUUID() }),
    });
  }
  actions += 1;
}

assert.equal(game.phase, "matchOver");
assert.ok(Math.max(...game.matchScore) >= 101);
assert.ok(completedHands >= 1);
assert.ok(game.handNumber > 1);

console.log(JSON.stringify({ status: "ok", gameId: game.id, hands: game.handNumber, score: game.matchScore, actions }));
