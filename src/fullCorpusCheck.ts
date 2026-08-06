/**
 * fullCorpusCheck.ts
 *
 * A smoke test, not a unit test: walks every string field in the full
 * 503-monster bestiary-xmm.json and runs it through the tokenizer, to
 * check two things the hand-picked unit tests can't:
 *   1. Nothing throws on any real string in the full dataset.
 *   2. Every tag name actually encountered has a renderer registered —
 *      i.e. the registry we built from the earlier tag scan is complete,
 *      and renderPlainText isn't silently falling back on anything.
 */

import * as fs from "node:fs";
import { tokenize } from "./tagParser";

// Registry tag names, kept in sync manually with tagParser.ts's
// TAG_RENDERERS keys — duplicated here just for this check rather than
// exporting internals we don't need in the public module.
const KNOWN_TAGS = new Set([
  "damage", "dice", "spell", "variantrule", "creature", "hazard", "item",
  "action", "status", "condition", "skill", "hit", "dc", "atkr", "atk",
  "recharge", "h", "actSave", "actSaveFail", "actSaveSuccess",
  "actSaveSuccessOrFail", "actSaveFailBy", "actTrigger", "actResponse", "hom",
  "dcYourSpellSave", "hitYourSpellAttack",
]);

// Pass your bestiary-xmm.json path as an argument, e.g.:
//   npm run smoke -- ./data/bestiary-xmm.json
const bestiaryPath = process.argv[2] ?? "./bestiary-xmm.json";
const raw = fs.readFileSync(bestiaryPath, "utf-8");
const data = JSON.parse(raw) as { monster: unknown[] };

let stringsChecked = 0;
let errors = 0;
const unknownTags = new Set<string>();

// A generic recursive walker: 5etools JSON nests strings inside arbitrarily
// deep arrays/objects, so rather than write one walker per field shape, we
// just walk everything and act on whatever's a string.
function walk(value: unknown): void {
  if (typeof value === "string") {
    stringsChecked++;
    try {
      const segments = tokenize(value);
      for (const segment of segments) {
        if (segment.type === "tag" && !KNOWN_TAGS.has(segment.tag)) {
          unknownTags.add(segment.tag);
        }
      }
    } catch (err) {
      errors++;
      console.log(`  ERROR on string: ${value.slice(0, 80)}...`);
      console.log(`    ${err instanceof Error ? err.message : err}`);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) walk(item);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) walk(v);
  }
}

walk(data.monster);

console.log(`Checked ${stringsChecked} strings across ${data.monster.length} monsters.`);
console.log(`Errors thrown: ${errors}`);
console.log(
  unknownTags.size === 0
    ? "No unknown tags encountered — registry covers every tag in the full dataset."
    : `Unknown tags found (not in registry): ${[...unknownTags].join(", ")}`
);