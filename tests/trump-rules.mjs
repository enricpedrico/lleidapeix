import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, firefox, webkit } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const base = process.env.BASE_URL || "http://127.0.0.1:3085";
assert.ok(new URL(base).hostname === "127.0.0.1", "Fixtures must only run against the isolated local database");
const out = "test-results/trump-rules";
const fixtures = JSON.parse(await fs.readFile(`${out}/fixtures.json`, "utf8"));
const request = async (path, body) => {
  const response = await fetch(base + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  return { status: response.status, body: await response.json() };
};
const sorted = xs => [...xs].sort((a,b) => a-b);
const results = [];

for (const [name, type, options] of [["chromium", chromium, { executablePath: "/usr/bin/google-chrome" }], ["firefox", firefox, {}], ["webkit", webkit, {}]]) {
  const browser = await type.launch({ headless: true, ...options });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", ...(name === "webkit" ? { isMobile: true, hasTouch: true } : {}) });
  await context.addInitScript(() => {
    localStorage.setItem("lleidapeix:game-pace", "quick");
    localStorage.setItem("lleidapeix:review-tricks", "true");
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const cases = fixtures.filter(f => /-(ruff|overruff|partner-follow|follow-lose)$/.test(f.name));
  for (const fixture of cases) {
    await page.goto(`${base}/partida/${fixture.id}`);
    await page.locator(".full-hand .playing-card").first().waitFor();
    const actual = await page.locator(".full-hand .hand-slot").evaluateAll(slots => slots.map(slot => {
      const c = slot.querySelector(".playing-card");
      return { id: Number(slot.dataset.cardId), disabled: c.disabled, trump: c.classList.contains("is-trump"), marked: Boolean(c.querySelector(".trump-letter")), description: c.getAttribute("aria-description") };
    }));
    assert.deepEqual(sorted(actual.filter(c => !c.disabled).map(c => c.id)), sorted(fixture.legal), `${name} ${fixture.name}: playable cards`);
    for (const c of actual) {
      const trump = fixture.state.contract.kind === "trump" && fixture.state.hand.find(card => card.id === c.id).suit === fixture.state.contract.suit;
      assert.equal(c.trump, trump);
      assert.equal(c.marked, trump);
      assert.equal(Boolean(c.description), trump);
    }
    assert.equal(await page.locator(".round-heading .has-trump").count(), fixture.state.contract.kind === "trump" ? 1 : 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${name}: overflow`);
    if (fixture.name === "0-overruff") {
      assert.match(await page.locator(".play-guidance").textContent(), /sobretrumfar/);
      await page.screenshot({ path: `${out}/${name}-mobile.png`, fullPage: true });
      for (const viewport of [{ width: 320, height: 568 }, { width: 1440, height: 1000 }]) {
        await page.setViewportSize(viewport);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        await page.locator(".play-guidance").scrollIntoViewIfNeeded();
        const badge = await page.locator(".round-heading .contract-badge").boundingBox();
        assert.ok(badge.y >= 0 && badge.y + badge.height < viewport.height, `${name}: trump must remain visible`);
        await page.screenshot({ path: `${out}/${name}-${viewport.width}.png`, fullPage: true });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "Historial de bases" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.locator(".trick-history article").last().scrollIntoViewIfNeeded();
      assert.equal(await dialog.locator(".sheet-header .has-trump").isVisible(), true);
      await page.screenshot({ path: `${out}/${name}-history.png` });
      await page.getByRole("button", { name: "Tanca el panell" }).click();
      await page.getByRole("button", { name: "Opcions de la taula" }).click();
      await page.getByRole("button", { name: "Lletres", exact: true }).click();
      assert.equal(await dialog.locator(".sheet-header .has-trump").isVisible(), true);
      await page.getByRole("button", { name: "Tanca el panell" }).click();
      assert.equal(await page.locator(".full-hand .trump-letter").count(), actual.filter(c => c.trump).length);
      await page.getByRole("button", { name: "Ajuda del motor" }).click();
      await dialog.getByLabel("Temps de càlcul").selectOption("500");
      await dialog.getByRole("button", { name: "Analitza el torn" }).click();
      await dialog.getByText("Anàlisi completada.").waitFor({ timeout: 15000 });
      assert.equal(await dialog.locator(".candidate .playing-card:not(.is-trump)").count(), 0);
      assert.ok(await dialog.locator(".candidate .is-trump").count() > 0);
      await dialog.locator(".engine-metrics").scrollIntoViewIfNeeded();
      assert.equal(await dialog.locator(".sheet-header .has-trump").isVisible(), true);
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      assert.deepEqual(axe.violations, [], JSON.stringify(axe.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n=>n.target) }))));
      await page.screenshot({ path: `${out}/${name}-analysis.png` });
      await page.getByRole("button", { name: "Tanca el panell" }).click();
    }
  }
  await page.goto(`${base}/analisi`);
  for (const suit of ["oros", "copes", "espases", "bastos", "botifarra"]) {
    await page.getByLabel("Contracte", { exact: true }).selectOption(suit);
    assert.equal(await page.locator(".deck-builder .is-trump").count(), suit === "botifarra" ? 0 : 12);
    if (suit === "botifarra") assert.match(await page.locator(".lab-contract").textContent(), /SENSE TRUMFO/);
  }
  await page.goto(`${base}/regles`);
  await page.getByRole("heading", { name: "Quan he de matar?" }).waitFor();
  assert.deepEqual(errors, []);
  results.push({ browser: name, positions: cases.length, trumpSuits: 4, botifarra: true, modalScroll: true, analysis: true, axe: "passed" });
  await context.close();
  await browser.close();
  console.log(`${name}: trump presentation and referee integration passed`);
}

// Mutations run last, so every browser saw the same authoritative fixture positions.
let rejected = 0;
for (const fixture of fixtures) {
  const path = `/api/games/${fixture.id}`;
  const { body: before } = await request(path);
  assert.deepEqual(sorted(before.legalCards), sorted(fixture.legal));
  assert.equal(before.hands, undefined);
  assert.deepEqual(before.hand, fixture.state.hand);
  for (const cardId of [...fixture.illegal, 255]) {
    const response = await request(path + "/play", { version: before.version, idempotencyKey: crypto.randomUUID(), cardId });
    assert.equal(response.status, 422, `${fixture.name}: accepted illegal card ${cardId}`);
    assert.deepEqual((await request(path)).body, before);
    rejected++;
  }
  const stale = await request(path + "/play", { version: before.version - 1, idempotencyKey: crypto.randomUUID(), cardId: fixture.legal[0] });
  assert.equal(stale.status, 409);
  const action = { version: before.version, idempotencyKey: crypto.randomUUID(), cardId: fixture.legal[0] };
  const accepted = await request(path + "/play", action);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.version, before.version + 1);
  assert.equal(accepted.body.hand.length, before.hand.length - 1);
  assert.deepEqual((await request(path + "/play", action)).body, accepted.body);
}
await fs.writeFile(`${out}/browser-api-report.json`, JSON.stringify({ browsers: results, apiPositions: fixtures.length, illegalApiRejections: rejected, idempotency: true, conflicts: true }, null, 2));
console.log(`API: ${fixtures.length} positions; ${rejected} illegal requests rejected; legal moves/idempotency/conflicts passed`);
