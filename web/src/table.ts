import { fullDeck, suitNames } from "./cards";
import type { Contract, GameState, PlayedCard } from "./types";

export const seatLabels = ["Tu", "Llevant", "Company", "Ponent"];

export function winningCard(plays: PlayedCard[], contract: Contract | null): PlayedCard | undefined {
  const lead = plays[0]?.card.suit;
  const trump = contract?.kind === "trump" ? contract.suit : undefined;
  return plays.reduce<PlayedCard | undefined>((winner, play) => {
    if (!winner) return play;
    if (play.card.suit === winner.card.suit) return play.card.id % 12 > winner.card.id % 12 ? play : winner;
    if (play.card.suit === trump) return play;
    if (winner.card.suit === trump) return winner;
    return play.card.suit === lead ? play : winner;
  }, undefined);
}

export function playGuidance(game: GameState): string {
  if (game.currentPlayer !== game.humanSeat) return "Les cartes es juguen una a una. Pots pausar quan vulguis.";
  if (!game.currentTrick.length) return "Obres la basa. Pots sortir de qualsevol pal.";
  const lead = game.currentTrick[0].card.suit;
  const winner = winningCard(game.currentTrick, game.contract)!;
  const partnerWinning = winner.seat % 2 === game.humanSeat % 2;
  const canWin = game.hand.some((card) => game.legalCards.includes(card.id) && winningCard([...game.currentTrick, { seat: game.humanSeat, card }], game.contract)?.seat === game.humanSeat);
  const follows = game.hand.some((card) => card.suit === lead);
  if (follows) {
    const suit = suitNames[lead].toLowerCase();
    if (partnerWinning) return `Domina el company. Cal assistir a ${suit}, però no cal superar-lo.`;
    if (canWin) return `Cal assistir a ${suit} i superar la carta rival.`;
    return `Cal assistir a ${suit}, encara que no puguis guanyar la basa.`;
  }
  if (partnerWinning) return "Domina el company. Pots carregar punts o descartar: no cal trumfar.";
  if (game.contract?.kind === "trump" && canWin) return winner.card.suit === game.contract.suit ? "No tens el pal de sortida. Cal sobretrumfar: juga un trumfo superior al del rival." : "No tens el pal de sortida. Cal jugar un trumfo que guanyi.";
  return "No pots superar la basa. Pots descartar qualsevol carta.";
}

export function cardPoints(id: number): number {
  return Math.max(0, (fullDeck[id]?.id ?? 0) % 12 - 6);
}
