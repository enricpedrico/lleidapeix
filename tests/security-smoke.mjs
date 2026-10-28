import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";

const directory = await mkdtemp(join(tmpdir(), "lleidapeix-security-"));
const listener = createServer();
await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const token = randomBytes(32).toString("hex");
const base = `http://127.0.0.1:${port}`;
const child = spawn(resolve(process.env.LLEIDAPEIX_BINARY || "target/debug/lleidapeix"), [], {
  env: { ...process.env, PORT: String(port), BIND_ADDRESS: "127.0.0.1", DATABASE_PATH: join(directory, "test.sqlite"), ADMIN_TOKEN: token },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", data => { logs = (logs + data).slice(-12000); });
child.stderr.on("data", data => { logs = (logs + data).slice(-12000); });
let childError;
child.on("error", error => { childError = error; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (childError) throw childError;
    if (child.exitCode !== null) throw new Error("Test server exited");
    try { if (await predicate()) return; } catch { /* server may be starting */ }
    await pause(30);
  }
  throw new Error("Timed out waiting for isolated test server");
}
async function api(path, data) {
  const response = await fetch(base + path, data === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  const body = await response.json();
  assert(response.ok, `${response.status}: ${JSON.stringify(body)}`);
  return body;
}
const status = () => fetch(base + "/api/admin/status", { headers: { "x-admin-token": token } }).then(r => r.json());
try {
  await until(() => fetch(base + "/api/health").then(r => r.ok));
  let game = await api("/api/games", { mode: "quick", difficulty: "easy", seed: 3 });
  for (let i = 0; i < 20 && !(game.phase === "playing" && game.currentPlayer === game.humanSeat); i++) {
    const action = { version: game.version, idempotencyKey: crypto.randomUUID() };
    if (game.phase === "bidding" && game.currentPlayer === game.humanSeat) {
      game = await api(`/api/games/${game.id}/contract`, { ...action, contract: { kind: "botifarra" }, delegate: false });
    } else if (game.phase === "doubling" && game.currentPlayer === game.humanSeat) {
      game = await api(`/api/games/${game.id}/doubling`, { ...action, raise: false });
    } else {
      game = await api(`/api/games/${game.id}/advance`, action);
    }
  }
  assert.equal(game.canAnalyze, true);
  const sockets = [];
  const attempts = Array.from({ length: 12 }, () => new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/games/${game.id}/analysis?budgetMs=10000`);
    sockets.push(socket);
    const timer = setTimeout(() => reject(new Error("WebSocket handshake timeout")), 5000);
    socket.onopen = () => { clearTimeout(timer); resolve(true); };
    socket.onerror = () => { clearTimeout(timer); resolve(false); };
  }));
  const outcomes = await Promise.all(attempts);
  assert.equal(outcomes.filter(Boolean).length, 4, "exactly four bounded analysis admissions");
  for (const socket of sockets) socket.close();
  await until(async () => { const s = await status(); return !s.analysisBusy && s.analysisQueue === 0; });
  console.log("WebSocket: 12 concurrent handshakes, 4 admitted; all engine and queue leases released.");

  const input = { actorHand: Array.from({ length: 12 }, (_, i) => i), actorSeat: 0, firstLeader: 0, history: [], contract: { kind: "botifarra" }, budgetMs: 3000, seed: 44 };
  const abort = new AbortController();
  const running = fetch(base + "/api/positions/analyze", { method: "POST", signal: abort.signal, headers: { "content-type": "application/json" }, body: JSON.stringify(input) }).catch(() => null);
  await until(async () => (await status()).analysisBusy);
  abort.abort();
  const overlapping = await fetch(base + "/api/positions/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  assert.equal(overlapping.status, 429, "disconnecting a client must not release its still-running CPU task");
  await running;
  await until(async () => !(await status()).analysisBusy);
  assert.equal((await api("/api/positions/analyze", { ...input, budgetMs: 100 })).status, "complete");
  console.log("HTTP analysis: disconnect retains the CPU lease, overlapping work returns 429, later work succeeds.");

  const forbidden = await fetch(base + "/api/games", { method: "POST", headers: { "content-type": "application/json", origin: "https://other.example" }, body: JSON.stringify({ mode: "quick" }) });
  assert.equal(forbidden.status, 403);
  const hidden = await fetch(base + "/.env");
  assert(!(await hidden.text()).includes(token));
  console.log("Foreign Origin rejected; runtime credentials are not served as static files.");
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
  }
  await rm(directory, { recursive: true, force: true });
}
