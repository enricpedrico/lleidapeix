import { describe, expect, it } from "vitest";
import { cardName, fullDeck, numericRankNames, rankNames, suitNames, CardView, TrumpProvider } from "./cards";
import { renderToStaticMarkup } from "react-dom/server";
import { ContractBadge } from "./TableParts";
import type { Suit } from "./types";
import { artRegion } from "./traditional-deck";
import { preferredNotation } from "./notation";

describe("baralla catalana", () => {
  it("marks only the twelve current trumps with a visible and accessible label", () => {
    for (const suit of Object.keys(suitNames) as Suit[]) {
      const html = renderToStaticMarkup(<TrumpProvider contract={{ kind: "trump", suit }}>{fullDeck.map(card => <CardView key={card.id} card={card} />)}</TrumpProvider>);
      expect(html.match(/ is-trump/g)).toHaveLength(12);
      expect(html.match(/class="trump-letter"/g)).toHaveLength(12);
      expect(html.match(/aria-description="Trumfo:/g)).toHaveLength(12);
      const badge = renderToStaticMarkup(<ContractBadge contract={{ kind: "trump", suit }} multiplier={4} />);
      expect(badge).toContain("TRUMFO · T");
      expect(badge).toContain(suitNames[suit]);
      expect(badge).toContain("Multiplicador per 4");
    }
    for (const contract of [null, { kind: "botifarra" as const }]) {
      const html = renderToStaticMarkup(<TrumpProvider contract={contract}>{fullDeck.map(card => <CardView key={card.id} card={card} />)}</TrumpProvider>);
      expect(html).not.toContain("is-trump");
    }
    expect(renderToStaticMarkup(<ContractBadge contract={{ kind: "botifarra" }} />)).toContain("SENSE TRUMFO");
  });
  it("genera 48 cartes úniques", () => {
    expect(fullDeck).toHaveLength(48);
    expect(new Set(fullDeck.map((card) => card.id)).size).toBe(48);
    expect(Object.keys(suitNames)).toHaveLength(4);
    expect(Object.keys(rankNames)).toHaveLength(12);
  });

  it("anomena correctament la manilla", () => {
    expect(cardName(fullDeck[11], "letters")).toBe("Manilla d’oros");
    expect(cardName(fullDeck[11])).toBe("9 d’oros");
    expect(cardName(fullDeck[7], "numbers")).toBe("10 d’oros");
    expect(cardName(fullDeck[8], "numbers")).toBe("11 d’oros");
    expect(cardName(fullDeck[9], "numbers")).toBe("12 d’oros");
    expect(cardName(fullDeck[10], "numbers")).toBe("1 d’oros");
    expect(numericRankNames.manilla).toBe("9");
  });

  it("associa cada carta amb el seu pal i valor imprès, no amb la força de joc", () => {
    const regions = fullDeck.map(artRegion);
    expect(new Set(regions.map(({ x, y }) => `${x}:${y}`)).size).toBe(48);
    for (const card of fullDeck) {
      expect(artRegion(card)).toEqual({
        x: (Number(numericRankNames[card.rank]) - 1) * 208,
        y: ["oros", "copes", "espases", "bastos"].indexOf(card.suit) * 319,
      });
    }
    expect(artRegion(fullDeck[11])).toEqual({ x: 8 * 208, y: 0 });
    expect(artRegion(fullDeck[10])).toEqual({ x: 0, y: 0 });
  });

  it("mostra números d’entrada i conserva una elecció posterior de lletres", () => {
    expect(preferredNotation(null)).toBe("numbers");
    expect(preferredNotation("invalid")).toBe("numbers");
    expect(preferredNotation("numbers")).toBe("numbers");
    expect(preferredNotation("letters")).toBe("letters");
  });
});
