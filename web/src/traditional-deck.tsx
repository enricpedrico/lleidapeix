import type { Card, Rank, Suit } from "./types";

// Basquetteur / Germarquezm, CC BY-SA 3.0. Full credits: /cards/CREDITS.txt.
export const DECK_ART = "/cards/baralla-espanyola-v1.png";
const columns: Record<Rank, number> = {
  as: 0, dos: 1, tres: 2, quatre: 3, cinc: 4, sis: 5,
  set: 6, vuit: 7, manilla: 8, sota: 9, cavall: 10, rei: 11,
};
const rows: Record<Suit, number> = { oros: 0, copes: 1, espases: 2, bastos: 3 };

export function artRegion(card: Card) {
  return { x: columns[card.rank] * 208, y: rows[card.suit] * 319 };
}

export function TraditionalFace({ card }: { card: Card }) {
  const { x, y } = artRegion(card);
  const indexWidth = columns[card.rank] >= 9 ? 32 : 15;
  return <svg className="traditional-face" viewBox="0 0 180 289" aria-hidden="true" focusable="false">
    <image href={DECK_ART} x={-x - 14} y={-y - 15} width="2496" height="1595" />
    {/* Printed corner indices are replaced by accessible, responsive typography. */}
    <path d={`M0 0h${indexWidth}v22H0ZM${180 - indexWidth} 268h${indexWidth}v21h-${indexWidth}Z`} fill="#f8f8f8" />
  </svg>;
}
