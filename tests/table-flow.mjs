import assert from "node:assert/strict";
import { chromium } from "playwright";
import fs from "node:fs/promises";

const base = process.env.BASE_URL || "http://127.0.0.1:18086";
const request = async (path, body) => {
  const response = await fetch(base + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  assert.ok(response.ok, await response.clone().text());
  return response.json();
};
const count = (game) => game.completedTricks.length * 4 + game.currentTrick.length;
await fs.mkdir("test-results/table-video", { recursive: true });
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, recordVideo: { dir: "test-results/table-video", size: { width: 390, height: 844 } } });
await context.addInitScript(() => {
  localStorage.setItem("lleidapeix:game-pace", "quick");
  localStorage.setItem("lleidapeix:review-tricks", "true");
});
const page = await context.newPage();
const errors = [];
const responses = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", async (response) => {
  if (/\/api\/games\/[^/]+\/(play|advance)$/.test(response.url()) && response.ok()) responses.push(await response.json());
});

const game = await request("/api/games", { mode: "quick", difficulty: "easy", initialDealer: 0, seed: 20260903 });
await page.goto(`${base}/partida/${game.id}`);
await page.getByRole("heading", { name: "Quin trumfo tries?" }).waitFor();
await page.waitForTimeout(700);
for (const size of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
  await page.setViewportSize(size);
  const rects = await page.locator(".full-hand .playing-card").evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().toJSON()));
  assert.equal(rects.length, 12);
  for (const card of rects) {
    assert.ok(card.x >= 0 && card.right <= size.width, `Carta fora de pantalla a ${size.width}`);
    assert.ok(card.width >= 44 && card.height >= 44, `Carta massa petita a ${size.width}: ${card.width}`);
  }
}
await page.setViewportSize({ width: 390, height: 844 });
await page.screenshot({ path: "test-results/table-bidding.png", fullPage: true });
await page.getByRole("button", { name: "Oros", exact: true }).click();
while (await page.locator(".game-layout").getAttribute("data-game-phase") === "doubling") {
  await page.getByRole("button", { name: "Bé, passo" }).click();
  await page.waitForTimeout(80);
}
await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
await page.waitForTimeout(600);
const hiddenCount = count(await request(`/api/games/${game.id}`));
await page.waitForTimeout(900);
assert.equal(count(await request(`/api/games/${game.id}`)), hiddenCount, "La partida avança en una pestanya oculta");
await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); });
for (const expected of [1, 2, 3]) await page.waitForFunction((n) => document.querySelectorAll(".trick-card").length === n, expected);
await page.locator(".full-hand .playable").first().waitFor();
assert.equal(await page.locator(".card-flight").first().evaluate((node) => getComputedStyle(node).animationName), "card-arrive");
const geometry = await page.evaluate(() => ({ board: document.querySelector(".card-table").getBoundingClientRect().toJSON(), action: document.querySelector(".confirm-card").getBoundingClientRect().toJSON(), width: innerWidth, height: innerHeight }));
assert.ok(geometry.board.right <= geometry.width);
assert.ok(geometry.action.bottom <= geometry.height, "Cal fer scroll per jugar al mòbil");
await page.screenshot({ path: "test-results/table-playing.png", fullPage: true });

const selected = page.locator(".full-hand .playable").first();
await selected.click();
assert.equal(await page.locator(".full-hand .selected").count(), 1);
await selected.click();
assert.equal(await page.locator(".full-hand .selected").count(), 0);
await selected.click();
await page.getByRole("button", { name: "Confirma la carta" }).click();
await page.waitForFunction(() => document.querySelector(".game-layout")?.getAttribute("data-scene") === "result");
let actual = await request(`/api/games/${game.id}`);
assert.equal(actual.completedTricks.length, 1);
assert.equal(await page.locator(".trick-card").count(), 4);
assert.equal(await page.locator(".hand-score b").allTextContents().then((values) => values.join(",")), "0,0", "Els punts han pujat abans de recollir la basa");
assert.equal(await page.locator(".winning-card").getAttribute("class").then((value) => value.includes(`seat-${actual.completedTricks[0].winner}`)), true);
await page.waitForTimeout(2000);
assert.equal(count(await request(`/api/games/${game.id}`)), 4, "La revisió manual no atura la partida");
await page.screenshot({ path: "test-results/table-result.png", fullPage: true });

await page.getByRole("button", { name: "Historial de bases" }).click();
const dialog = page.getByRole("dialog");
assert.equal(await dialog.locator(".history-cards .playing-card").count(), 4);
assert.match(await dialog.textContent(), new RegExp(`\\+${actual.completedTricks[0].points} punts`));
await page.screenshot({ path: "test-results/table-history.png" });
await page.keyboard.press("Escape");
assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Historial de bases");

await page.getByRole("button", { name: "Continua la partida" }).click();
await page.waitForFunction(() => document.querySelector(".game-layout")?.getAttribute("data-scene") === "collecting");
assert.equal(await page.locator(".card-flight").first().evaluate((node) => getComputedStyle(node).animationName), "collect-cards");
await page.getByRole("button", { name: "Pausa la partida" }).click();
await page.waitForTimeout(900);
const pausedVersion = (await request(`/api/games/${game.id}`)).version;
await page.waitForTimeout(1300);
assert.equal((await request(`/api/games/${game.id}`)).version, pausedVersion, "Les jugades continuen en pausa");
await page.locator(".table-pause").getByRole("button", { name: /Reprèn la partida/ }).click();

await page.getByRole("button", { name: "Opcions de la taula" }).click();
await page.getByRole("switch", { name: /Revisa cada basa/ }).uncheck();
await page.getByRole("switch", { name: /Confirma abans de jugar/ }).uncheck();
await page.getByRole("button", { name: "Números" }).click();
await page.getByRole("button", { name: "Tanca el panell" }).click();
let humanMoves = 1;
while (true) {
  const outcome = await page.waitForFunction(() => {
    if (document.querySelector(".hand-finished")) return "complete";
    if (document.querySelector(".full-hand .playable")) return "human";
    return false;
  }, undefined, { timeout: 20000 });
  if (await outcome.jsonValue() === "complete") break;
  await page.locator(".full-hand .playable").first().click();
  humanMoves++;
  assert.ok(humanMoves <= 12);
  await page.waitForTimeout(90);
}
actual = await request(`/api/games/${game.id}`);
assert.equal(actual.phase, "handOver");
assert.equal(actual.completedTricks.length, 12);
assert.equal(actual.teamPoints.reduce((a, b) => a + b), 72);
assert.equal(humanMoves, 12);
assert.equal(responses.length, 48, "Cada carta ha de correspondre a una sola acció");
responses.forEach((response, index) => assert.equal(count(response), index + 1, "S’han saltat o duplicat cartes"));
await page.screenshot({ path: "test-results/table-finished.png", fullPage: true });
await page.getByRole("button", { name: "Historial de bases" }).click();
assert.equal(await page.locator(".trick-history article").count(), 12);
await page.keyboard.press("Escape");
await page.reload();
await page.getByRole("button", { name: "Opcions de la taula" }).click();
assert.equal(await page.getByRole("switch", { name: /Confirma abans de jugar/ }).isChecked(), false);
assert.equal(await page.getByRole("button", { name: "Números" }).getAttribute("aria-pressed"), "true");
assert.deepEqual(errors, []);
await context.close();
await browser.close();
console.log(JSON.stringify({ status: "ok", humanMoves, cards: responses.length, tricks: actual.completedTricks.length, points: actual.teamPoints, checks: ["all cards visible", "44px targets", "one-screen play", "hidden tab", "manual trick review", "winner", "score timing", "pause", "history", "focus", "one-tap play", "48 sequential actions", "persistence"] }));
