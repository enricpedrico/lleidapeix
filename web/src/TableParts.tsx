import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { X, Trophy } from "lucide-react";
import { CardView, SuitMark, suitNames } from "./cards";
import { seatLabels } from "./table";
import type { Card, CompletedTrick, Contract, GameState } from "./types";

export function Sheet({ title, children, close, className = "", contract, multiplier }: { title: string; children: ReactNode; close: () => void; className?: string; contract?: Contract | null; multiplier?: number }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      queueMicrotask(() => { if (opener?.isConnected && !document.querySelector("dialog[open]")) opener.focus(); });
    };
  }, []);
  return <dialog ref={ref} className={`table-sheet ${className}`} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); ref.current?.close(); close(); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div className="sheet-header"><div className="sheet-heading"><h2 id={titleId}>{title}</h2><button type="button" className="tool-button" aria-label="Tanca el panell" onClick={close}><X size={21} /></button></div>
      {contract !== undefined && <div className="sheet-contract"><ContractBadge contract={contract} multiplier={multiplier} /></div>}
    </div>
    <div className="sheet-body">{children}</div>
  </dialog>;
}

export function PlayerHand({ game, selected, locked, select, bidding }: { game: GameState; selected: Card | null; locked: boolean; select: (card: Card) => void; bidding: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(new Map<number, DOMRect>());
  const ids = game.hand.map((card) => card.id).join(",");
  useLayoutEffect(() => {
    const elements = [...ref.current!.querySelectorAll<HTMLElement>(".hand-slot")];
    const motion = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map<number, DOMRect>();
    elements.forEach((element, index) => {
      const id = Number(element.dataset.cardId);
      const rect = element.getBoundingClientRect();
      const old = previous.current.get(id);
      next.set(id, rect);
      if (!motion) return;
      if (old && (Math.abs(old.x - rect.x) > 1 || Math.abs(old.y - rect.y) > 1)) {
        element.animate([{ transform: `translate(${old.x - rect.x}px, ${old.y - rect.y}px)` }, { transform: "translate(0, 0)" }], { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" });
      } else if (!old) {
        element.animate([{ opacity: 0, transform: "translateY(16px) rotate(-3deg)" }, { opacity: 1, transform: "translateY(0) rotate(0)" }], { duration: 350, delay: index * 22, fill: "backwards", easing: "ease-out" });
      }
    });
    previous.current = next;
  }, [ids, game.handNumber]);
  return <div ref={ref} className={`card-hand full-hand${bidding ? " bidding-cards" : ""}`} aria-label={bidding ? "La teva mà durant el cant" : "La teva mà"}>
    {game.hand.map((card) => <div className={`hand-slot${game.contract?.kind === "trump" && game.contract.suit === card.suit ? " trump-card" : ""}`} key={card.id} data-card-id={card.id}>
      <CardView card={card} playable={!bidding && game.legalCards.includes(card.id) && !locked} unavailable={!bidding && game.currentPlayer === game.humanSeat && !game.legalCards.includes(card.id)} selected={selected?.id === card.id} onClick={bidding ? undefined : () => select(card)} />
    </div>)}
  </div>;
}

export function TrickHistory({ tricks }: { tricks: CompletedTrick[] }) {
  return <div className="trick-history">{tricks.length ? [...tricks].reverse().map((trick, index) => <article key={tricks.length - index}>
    <header><span>Basa {tricks.length - index}</span><strong><Trophy size={15} /> {seatLabels[trick.winner]}</strong><b>+{trick.points} punts</b></header>
    <div className="history-cards">{trick.cards.map((play) => <div key={play.seat} className={play.seat === trick.winner ? "history-winner" : ""}><span>{seatLabels[play.seat]}</span><CardView card={play.card} compact /><small>{play.seat === trick.winner ? "Guanya" : ""}</small></div>)}</div>
  </article>) : <div className="history-empty"><Trophy /><h3>Encara no hi ha bases</h3><p>Les quatre cartes de cada basa es guardaran aquí, amb el guanyador i els punts.</p></div>}</div>;
}

export function ContractBadge({ contract, multiplier = 1 }: { contract: Contract | null; multiplier?: number }) {
  return <span className={`contract-badge ${contract?.kind === "trump" ? "has-trump" : "no-trump"}`}>
    {contract?.kind === "trump" && <SuitMark suit={contract.suit} />}
    <span><small>{contract?.kind === "trump" ? "TRUMFO · T" : contract ? "SENSE TRUMFO" : "CONTRACTE"}</small><strong>{contract?.kind === "trump" ? suitNames[contract.suit] : contract ? "Botifarra" : "Per decidir"}</strong></span>
    {multiplier > 1 && <b aria-label={`Multiplicador per ${multiplier}`}>×{multiplier}</b>}
  </span>;
}
