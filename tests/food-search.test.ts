import assert from "node:assert/strict";
import { test } from "node:test";
import { portionBasis, scalePortion } from "../lib/food-portion";
import { foodMatchScore } from "../lib/search-match";
import { searchUkStaples } from "../lib/uk-foods";

test("food suggestions handle prefixes, typos and UK spellings without unrelated matches", () => {
  for (const query of ["eggs", "egg", "Ehgs", "egsg"]) {
    assert.ok(searchUkStaples(query).some((food) => food.name.includes("eggs")), query);
  }
  assert.ok(searchUkStaples("yoghurt").some((food) => food.name.includes("yogurt")));
  assert.ok(searchUkStaples("dal").some((food) => food.name.includes("dhal")));
  assert.ok(foodMatchScore("Chicken breast, grilled", "chicken") < foodMatchScore("Chickpeas, canned", "chicken"));
  assert.equal(searchUkStaples("nonexistentfood").length, 0);
});

test("portion edits use the original nutrition basis and keep unknown values blank", () => {
  const basis = portionBasis({ amount: "100", calories: "143", proteinG: "12.6", carbsG: "1.1", fatG: "9.7", fibreG: "", calMin: "", calMax: "" });
  assert.equal(scalePortion(basis, "200").calories, "286");
  assert.equal(scalePortion(basis, "2").calories, "2.9");
  assert.deepEqual(scalePortion(basis, ""), {});
  assert.equal(scalePortion(basis, "200").proteinG, "25.2");
  assert.equal(scalePortion(basis, "200").fibreG, "");
  assert.equal(scalePortion(basis, "100").calories, "143");
});
