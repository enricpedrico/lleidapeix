import { createContext, useContext, type ReactNode } from "react";
import type { Card, Contract, Rank, Suit } from "./types";
import { useNotation, type CardNotation } from "./notation";
import { TraditionalFace } from "./traditional-deck";

const TrumpContext = createContext<Suit | null>(null);

export function TrumpProvider({ contract, children }: { contract: Contract | null; children: ReactNode }) {
  return <TrumpContext.Provider value={contract?.kind === "trump" ? contract.suit : null}>{children}</TrumpContext.Provider>;
}

export const suitNames: Record<Suit, string> = {
  oros: "Oros",
  copes: "Copes",
  espases: "Espases",
  bastos: "Bastos",
};

export const rankNames: Record<Rank, string> = {
  dos: "2",
  tres: "3",
  quatre: "4",
  cinc: "5",
  sis: "6",
  set: "7",
  vuit: "8",
  sota: "S",
  cavall: "C",
  rei: "R",
  as: "A",
  manilla: "9",
};

export const numericRankNames: Record<Rank, string> = {
  dos: "2",
  tres: "3",
  quatre: "4",
  cinc: "5",
  sis: "6",
  set: "7",
  vuit: "8",
  sota: "10",
  cavall: "11",
  rei: "12",
  as: "1",
  manilla: "9",
};

const spokenRankNames: Record<Rank, string> = {
  dos: "dos",
  tres: "tres",
  quatre: "quatre",
  cinc: "cinc",
  sis: "sis",
  set: "set",
  vuit: "vuit",
  sota: "sota",
  cavall: "cavall",
  rei: "rei",
  as: "as",
  manilla: "manilla",
};

const ranks: Rank[] = ["dos", "tres", "quatre", "cinc", "sis", "set", "vuit", "sota", "cavall", "rei", "as", "manilla"];
const suits: Suit[] = ["oros", "copes", "espases", "bastos"];

export const fullDeck: Card[] = suits.flatMap((suit, suitIndex) =>
  ranks.map((rank, rankIndex) => ({ id: suitIndex * 12 + rankIndex, suit, rank })),
);

export function rankLabel(rank: Rank, notation: CardNotation): string {
  return notation === "numbers" ? numericRankNames[rank] : rankNames[rank];
}

export function cardName(card: Card, notation: CardNotation = "numbers"): string {
  const rank = notation === "numbers"
    ? numericRankNames[card.rank]
    : card.rank === "manilla" ? "Manilla" : rankNames[card.rank];
  return `${rank} ${card.suit === "oros" || card.suit === "espases" ? "d’" : "de "}${card.suit}`;
}

function accessibleCardName(card: Card, notation: CardNotation): string {
  if (notation === "letters" || card.rank === "dos" || card.rank === "tres" || card.rank === "quatre" || card.rank === "cinc" || card.rank === "sis" || card.rank === "set" || card.rank === "vuit") {
    return cardName(card, notation);
  }
  return `${numericRankNames[card.rank]}, ${spokenRankNames[card.rank]} ${card.suit === "oros" || card.suit === "espases" ? "d’" : "de "}${card.suit}`;
}

export function SuitMark({ suit }: { suit: Suit }) {
  if (suit === "oros") {
    return <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="11" fill="currentColor" fillOpacity=".1"/><circle cx="16" cy="16" r="7.5"/><path d="m16 10 1.6 4.4 4.4 1.6-4.4 1.6L16 22l-1.6-4.4L10 16l4.4-1.6Z" fill="currentColor" strokeWidth="1"/><path d="M16 5v3m0 16v3M5 16h3m16 0h3"/></svg>;
  }
  if (suit === "copes") {
    return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8 5h16l-2 10c-.7 3.5-3 5.6-6 5.6S10.7 18.5 10 15L8 5Z" fill="currentColor" fillOpacity=".12"/><path d="M7 5h18M10 10h12M16 20v6m-5 1h10M8.7 9H5c-1 6 1.5 9 7 9m11.3-9H27c1 6-1.5 9-7 9"/></svg>;
  }
  if (suit === "espases") {
    return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="m25 3-1 10-9 10-6-6 10-9 6-5Z" fill="currentColor" fillOpacity=".1"/><path d="m23 6-11 14M6 16l10 10m-5-5-6 6m-2-3 5 5"/><circle cx="5" cy="27" r="1.5" fill="currentColor"/></svg>;
  }
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M20 3c4 0 7 4 5 8L13 26c-2 3-6 0-4-3L16 5c.7-1.5 2-2 4-2Z" fill="currentColor" fillOpacity=".15"/><path d="m18 8 4 3m-7 3 4 3m-6 3 3 2m-4 0-2 5M25 8l3-1M17 6l-3-2"/></svg>;
}

interface CardViewProps {
  card: Card;
  playable?: boolean;
  selected?: boolean;
  compact?: boolean;
  unavailable?: boolean;
  onClick?: () => void;
}

export function CardView({ card, playable, selected, compact, unavailable, onClick }: CardViewProps) {
  const { notation } = useNotation();
  const isTrump = useContext(TrumpContext) === card.suit;
  const className = `playing-card suit-${card.suit}${isTrump ? " is-trump" : ""}${playable ? " playable" : ""}${selected ? " selected" : ""}${compact ? " compact" : ""}${unavailable ?? (onClick && !playable) ? " unavailable" : ""}`;
  const content = <>
    <span className="traditional-index" aria-hidden="true"><span className="traditional-rank">{rankLabel(card.rank, notation)}</span>{isTrump ? <span className="trump-letter">T</span> : <SuitMark suit={card.suit} />}</span>
    <TraditionalFace card={card} />
    <span className="traditional-index reverse-index" aria-hidden="true"><span className="traditional-rank">{rankLabel(card.rank, notation)}</span></span>
  </>;
  const description = isTrump ? `Trumfo: ${suitNames[card.suit]}` : undefined;
  return onClick ? <button type="button" className={className} onClick={onClick} disabled={!playable} aria-label={accessibleCardName(card, notation)} aria-description={description} title={description} aria-pressed={Boolean(selected)}>{content}</button>
    : <div className={className} role="img" aria-label={accessibleCardName(card, notation)} aria-description={description} title={description}>{content}</div>;
}
