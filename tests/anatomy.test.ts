import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { bodyBack, bodyFront } from "../components/anatomy-paths";
import { MuscleFreshnessMap } from "../components/muscle-map-svg";

test("detailed anatomy retains front/back regions and no-history accessible state", () => {
  const pathCount = [...bodyFront, ...bodyBack].reduce((sum, part) => sum + Object.values(part.path).flat().length, 0);
  assert.ok(pathCount > 100, `Expected anatomical segmentation, got ${pathCount} paths`);
  assert.ok(bodyFront.some((part) => part.slug === "quadriceps"));
  assert.ok(bodyBack.some((part) => part.slug === "hamstring"));
  const html = renderToStaticMarkup(createElement(MuscleFreshnessMap, { entries: [] }));
  assert.match(html, /No history/);
  assert.match(html, /Recovery percentage unavailable/);
  assert.match(html, /aria-label="Chest: No history/);
  assert.match(html, /tabindex="0"/);
  assert.doesNotMatch(html, /100%|Recovered|ready for peak/);
});
