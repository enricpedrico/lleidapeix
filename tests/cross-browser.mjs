import assert from "node:assert/strict";
import { chromium, firefox, webkit } from "playwright";

const base = process.env.BASE_URL || "http://127.0.0.1:18085";
const targets = [
  ["Chromium", chromium, { executablePath: "/usr/bin/google-chrome" }],
  ["Firefox", firefox, {}],
  ["WebKit", webkit, {}],
];

for (const [name, browserType, options] of targets) {
  const browser = await browserType.launch({ headless: true, ...options });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /La botifarra/ }).waitFor();
  const dimensions = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  assert.ok(dimensions[0] <= dimensions[1] + 1, `${name}: desbordament horitzontal`);
  assert.equal(await page.getByRole("button", { name: "Aleatori", exact: true }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "Tu", exact: true }).click();
  await page.getByRole("button", { name: /Reparteix i mira la mà/ }).click();
  await page.getByRole("heading", { name: "Quin trumfo tries?" }).waitFor();
  assert.equal(await page.locator(".bidding-hand .playing-card").count(), 12, `${name}: la mà ha d’aparèixer abans del cant`);
  await page.getByRole("button", { name: "Copes", exact: true }).click();
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
  await page.locator(".card-hand .playing-card.playable").first().waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "Ajuda del motor" }).click();
  const engine = page.getByRole("dialog");
  await engine.getByLabel("Temps de càlcul").selectOption("500");
  await engine.getByRole("button", { name: /Analitza el torn/ }).click();
  await engine.getByText("Anàlisi completada.").waitFor({ timeout: 15_000 });
  await page.waitForTimeout(250);
  assert.equal(await page.getByText(/connexió.*interromp/i).count(), 0, `${name}: fals error de WebSocket`);
  assert.ok(await page.locator(".candidate").count() > 0, `${name}: s’han perdut els resultats finals`);
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0, `${name}: el panell no es tanca`);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("class")), "button analysis-launch", `${name}: no es recupera el focus`);
  await browser.close();
  console.log(`${name}: OK`);
}
