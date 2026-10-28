import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright-core";

const base = process.env.BASE_URL || "http://127.0.0.1:18085";
const executablePath = process.env.CHROME_PATH || "/usr/bin/google-chrome";
await fs.mkdir("test-results", { recursive: true });

async function post(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(data)}`);
  return data;
}

const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });

async function assertFits(page) {
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(dimensions.width <= dimensions.viewport + 1, `desbordament horitzontal: ${dimensions.width} > ${dimensions.viewport}`);
}

async function finishDoubling(page) {
  await page.waitForFunction(() => ["doubling", "playing"].includes(document.querySelector(".game-layout")?.getAttribute("data-game-phase") || ""));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await page.locator(".game-layout").getAttribute("data-game-phase") !== "doubling") break;
    await page.getByRole("button", { name: "Bé, passo" }).click();
    await page.waitForFunction(() => {
      const layout = document.querySelector(".game-layout");
      const pass = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("Bé, passo"));
      return layout?.getAttribute("data-game-phase") === "playing" || (pass instanceof HTMLButtonElement && !pass.disabled);
    });
  }
  await page.locator('.game-layout[data-game-phase="playing"]').waitFor();
}

async function waitForOpeningCards(page) {
  for (const count of [1, 2, 3]) {
    await page.waitForFunction((expected) => document.querySelectorAll(".trick-card").length === expected, count, { timeout: 15_000 });
  }
  await page.locator(".card-hand .playing-card.playable").first().waitFor({ timeout: 15_000 });
}

async function run(viewport, name) {
  const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /La botifarra/ }).waitFor();
  await page.locator(".table-story img").waitFor();
  await assertFits(page);
  await page.screenshot({ path: `test-results/home-${name}.png`, fullPage: true });

  await page.getByRole("button", { name: "Mestre" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Mestre" }).getAttribute("aria-pressed"), "true");
  assert.equal(await page.getByRole("button", { name: "Aleatori", exact: true }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "Tu", exact: true }).click();
  await page.getByRole("button", { name: /Reparteix i mira la mà/ }).click();
  await page.waitForURL(/\/partida\//);
  await page.getByRole("heading", { name: "Quin trumfo tries?" }).waitFor();
  assert.equal(await page.locator(".bidding-hand .playing-card").count(), 12);
  await page.getByRole("button", { name: "Opcions de la taula" }).click();
  await page.getByRole("button", { name: "Números" }).click();
  assert.equal(await page.getByRole("button", { name: "Números" }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "Tanca el panell" }).click();
  await page.getByRole("button", { name: "Oros", exact: true }).click();
  await finishDoubling(page);
  await waitForOpeningCards(page);
  if (name === "mobile") {
    await page.getByRole("button", { name: "Opcions de la taula" }).click();
    await page.getByLabel("Ritme de joc").selectOption("quick");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Opcions de la taula" }).click();
    assert.equal(await page.getByLabel("Ritme de joc").inputValue(), "quick");
    await page.getByLabel("Ritme de joc").selectOption("normal");
    await page.getByRole("button", { name: "Tanca el panell" }).click();
    await page.getByRole("button", { name: "Ajuda del motor" }).click();
  }
  await assertFits(page);

  const engine = page.locator(name === "mobile" ? ".engine-sheet" : ".analysis-rail");
  await engine.getByLabel("Temps de càlcul").selectOption("5000");
  await engine.getByRole("button", { name: /Analitza el torn/ }).click();
  await engine.getByRole("button", { name: "Atura" }).click();
  await engine.getByRole("button", { name: /Analitza el torn/ }).waitFor();
  await engine.getByLabel("Temps de càlcul").selectOption("500");
  await engine.getByRole("button", { name: /Analitza el torn/ }).click();
  await engine.locator(".candidate").first().waitFor({ timeout: 15_000 });
  await engine.getByText("Anàlisi completada.").waitFor({ timeout: 15_000 });
  await page.waitForTimeout(250);
  assert.equal(await page.getByText(/connexió.*interromp/i).count(), 0);
  assert.ok(await page.locator(".candidate").count() > 0);
  const simulations = await engine.locator(".engine-metrics b").first().textContent();
  assert.ok(simulations && simulations !== "0");
  await engine.getByRole("button", { name: /^Selecciona / }).first().click();
  assert.equal(await page.locator(".full-hand .selected").count(), 1);
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.locator(".full-hand .selected").click();

  await page.locator(".card-hand .playing-card.playable").first().click();
  await page.getByRole("button", { name: /Confirma la carta/ }).click();
  await page.locator(".card-hand .playing-card.playable").first().waitFor({ timeout: 15_000 });
  await page.screenshot({ path: `test-results/game-${name}.png`, fullPage: true });
  await assertFits(page);

  if (name === "mobile") {
    await page.getByRole("button", { name: "Opcions de la taula" }).click();
    await page.getByRole("button", { name: /Obre aquesta posició al laboratori/ }).click();
    await page.waitForURL(/\/analisi$/);
    await page.getByText("Posició preparada").waitFor();
    assert.ok(Number(await page.locator(".builder-toolbar strong").textContent().then((value) => value?.split(" /")[0])) < 12);
    await page.getByRole("button", { name: /Calcula la millor jugada/ }).click();
    await page.locator(".lab-result").first().waitFor({ timeout: 15_000 });
  }

  await context.close();
}

await run({ width: 1440, height: 1000 }, "desktop");
await run({ width: 390, height: 844 }, "mobile");

const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const lab = await context.newPage();
await lab.goto(`${base}/analisi`, { waitUntil: "networkidle" });
await lab.getByRole("tab", { name: /Mà actual/ }).click();
const cards = lab.locator(".deck-builder .playing-card");
for (let index = 0; index < 12; index += 1) await cards.nth(index).click();
await lab.getByRole("button", { name: /Calcula la sortida/ }).click();
await lab.locator(".lab-result").first().waitFor({ timeout: 15_000 });
await lab.screenshot({ path: "test-results/lab-mobile.png", fullPage: true });
await assertFits(lab);
await context.close();

const biddingContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
const bidding = await biddingContext.newPage();
await bidding.goto(base, { waitUntil: "networkidle" });
await bidding.getByRole("button", { name: "Rival de ponent" }).click();
await bidding.getByRole("button", { name: /Reparteix i mira la mà/ }).click();
await bidding.waitForURL(/\/partida\//);
await bidding.getByRole("heading", { name: "Vols dir Contro?" }).waitFor();
assert.equal(await bidding.locator(".trick-card").count(), 0);
assert.equal(await bidding.locator(".bidding-hand .playing-card").count(), 12);
await bidding.screenshot({ path: "test-results/doubling-mobile.png", fullPage: true });
await biddingContext.close();

const seededGame = await post("/api/games", { mode: "quick", difficulty: "strong", initialDealer: 0, seed: 3 });
const recontroTurn = await post(`/api/games/${seededGame.id}/contract`, {
  version: seededGame.version,
  idempotencyKey: crypto.randomUUID(),
  contract: { kind: "trump", suit: "oros" },
  delegate: false,
});
assert.equal(recontroTurn.doublingLevel, 1);
assert.equal(recontroTurn.currentPlayer, 0);
const recontroContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
const recontro = await recontroContext.newPage();
await recontro.goto(`${base}/partida/${seededGame.id}`, { waitUntil: "networkidle" });
await recontro.getByRole("heading", { name: "Vols dir Recontro?" }).waitFor();
assert.equal(await recontro.locator(".trick-card").count(), 0);
assert.equal(await recontro.locator(".bidding-hand .playing-card").count(), 12);
await assertFits(recontro);
await recontroContext.close();

await browser.close();
console.log("E2E cant, Contro/Recontro, cartes seqüencials, escriptori, mòbil, WebSocket i laboratori: OK");
