import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type CardNotation = "letters" | "numbers";

// The old key was written even without an explicit choice. Start the new deck
// with numbers once, then preserve every choice made with the new selector.
export const NOTATION_KEY = "lleidapeix:card-notation:v2";

interface NotationState {
  notation: CardNotation;
  setNotation: (notation: CardNotation) => void;
}

const NotationContext = createContext<NotationState>({
  notation: "numbers",
  setNotation: () => undefined,
});

export function preferredNotation(saved: string | null): CardNotation {
  return saved === "letters" ? "letters" : "numbers";
}

export function NotationProvider({ children }: { children: ReactNode }) {
  const [notation, setNotation] = useState<CardNotation>(() => {
    try {
      return preferredNotation(localStorage.getItem(NOTATION_KEY));
    } catch {
      return "numbers";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(NOTATION_KEY, notation);
    } catch {
      // The display toggle still works when browser storage is unavailable.
    }
  }, [notation]);

  return <NotationContext.Provider value={{ notation, setNotation }}>{children}</NotationContext.Provider>;
}

export function useNotation() {
  return useContext(NotationContext);
}
