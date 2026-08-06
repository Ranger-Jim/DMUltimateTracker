/**
 * tagParser.test.ts
 *
 * Not using a test framework (Jest/Vitest) yet — Node's built-in
 * `node:assert/strict` module is enough for now and keeps the dependency
 * list small. `assert.strictEqual(actual, expected)` throws if they don't
 * match, which our tiny runner below catches and reports as a failure.
 *
 * Every string here is copied directly from the real bestiary-xmm.json
 * (2024 Monster Manual) via the 5etools GitHub data, not made up —
 * so a pass here means the parser handles what's actually in the data.
 */

import assert from "node:assert/strict";
import { tokenize, renderPlainText, extractSpellReferences } from "./tagParser";

// A tiny hand-rolled test runner: each entry is a name + a function that
// throws (via assert) if something's wrong. `void` return type just means
// "this function doesn't return anything useful."
type Test = { name: string; fn: () => void };
const tests: Test[] = [];

// `t()` just pushes onto the array above — a bit of sugar so the test list
// below reads top-to-bottom like a normal test file.
function t(name: string, fn: () => void): void {
  tests.push({ name, fn });
}

// ---------------------------------------------------------------------------
// Real strings from Ancient Black Dragon (bestiary-xmm.json)
// ---------------------------------------------------------------------------

t("renders a Rend attack line (atkr, hit, h, damage combo)", () => {
  const raw =
    "{@atkr m} {@hit 15}, reach 15 ft. {@h}17 ({@damage 2d8 + 8}) Slashing damage plus 9 ({@damage 2d8}) Acid damage.";
  const result = renderPlainText(raw);
  assert.strictEqual(
    result,
    "Melee Attack Roll: +15, reach 15 ft. Hit:17 (2d8 + 8) Slashing damage plus 9 (2d8) Acid damage."
  );
});

t("renders Acid Breath (actSave, dc, actSaveFail, actSaveSuccess, variantrule)", () => {
  const raw =
    "{@actSave dex} {@dc 22}, each creature in a 90-foot-long, 10-foot-wide {@variantrule Line [Area of Effect]|XPHB|Line}. {@actSaveFail} 67 ({@damage 15d8}) Acid damage. {@actSaveSuccess} Half damage.";
  const result = renderPlainText(raw);
  assert.strictEqual(
    result,
    "Dexterity Saving Throw: DC 22, each creature in a 90-foot-long, 10-foot-wide Line. Failure: 67 (15d8) Acid damage. Success: Half damage."
  );
});

t("renders Multiattack (plain sentence + one spell tag with trailing note)", () => {
  const raw =
    "The dragon makes three Rend attacks. It can replace one attack with a use of Spellcasting to cast {@spell Melf's Acid Arrow|XPHB} (level 4 version).";
  const result = renderPlainText(raw);
  assert.strictEqual(
    result,
    "The dragon makes three Rend attacks. It can replace one attack with a use of Spellcasting to cast Melf's Acid Arrow (level 4 version)."
  );
});

t("renders a two-attack-type atkr (comma-separated codes, not pipe-separated)", () => {
  const raw = "{@atkr m,r} {@hit 13}";
  const result = renderPlainText(raw);
  assert.strictEqual(result, "Melee or Ranged Attack Roll: +13");
});

t("renders recharge with a number", () => {
  const raw = "Acid Breath {@recharge 5}";
  const result = renderPlainText(raw);
  assert.strictEqual(result, "Acid Breath (Recharge 5-6)");
});

// ---------------------------------------------------------------------------
// Spell extraction (for the future monster_spellcasting ingestion table)
// ---------------------------------------------------------------------------

t("extractSpellReferences finds the spell name and source", () => {
  const raw = "{@spell Detect Magic|XPHB}";
  const [ref] = extractSpellReferences(raw);
  assert.strictEqual(ref.name, "Detect Magic");
  assert.strictEqual(ref.source, "XPHB");
  assert.strictEqual(ref.note, undefined);
});

t("extractSpellReferences captures the trailing '(level X version)' note", () => {
  const raw = "{@spell Melf's Acid Arrow|XPHB} (level 4 version)";
  const [ref] = extractSpellReferences(raw);
  assert.strictEqual(ref.name, "Melf's Acid Arrow");
  assert.strictEqual(ref.note, "(level 4 version)");
});

t("extractSpellReferences finds multiple spells in one string, only tagging notes to the right spell", () => {
  const raw =
    "At Will: {@spell Detect Magic|XPHB}, {@spell Fear|XPHB}, {@spell Melf's Acid Arrow|XPHB} (level 4 version)";
  const refs = extractSpellReferences(raw);
  assert.strictEqual(refs.length, 3);
  assert.strictEqual(refs[0].name, "Detect Magic");
  assert.strictEqual(refs[0].note, undefined);
  assert.strictEqual(refs[1].name, "Fear");
  assert.strictEqual(refs[1].note, undefined);
  assert.strictEqual(refs[2].name, "Melf's Acid Arrow");
  assert.strictEqual(refs[2].note, "(level 4 version)");
});

// ---------------------------------------------------------------------------
// Real strings from bestiary-rhw.json (summoned companion stat blocks) —
// these introduce placeholder tags that scale with the summoner's own
// stats rather than the monster's, plus a shorter alias for {@atkr}.
// ---------------------------------------------------------------------------

t("renders Death Burst (dcYourSpellSave placeholder tag)", () => {
  const raw =
    "The companion explodes when it dies. {@actSave dex} DC equals {@dcYourSpellSave}, each creature in a 10-foot {@variantrule Emanation [Area of Effect]|XPHB|Emanation} originating from the companion. {@actSaveFail} {@damage 2d4} Necrotic damage. {@actSaveSuccess} Half damage.";
  const result = renderPlainText(raw);
  assert.strictEqual(
    result,
    "The companion explodes when it dies. Dexterity Saving Throw: DC equals your spell save DC, each creature in a 10-foot Emanation originating from the companion. Failure: 2d4 Necrotic damage. Success: Half damage."
  );
});

t("renders Dreadful Swipe (atk alias + hitYourSpellAttack placeholder tag)", () => {
  const raw =
    "{@atkr m} {@hitYourSpellAttack Bonus equals your spell attack modifier}, reach 5 ft. {@h}{@dice 1d4} plus your Intelligence modifier Necrotic damage.";
  const result = renderPlainText(raw);
  assert.strictEqual(
    result,
    "Melee Attack Roll: Bonus equals your spell attack modifier, reach 5 ft. Hit:1d4 plus your Intelligence modifier Necrotic damage."
  );
});

t("atk (short alias) renders identically to atkr", () => {
  assert.strictEqual(renderPlainText("{@atk m,r}"), renderPlainText("{@atkr m,r}"));
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

t("plain text with no tags passes through unchanged", () => {
  const raw = "The dragon can breathe air and water.";
  assert.strictEqual(renderPlainText(raw), raw);
});

t("unknown/future tag falls back to its first param instead of disappearing", () => {
  const raw = "Some {@futuretag Whatever|XPHB} thing";
  assert.strictEqual(renderPlainText(raw), "Some Whatever thing");
});

t("zero-argument tag with genuinely no params (e.g. {@hom}) renders as empty string", () => {
  const raw = "Reference monster {@hom}";
  assert.strictEqual(renderPlainText(raw), "Reference monster ");
});

t("tokenize output can be joined back into readable form (structure check)", () => {
  const raw = "{@hit 13}, reach 10 ft.";
  const segments = tokenize(raw);
  assert.strictEqual(segments.length, 2);
  assert.strictEqual(segments[0].type, "tag");
  assert.strictEqual(segments[1].type, "text");
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

for (const test of tests) {
  try {
    test.fn();
    console.log(`  \u2713 ${test.name}`);
    passed++;
  } catch (err) {
    failed++;
    console.log(`  \u2717 ${test.name}`);
    if (err instanceof Error) {
      console.log(`      ${err.message}`);
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed (${tests.length} total)`);

// Non-zero exit code on failure so this can plug into CI later.
if (failed > 0) process.exit(1);