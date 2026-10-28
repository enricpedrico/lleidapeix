import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Bot,
  BrainCircuit,
  Check,
  ChevronRight,
  CircleStop,
  Cpu,
  Gauge,
  History,
  LoaderCircle,
  Play,
  Pause,
  Settings2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Swords,
  Trophy,
  WifiOff,
} from "lucide-react";
import { analysisSocket, api } from "./api";
import { CardView, cardName, fullDeck, suitNames, SuitMark, TrumpProvider } from "./cards";
import { useNotation } from "./notation";
import type { AnalysisUpdate, Card, CompletedTrick, Contract, Difficulty, DoublingCall, GameMode, GameState, PositionHistoryPlay, Suit } from "./types";
import { ContractBadge, PlayerHand, Sheet, TrickHistory } from "./TableParts";
import { playGuidance, seatLabels, winningCard } from "./table";
import { RulesObligations } from "./RulesObligations";

type Route =
  | { page: "home" }
  | { page: "game"; id: string }
  | { page: "lab" }
  | { page: "rules" }
  | { page: "admin" };

function currentRoute(): Route {
  const game = location.pathname.match(/^\/partida\/([a-f0-9]+)$/);
  if (game) return { page: "game", id: game[1] };
  if (location.pathname === "/analisi") return { page: "lab" };
  if (location.pathname === "/regles") return { page: "rules" };
  if (location.pathname === "/admin") return { page: "admin" };
  return { page: "home" };
}

export default function App() {
  const [route, setRoute] = useState<Route>(currentRoute);
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const navigateBack = () => setRoute(currentRoute());
    const online = () => setOffline(false);
    const offlineHandler = () => setOffline(true);
    addEventListener("popstate", navigateBack);
    addEventListener("online", online);
    addEventListener("offline", offlineHandler);
    return () => {
      removeEventListener("popstate", navigateBack);
      removeEventListener("online", online);
      removeEventListener("offline", offlineHandler);
    };
  }, []);

  const navigate = (path: string) => {
    history.pushState({}, "", path);
    setRoute(currentRoute());
    scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="app-shell">
      <Header navigate={navigate} compact={route.page === "game"} />
      {offline && <div className="offline-banner"><WifiOff size={16} /> La interfície és disponible, però el motor necessita connexió.</div>}
      <main>
        {route.page === "home" && <Home navigate={navigate} />}
        {route.page === "game" && <GamePage key={route.id} id={route.id} navigate={navigate} />}
        {route.page === "lab" && <PositionLab navigate={navigate} />}
        {route.page === "rules" && <Rules navigate={navigate} />}
        {route.page === "admin" && <Admin navigate={navigate} />}
      </main>
      {route.page !== "game" && <Footer navigate={navigate} />}
    </div>
  );
}

function Header({ navigate, compact }: { navigate: (path: string) => void; compact: boolean }) {
  return (
    <header className={`site-header${compact ? " compact" : ""}`}>
      <button className="brand" onClick={() => navigate("/")} aria-label="Anar a l’inici">
        <span className="brand-mark"><img src="/engine-icon-192.png" alt="" /></span>
        <span><strong>LleidaPeix</strong><small>Motor de botifarra</small></span>
      </button>
      <nav aria-label="Navegació principal">
        <button onClick={() => navigate("/analisi")}><BrainCircuit size={17} /> Analitza</button>
        <button onClick={() => navigate("/regles")}><BookOpen size={17} /> Regles</button>
      </nav>
    </header>
  );
}

function Home({ navigate }: { navigate: (path: string) => void }) {
  const [mode, setMode] = useState<GameMode>("quick");
  const [difficulty, setDifficulty] = useState<Difficulty>("strong");
  const [dealer, setDealer] = useState<"0" | "1" | "2" | "3" | "random">("random");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const initialDealer = dealer === "random"
        ? crypto.getRandomValues(new Uint32Array(1))[0] % 4
        : Number(dealer);
      const game = await api.createGame(mode, difficulty, initialDealer);
      localStorage.setItem("lleidapeix:last-game", game.id);
      navigate(`/partida/${game.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No s’ha pogut crear la partida");
      setBusy(false);
    }
  };

  const goToSetup = () => document.getElementById("nova-partida")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const selectedDealer = dealer === "random" ? null : Number(dealer);
  const firstLeader = selectedDealer === null ? null : (selectedDealer + 1) % 4;

  const lastGame = localStorage.getItem("lleidapeix:last-game");
  return (
    <>
      <section className="hero">
        <div className="hero-copy reveal">
          <span className="eyebrow"><span /> Enginy català, decisió a decisió</span>
          <h1>La botifarra,<br /><em>sota anàlisi.</em></h1>
          <p>LleidaPeix calcula mans compatibles, contrasta alternatives i t’explica per què una carta té més futur que una altra.</p>
          <div className="hero-actions">
            <button className="button primary" onClick={goToSetup}>
              <Play size={19} fill="currentColor" /> Nova partida
            </button>
            <button className="button ghost" onClick={() => navigate("/analisi")}><BrainCircuit size={19} /> Obre el laboratori</button>
          </div>
          {lastGame && <button className="resume-link" onClick={() => navigate(`/partida/${lastGame}`)}><History size={16} /> Reprèn l’última partida <ChevronRight size={16} /></button>}
          {error && <p className="error-message">{error}</p>}
        </div>
        <div className="hero-console hero-table-preview reveal delay-1" aria-label="La baralla de LleidaPeix">
          <div className="console-top"><span><i /> LA TAULA ÉS A PUNT</span><strong>DES DE PONENT</strong></div>
          <img className="engine-seal" src="/lleidapeix-engine.webp" alt="" />
          <div className="hero-hand" aria-hidden="true"><CardView card={fullDeck[21]} /><CardView card={fullDeck[34]} /><CardView card={fullDeck[11]} /></div>
          <div className="preview-copy"><small>EL JOC DE SEMPRE, UNA NOVA MIRADA</small><strong>Cada mà, una<br /><em>nova possibilitat.</em></strong><p>Seu a taula, juga al teu ritme i descobreix el perquè de cada jugada.</p></div>
          <div className="preview-details"><span>48 cartes</span><span>12 bases</span><span>Sense compte</span></div>
        </div>
      </section>

      <section className="game-setup reveal delay-2" id="nova-partida">
        <header className="setup-heading">
          <div><span className="section-kicker">Nova partida</span><h2>Com vols jugar?</h2></div>
          <p>Tria el format i qui reparteix. Veuràs la teva mà abans de prendre cap decisió.</p>
        </header>
        <fieldset className="mode-picker"><legend>Modalitat</legend>
          {([
            ["quick", "Una mà", "Dotze bases i resultat final."],
            ["match", "Partida a 101", "Mans consecutives amb marcador."],
            ["training", "Entrenament", "Avisos abans de confirmar una errada."],
          ] as [GameMode, string, string][]).map(([value, title, description]) => (
            <button type="button" key={value} className={mode === value ? "active" : ""} onClick={() => setMode(value)} aria-pressed={mode === value}>
              <strong>{title}</strong><small>{description}</small>
            </button>
          ))}
        </fieldset>
        <div className="setup-options">
          <fieldset className="segmented dealer-picker"><legend>Qui escull el trumfo de la primera mà?</legend>
            {(["0", "1", "2", "3", "random"] as const).map((value) => (
              <button type="button" key={value} className={dealer === value ? "active" : ""} onClick={() => setDealer(value)} aria-pressed={dealer === value}>
                {value === "random" ? "Aleatori" : seatNames[Number(value)]}
              </button>
            ))}
          </fieldset>
          <fieldset className="segmented"><legend>Força del motor</legend>
            {(["easy", "medium", "strong"] as Difficulty[]).map((value) => (
              <button type="button" key={value} className={difficulty === value ? "active" : ""} onClick={() => setDifficulty(value)} aria-pressed={difficulty === value}>
                {value === "easy" ? "Àgil" : value === "medium" ? "Pensador" : "Mestre"}
              </button>
            ))}
          </fieldset>
        </div>
        <div className="setup-confirmation">
          <p><strong>{selectedDealer === null ? "El cantador es triarà a l’atzar" : `${seatNames[selectedDealer]} reparteix i escull trumfo`}</strong><span>{firstLeader === null ? "Se sorteja qui reparteix i tria trumfo; surt el seient següent." : `${seatNames[firstLeader]} farà la primera sortida.`}</span></p>
          <button className="button primary" onClick={create} disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={19} /> : <Play size={19} fill="currentColor" />} Reparteix i mira la mà
          </button>
        </div>
        {error && <p className="error-message setup-error">{error}</p>}
      </section>

      <figure className="table-story reveal">
        <picture>
          <source srcSet="/botifarra-taula.avif" type="image/avif" />
          <source srcSet="/botifarra-taula.webp" type="image/webp" />
          <img src="/botifarra-taula.jpg" width="1600" height="746" loading="eager" alt="Quatre persones jugant una mà de botifarra al voltant d’un tapet verd" />
        </picture>
        <figcaption><span>Una taula, quatre mans</span><strong>Cada carta explica una història.</strong></figcaption>
      </figure>
    </>
  );
}

const seatNames = ["Tu", "Rival de llevant", "Company", "Rival de ponent"];
type GamePace = "relaxed" | "normal" | "quick";
const aiDelay: Record<GamePace, number> = { relaxed: 1100, normal: 550, quick: 250 };
const trickDelay: Record<GamePace, number> = { relaxed: 2200, normal: 1400, quick: 850 };
type TableScene = {
  stage: "arriving" | "result" | "collecting";
  completed?: CompletedTrick;
  previousPoints: [number, number];
  previousMatch: [number, number];
};

function GamePage({ id, navigate }: { id: string; navigate: (path: string) => void }) {
  const { notation } = useNotation();
  const [game, setGame] = useState<GameState | null>(null);
  const [selected, setSelected] = useState<Card | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [automaticPaused, setAutomaticPaused] = useState(false);
  const [scene, setScene] = useState<TableScene | null>(null);
  const [paused, setPaused] = useState(false);
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const [panel, setPanel] = useState<"settings" | "history" | "analysis" | null>(null);
  const [reviewEachTrick, setReviewEachTrick] = useState(() => localStorage.getItem("lleidapeix:review-tricks") === "true");
  const [confirmPlay, setConfirmPlay] = useState(() => localStorage.getItem("lleidapeix:confirm-play") !== "false");
  const [pace, setPace] = useState<GamePace>(() => {
    const stored = localStorage.getItem("lleidapeix:game-pace");
    return stored === "relaxed" || stored === "quick" ? stored : "normal";
  });
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState<AnalysisUpdate | null>(null);
  const [budget, setBudget] = useState(1500);
  const socketRef = useRef<WebSocket | null>(null);
  const socketGenerationRef = useRef(0);
  const terminalRef = useRef(false);
  const manuallyStoppedRef = useRef(false);
  const sequenceRef = useRef(0);
  const gameRef = useRef<GameState | null>(null);
  const mountedRef = useRef(false);
  const actionLockRef = useRef(false);
  const presentationPaused = paused || !pageVisible || panel !== null || automaticPaused;
  const trickSettling = scene !== null;

  const commitGame = (next: GameState) => {
    const previous = gameRef.current;
    if (previous && previous.handNumber === next.handNumber
      && next.completedTricks.length * 4 + next.currentTrick.length > previous.completedTricks.length * 4 + previous.currentTrick.length) {
      setScene({
        stage: "arriving",
        completed: next.completedTricks.length > previous.completedTricks.length ? next.completedTricks.at(-1) : undefined,
        previousPoints: previous.teamPoints,
        previousMatch: previous.matchScore,
      });
    } else if (!previous || previous.handNumber !== next.handNumber) {
      setScene(null);
    }
    gameRef.current = next;
    setGame(next);
  };

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    api.getGame(id).then((next) => { if (!cancelled) commitGame(next); }).catch((reason) => { if (!cancelled) setError(reason.message); });
    return () => {
      cancelled = true;
      mountedRef.current = false;
      socketGenerationRef.current += 1;
      manuallyStoppedRef.current = true;
      socketRef.current?.close(1000, "page-left");
    };
  }, [id]);

  useEffect(() => {
    const visibility = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);

  useEffect(() => {
    if (!scene || presentationPaused || (scene.stage === "result" && reviewEachTrick)) return;
    const duration = scene.stage === "arriving" ? 460 : scene.stage === "result" ? trickDelay[pace] : 440;
    const timer = window.setTimeout(() => setScene((current) => {
      if (!current) return null;
      if (current.stage === "arriving") return current.completed ? { ...current, stage: "result" } : null;
      return current.stage === "result" ? { ...current, stage: "collecting" } : null;
    }), duration);
    return () => window.clearTimeout(timer);
  }, [scene, presentationPaused, reviewEachTrick, pace]);

  useEffect(() => {
    localStorage.setItem("lleidapeix:game-pace", pace);
    localStorage.setItem("lleidapeix:review-tricks", String(reviewEachTrick));
    localStorage.setItem("lleidapeix:confirm-play", String(confirmPlay));
  }, [pace, reviewEachTrick, confirmPlay]);

  useEffect(() => {
    if (!game || busy || aiBusy || presentationPaused || trickSettling) return;
    const needsAutomaticAction = game.currentPlayer !== game.humanSeat
      && (game.phase === "bidding" || game.phase === "doubling" || game.phase === "playing");
    if (!needsAutomaticAction) return;
    const delay = game.phase === "playing" ? aiDelay[pace] : 260;
    const expectedVersion = game.version;
    const timer = window.setTimeout(async () => {
      const current = gameRef.current;
      if (!current || current.version !== expectedVersion) return;
      setAiBusy(true);
      setError("");
      try {
        const next = await api.advance(current);
        if (!mountedRef.current) return;
        commitGame(next);
        setSelected(null);
      } catch (reason) {
        const typed = reason as Error & { current?: GameState };
        if (!mountedRef.current) return;
        if (typed.current) {
          commitGame(typed.current);
        } else {
          setAutomaticPaused(true);
        }
        setError(typed.message);
      } finally {
        setAiBusy(false);
      }
    }, delay);
    return () => window.clearTimeout(timer);
  }, [game?.version, game?.phase, game?.currentPlayer, busy, aiBusy, presentationPaused, trickSettling, pace]);

  const apply = async (action: () => Promise<GameState>) => {
    if (actionLockRef.current) return;
    actionLockRef.current = true;
    setBusy(true);
    setAutomaticPaused(false);
    setError("");
    socketGenerationRef.current += 1;
    manuallyStoppedRef.current = true;
    socketRef.current?.close(1000, "position-changed");
    setAnalysis(null);
    try {
      const next = await action();
      if (!mountedRef.current) return;
      commitGame(next);
      setSelected(null);
    } catch (reason) {
      const typed = reason as Error & { current?: GameState };
      if (typed.current) commitGame(typed.current);
      setError(typed.message);
    } finally {
      actionLockRef.current = false;
      setBusy(false);
    }
  };

  const analyze = () => {
    if (!game?.canAnalyze || scene) return;
    socketGenerationRef.current += 1;
    socketRef.current?.close(1000, "replaced");
    const generation = socketGenerationRef.current;
    terminalRef.current = false;
    manuallyStoppedRef.current = false;
    sequenceRef.current = 0;
    setAnalysis({ status: "analyzing", message: "Preparant mans compatibles…" });
    const socket = analysisSocket(game.id, budget);
    socketRef.current = socket;
    socket.onmessage = (event) => {
      if (generation !== socketGenerationRef.current) return;
      try {
        const update = JSON.parse(event.data) as AnalysisUpdate;
        if ((update.sequence ?? 0) <= sequenceRef.current && update.sequence !== undefined) return;
        sequenceRef.current = update.sequence ?? sequenceRef.current + 1;
        if (update.status === "complete" || update.status === "cancelled" || update.status === "error") terminalRef.current = true;
        setAnalysis((current) => update.status === "error" && current?.candidates?.length
          ? { ...current, ...update, candidates: current.candidates }
          : update);
      } catch {
        terminalRef.current = true;
        setAnalysis((current) => ({ ...current, status: "error", terminalReason: "engineError", message: "El motor ha retornat una resposta que no es pot llegir." }));
      }
    };
    socket.onerror = () => undefined;
    socket.onclose = () => {
      if (generation !== socketGenerationRef.current || terminalRef.current || manuallyStoppedRef.current) return;
      terminalRef.current = true;
      setAnalysis((current) => ({
        ...current,
        status: "error",
        terminalReason: "connectionLost",
        message: "S’ha interromput la connexió. Conservem l’últim càlcul disponible.",
      }));
    };
  };

  const stopAnalysis = () => {
    manuallyStoppedRef.current = true;
    terminalRef.current = true;
    socketRef.current?.close(1000, "user-cancelled");
    setAnalysis((current) => current ? { ...current, status: "cancelled", terminalReason: "cancelled", message: "Anàlisi aturada manualment." } : null);
  };

  if (!game && !error) return <Loading label="Recuperant la taula…" />;
  if (!game) return <EmptyState title="No hem trobat la partida" message={error} onBack={() => navigate("/")} />;

  const top = analysis?.candidates?.[0];
  const trainingWarning = game.mode === "training" && selected && top && selected.id !== top.card.id;
  const firstLeader = (game.dealer + 1) % 4;
  const visualTrick = scene?.completed?.cards ?? game.currentTrick;
  const displayedPoints = scene?.completed ? scene.previousPoints : game.teamPoints;
  const displayedScore = scene?.completed ? scene.previousMatch : game.matchScore;
  const winner = winningCard(visualTrick, game.contract);
  const bidding = game.phase === "bidding" || game.phase === "doubling";
  const humanTurn = game.currentPlayer === game.humanSeat;
  const locked = busy || aiBusy || trickSettling || presentationPaused || !humanTurn;
  const status = paused || automaticPaused ? "Taula en pausa" : scene?.stage === "result" || scene?.stage === "collecting" ? `${seatLabels[scene.completed!.winner]} guanya la basa` : scene ? "Carta a la taula" : humanTurn ? "És el teu torn" : `Torn de ${seatLabels[game.currentPlayer]}`;
  const selectCard = (card: Card) => {
    if (locked || !game.legalCards.includes(card.id)) return;
    if (!confirmPlay && game.mode !== "training") void apply(() => api.play(game, card));
    else setSelected((previous) => previous?.id === card.id ? null : card);
  };
  const analysisGame = { ...game, canAnalyze: game.canAnalyze && !trickSettling };
  const chooseSuggestion = (card: Card) => {
    if (!analysisGame.canAnalyze || !game.legalCards.includes(card.id)) return;
    setSelected(card);
    setPanel(null);
  };
  const openInLab = () => {
    if (!game.contract) return;
    const history = game.completedTricks.flatMap((trick) => trick.cards).concat(game.currentTrick).map((play) => ({ seat: play.seat, cardId: play.card.id }));
    sessionStorage.setItem("lleidapeix:position-draft", JSON.stringify({
      actorSeat: game.humanSeat,
      actorHand: game.hand.map((card) => card.id),
      contract: game.contract,
      firstLeader: game.completedTricks[0]?.leader ?? game.currentTrick[0]?.seat ?? firstLeader,
      history,
    }));
    navigate("/analisi");
  };
  return (
    <TrumpProvider contract={game.contract}><div className="game-layout table-experience" data-game-phase={game.phase} data-current-player={game.currentPlayer} data-scene={scene?.stage ?? "idle"} data-paused={presentationPaused}>
      <section className="game-main">
        <div className="game-toolbar">
          <button className="tool-button" onClick={() => navigate("/")} aria-label="Surt de la taula"><ArrowLeft size={20} /></button>
          <div className="scoreboard" aria-label={`Marcador: nosaltres ${displayedScore[0]}, rivals ${displayedScore[1]}`}>
            <span><small>Nosaltres</small><strong>{displayedScore[0]}</strong></span><i>:</i><span><strong>{displayedScore[1]}</strong><small>Rivals</small></span>
          </div>
          <div className="table-tools">
            <button className="tool-button" disabled={bidding} onClick={() => setPaused(!paused)} aria-label={paused ? "Reprèn la partida" : "Pausa la partida"} aria-pressed={paused}>{paused ? <Play size={19} /> : <Pause size={19} />}</button>
            <button className="tool-button" onClick={() => setPanel("history")} aria-label="Historial de bases"><History size={20} /></button>
            <button className="tool-button" onClick={() => setPanel("settings")} aria-label="Opcions de la taula"><Settings2 size={20} /></button>
          </div>
        </div>
        <div className="round-heading"><span>Mà {game.handNumber}<i />{game.mode === "match" ? "Partida a 101" : game.mode === "training" ? "Entrenament" : "Una mà"}</span><ContractBadge contract={game.contract} multiplier={game.multiplier} /></div>
        {bidding && <div className="bidding-intro"><span className="section-kicker">Una bona mà comença aquí</span><h1>{game.phase === "bidding" ? "Primer, mira les cartes." : "El trumfo està decidit."}</h1><p>Reparteix {seatLabels[game.dealer].toLowerCase()}. Surt {seatLabels[firstLeader].toLowerCase()}.</p></div>}

        {!bidding && (game.phase === "playing" || scene) && <div className="table-wrap">
          <div className={`card-table${scene?.stage === "collecting" ? " collecting" : ""}`} data-winner={scene?.completed?.winner}>
            <div className="felt-emblem" aria-hidden="true"><img src="/lleidapeix-engine.webp" alt="" /><span>LLEIDAPEIX</span></div>
            <PlayerSeat seat={2} game={game} position="north" resting={Boolean(scene || presentationPaused)} />
            <PlayerSeat seat={3} game={game} position="west" resting={Boolean(scene || presentationPaused)} />
            <PlayerSeat seat={1} game={game} position="east" resting={Boolean(scene || presentationPaused)} />
            <div className="table-center">
              <div className="trick-counter">BASA {Math.min(12, game.completedTricks.length + (scene?.completed ? 0 : 1))}<span> / 12</span></div>
              <div className="trick-zone">
                {visualTrick.length === 0 && <span className="empty-trick">{game.phase === "playing" ? "La pròxima basa és vostra." : "Mà completada"}</span>}
                {visualTrick.map((play, index) => <div className={`trick-card seat-${play.seat}${winner?.seat === play.seat ? " winning-card" : ""}`} key={`${play.seat}-${play.card.id}`} style={{ zIndex: index + 1 }}><div className="card-flight"><CardView card={play.card} compact /></div></div>)}
              </div>
              {scene?.completed && scene.stage !== "arriving" && <div className="trick-result" role="status"><Trophy size={15} /><strong>{seatLabels[scene.completed.winner]}</strong><span>+{scene.completed.points} punts</span></div>}
            </div>
            <PlayerSeat seat={0} game={game} position="south" resting={Boolean(scene || presentationPaused)} />
            {(paused || automaticPaused) && <div className="table-pause"><Pause size={25} /><strong>Fes una pausa</strong><span>La partida queda desada.</span><button className="button" onClick={() => { setPaused(false); setAutomaticPaused(false); setError(""); }}>Reprèn la partida <Play size={17} /></button></div>}
          </div>
          <div className="hand-score"><span>Nosaltres <b>{displayedPoints[0]}</b></span><div className="points-track" aria-hidden="true"><span style={{ width: `${displayedPoints[0] / 72 * 100}%` }} /><i style={{ width: `${displayedPoints[1] / 72 * 100}%` }} /></div><span>Rivals <b>{displayedPoints[1]}</b></span></div>
        </div>}

        {(bidding || game.phase === "playing" || scene) && <div className={`hand-dock${bidding ? " bidding-hand" : ""}`}>
          <div className="turn-line"><div aria-live="polite"><span className={humanTurn && !locked ? "live-dot" : "thinking-dot"} /><strong>{bidding ? "La teva mà" : status}</strong></div><span className="hand-count">{game.hand.length} cartes</span></div>
          <PlayerHand game={game} selected={selected} locked={locked} select={selectCard} bidding={bidding} />
          {!bidding && <p className="play-guidance">{scene?.stage === "result" ? "Les quatre cartes es recullen per a la parella guanyadora." : selected ? `${cardName(selected, notation)} seleccionada. Torna-la a tocar per cancel·lar.` : playGuidance(game)}</p>}
          {!bidding && <div className="play-actions">
            {trainingWarning && <p className="training-warning"><Sparkles size={17} /> El motor prefereix {cardName(top.card, notation)}. Pots jugar igualment.</p>}
            {scene?.stage === "result" && reviewEachTrick ? <button className="button primary" onClick={() => setScene((current) => current ? { ...current, stage: "collecting" } : null)} disabled={presentationPaused}>Continua la partida <ChevronRight size={18} /></button> : confirmPlay || selected || game.mode === "training" ? <button className="button primary confirm-card" aria-label="Confirma la carta" disabled={!selected || locked} onClick={() => selected && apply(() => api.play(game, selected))}>{busy ? <LoaderCircle className="spin" size={18} /> : <Check size={18} />}<span>{selected ? `Juga ${cardName(selected, notation)}` : "Tria una carta"}</span></button> : <span className="one-tap-note">Toca una carta per jugar-la</span>}
            <button className="button analysis-launch" aria-label="Ajuda del motor" onClick={() => setPanel("analysis")}><BrainCircuit size={19} /><span>Ajuda del motor</span></button>
          </div>}
        </div>
        }
        {game.phase === "bidding" && <>
          <Bidding game={game} busy={busy} choose={(contract, delegate) => apply(() => api.contract(game, contract, delegate))} />
        </>}
        {game.phase === "doubling" && <DoublingPanel game={game} busy={busy || aiBusy} respond={(raise) => apply(() => api.doubling(game, raise))} />}
        {(game.phase === "handOver" || game.phase === "matchOver") && !trickSettling && <HandFinished game={game} busy={busy} onHistory={() => setPanel("history")} onNext={() => apply(() => api.nextHand(game))} onHome={() => navigate("/")} />}
        {error && <p className="error-message floating">{error}</p>}
      </section>

      <div className="analysis-rail"><AnalysisPanel game={analysisGame} analysis={analysis} budget={budget} setBudget={setBudget} analyze={analyze} stop={stopAnalysis} select={chooseSuggestion} /><div className="rail-footer"><BookOpen size={17} /><p><strong>La taula, al teu ritme.</strong>Pausa la partida o torna a veure qualsevol basa amb els controls de dalt.</p></div></div>
      {panel === "analysis" && <Sheet contract={game.contract} multiplier={game.multiplier} title="Ajuda del motor" className="engine-sheet" close={() => setPanel(null)}><AnalysisPanel game={analysisGame} analysis={analysis} budget={budget} setBudget={setBudget} analyze={analyze} stop={stopAnalysis} select={chooseSuggestion} />{analysisGame.canAnalyze && <button className="lab-link" onClick={openInLab}><BrainCircuit size={17} /> Obre aquesta posició al laboratori</button>}</Sheet>}
      {panel === "history" && <Sheet contract={game.contract} multiplier={game.multiplier} title="Les bases d’aquesta mà" close={() => setPanel(null)}><TrickHistory tricks={game.completedTricks} /></Sheet>}
      {panel === "settings" && <Sheet contract={game.contract} multiplier={game.multiplier} title="Al teu ritme" close={() => setPanel(null)}>
        <div className="table-settings">
          <label className="setting-row"><span><strong>Ritme de joc</strong><small>Temps entre cartes i per llegir cada basa.</small></span><select aria-label="Ritme de joc" value={pace} onChange={(event) => setPace(event.target.value as GamePace)}><option value="relaxed">Calmat</option><option value="normal">Normal</option><option value="quick">Àgil</option></select></label>
          <label className="setting-row"><span><strong>Revisa cada basa</strong><small>Continua amb un botó quan hagis vist les quatre cartes.</small></span><input type="checkbox" role="switch" checked={reviewEachTrick} onChange={(event) => setReviewEachTrick(event.target.checked)} /></label>
          <label className="setting-row"><span><strong>Confirma abans de jugar</strong><small>Selecciona una carta i confirma-la. Sempre actiu en entrenament.</small></span><input type="checkbox" role="switch" checked={confirmPlay || game.mode === "training"} disabled={game.mode === "training"} onChange={(event) => setConfirmPlay(event.target.checked)} /></label>
          <div className="setting-row"><span><strong>Noms de les cartes</strong><small>Lletres tradicionals o valors numèrics.</small></span><NotationToggle /></div>
          <div className="setting-context"><span>Reparteix <b>{seatNames[game.dealer]}</b></span><span>Tria trumfo <b>{seatNames[game.declarer ?? game.dealer]}</b></span><span>Primera sortida <b>{seatNames[firstLeader]}</b></span></div>
          {game.canAnalyze && <button className="lab-link" onClick={openInLab}><BrainCircuit size={17} /> Obre aquesta posició al laboratori</button>}
        </div>
      </Sheet>}
    </div></TrumpProvider>
  );
}

function PlayerSeat({ seat, game, position, resting }: { seat: number; game: GameState; position: string; resting: boolean }) {
  const active = !resting && game.currentPlayer === seat && game.phase === "playing";
  return <div className={`player-seat ${position}${active ? " active" : ""}`}><span className={`avatar team-${seat % 2}`}>{seat === 0 ? "T" : seat === 2 ? "C" : seat === 1 ? "L" : "P"}</span><div><strong>{seatLabels[seat]}</strong><small>{game.handCounts[seat]} cartes</small></div>{active && <i />}</div>;
}

function NotationToggle({ compact = false }: { compact?: boolean }) {
  const { notation, setNotation } = useNotation();
  return <div className={`notation-toggle${compact ? " compact" : ""}`} role="group" aria-label="Nomenclatura de les cartes">
    <button type="button" className={notation === "letters" ? "active" : ""} onClick={() => setNotation("letters")} aria-pressed={notation === "letters"}>Lletres</button>
    <button type="button" className={notation === "numbers" ? "active" : ""} onClick={() => setNotation("numbers")} aria-pressed={notation === "numbers"}>Números</button>
  </div>;
}

function Bidding({ game, busy, choose }: { game: GameState; busy: boolean; choose: (contract: Contract | null, delegate: boolean) => void }) {
  return (
    <section className="bidding-panel">
      <span className="section-kicker">Ara que has vist la mà</span><h2>Quin trumfo tries?</h2><p>Pots escollir un pal, jugar botifarra o delegar la decisió al company.</p>
      <div className="suit-options">
        {(["oros", "copes", "espases", "bastos"] as Suit[]).map((suit) => <button key={suit} disabled={busy} onClick={() => choose({ kind: "trump", suit }, false)}><SuitMark suit={suit} /><span>{suitNames[suit]}</span></button>)}
      </div>
      <div className="bid-secondary"><button disabled={busy} onClick={() => choose({ kind: "botifarra" }, false)}>BOTIFARRA <small>Sense trumfo · punts dobles</small></button><button disabled={busy} onClick={() => choose(null, true)}>DELEGA <small>Decideix el company</small></button></div>
    </section>
  );
}

const doublingLabels: Record<DoublingCall, string> = {
  contro: "Contro",
  recontro: "Recontro",
  santVicenc: "Sant Vicenç",
};

function currentDoublingCall(game: GameState): DoublingCall {
  if (game.doublingLevel === 0) return "contro";
  if (game.doublingLevel === 1) return "recontro";
  return "santVicenc";
}

function DoublingPanel({ game, busy, respond }: { game: GameState; busy: boolean; respond: (raise: boolean) => void }) {
  const call = currentDoublingCall(game);
  const humanTurn = game.currentPlayer === game.humanSeat;
  return <section className="doubling-panel" aria-live="polite">
    <div className="doubling-heading">
      <div><span className="section-kicker">Abans de la primera carta</span><h2>{humanTurn ? `Vols dir ${doublingLabels[call]}?` : `${seatNames[game.currentPlayer]} valora el cant`}</h2></div>
      <span className="risk-multiplier"><small>ARA</small>×{game.multiplier}<i /> <small>SI PUJA</small>×{game.multiplier * 2}</span>
    </div>
    <p>{humanTurn ? "Pots apujar el valor de la mà o dir «Bé» i cedir la decisió a l’altre membre de la parella." : "La IA està valorant les figures, el control del trumfo i la distribució de la seva mà."}</p>
    {game.doublingHistory.length > 0 && <div className="doubling-history" aria-label="Historial del cant">{game.doublingHistory.map((record, index) => <span className={record.decision === "raise" ? "raised" : "passed"} key={`${record.seat}-${record.call}-${index}`}><b>{seatNames[record.seat]}</b>{record.decision === "raise" && record.call ? doublingLabels[record.call] : "Bé"}</span>)}</div>}
    {humanTurn ? <div className="doubling-actions"><button type="button" className="button ghost" disabled={busy} onClick={() => respond(false)}>Bé, passo</button><button type="button" className="button risk" disabled={busy} onClick={() => respond(true)}>{doublingLabels[call]} <small>La mà passarà a ×{game.multiplier * 2}</small></button></div> : <div className="doubling-thinking"><LoaderCircle className="spin" size={18} /> Esperant la decisió…</div>}
    <small className="doubling-rule">No sortirà cap carta fins que les dues parelles hagin tancat el cant.</small>
  </section>;
}

function AnalysisPanel({ game, analysis, budget, setBudget, analyze, stop, select }: { game: GameState; analysis: AnalysisUpdate | null; budget: number; setBudget: (value: number) => void; analyze: () => void; stop: () => void; select: (card: Card) => void }) {
  const { notation } = useNotation();
  const budgetId = useId();
  const running = analysis?.status === "analyzing" || analysis?.status === "queued";
  const stateLabel = analysis?.status === "queued" ? "En cua" : running ? "Calculant" : analysis?.status === "complete" ? "Completada" : analysis?.status === "error" ? "Incidència" : analysis?.status === "cancelled" ? "Aturada" : "Preparat";
  return (
    <aside className="analysis-panel">
      <ContractBadge contract={game.contract} multiplier={game.multiplier} />
      <div className="analysis-heading"><div className="analysis-title"><img src="/lleidapeix-engine.webp" alt="" /><div><span className="section-kicker">Taula de càlcul</span><h2>Anàlisi en viu</h2></div></div><span className={`engine-state ${running ? "running" : analysis?.status === "error" ? "error" : ""}`}><i /> {stateLabel}</span></div>
      <div className="budget-picker"><label htmlFor={budgetId}>Temps de càlcul</label><select id={budgetId} value={budget} onChange={(event) => setBudget(Number(event.target.value))}><option value={150}>Ràpid · 150 ms</option><option value={500}>Normal · 500 ms</option><option value={1500}>Profund · 1,5 s</option><option value={5000}>Expert · 5 s</option></select></div>
      <button className="button analyze-button" disabled={!game.canAnalyze} onClick={running ? stop : analyze}>{running ? <><CircleStop size={18} /> Atura</> : <><Cpu size={18} /> Analitza el torn</>}</button>
      {!game.canAnalyze && game.phase === "playing" && <p className="muted-note">L’anàlisi s’activarà quan torni a ser el teu torn.</p>}
      {analysis?.message && <p className="analysis-message">{analysis.message}</p>}
      {analysis?.candidates && analysis.candidates.length > 0 ? <div className="candidate-list">
        {analysis.candidates.slice(0, 3).map((candidate, index) => <article className="candidate" key={candidate.card.id}><span className="candidate-rank">0{index + 1}</span><CardView card={candidate.card} compact /><div className="candidate-copy"><strong>{cardName(candidate.card, notation)}</strong><p>{candidate.explanation}</p><div className="candidate-meter"><span style={{ width: `${Math.max(5, candidate.winProbability * 100)}%` }} /></div><small>EV {candidate.expectedPoints > 0 ? "+" : ""}{candidate.expectedPoints} · {Math.round(candidate.winProbability * 100)}% favorable</small><button type="button" className="choose-candidate" disabled={!game.canAnalyze} onClick={() => select(candidate.card)}>Selecciona {cardName(candidate.card, notation)} <ChevronRight size={14} /></button></div></article>)}
      </div> : <div className="analysis-empty"><BarChart3 /><h3>Encara sense variants</h3><p>Quan sigui el teu torn, demana al motor que compari totes les cartes legals.</p></div>}
      {analysis?.simulations !== undefined && <div className="engine-metrics"><span><small>SIMULACIONS</small><b>{analysis.simulations.toLocaleString("ca")}</b></span><span><small>NODES/S</small><b>{analysis.nodesPerSecond?.toLocaleString("ca")}</b></span><span><small>CONFIANÇA</small><b>{Math.round((analysis.confidence || 0) * 100)}%</b></span></div>}
      <div className="privacy-seal"><ShieldCheck size={20} /><p><strong>Joc net per disseny</strong>El motor només rep les cartes i deduccions que podries conèixer.</p></div>
      {analysis?.status === "error" && <button className="analysis-retry" type="button" disabled={!game.canAnalyze} onClick={analyze}>Torna-ho a provar</button>}
    </aside>
  );
}

function HandFinished({ game, busy, onNext, onHome, onHistory }: { game: GameState; busy: boolean; onNext: () => void; onHome: () => void; onHistory: () => void }) {
  const result = game.handResult!;
  const matchOver = game.phase === "matchOver";
  const won = matchOver ? game.matchScore[0] >= 101 : result.teamPoints[0] > 36;
  const tied = !matchOver && result.teamPoints[0] === 36;
  return <section className={`hand-finished${won ? " won" : ""}`}>
    <span className="finish-emblem"><Trophy size={34} /></span><span className="section-kicker">{matchOver ? "Partida completada" : "Les dotze bases, jugades"}</span>
    <h2>{tied ? "Una mà ben igualada." : won ? matchOver ? "La partida és vostra." : "Us emporteu la mà." : matchOver ? "La partida és dels rivals." : "Els rivals guanyen la mà."}</h2>
    <p className="result-description">{tied ? "36 punts per parella. El marcador no es mou." : `${won ? "Sumeu" : "Els rivals sumen"} ${Math.max(...result.awarded)} punts al marcador${result.multiplier > 1 ? ` amb el multiplicador ×${result.multiplier}` : ""}.`}</p>
    <div className="result-numbers"><span><small>Nosaltres</small><strong>{result.teamPoints[0]}</strong><em>+{result.awarded[0]} al marcador</em></span><span><small>Rivals</small><strong>{result.teamPoints[1]}</strong><em>+{result.awarded[1]} al marcador</em></span></div>
    <button className="finish-history" onClick={onHistory}><History size={18} /> Revisa les 12 bases <ChevronRight size={17} /></button>
    {matchOver || game.mode === "quick" ? <button className="button primary" onClick={onHome}><Play size={17} /> Torna a l’inici</button> : <button className="button primary" disabled={busy} onClick={onNext}>{busy ? <LoaderCircle className="spin" /> : <RefreshCw />} Reparteix la mà següent</button>}
  </section>;
}

const rankStrength: Record<Card["rank"], number> = {
  dos: 0, tres: 1, quatre: 2, cinc: 3, sis: 4, set: 5,
  vuit: 6, sota: 7, cavall: 8, rei: 9, as: 10, manilla: 11,
};
const rankPoints: Record<Card["rank"], number> = {
  dos: 0, tres: 0, quatre: 0, cinc: 0, sis: 0, set: 0,
  vuit: 0, sota: 1, cavall: 2, rei: 3, as: 4, manilla: 5,
};

function positionWinner(cards: PositionHistoryPlay[], contract: Contract): PositionHistoryPlay {
  const lead = fullDeck[cards[0].cardId].suit;
  const trump = contract.kind === "trump" ? contract.suit : null;
  return cards.slice(1).reduce((winner, candidate) => {
    const current = fullDeck[winner.cardId];
    const next = fullDeck[candidate.cardId];
    const beats = next.suit === current.suit
      ? rankStrength[next.rank] > rankStrength[current.rank]
      : next.suit === trump && current.suit !== trump
        ? true
        : current.suit === trump
          ? false
          : next.suit === lead && current.suit !== lead;
    return beats ? candidate : winner;
  }, cards[0]);
}

function summarizeHistory(history: PositionHistoryPlay[], contract: Contract, firstLeader: number) {
  let expectedSeat = firstLeader;
  const tricks: { cards: PositionHistoryPlay[]; winner: number | null; points: number }[] = [];
  let current: PositionHistoryPlay[] = [];
  let valid = true;
  for (const play of history) {
    if (play.seat !== expectedSeat) valid = false;
    current.push(play);
    if (current.length === 4) {
      const winner = positionWinner(current, contract).seat;
      tricks.push({ cards: current, winner, points: 1 + current.reduce((sum, item) => sum + rankPoints[fullDeck[item.cardId].rank], 0) });
      current = [];
      expectedSeat = winner;
    } else {
      expectedSeat = (play.seat + 1) % 4;
    }
  }
  if (current.length) tricks.push({ cards: current, winner: null, points: 0 });
  return { expectedSeat, tricks, valid };
}

interface PositionDraft {
  actorSeat: number;
  actorHand: number[];
  contract: Contract;
  firstLeader: number;
  history: PositionHistoryPlay[];
}

function loadPositionDraft(): PositionDraft | null {
  try {
    const raw = sessionStorage.getItem("lleidapeix:position-draft");
    if (!raw) return null;
    sessionStorage.removeItem("lleidapeix:position-draft");
    return JSON.parse(raw) as PositionDraft;
  } catch {
    return null;
  }
}

function PositionLab({ navigate }: { navigate: (path: string) => void }) {
  const draftRef = useRef<PositionDraft | null>(loadPositionDraft());
  const draft = draftRef.current;
  const { notation } = useNotation();
  const [selected, setSelected] = useState<number[]>(draft?.actorHand ?? []);
  const [contract, setContract] = useState<Contract>(draft?.contract ?? { kind: "trump", suit: "oros" });
  const [actorSeat, setActorSeat] = useState(draft?.actorSeat ?? 0);
  const [firstLeader, setFirstLeader] = useState(draft?.firstLeader ?? 0);
  const [history, setHistory] = useState<PositionHistoryPlay[]>(draft?.history ?? []);
  const [editorMode, setEditorMode] = useState<"history" | "hand">(draft ? "hand" : "history");
  const [budgetMs, setBudgetMs] = useState(1500);
  const [result, setResult] = useState<AnalysisUpdate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const summary = summarizeHistory(history, contract, firstLeader);
  const playedIds = new Set(history.map((play) => play.cardId));
  const actorPlayed = history.filter((play) => play.seat === actorSeat).length;
  const expectedHandSize = Math.max(0, 12 - actorPlayed);
  const canAnalyze = summary.valid && summary.expectedSeat === actorSeat && expectedHandSize > 0 && selected.length === expectedHandSize;

  const changeContext = (nextContract: Contract, nextFirstLeader = firstLeader) => {
    setContract(nextContract);
    setFirstLeader(nextFirstLeader);
    setHistory([]);
    setSelected([]);
    setResult(null);
    setError("");
  };
  const pickCard = (id: number) => {
    setResult(null);
    setError("");
    if (editorMode === "history") {
      if (playedIds.has(id) || selected.includes(id) || history.length >= 47) return;
      setHistory((current) => [...current, { seat: summary.expectedSeat, cardId: id }]);
      return;
    }
    setSelected((current) => current.includes(id)
      ? current.filter((value) => value !== id)
      : current.length < expectedHandSize && !playedIds.has(id) ? [...current, id] : current);
  };
  const undoHistory = () => {
    setHistory((current) => current.slice(0, -1));
    setSelected([]);
    setResult(null);
  };
  const analyze = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(await api.analyzePosition({ actorSeat, actorHand: selected, contract, firstLeader, history, budgetMs }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No s’ha pogut analitzar");
    } finally {
      setBusy(false);
    }
  };

  return <TrumpProvider contract={contract}><div className="page-width lab-page">
    <div className="lab-topbar"><button className="icon-text" onClick={() => navigate("/")}><ArrowLeft size={18} /> Inici</button><NotationToggle /></div>
    <header className="page-intro"><span className="section-kicker">Anàlisi de posició</span><h1>Reconstrueix la mà.<br /><em>Troba la millor jugada.</em></h1><p>Introdueix les cartes en l’ordre en què han sortit. LleidaPeix calcularà el torn, les bases i només provarà repartiments compatibles.</p></header>
    <section className="position-context" aria-label="Context de la posició">
      <label>Contracte<select aria-label="Contracte" disabled={history.length > 0} value={contract.kind === "botifarra" ? "botifarra" : contract.suit} onChange={(event) => changeContext(event.target.value === "botifarra" ? { kind: "botifarra" } : { kind: "trump", suit: event.target.value as Suit })}><option value="oros">Oros</option><option value="copes">Copes</option><option value="espases">Espases</option><option value="bastos">Bastos</option><option value="botifarra">Botifarra</option></select></label>
      <label>Primera sortida<select disabled={history.length > 0} value={firstLeader} onChange={(event) => changeContext(contract, Number(event.target.value))}>{seatNames.map((name, seat) => <option value={seat} key={name}>{name}</option>)}</select></label>
      <label>Mà que analitzes<select value={actorSeat} onChange={(event) => { setActorSeat(Number(event.target.value)); setSelected([]); setResult(null); }}>{seatNames.map((name, seat) => <option value={seat} key={name}>{name}</option>)}</select></label>
      <label>Temps de càlcul<select value={budgetMs} onChange={(event) => setBudgetMs(Number(event.target.value))}><option value={500}>Normal · 500 ms</option><option value={1500}>Profund · 1,5 s</option><option value={3000}>Expert · 3 s</option></select></label>
    </section>
    <div className="lab-contract"><ContractBadge contract={contract} /></div>
    <div className="lab-grid position-lab-grid">
      <section className="deck-builder">
        <div className="builder-toolbar"><div className="editor-tabs" role="tablist" aria-label="Pas de l’editor"><button type="button" role="tab" aria-selected={editorMode === "history"} className={editorMode === "history" ? "active" : ""} onClick={() => setEditorMode("history")}>1. Cartes jugades</button><button type="button" role="tab" aria-selected={editorMode === "hand"} className={editorMode === "hand" ? "active" : ""} onClick={() => setEditorMode("hand")}>2. Mà actual</button></div><strong>{editorMode === "history" ? `${history.length} jugades` : `${selected.length} / ${expectedHandSize} cartes`}</strong></div>
        <div className="editor-guidance"><span>{editorMode === "history" ? `Ara juga: ${seatNames[summary.expectedSeat]}` : `Selecciona les ${expectedHandSize} cartes que conserva ${seatNames[actorSeat]}`}</span>{history.length > 0 && <button type="button" onClick={undoHistory}>Desfés l’última jugada</button>}</div>
        {(["oros", "copes", "espases", "bastos"] as Suit[]).map((suit) => <div className="deck-suit" key={suit}><h3><SuitMark suit={suit} /> {suitNames[suit]}</h3><div>{fullDeck.filter((card) => card.suit === suit).map((card) => {
          const unavailable = editorMode === "history" ? playedIds.has(card.id) || selected.includes(card.id) : playedIds.has(card.id);
          return <CardView key={card.id} card={card} compact playable={!unavailable} selected={editorMode === "hand" && selected.includes(card.id)} onClick={() => pickCard(card.id)} />;
        })}</div></div>)}
      </section>
      <aside className="lab-controls position-review">
        <span className="section-kicker">Revisió</span><h2>{summary.tricks.length ? `${summary.tricks.length} bases registrades` : "Posició inicial"}</h2>
        <div className="history-timeline">{summary.tricks.map((trick, index) => <article key={index} className={trick.winner === null ? "current" : ""}><div><b>{trick.winner === null ? "Basa en curs" : `Basa ${index + 1}`}</b><small>{trick.winner === null ? `Torn de ${seatNames[summary.expectedSeat]}` : `Guanya ${seatNames[trick.winner]} · ${trick.points} punts`}</small></div><div>{trick.cards.map((play) => <span key={`${play.seat}-${play.cardId}`} title={seatNames[play.seat]}><CardView card={fullDeck[play.cardId]} compact /></span>)}</div></article>)}</div>
        {!summary.tricks.length && <p className="position-empty">Sense historial: estàs analitzant la primera sortida.</p>}
        <div className={`position-readiness${canAnalyze ? " ready" : ""}`}><b>{canAnalyze ? "Posició preparada" : "Encara falta informació"}</b><span>{summary.expectedSeat !== actorSeat ? `Ara és el torn de ${seatNames[summary.expectedSeat]}.` : selected.length !== expectedHandSize ? `Falten ${Math.max(0, expectedHandSize - selected.length)} cartes de la mà.` : "El motor pot començar."}</span></div>
        <button className="button primary" disabled={!canAnalyze || busy} onClick={analyze}>{busy ? <LoaderCircle className="spin" /> : <BrainCircuit />} {history.length ? "Calcula la millor jugada" : "Calcula la sortida"}</button>
        {error && <p className="error-message">{error}</p>}
        {result?.candidates?.slice(0, 4).map((candidate, index) => <article className="lab-result" key={candidate.card.id}><b>#{index + 1}</b><CardView card={candidate.card} compact /><span><strong>{cardName(candidate.card, notation)}</strong><small>EV {candidate.expectedPoints > 0 ? "+" : ""}{candidate.expectedPoints} · {Math.round(candidate.winProbability * 100)}%</small></span></article>)}
      </aside>
    </div>
  </div></TrumpProvider>;
}

function Rules({ navigate }: { navigate: (path: string) => void }) {
  return <div className="page-width text-page"><button className="icon-text" onClick={() => navigate("/")}><ArrowLeft size={18} /> Inici</button><header className="page-intro"><span className="section-kicker">Variant lliure o occidental</span><h1>Regles clares.<br /><em>Càlcul auditable.</em></h1></header><section className="rules-grid"><article><span>01</span><h2>La baralla</h2><p>Quatre jugadors en parelles, 48 cartes i 12 cartes per persona. La manilla és la carta més alta, seguida de l’as, el rei, el cavall i la sota.</p></article><article><span>02</span><h2>L’obligació</h2><p>Cal assistir al pal. Si domina un rival, també cal superar quan sigui possible; sense el pal, cal trumfar si el trumfo pot guanyar.</p></article><article><span>03</span><h2>Els punts</h2><p>Manilla 5, as 4, rei 3, cavall 2, sota 1 i cada basa 1. Dels 72 punts totals, només s’anota l’excés sobre 36.</p></article><article><span>04</span><h2>Contro i recontro</h2><p>Després del trumfo, la parella rival pot dir contro i la declarant pot recontrar. Si no és botifarra, encara es pot dir Sant Vicenç. Cada cant duplica el valor i totes les respostes es fan abans de la primera carta.</p></article><article><span>05</span><h2>El motor</h2><p>LleidaPeix desconeix les mans ocultes. Mostreja repartiments legalment compatibles i mesura com respon cada jugada.</p></article></section><RulesObligations /><details className="engine-method"><summary><span>Metodologia</span>Com calcula LleidaPeix?</summary><div><p><strong>1. Reconstrueix allò que no veu.</strong> Parteix de la teva mà i de totes les cartes jugades. Genera repartiments ocults que respecten el nombre de cartes, els pals fallats i les obligacions observades.</p><p><strong>2. Compara totes les jugades legals.</strong> Una cerca Monte Carlo amb exploració equilibrada prova cada candidata en molts repartiments compatibles. Les continuacions combinen criteris de cartes mestres, trumfos, punts en risc i retorns al company.</p><p><strong>3. Decideix el cant.</strong> Per triar trumfo i valorar contro o recontro, la IA pondera manilles i asos, longitud i control del trumfo, figures protegides, fallos i equilibri de pals. Només utilitza la mà del seient que pren la decisió.</p><p><strong>4. Mesura resultat i incertesa.</strong> L’EV és la diferència esperada de punts de la parella; la confiança indica l’estabilitat estadística de l’estimació. Els valors poden canviar mentre augmenten les simulacions.</p><p><strong>5. Resol els finals petits.</strong> Quan queden molt poques cartes, el motor abandona l’estimació i calcula exactament les continuacions possibles. Fora d’aquests finals, la recomanació és una estimació informada, no una certesa matemàtica.</p></div></details><div className="responsible-note"><ShieldCheck /><p><strong>Privacitat i ús</strong>No hi ha comptes, publicitat ni seguiment. Les partides caduquen automàticament i aquesta eina no gestiona apostes ni diners.</p></div></div>;
}

function Admin({ navigate }: { navigate: (path: string) => void }) {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const load = async () => { setError(""); const response = await fetch("/api/admin/status", { headers: { "x-admin-token": token } }); const body = await response.json(); if (!response.ok) setError(body.error); else setStatus(body); };
  return <div className="page-width admin-page"><button className="icon-text" onClick={() => navigate("/")}><ArrowLeft size={18} /> Inici</button><section className="admin-card"><Gauge /><span className="section-kicker">Accés restringit</span><h1>Estat del motor</h1><label>Credencial administrativa<input type="password" value={token} onChange={(event) => setToken(event.target.value)} /></label><button className="button primary" onClick={load}>Consulta</button>{error && <p className="error-message">{error}</p>}{status && <pre>{JSON.stringify(status, null, 2)}</pre>}</section></div>;
}

function Loading({ label }: { label: string }) { return <div className="loading-page"><LoaderCircle className="spin" /><p>{label}</p></div>; }
function EmptyState({ title, message, onBack }: { title: string; message: string; onBack: () => void }) { return <div className="loading-page"><Swords /><h1>{title}</h1><p>{message}</p><button className="button primary" onClick={onBack}>Torna a l’inici</button></div>; }

function Footer({ navigate }: { navigate: (path: string) => void }) {
  return <footer><div className="brand"><span className="brand-mark"><img src="/engine-icon-192.png" alt="" /></span><span><strong>LleidaPeix</strong><small>Motor de botifarra</small></span></div><p>Fet a Ponent per entendre millor cada carta.</p><div><button onClick={() => navigate("/regles")}>Regles i privacitat</button><a href="/cards/CREDITS.txt">Crèdits de la baralla</a><button onClick={() => navigate("/admin")}>Administració</button></div></footer>;
}
