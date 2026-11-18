import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
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
const systemChromium = existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined;

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

  for (const [name, preferredEngine, device] of [["iphone", webkit, devices["iPhone 15"]], ["desktop", chromium, { viewport: { width: 1280, height: 900 } }]]) {
    if (process.env.UI_ENGINE && process.env.UI_ENGINE !== name) continue;
    const useFallbackChromium = !existsSync(preferredEngine.executablePath()) && Boolean(systemChromium);
    const engine = useFallbackChromium ? chromium : preferredEngine;
    const contextDevice = useFallbackChromium ? { ...device, defaultBrowserType: undefined } : device;
    browser = await engine.launch(engine === chromium
      ? { ...(useFallbackChromium ? { executablePath: systemChromium } : { channel: "chromium" }), args: ["--disable-gpu", "--disable-renderer-backgrounding"] }
      : {});
    const context = await browser.newContext({ ...contextDevice, serviceWorkers: "block", reducedMotion: "reduce" });
    assert.ok((await context.request.post(`${origin}/api/auth/sign-in/email`, { headers: { Origin: origin }, data: { email, password } })).ok());
    const page = await context.newPage();
    await page.route(/\/api\/foods\?.*products=1/, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ products: [], providerMessage: null }) }));
    await page.goto(origin);
    const prevDayBtn = page.getByRole("button", { name: "Previous day", exact: true });
    const nextDayBtn = page.getByRole("button", { name: "Next day", exact: true });
    await prevDayBtn.waitFor();
    assert.equal(await nextDayBtn.isDisabled(), true);
    await page.getByRole("heading", { name: "Nutrition Score", exact: true }).waitFor();

    const homeText = await page.locator("main").innerText();
    for (const forbidden of [
      "Sleep",
      "Steps",
      "Active burn",
      "Apple Health",
      "Waiting for sleep",
      "Start today",
      "Holding yesterday",
      "Finish day",
      "Day complete",
      "7-Day Net Balance",
      "30-Day Net Balance",
    ]) {
      assert.equal(homeText.includes(forbidden), false, `Home must hide "${forbidden}" in manual mode`);
    }

    await prevDayBtn.click();
    assert.equal((await page.locator("h1").innerText()).trim(), "Yesterday");
    assert.equal(await nextDayBtn.isDisabled(), false);
    await nextDayBtn.click();
    assert.equal((await page.locator("h1").innerText()).trim(), "Today");
    assert.equal(await nextDayBtn.isDisabled(), true);

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
    const nutritionText = await page.locator("main").innerText();
    assert.equal(nutritionText.includes("7-Day Net Balance"), true, "Nutrition must show 7-Day Net Balance");
    assert.equal(nutritionText.includes("30-Day Net Balance"), true, "Nutrition must show 30-Day Net Balance");
    assert.equal(nutritionText.includes("Finish logging"), false, "Nutrition must not show Finish logging button");
    await page.getByRole("button", { name: "Edit", exact: true }).last().click();
    await modal.getByLabel("Food name", { exact: true }).fill("oats");
    await modal.getByRole("option").filter({ hasText: "Porridge oats, unfortified" }).first().click();
    assert.equal(await modal.getByLabel("Calories", { exact: false }).inputValue(), "381");
    await modal.getByRole("button", { name: "Close composer" }).click();
    assert.equal(await page.evaluate(() => document.body.style.overflow), "");

    if (name === "iphone") {
      await fab.click();
      await modal.waitFor();
      await page.setViewportSize({ width: 390, height: 430 });
      await search.click();
      await search.fill("Eggs");
      await modal.getByRole("option").filter({ hasText: "whole, boiled" }).waitFor();
      const firstOptionBox = await modal.getByRole("option").filter({ hasText: "whole, boiled" }).first().boundingBox();
      assert.ok(firstOptionBox && firstOptionBox.y + firstOptionBox.height <= 430 + 24, "Food suggestions should stay visible above mobile keyboard");
      if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/${name}-keyboard-search.png` });
      await modal.getByRole("option").filter({ hasText: "whole, boiled" }).first().click();
      const calInput = modal.getByLabel("Calories", { exact: false });
      await calInput.click();
      await page.waitForTimeout(180);
      const sheetState = await modal.locator(".modal-sheet").getAttribute("data-keyboard");
      assert.equal(sheetState, "open");
      if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/${name}-keyboard-meal.png` });
      const calBox = await calInput.boundingBox();
      assert.ok(calBox && calBox.y >= 0 && calBox.y + calBox.height <= 430, "Focused Calories input must sit inside reduced mobile viewport");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await modal.getByRole("button", { name: "Done", exact: true }).click();
      await page.setViewportSize({ width: 390, height: 844 });
      await modal.getByRole("button", { name: "Save meal & reusable template", exact: true }).waitFor();
      await modal.getByRole("button", { name: "Close composer" }).click();
    }

    for (const tab of ["Home", "Nutrition", "Measurements", "Settings"]) {
      await page.getByRole("navigation").getByRole("button", { name: tab, exact: true }).click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      if (tab === "Settings") {
        const manualHeading = page.getByRole("heading", { name: "Manual Daily Expenditure (TDEE)", exact: true });
        const sourceSelect = page.getByLabel("Preferred expenditure source");
        await manualHeading.waitFor();
        await sourceSelect.waitFor();
        const manualBox = await manualHeading.boundingBox();
        const sourceBox = await sourceSelect.boundingBox();
        assert.ok(manualBox && sourceBox && manualBox.y < sourceBox.y, "Manual TDEE card must appear above Preferred expenditure source");
        const optionTexts = await sourceSelect.locator("option").allInnerTexts();
        assert.deepEqual(optionTexts, ["Manual TDEE entry", "Google Health (Fitbit Air)"]);
        const settingsText = await page.locator("main").innerText();
        assert.equal(settingsText.includes("Apple Health"), false, "Settings must not reference Apple Health");
      }
    }

    await page.getByRole("navigation").getByRole("button", { name: "Nutrition", exact: true }).click();
    const londonToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
    const bgMealRes = await context.request.post(`${origin}/api/nutrition`, {
      headers: { Origin: origin },
      data: {
        action: "log",
        data: {
          day: londonToday,
          time: "19:45",
          name: `${name} auto-synced bowl`,
          category: "dinner",
          idempotencyKey: `ui-auto-sync-${name}`,
          items: [{ name: "Greek yoghurt", amount: 150, unit: "g", calories: 140, proteinG: 15, carbsG: 6, fatG: 5, estimationMethod: "weighed" }],
        },
      },
    });
    assert.equal(bgMealRes.status(), 200);
    await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    await page.locator(".meal-card").filter({ hasText: `${name} auto-synced bowl` }).waitFor();

    console.log(`${name}: food suggestions, input sizing, modal bounds, portion scaling, failed-save recovery, inline autocomplete, keyboard viewport, Bevel steppers, non-Fitbit hiding, settings ordering, auto-refresh and tab overflow passed.`);
    await browser.close(); browser = undefined;
  }
} finally {
  await browser?.close();
  if (app && app.exitCode === null) { const exit = once(app, "exit"); app.kill(); await exit; }
  await database.stop(); await db.close();
}
