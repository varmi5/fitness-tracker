import assert from "node:assert/strict";
import test from "node:test";
import { computeRecoveryInsights } from "../lib/recovery-insights";

test("computeRecoveryInsights uses the same gated Pulse engine with observed prior days", () => {
  const result = computeRecoveryInsights({
    day: "2026-11-23",
    sleep: {
      minutesAsleep: 465,
      deepMinutes: 85,
      remMinutes: 105,
      lightMinutes: 275,
      minutesAwake: 15,
    },
    recovery: {
      restingHrBpm: 50,
      hrvRmssdMs: 68,
      spo2Pct: 98,
      respiratoryRate: 14.5,
      skinTempDeltaC: 0.1,
    },
    baseline: {
      avgSleepMinutes: 440,
      avgRestingHrBpm: 52,
      avgHrvRmssdMs: 60,
      sampleDays: 10,
    },
    priorDays: Array.from({ length: 14 }, () => ({ hrvRmssdMs: 60, restingHrBpm: 52, respiratoryRate: 14.5, skinTempDeltaC: 0, sleepHours: 7.5 })),
    yesterdayStrain: 58,
    sevenDayAvgStrain: 48,
  });

  assert.equal(result.completeness, "complete");
  assert.equal(result.confidence, "medium");
  assert.equal(result.band, "optimal");
  assert.ok(result.score != null && result.score >= 75 && result.score <= 100);
  assert.deepEqual(result.missingSignals, []);
  assert.equal(result.metrics.restingHrDeltaBpm, -2);
  assert.equal(result.metrics.hrvDeltaMs, 8);
});

test("computeRecoveryInsights marks partial signals honestly and never invents missing vitals", () => {
  const result = computeRecoveryInsights({
    day: "2026-11-23",
    sleep: {
      minutesAsleep: 390,
      deepMinutes: null,
      remMinutes: null,
      lightMinutes: null,
      minutesAwake: null,
    },
    recovery: null,
    baseline: {
      avgSleepMinutes: 420,
      avgRestingHrBpm: null,
      avgHrvRmssdMs: null,
      sampleDays: 5,
    },
  });

  assert.equal(result.completeness, "partial");
  assert.equal(result.confidence, "low");
  assert.deepEqual(result.missingSignals, ["Resting HR", "HRV"]);
  assert.equal(result.metrics.restingHrBpm, null);
  assert.equal(result.metrics.hrvRmssdMs, null);
  assert.equal(result.score, null);
  assert.match(result.summary, /Missing: Resting HR, HRV/);
});

test("computeRecoveryInsights returns unavailable with null score when no sleep or vitals exist", () => {
  const result = computeRecoveryInsights({
    day: "2026-11-23",
    sleep: null,
    recovery: {
      restingHrBpm: null,
      hrvRmssdMs: null,
      spo2Pct: null,
      respiratoryRate: null,
      skinTempDeltaC: null,
    },
  });

  assert.equal(result.score, null);
  assert.equal(result.band, "unavailable");
  assert.equal(result.completeness, "unavailable");
  assert.equal(result.confidence, "unavailable");
  assert.deepEqual(result.missingSignals, ["Sleep", "Resting HR", "HRV"]);
});
