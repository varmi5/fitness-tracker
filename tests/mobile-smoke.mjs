import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdir } from "node:fs/promises";
import { once } from "node:events";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { chromium, webkit, devices } from "playwright";

// Synthetic, ephemeral database only. Never connects to deployment health data.
const db = await PGlite.create();
const database = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 0, maxConnections: 16 });
await database.start();
const origin = "http://localhost:3087";
const code = randomBytes(24).toString("hex");
const password = randomBytes(24).toString("hex");
const email = "mobile-review@example.test";
const env = { ...process.env, FITNESS_BACKGROUND_WORKER: "false", HOSTNAME: "127.0.0.1", PORT: "3087", SIGNUP_MODE: "closed",
  FITNESS_MCP_ENABLED: "false", SETUP_CODE: code, BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  DATABASE_URL: `postgresql://postgres:postgres@${database.getServerConn()}/postgres` };
let app;
let browser;
const screenshotDir = process.env.UI_SCREENSHOT_DIR;

try {
  const migration = spawn(process.execPath, ["scripts/migrate.mjs"], { env, stdio: "inherit" });
  assert.equal((await once(migration, "exit"))[0], 0);
  await cp("public", ".next/standalone/public", { recursive: true });
  await cp(".next/static", ".next/standalone/.next/static", { recursive: true });
  app = spawn(process.execPath, [".next/standalone/server.js"], { env, stdio: "inherit" });
  for (let i = 0; i < 50; i++) {
    if ((await fetch(origin).catch(() => null))?.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const owner = await fetch(`${origin}/api/auth/sign-up/email`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin, "X-Setup-Code": code },
    body: JSON.stringify({ name: "Synthetic UI test", email, password }),
  });
  assert.equal(owner.status, 200);

  for (const [name, engine, device] of [["iphone", webkit, devices["iPhone 15"]], ["desktop", chromium, { viewport: { width: 1280, height: 900 } }]]) {
    if (process.env.UI_ENGINE && process.env.UI_ENGINE !== name) continue;
    browser = await engine.launch(name === "desktop" ? { channel: "chromium", args: ["--disable-gpu", "--disable-renderer-backgrounding"] } : {});
    const context = await browser.newContext({ ...device, serviceWorkers: "block", reducedMotion: "reduce" });
    assert.ok((await context.request.post(`${origin}/api/auth/sign-in/email`, { headers: { Origin: origin }, data: { email, password } })).ok());
    const page = await context.newPage();
    await page.route(/\/api\/foods\?.*products=1/, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ products: [], providerMessage: null }) }));
    await page.goto(origin);
    const fab = page.getByRole("button", { name: "Log meal", exact: true });
    assert.equal(await fab.evaluate((node) => getComputedStyle(node).position), "fixed");
    const fabBox = await fab.boundingBox(); const navBox = await page.getByRole("navigation").boundingBox();
    assert.ok(fabBox.x + fabBox.width / 2 > page.viewportSize().width / 2);
    assert.ok(fabBox.y + fabBox.height < navBox.y);
    await fab.click();
    const modal = page.getByRole("dialog");
    await modal.waitFor();
    const search = modal.getByRole("combobox", { name: "Find a food" });
    await search.fill("Ehgs");
    await modal.getByRole("option").filter({ hasText: "whole, boiled" }).waitFor();
    assert.ok(await search.evaluate((input) => parseFloat(getComputedStyle(input).fontSize) >= 16));
    assert.equal(await page.evaluate(() => window.visualViewport.scale), 1);
    const bounds = await modal.boundingBox();
    assert.ok(bounds.width <= page.viewportSize().width);
    assert.ok(bounds.height <= page.viewportSize().height + 1);
    if (screenshotDir) {
      await mkdir(screenshotDir, { recursive: true });
      await page.screenshot({ path: `${screenshotDir}/${name}-search.png` });
    }
    await modal.getByRole("option").filter({ hasText: "whole, boiled" }).click();
    await modal.getByLabel("Portion measure", { exact: true }).selectOption("g");
    await modal.getByLabel("Portion amount", { exact: true }).fill("200");
    assert.equal(await modal.getByLabel("Calories", { exact: false }).inputValue(), "286");
    await modal.getByLabel("Meal name", { exact: true }).fill(`${name} review meal`);
    let rejectSave = true;
    await page.route("**/api/nutrition", async (route) => {
      if (route.request().method() === "POST" && rejectSave) {
        rejectSave = false;
        return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "Synthetic validation failure" }) });
      }
      return route.continue();
    });
    await modal.getByRole("button", { name: "Save meal", exact: true }).click();
    await modal.getByRole("alert").waitFor();
    assert.equal(await modal.getByLabel("Meal name", { exact: true }).inputValue(), `${name} review meal`);
    await modal.getByRole("button", { name: "Save meal", exact: true }).click();
    await modal.waitFor({ state: "hidden" });
    await page.unroute("**/api/nutrition");
    assert.equal(await page.evaluate(() => document.body.style.position), "");
    await page.getByRole("navigation").getByRole("button", { name: "Nutrition", exact: true }).click();
    await page.locator(".meal-card").filter({ hasText: `${name} review meal` }).waitFor();
    await page.getByRole("button", { name: "Edit", exact: true }).last().click();
    await modal.getByLabel("Food name", { exact: true }).fill("oats");
    await modal.getByRole("option").filter({ hasText: "Porridge oats, unfortified" }).first().click();
    assert.equal(await modal.getByLabel("Calories", { exact: false }).inputValue(), "381");
    await modal.getByRole("button", { name: "Close composer" }).click();
    for (const tab of ["Home", "Nutrition", "Measurements", "Settings"]) {
      await page.getByRole("navigation").getByRole("button", { name: tab, exact: true }).click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    }
    console.log(`${name}: food suggestions, input sizing, modal bounds, portion scaling, failed-save recovery, inline autocomplete and tab overflow passed.`);
    await browser.close(); browser = undefined;
  }
} finally {
  await browser?.close();
  if (app && app.exitCode === null) { const exit = once(app, "exit"); app.kill(); await exit; }
  await database.stop(); await db.close();
}
