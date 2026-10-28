import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium, firefox, webkit } from "playwright";

const base = process.env.BASE_URL || "http://127.0.0.1:3085";
await fs.mkdir("test-results/traditional-deck", { recursive: true });
const report = [];
for (const [name, type] of [["chromium", chromium], ["firefox", firefox], ["webkit", webkit]]) {
  const browser = await type.launch({ headless: true });
  try {
    for (const seat of [0, 1, 2, 3]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
      // Exercise every outcome of the real random-default path, without a flaky
      // assertion that a small random sample must happen to include all seats.
      await context.addInitScript((seat) => {
        const original = crypto.getRandomValues.bind(crypto);
        crypto.getRandomValues = (array) => {
          if (array instanceof Uint32Array && array.length === 1) { array[0] = seat; return array; }
          return original(array);
        };
        localStorage.setItem("lleidapeix:card-notation", "letters");
      }, seat);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(base, { waitUntil: "networkidle" });
      assert.equal(await page.getByRole("button", { name: "Aleatori", exact: true }).getAttribute("aria-pressed"), "true");
      assert.equal(await page.getByRole("button", { name: "Tu", exact: true }).getAttribute("aria-pressed"), "false");
      assert.equal(await page.getByRole("button", { name: "Mestre", exact: true }).getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator(".hero-hand .traditional-rank").first().textContent(), "12");
      const created = page.waitForResponse((response) => response.url().endsWith("/api/games") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Reparteix i mira la mà" }).click();
      const response = await created;
      assert.equal(response.request().postDataJSON().initialDealer, seat);
      const game = await response.json();
      assert.equal(game.dealer, seat);
      assert.equal(game.difficulty, "strong");
      await page.locator(".full-hand .playing-card").first().waitFor();
      assert.equal(await page.locator(".full-hand .playing-card").count(), 12);
      if (seat === 0) await page.getByRole("heading", { name: "Quin trumfo tries?" }).waitFor();
      await page.getByRole("button", { name: "Opcions de la taula" }).click();
      assert.equal(await page.getByRole("button", { name: "Números", exact: true }).getAttribute("aria-pressed"), "true");
      await page.getByRole("button", { name: "Lletres", exact: true }).click();
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Opcions de la taula" }).click();
      assert.equal(await page.getByRole("button", { name: "Lletres", exact: true }).getAttribute("aria-pressed"), "true");
      await page.getByRole("button", { name: "Números", exact: true }).click();
      await page.getByRole("button", { name: "Tanca el panell" }).click();
      if (seat === 0) {
        for (const width of [320, 390, 768, 1440]) {
          await page.setViewportSize({ width, height: width > 600 ? 1000 : 844 });
          const bounds = await page.locator(".full-hand .playing-card").evaluateAll((cards) => cards.map((card) => {
            const rect = card.getBoundingClientRect();
            const label = card.querySelector(".traditional-index").getBoundingClientRect();
            return { x: rect.x, right: rect.right, width: rect.width, height: rect.height, labelFits: label.x >= rect.x && label.right <= rect.right };
          }));
          assert.ok(bounds.every((r) => r.width >= 44 && r.height >= 44 && r.x >= 0 && r.right <= width && r.labelFits), `${name} ${width}: card geometry`);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
          await page.screenshot({ path: `test-results/traditional-deck/${name}-hand-${width}.png`, fullPage: true });
        }
        await page.goto(`${base}/analisi`, { waitUntil: "networkidle" });
        await page.getByRole("tab", { name: /Mà actual/ }).click();
        const images = page.locator(".deck-builder .traditional-face image");
        assert.equal(await images.count(), 48);
        const regions = await images.evaluateAll((nodes) => nodes.map((node) => `${node.getAttribute("x")}:${node.getAttribute("y")}`));
        assert.equal(new Set(regions).size, 48);
        const facesFit = await page.locator(".deck-builder .playing-card").evaluateAll((cards) => cards.every((card) => {
          const face = card.querySelector(".traditional-face").getBoundingClientRect();
          return face.height >= card.clientHeight * .75 && face.width >= card.clientWidth * .9;
        }));
        assert.ok(facesFit, `${name}: a compact-card rule is shrinking the traditional artwork`);
        await page.screenshot({ path: `test-results/traditional-deck/${name}-all-48.png`, fullPage: true });
        for (const title of ["10, sota d’oros", "11, cavall d’oros", "12, rei d’oros", "1, as d’oros", "9, manilla d’oros"]) {
          assert.equal(await page.getByRole("button", { name: title, exact: true }).count(), 1);
        }
        assert.ok((await context.request.get(`${base}/cards/baralla-espanyola-v1.png`)).ok());
      }
      assert.deepEqual(errors, []);
      report.push({ browser: name, randomSeat: seat, numericDefault: true, notationPersistence: true });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
await fs.writeFile("test-results/traditional-deck/report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ status: "ok", checks: report }));
