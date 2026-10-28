import { describe, expect, it } from "vitest";
import { fullDeck } from "./cards";
import { cardPoints, playGuidance, winningCard } from "./table";
import type { GameState } from "./types";

describe("presentation of the referee's public state", () => {
  it("marks the highest trump, or the highest leading suit without trump", () => {
    const plays = [{ seat: 0, card: fullDeck[11] }, { seat: 1, card: fullDeck[24] }, { seat: 2, card: fullDeck[35] }, { seat: 3, card: fullDeck[22] }];
    expect(winningCard(plays, { kind: "trump", suit: "espases" })?.seat).toBe(2);
    expect(winningCard(plays, { kind: "botifarra" })?.seat).toBe(0);
    expect(winningCard([], null)).toBeUndefined();
  });

  it("keeps the 60 card points distinct from the 12 trick points", () => {
    expect(fullDeck.reduce((sum, card) => sum + cardPoints(card.id), 0)).toBe(60);
    expect(cardPoints(7)).toBe(1);
    expect(cardPoints(11)).toBe(5);
  });

  it("explains a forced winning trump even when all remaining cards are trumps", () => {
    const position = { humanSeat: 0, currentPlayer: 0, hand: [fullDeck[0], fullDeck[11]], legalCards: [0, 11], contract: { kind: "trump", suit: "oros" }, currentTrick: [{ seat: 1, card: fullDeck[22] }] } as GameState;
    expect(playGuidance(position)).toContain("Cal jugar un trumfo que guanyi");
    position.currentTrick[0].seat = 2;
    expect(playGuidance(position)).toContain("Domina el company");
  });

  it("explains beating even if every following card can beat", () => {
    const position = { humanSeat: 0, currentPlayer: 0, hand: [fullDeck[9], fullDeck[10]], legalCards: [9, 10], contract: { kind: "trump", suit: "copes" }, currentTrick: [{ seat: 3, card: fullDeck[0] }] } as GameState;
    expect(playGuidance(position)).toContain("superar la carta rival");
    position.currentTrick[0].seat = 2;
    expect(playGuidance(position)).toContain("no cal superar-lo");
  });

  it("distinguishes overruffing, following a ruffed trick, and free discard", () => {
    const position = { humanSeat: 0, currentPlayer: 0, hand: [fullDeck[0], fullDeck[10], fullDeck[36]], legalCards: [10], contract: { kind: "trump", suit: "oros" }, currentTrick: [{ seat: 2, card: fullDeck[23] }, { seat: 3, card: fullDeck[9] }] } as GameState;
    expect(playGuidance(position)).toContain("sobretrumfar");
    position.hand.push(fullDeck[12]);
    position.legalCards = [12];
    expect(playGuidance(position)).toContain("encara que no puguis guanyar");
    position.hand = [fullDeck[0], fullDeck[36]];
    position.legalCards = [0, 36];
    expect(playGuidance(position)).toContain("qualsevol carta");
  });
});
