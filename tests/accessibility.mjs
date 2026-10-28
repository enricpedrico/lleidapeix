import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const base = process.env.BASE_URL || "http://127.0.0.1:18086";
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
const page = await context.newPage();
const results = [];
async function scan(name) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  const violations = result.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) }));
  results.push({ name, violations });
  console.log(JSON.stringify({ name, violations }));
}
for (const path of ["/", "/regles", "/analisi"]) {
  await page.goto(base + path, { waitUntil: "networkidle" });
  await scan(path);
}
await page.goto(base);
await page.getByRole("button", { name: "Tu", exact: true }).click();
await page.getByRole("button", { name: /Reparteix i mira la mà/ }).click();
await page.getByRole("heading", { name: "Quin trumfo tries?" }).waitFor();
await scan("bidding");
await page.getByRole("button", { name: "Opcions de la taula" }).click();
await scan("settings");
await page.keyboard.press("Escape");
await page.getByRole("button", { name: "Copes", exact: true }).click();
await page.waitForTimeout(150);
while (await page.locator(".game-layout").getAttribute("data-game-phase") === "doubling") {
  await scan("doubling");
  await page.getByRole("button", { name: "Bé, passo" }).click();
  await page.waitForTimeout(100);
}
await page.locator(".full-hand .playable").first().waitFor();
await scan("playing");
await page.getByRole("button", { name: "Ajuda del motor" }).click();
const engine = page.getByRole("dialog");
await engine.getByLabel("Temps de càlcul").selectOption("150");
await engine.getByRole("button", { name: "Analitza el torn" }).click();
await engine.getByText("Anàlisi completada.").waitFor();
await scan("analysis");
await page.keyboard.press("Escape");
await page.getByRole("button", { name: "Historial de bases" }).click();
await scan("history");
await fs.writeFile("test-results/accessibility.json", JSON.stringify(results, null, 2));
await browser.close();
assert.equal(results.flatMap((result) => result.violations).length, 0, "S’han detectat problemes d’accessibilitat");
