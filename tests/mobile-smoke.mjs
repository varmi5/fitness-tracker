import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createCipheriv, randomBytes } from "node:crypto";
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
const integrationKey = randomBytes(32);
const email = "mobile-review@example.test";
const env = { ...process.env, FITNESS_BACKGROUND_WORKER: "false", FITNESS_INTEGRATION_KEY: integrationKey.toString("hex"), GOOGLE_HEALTH_CLIENT_ID: "synthetic", GOOGLE_HEALTH_CLIENT_SECRET: "synthetic", HOSTNAME: "127.0.0.1", PORT: "3087", SIGNUP_MODE: "closed",
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
  const ownerId = (await owner.json()).user.id;
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", integrationKey, iv);
  cipher.setAAD(Buffer.from(ownerId));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ accessToken: "synthetic", refreshToken: "synthetic", expiresAt: Date.now() + 3600000, scopes: ["https://www.googleapis.com/auth/googlehealth.nutrition.writeonly"] })), cipher.final()]);
  await db.query("INSERT INTO health_integration(user_id,provider,account_label,credential) VALUES ($1,'google','synthetic@example.test',$2)", [ownerId, Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString("base64url")]);

  // Synthetic imported strength sessions unlock the actual anatomy component without remote credentials.
  for (const daysAgo of [1, 3, 5]) {
    const day = new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
    const id = `anatomy-${daysAgo}`;
    await db.query("INSERT INTO hevy_workout(user_id,hevy_id,day,title,start_time,end_time,duration_seconds) VALUES($1,$2,$3,'Synthetic bench session',$4,$5,3600)", [ownerId, id, day, `${day}T10:00:00Z`, `${day}T11:00:00Z`]);
    await db.query("INSERT INTO hevy_set(id,user_id,hevy_id,exercise_index,exercise_title,set_index,set_type,weight_kg,reps,rpe) VALUES($1,$2,$3,0,'Bench Press',0,'normal',60,5,8)", [`set-${id}`, ownerId, id]);
  }

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
    await page.getByText("Calorie Intake", { exact: true }).waitFor();
    await page.getByRole("progressbar").first().waitFor();

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

    const nav = page.getByRole("navigation");
    const fab = page.getByRole("button", { name: "Quick log", exact: true });
    assert.equal(await nav.evaluate((node) => getComputedStyle(node).position), "fixed");
    const fabBox = await fab.boundingBox(); const navBox = await nav.boundingBox();
    assert.ok(fabBox && navBox && fabBox.x >= navBox.x && fabBox.x + fabBox.width <= navBox.x + navBox.width + 2);
    assert.ok(fabBox.y >= navBox.y - 2 && fabBox.y + fabBox.height <= navBox.y + navBox.height + 2);
    await fab.click();
    await page.getByRole("button", { name: "Full Meal Composer", exact: true }).click();
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
    assert.equal(nutritionText.includes("7-Day Energy Balance"), true, "Nutrition must show 7-Day Energy Balance");
    assert.equal(nutritionText.includes("30-Day Energy Balance"), false, "30-Day balance must be inside drill-down, not cluttering Diary");
    assert.equal(nutritionText.includes("Finish logging"), false, "Nutrition must not show Finish logging button");
    await page.getByText("7-Day Energy Balance").click();
    await page.getByRole("tab", { name: "30 Days", exact: true }).click();
    await page.getByText("30-Day Energy Balance").waitFor();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.locator(".meal-card").filter({ hasText: `${name} review meal` }).waitFor();
    await page.getByRole("button", { name: "Edit", exact: true }).last().click();
    await modal.getByLabel("Food name", { exact: true }).fill("oats");
    await modal.getByRole("option").filter({ hasText: "Porridge oats, unfortified" }).first().click();
    assert.equal(await modal.getByLabel("Calories", { exact: false }).inputValue(), "381");
    await modal.getByRole("button", { name: "Close composer" }).click();
    assert.equal(await page.evaluate(() => document.body.style.overflow), "");

    if (name === "iphone") {
      await fab.click();
      await page.getByRole("button", { name: "Full Meal Composer", exact: true }).click();
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

    for (const tab of ["Today", "Training", "Nutrition", "Body"]) {
      await page.getByRole("navigation").getByRole("button", { name: tab, exact: true }).click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      if (tab === "Training") {
        await page.getByRole("heading", { name: "Training & Strain", exact: true }).waitFor();
        await page.getByText(/Cardio Load|Daily Walking/).first().waitFor();
        await page.getByText("Muscular Load", { exact: true }).first().waitFor();
      }
      if (tab === "Body") {
        await page.getByRole("heading", { name: "Body", exact: true }).waitFor();
        await page.getByText("Physique Check-in & Timelapse").waitFor();
      }
    }

    await page.getByRole("button", { name: "Open settings", exact: true }).click();
    {
        const manualHeading = page.getByRole("heading", { name: "Manual Daily Expenditure (TDEE)", exact: true });
        const expSourceHeading = page.getByRole("heading", { name: "Expenditure Source & Timezone", exact: true });
        await manualHeading.waitFor();
        await expSourceHeading.waitFor();
        const manualBox = await manualHeading.boundingBox();
        const expSourceBox = await expSourceHeading.boundingBox();
        assert.ok(manualBox && expSourceBox && manualBox.y < expSourceBox.y, "Manual TDEE card must appear above Preferred expenditure source");
        await expSourceHeading.click();
        const sourceSelect = page.getByLabel("Preferred expenditure source");
        await sourceSelect.waitFor();
        const optionTexts = await sourceSelect.locator("option").allInnerTexts();
        assert.deepEqual(optionTexts, ["Manual TDEE entry", "Google Health (Fitbit Air)"]);
        const settingsText = await page.locator("main").innerText();
        assert.equal(settingsText.includes("Apple Health"), false, "Settings must not reference Apple Health");

        // Stage 6: Training & Strain -> Walking Contribution settings
        const walkingHeading = page.getByRole("heading", { name: /Walking Contribution/ });
        await walkingHeading.waitFor();
        await walkingHeading.click();
        const stepThresholdInput = page.getByRole("spinbutton", { name: "Daily step threshold" });
        await stepThresholdInput.fill("11000");
        await page.getByRole("button", { name: "Save strain & walking settings", exact: true }).click();
        await page.getByText("Strain & walking settings saved.").waitFor();
        await page.locator(".toast-dismiss").click();

        const googleHeading = page.getByRole("heading", { name: "Google Health (Fitbit Air)", exact: true });
        await googleHeading.waitFor();
        await googleHeading.click();
        const syncButton = page.getByRole("button", { name: "Sync Now", exact: true });
        await syncButton.waitFor();
        const status = { available: true, connected: true, status: "connected", accountLabel: "synthetic@example.test", canWriteNutrition: true, mealSync: { pending: 0, failed: 1, verified: 2, lastVerifiedAt: "2026-11-17T12:00:00Z", lastError: "Google meal creation returned HTTP 400; check serving.food_measurement_unit." } };
        const requests = [];
        await page.route("**/api/integrations/google/push", async (route) => {
          if (route.request().method() === "POST") requests.push(route.request().postDataJSON());
          await route.fulfill({ contentType: "application/json", body: JSON.stringify({ mealsQueued: 1, nextCursor: null, status }) });
        });
        await syncButton.click();
        await page.getByText(/2 verified in Google/).waitFor();
        await page.getByText(/check serving.food_measurement_unit/).waitFor();
        assert.ok(requests[0].from, "Sync Now queues the last 14 days");
        await page.getByRole("button", { name: "Backfill all meals", exact: true }).click();
        await page.waitForFunction(() => [...document.querySelectorAll("button")].some((button) => button.textContent.includes("Sync Now") && !button.disabled));
        assert.equal(requests.at(-1).allHistory, true);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        const feedbackBox = await page.locator(".feedback").boundingBox();
        const logBox = await page.getByRole("button", { name: "Quick log", exact: true }).boundingBox();
        assert.ok(feedbackBox.y + feedbackBox.height <= logBox.y || feedbackBox.x + feedbackBox.width <= logBox.x, "Sync feedback must not overlap Quick log");
        if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/${name}-google-sync.png` });
        await page.getByRole("button", { name: "Back", exact: true }).click();
    }

    // Stage 6 & 7: Tapping Overall Strain on Today opens Training, where Recovery Insights is shown
    await page.getByRole("navigation").getByRole("button", { name: "Today", exact: true }).click();
    await page.getByRole("button", { name: "Overall Strain summary", exact: true }).click();
    await page.getByRole("heading", { name: "Training & Strain", exact: true }).waitFor();
    await page.getByRole("region", { name: "Recovery Insights", exact: true }).waitFor();
    const recoveryRegion = page.getByRole("region", { name: "Recovery Insights", exact: true });
    const anatomyRegion = page.getByRole("region", { name: "Muscle Training Map", exact: true });
    await anatomyRegion.locator(".muscle-svg").waitFor();
    assert.ok(await anatomyRegion.locator(".muscle-svg path").count() > 40);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    if (screenshotDir) {
      await page.screenshot({ path: `${screenshotDir}/${name}-training.png`, fullPage: true });
      await anatomyRegion.screenshot({ path: `${screenshotDir}/${name}-anatomy-front.png` });
      await anatomyRegion.getByRole("button", { name: "Back", exact: true }).click();
      await anatomyRegion.screenshot({ path: `${screenshotDir}/${name}-anatomy-back.png` });
    }
    await recoveryRegion.getByRole("button").click();
    await page.getByText("Readiness estimate", { exact: true }).waitFor();

    assert.equal(await recoveryRegion.locator(".bevel-ring-center").innerText(), "—", "No recorded sleep or baseline must never produce a recovery percentage");
    assert.match(await recoveryRegion.innerText(), /needs completed sleep|Waiting for completed sleep|Awaiting sleep/);
    await page.getByRole("button", { name: "Back", exact: true }).first().click();


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

    // Stage 1 regression: toast auto-dismiss (~3s), manual dismiss, and live camera barcode scanner
    await fab.click();
    await page.getByRole("button", { name: "Full Meal Composer", exact: true }).click();
    await page.getByRole("button", { name: "Barcode", exact: true }).click();
    await page.evaluate(() => {
      window.__stoppedCameraTracks = 0;
      const fakeStream = typeof MediaStream !== "undefined" ? new MediaStream() : {};
      fakeStream.getTracks = () => [{ stop: () => { window.__stoppedCameraTracks += 1; } }];
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getUserMedia: async () => fakeStream },
      });
      HTMLMediaElement.prototype.play = async () => undefined;
      Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 2 });
      window.BarcodeDetector = class {
        static async getSupportedFormats() { return ["ean_13"]; }
        async detect() { return [{ rawValue: "5000112637922" }]; }
      };
    });
    await page.route("**/api/foods?barcode=5000112637922", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          food: {
            id: "off:5000112637922",
            name: "Scanned Zero Drink",
            brand: "Test",
            foodType: "drink",
            basisAmount: 100,
            basisUnit: "ml",
            calories: 1,
            proteinG: 0,
            carbsG: 0,
            fatG: 0,
            fibreG: 0,
            portions: [{ id: "ml", label: "ml", unit: "ml", baseAmount: 1, defaultAmount: 330, estimated: false }],
            defaultPortionId: "ml",
            sourceName: "Open Food Facts",
          },
        }),
      });
    });
    await page.getByRole("button", { name: "Scan", exact: true }).click();
    await page.getByText("Scanned Zero Drink").waitFor();
    assert.equal(await page.evaluate(() => window.__stoppedCameraTracks >= 1), true, "Camera stream tracks must stop after scan");
    await page.getByRole("button", { name: "Close composer", exact: true }).click();

    // Verify success toast auto-dismisses after ~3s
    await page.getByRole("button", { name: "Open settings", exact: true }).click();
    await page.getByRole("heading", { name: "Expenditure Source & Timezone", exact: true }).click();
    await page.getByRole("button", { name: "Save preferences", exact: true }).click();
    const toast = page.locator(".feedback");
    await toast.waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Dismiss notification", exact: true }).waitFor();
    await toast.waitFor({ state: "hidden", timeout: 5000 });

    console.log(`${name}: food suggestions, input sizing, modal bounds, portion scaling, failed-save recovery, inline autocomplete, keyboard viewport, Bevel steppers, non-Fitbit hiding, settings ordering, auto-refresh, toast auto-dismiss, barcode scanner and tab overflow passed.`);
    await browser.close(); browser = undefined;
  }
} finally {
  await browser?.close();
  if (app && app.exitCode === null) { const exit = once(app, "exit"); app.kill(); await exit; }
  await database.stop(); await db.close();
}
