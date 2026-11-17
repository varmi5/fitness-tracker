import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { drizzle } from "drizzle-orm/pglite";
import { parseGoogleRollup, seal, unseal } from "../lib/google-health";
import { allowedMcpCallback } from "../lib/mcp-config";
import { fitnessMcp } from "../lib/mcp-tools";
import { nutritionData } from "../lib/nutrition-data";
import * as schema from "../lib/schema";

const pg = new PGlite();
const db = drizzle(pg, { schema });

before(async () => {
  for (const migration of [
    "001-auth.sql",
    "002-tracker.sql",
    "003-preserve-owner-access.sql",
    "004-nutrition-health.sql",
    "005-mcp-oauth.sql",
  ]) {
    await pg.exec(await readFile(`migrations/${migration}`, "utf8"));
  }
  await db.insert(schema.user).values({
    id: "M1",
    name: "M1",
    email: "m1@example.test",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

after(async () => pg.close());

test("Google Health dailyRollUp parser handles total-calories, active-energy-burned, steps, and weight", () => {
  const total = parseGoogleRollup("total-calories", {
    rollupDataPoints: [
      { civilStartTime: { date: { year: 2026, month: 11, day: 17 } }, totalCalories: { kcalSum: 2345.6 } },
    ],
  });
  assert.equal(total.rows.get("2026-11-17"), 2345.6);

  const active = parseGoogleRollup("active-energy-burned", {
    rollupDataPoints: [
      { civilStartTime: { date: { year: 2026, month: 11, day: 17 } }, activeEnergyBurned: { kcalSum: 512.3 } },
    ],
  });
  assert.equal(active.rows.get("2026-11-17"), 512.3);

  const steps = parseGoogleRollup("steps", {
    rollupDataPoints: [
      { civilStartTime: { date: { year: 2026, month: 11, day: 17 } }, steps: { countSum: "9842" } },
    ],
  });
  assert.equal(steps.rows.get("2026-11-17"), 9842);

  const weight = parseGoogleRollup("weight", {
    rollupDataPoints: [
      { civilStartTime: { date: { year: 2026, month: 11, day: 17 } }, weight: { weightGramsAvg: 74250 } },
    ],
  });
  assert.equal(weight.rows.get("2026-11-17"), 74.25);
});

test("AES-256-GCM seal/unseal enforces user AAD binding", () => {
  const keyHex = randomBytes(32).toString("hex");
  const cipher = seal({ accessToken: "secret-tok", refreshToken: "ref-tok" }, "user-A", keyHex);
  const plain = unseal(cipher, "user-A", keyHex) as { accessToken: string };
  assert.equal(plain.accessToken, "secret-tok");
  assert.throws(() => unseal(cipher, "user-B", keyHex));
});

test("MCP OAuth redirect URI validation accepts ChatGPT and loopback Codex callbacks only", () => {
  assert.equal(allowedMcpCallback("https://chatgpt.com/connector_platform_oauth_redirect"), true);
  assert.equal(allowedMcpCallback("https://chatgpt.com/connector/oauth/abc-123"), true);
  assert.equal(allowedMcpCallback("http://127.0.0.1:51234/callback"), true);
  assert.equal(allowedMcpCallback("https://evil.example.com/callback"), false);
  assert.equal(allowedMcpCallback("https://chatgpt.com/connector_platform_oauth_redirect#frag"), false);
});

test("MCP server enforces read vs write scopes and executes meal + energy tools against DB", async () => {
  // Read-only client must not see write tools
  const readServer = fitnessMcp("M1", ["fitness:read"], db);
  const [readClientT, readServerT] = InMemoryTransport.createLinkedPair();
  const readClient = new Client({ name: "test-read", version: "1.0.0" });
  await Promise.all([readServer.connect(readServerT), readClient.connect(readClientT)]);
  const readTools = (await readClient.listTools()).tools.map((t) => t.name);
  assert.ok(readTools.includes("get_daily_log"));
  assert.ok(readTools.includes("get_fitness_summary"));
  assert.equal(readTools.includes("log_meal"), false);
  assert.equal(readTools.includes("delete_meal"), false);
  await Promise.all([readClient.close(), readServer.close()]);

  // Read+write client can log, retrieve, append, and delete with confirmation
  const rwServer = fitnessMcp("M1", ["fitness:read", "fitness:write"], db);
  const [rwClientT, rwServerT] = InMemoryTransport.createLinkedPair();
  const rwClient = new Client({ name: "test-rw", version: "1.0.0" });
  await Promise.all([rwServer.connect(rwServerT), rwClient.connect(rwClientT)]);

  const rwTools = (await rwClient.listTools()).tools.map((t) => t.name);
  assert.equal(rwTools.length, 10);

  const logged = await rwClient.callTool({
    name: "log_meal",
    arguments: {
      day: "2026-11-17",
      time: "08:45",
      name: "Breakfast eggs",
      category: "breakfast",
      idempotencyKey: "mcp-test-1",
      items: [
        { name: "Three large eggs", amount: 180, unit: "g", calories: 257, proteinG: 22.7, carbsG: 2, fatG: 17.5, estimationMethod: "weighed" },
      ],
    },
  });
  const loggedJson = JSON.parse((logged.content as { text: string }[])[0].text);
  assert.equal(loggedJson.dailyTotals.calories, 257);
  assert.equal(loggedJson.remainingCalorieAllowance, 1643);

  const appended = await rwClient.callTool({
    name: "update_meal",
    arguments: {
      id: loggedJson.meal.id,
      idempotencyKey: "mcp-append-1",
      appendItems: [
        { name: "Cholula hot sauce", amount: 15, unit: "ml", calories: 3, proteinG: 0.1, carbsG: 0.5, fatG: 0, estimationMethod: "measured" },
      ],
    },
  });
  const appendedJson = JSON.parse((appended.content as { text: string }[])[0].text);
  assert.equal(appendedJson.dailyTotals.calories, 260);

  const settings = await rwClient.callTool({ name: "get_nutrition_settings", arguments: {} });
  assert.equal(JSON.parse((settings.content as { text: string }[])[0].text).timezone, "Europe/London");

  const deleted = await rwClient.callTool({
    name: "delete_meal",
    arguments: { id: loggedJson.meal.id, confirmation: "DELETE" },
  });
  assert.equal(JSON.parse((deleted.content as { text: string }[])[0].text).day.meals.length, 0);

  const audit = await nutritionData(db, "M1").recentAudit(10);
  assert.equal(audit.length, 4);

  await Promise.all([rwClient.close(), rwServer.close()]);
});
