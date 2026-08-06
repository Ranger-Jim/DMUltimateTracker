/**
 * ingest.ts
 *
 * Reads one or more 5etools bestiary JSON files, validates every monster
 * against MonsterSchema, and writes them into a fresh SQLite database
 * built from schema.sql.
 *
 * Usage:
 *   npx ts-node src/ingest.ts ./monsters.db ./data/bestiary-xmm.json ./data/bestiary-mm.json ...
 *
 * The first argument is the OUTPUT database path (deleted and recreated
 * fresh each run, so this script is safe to re-run as often as you like
 * while developing). Every argument after that is an INPUT bestiary file.
 */

import * as fs from "node:fs";
import Database from "better-sqlite3";
import { MonsterSchema, type Monster } from "./monster-schema";
import { tokenize, extractSpellReferences } from "./tagParser";

// ---------------------------------------------------------------------------
// CR -> PROFICIENCY BONUS LOOKUP
// ---------------------------------------------------------------------------

// D&D 5e's fixed CR-to-proficiency-bonus table. A plain array of
// [minimumCR, proficiencyBonus] pairs, checked from lowest to highest.
const CR_TO_PROFICIENCY_BONUS: [number, number][] = [
  [0, 2], [5, 3], [9, 4], [13, 5], [17, 6], [21, 7], [25, 8], [29, 9],
];

function proficiencyBonusForCr(crNumeric: number): number {
  // Walk the table from the top down, returning the first bracket the CR
  // qualifies for. Starting from the highest bracket means we don't need
  // to track "the next bracket's minimum" — just find where crNumeric fits.
  for (let i = CR_TO_PROFICIENCY_BONUS.length - 1; i >= 0; i--) {
    const [minCr, bonus] = CR_TO_PROFICIENCY_BONUS[i];
    if (crNumeric >= minCr) return bonus;
  }
  return 2; // fallback, should never actually hit this given the table above
}

// CR can be a fraction like "1/4" or "1/8" — this converts either a whole
// number string or a fraction string into a real number for storage/sorting.
function crToNumeric(cr: string): number {
  if (cr.includes("/")) {
    const [numerator, denominator] = cr.split("/").map(Number);
    return numerator / denominator;
  }
  return Number(cr);
}

function abilityModifier(score: number): number {
  // Standard 5e formula: subtract 10, halve, round down. Math.floor on a
  // negative division in JS rounds toward negative infinity, which is
  // exactly the "round down" behavior 5e wants (e.g. a score of 7 gives
  // (7-10)/2 = -1.5 -> floor -> -2, the correct modifier).
  return Math.floor((score - 10) / 2);
}

// ---------------------------------------------------------------------------
// EDITION LOOKUP
// ---------------------------------------------------------------------------

// Maps a source book abbreviation to which ruleset it belongs to. Only
// covers the four files this project currently ingests — extend this list
// if you add more sourcebooks later.
const SOURCE_TO_EDITION: Record<string, string> = {
  XMM: "2024",
  MM: "2014",
  VGM: "2014",
  VRGR: "2014",
};

// ---------------------------------------------------------------------------
// SPELLCASTING EXTRACTION
// ---------------------------------------------------------------------------

interface ExtractedSpell {
  frequency: string;
  spellName: string;
  spellSource?: string;
  note?: string;
}

interface ExtractedSlot {
  level: number;
  slots: number;
}

// Every spell reference in 5etools spellcasting blocks is a STRING
// containing a {@spell ...} tag (plus maybe a trailing note like
// "(level 4 version)") — so extractSpellReferences from the tag parser,
// built for parsing prose, works perfectly here too on each individual
// string. Usually returns exactly one match per string; spreading all
// matches (rather than assuming exactly one) is just a safety margin.
function extractSpellsFromTagStrings(tagStrings: string[], frequency: string): ExtractedSpell[] {
  const results: ExtractedSpell[] = [];
  for (const tagString of tagStrings) {
    for (const ref of extractSpellReferences(tagString)) {
      results.push({ frequency, spellName: ref.name, spellSource: ref.source, note: ref.note });
    }
  }
  return results;
}

// Pulls every spell (across every frequency shape 5etools uses) out of a
// single spellcasting block, plus slot counts for leveled/prepared casters.
// Two totally different real-world shapes are handled here:
//   1. 2024-style innate casters: will (flat array) / daily, recharge,
//      restLong, legendary (all keyed objects, e.g. {"5": [...spells]}
//      for recharge, where "5" is the recharge die value).
//   2. 2014-style leveled/prepared casters: `spells` keyed by level number,
//      each level having its own spell list AND (except cantrips) a slot count.
function extractSpellcasting(sc: any): { spells: ExtractedSpell[]; slots: ExtractedSlot[] } {
  const spells: ExtractedSpell[] = [];
  const slots: ExtractedSlot[] = [];

  if (Array.isArray(sc.will)) {
    spells.push(...extractSpellsFromTagStrings(sc.will, "will"));
  }

  // daily / recharge / restLong / legendary all share the same keyed-object
  // shape — a small loop over their prefixes avoids repeating the same
  // four blocks of near-identical code.
  const keyedGroups: [string, string][] = [
    ["daily", "daily"],
    ["recharge", "recharge"],
    ["restLong", "rest_long"],
    ["legendary", "legendary"],
  ];
  for (const [jsonKey, frequencyPrefix] of keyedGroups) {
    const group = sc[jsonKey];
    if (group && typeof group === "object") {
      for (const [key, tagStrings] of Object.entries(group)) {
        spells.push(...extractSpellsFromTagStrings(tagStrings as string[], `${frequencyPrefix}_${key}`));
      }
    }
  }

  // 2014-style leveled/prepared casters: sc.spells = {"0": {spells:[...]},
  // "1": {slots: 3, spells:[...]}, ...}. Level "0" is cantrips — no slots.
  if (sc.spells && typeof sc.spells === "object") {
    for (const [levelStr, levelData] of Object.entries(sc.spells as Record<string, any>)) {
      const level = Number(levelStr);
      const frequency = `level_${level}`;
      if (typeof levelData.slots === "number") {
        slots.push({ level, slots: levelData.slots });
      }
      if (Array.isArray(levelData.spells)) {
        spells.push(...extractSpellsFromTagStrings(levelData.spells, frequency));
      }
    }
  }

  return { spells, slots };
}

// ---------------------------------------------------------------------------
// RECHARGE VALUE EXTRACTION (for monster_actions.recharge_value)
// ---------------------------------------------------------------------------

// Action names look like "Acid Breath {@recharge 5}" or just "{@recharge}"
// (no number = implicitly "recharges on a 6"). Reuses the tag parser's
// tokenizer rather than writing a separate one-off regex here.
function extractRechargeValue(actionName: string): number | null {
  for (const segment of tokenize(actionName)) {
    if (segment.type === "tag" && segment.tag === "recharge") {
      return segment.params[0] ? Number(segment.params[0]) : 6;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// MAIN INGESTION
// ---------------------------------------------------------------------------

const [dbPath, ...inputFiles] = process.argv.slice(2);

if (!dbPath || inputFiles.length === 0) {
  console.error("Usage: ts-node src/ingest.ts <output.db> <bestiary1.json> [bestiary2.json ...]");
  process.exit(1);
}

// Fresh database every run — safe to re-run as often as needed while developing.
if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
const db = new Database(dbPath);
db.exec(fs.readFileSync("./db/schema.sql", "utf-8"));

// Prepared statements — preparing once and reusing per-row is significantly
// faster than re-preparing the same SQL on every insert, and better-sqlite3
// encourages this pattern.
const insertMonster = db.prepare(`
  INSERT INTO monsters (
    name, source, edition, page, size, creature_type, type_raw,
    alignment_display, alignment_raw, ac, ac_raw, hp_average, hp_formula, speed,
    str, dex, con, int, wis, cha, saves, skills, senses, passive_perception,
    languages, damage_immunities, damage_resistances, damage_vulnerabilities,
    condition_immunities, cr, cr_numeric, xp, xp_lair, proficiency_bonus,
    initiative_proficiency_multiplier, initiative_bonus,
    legendary_action_uses, legendary_action_uses_lair, environment, source_json
  ) VALUES (
    @name, @source, @edition, @page, @size, @creature_type, @type_raw,
    @alignment_display, @alignment_raw, @ac, @ac_raw, @hp_average, @hp_formula, @speed,
    @str, @dex, @con, @int, @wis, @cha, @saves, @skills, @senses, @passive_perception,
    @languages, @damage_immunities, @damage_resistances, @damage_vulnerabilities,
    @condition_immunities, @cr, @cr_numeric, @xp, @xp_lair, @proficiency_bonus,
    @initiative_proficiency_multiplier, @initiative_bonus,
    @legendary_action_uses, @legendary_action_uses_lair, @environment, @source_json
  )
`);

const insertFeature = (table: string) =>
  db.prepare(`INSERT INTO ${table} (monster_id, name, entries, order_index) VALUES (?, ?, ?, ?)`);
const insertTrait = insertFeature("monster_traits");
const insertBonusAction = insertFeature("monster_bonus_actions");
const insertReaction = insertFeature("monster_reactions");
const insertLegendaryAction = insertFeature("monster_legendary_actions");
const insertAction = db.prepare(
  `INSERT INTO monster_actions (monster_id, name, entries, recharge_value, order_index) VALUES (?, ?, ?, ?, ?)`
);

const insertSpellcastingBlock = db.prepare(`
  INSERT INTO monster_spellcasting_blocks (monster_id, name, header_entries, footer_entries, ability, display_as, order_index)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const insertSpellcastingSpell = db.prepare(`
  INSERT INTO monster_spellcasting_spells (block_id, frequency, spell_name, spell_source, note, order_index)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const insertSpellcastingSlot = db.prepare(
  `INSERT INTO monster_spellcasting_slots (block_id, level, slots) VALUES (?, ?, ?)`
);

const findMonsterIdByNameSource = db.prepare(`SELECT id FROM monsters WHERE name = ? AND source = ?`);
const insertReprintLink = db.prepare(
  `INSERT OR IGNORE INTO monster_reprint_links (legacy_monster_id, new_monster_id) VALUES (?, ?)`
);

// Collected across every file, so the second pass (resolving reprintedAs
// links) can run once at the very end, after ALL sources are loaded —
// a legacy monster's reprint target might live in a file processed later.
const ingested: { id: number; raw: any }[] = [];

let totalParsed = 0;
let totalSkippedCopy = 0;
let totalSkippedInvalid = 0;
let totalInserted = 0;

for (const filePath of inputFiles) {
  const fileData = JSON.parse(fs.readFileSync(filePath, "utf-8")) as { monster: unknown[] };
  console.log(`\n--- ${filePath} (${fileData.monster.length} entries) ---`);

  for (const raw of fileData.monster) {
    totalParsed++;

    // _copy-template monsters aren't real stat blocks — they're instructions
    // to derive one from a base monster plus modifications. Not yet
    // resolved (see ROADMAP.md), so skip with a clear warning rather than
    // silently dropping them.
    if (raw && typeof raw === "object" && "_copy" in raw) {
      console.warn(`  SKIP (uses _copy template): ${(raw as any).name}`);
      totalSkippedCopy++;
      continue;
    }

    const result = MonsterSchema.safeParse(raw);
    if (!result.success) {
      console.warn(`  SKIP (failed validation): ${(raw as any).name} - ${result.error.issues[0]?.message}`);
      totalSkippedInvalid++;
      continue;
    }

    const m: Monster = result.data;

    // --- Derive fields that need real computation, not just reshaping ---

    // m.type can be: a plain string, an object with a string `type`, OR an
    // object whose `type` is itself {choose: [...]} (e.g. Empyrean can be
    // "celestial or fiend" — the DM picks). Building a readable fallback
    // string for the last case; type_raw preserves full fidelity either way.
    const creatureType =
      typeof m.type === "string"
        ? m.type
        : typeof m.type.type === "string"
          ? m.type.type
          : m.type.type.choose.join(" or ");
    const typeRaw = JSON.stringify(m.type);

    // alignment can be: a flat code string, a {alignment, chance} variant,
    // OR a {special: "..."} note (e.g. Sacred Statue: "as the eidolon's
    // alignment") — build a readable display string covering all three.
    const alignmentDisplay = (m.alignment ?? [])
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if ("special" in entry) return entry.special;
        return (entry as any).alignment.join("");
      })
      .join(" or ");

    // ac: store the FIRST listed value as the primary sortable int (matches
    // how 5etools always lists the "normal"/most relevant AC first), full
    // array preserved in ac_raw for accurate stat block rendering. Some
    // summoned-creature templates (e.g. Reanimated Companion) have NO fixed
    // AC at all — just a {special: "..."} note — so primaryAc is nullable.
    const firstAc = m.ac[0];
    const primaryAc =
      typeof firstAc === "number" ? firstAc : "ac" in firstAc ? firstAc.ac : null;

    const crNumeric = m.cr ? crToNumeric(typeof m.cr === "string" ? m.cr : m.cr.cr) : null;
    const proficiencyBonus = crNumeric !== null ? proficiencyBonusForCr(crNumeric) : null;

    // initiative.proficiency lives on the RAW JSON, not MonsterSchema (it
    // wasn't part of the Zod schema we validated against — worth adding to
    // MonsterSchema later, but reading it off the raw object works fine for
    // now since we keep source_json anyway). It's a MULTIPLIER on
    // proficiency_bonus, not a flat add — confirmed against the Ancient
    // Black Dragon's real +16 (DEX +2, PB 7, expertise multiplier 2).
    // Monsters with no fixed CR (summoned-creature templates) have neither
    // a proficiency bonus nor a real initiative value to compute — their
    // initiative depends on whoever summoned them, same story as their AC/HP.
    const rawInitiative = (raw as any).initiative;
    const initiativeMultiplier =
      rawInitiative && typeof rawInitiative.proficiency === "number" ? rawInitiative.proficiency : null;
    // IMPORTANT: 2014-rules monsters have NO `initiative` field at all —
    // that mechanic didn't exist yet. Their initiative bonus is pure DEX
    // modifier, with NO proficiency bonus added (confirmed: 2014 stat
    // blocks never listed initiative as its own line; DMs just rolled DEX
    // mod). Only add the proficiency-based bonus when the monster actually
    // HAS the 2024-style field — checking initiativeMultiplier !== null,
    // not just whether the monster has a CR (which 2014 monsters do too).
    const initiativeBonus =
      initiativeMultiplier !== null && proficiencyBonus !== null
        ? abilityModifier(m.dex) + Math.round(proficiencyBonus * initiativeMultiplier)
        : abilityModifier(m.dex);

    const params = {
      name: m.name,
      source: m.source,
      edition: SOURCE_TO_EDITION[m.source] ?? null,
      page: null,
      size: m.size[0],
      creature_type: creatureType,
      type_raw: typeRaw,
      alignment_display: alignmentDisplay || null,
      alignment_raw: m.alignment ? JSON.stringify(m.alignment) : null,
      ac: primaryAc,
      ac_raw: JSON.stringify(m.ac),
      hp_average: "average" in m.hp ? m.hp.average : null,
      hp_formula: "formula" in m.hp ? m.hp.formula : null,
      speed: JSON.stringify(m.speed),
      str: m.str,
      dex: m.dex,
      con: m.con,
      int: m.int,
      wis: m.wis,
      cha: m.cha,
      saves: m.save ? JSON.stringify(m.save) : null,
      skills: m.skill ? JSON.stringify(m.skill) : null,
      senses: m.senses ? JSON.stringify(m.senses) : null,
      passive_perception: m.passive ?? null,
      languages: m.languages ? m.languages.join(", ") : null,
      damage_immunities: m.immune ? JSON.stringify(m.immune) : null,
      damage_resistances: m.resist ? JSON.stringify(m.resist) : null,
      damage_vulnerabilities: m.vulnerable ? JSON.stringify(m.vulnerable) : null,
      condition_immunities: m.conditionImmune ? JSON.stringify(m.conditionImmune) : null,
      cr: m.cr ? (typeof m.cr === "string" ? m.cr : m.cr.cr) : null,
      cr_numeric: crNumeric,
      xp: m.cr && typeof m.cr !== "string" ? (m.cr as any).xp ?? null : null,
      xp_lair: m.cr && typeof m.cr !== "string" ? (m.cr as any).xpLair ?? null : null,
      proficiency_bonus: proficiencyBonus,
      initiative_proficiency_multiplier: initiativeMultiplier,
      initiative_bonus: initiativeBonus,
      legendary_action_uses: null,
      legendary_action_uses_lair: m.legendaryActionsLair ?? null,
      environment: m.environment ? JSON.stringify(m.environment) : null,
      source_json: JSON.stringify(raw),
    };

    insertMonster.run(params);

    const monsterId = db.prepare(`SELECT last_insert_rowid() as id`).get() as { id: number };
    const id = monsterId.id;

    // --- Child tables: traits / actions / bonus actions / reactions / legendary ---
    (m.trait ?? []).forEach((t, i) => insertTrait.run(id, t.name, JSON.stringify(t.entries), i));
    (m.action ?? []).forEach((a, i) =>
      insertAction.run(id, a.name, JSON.stringify(a.entries), extractRechargeValue(a.name), i)
    );
    (m.bonus ?? []).forEach((b, i) => insertBonusAction.run(id, b.name, JSON.stringify(b.entries), i));
    (m.reaction ?? []).forEach((r, i) => insertReaction.run(id, r.name, JSON.stringify(r.entries), i));
    (m.legendary ?? []).forEach((l, i) => insertLegendaryAction.run(id, l.name, JSON.stringify(l.entries), i));

    // --- Spellcasting ---
    const rawSpellcasting = (raw as any).spellcasting;
    if (Array.isArray(rawSpellcasting)) {
      rawSpellcasting.forEach((sc: any, blockIndex: number) => {
        insertSpellcastingBlock.run(
          id,
          sc.name ?? "Spellcasting",
          sc.headerEntries ? JSON.stringify(sc.headerEntries) : null,
          sc.footerEntries ? JSON.stringify(sc.footerEntries) : null,
          sc.ability ?? null,
          sc.displayAs ?? null,
          blockIndex
        );
        const blockId = (db.prepare(`SELECT last_insert_rowid() as id`).get() as { id: number }).id;

        const { spells, slots } = extractSpellcasting(sc);
        spells.forEach((s, i) =>
          insertSpellcastingSpell.run(blockId, s.frequency, s.spellName, s.spellSource ?? null, s.note ?? null, i)
        );
        slots.forEach((s) => insertSpellcastingSlot.run(blockId, s.level, s.slots));
      });
    }

    ingested.push({ id, raw });
    totalInserted++;
  }
}

// ---------------------------------------------------------------------------
// SECOND PASS: resolve reprintedAs -> monster_reprint_links
// ---------------------------------------------------------------------------

let reprintLinksResolved = 0;
let reprintLinksUnresolved = 0;

for (const { id, raw } of ingested) {
  const reprintedAs = raw.reprintedAs;
  if (!Array.isArray(reprintedAs)) continue;

  for (const target of reprintedAs) {
    const [newName, newSource] = target.split("|");
    const newRow = findMonsterIdByNameSource.get(newName, newSource) as { id: number } | undefined;
    if (newRow) {
      insertReprintLink.run(id, newRow.id);
      reprintLinksResolved++;
    } else {
      console.warn(`  Reprint link unresolved: "${raw.name}" -> "${target}" (target not found in ingested data)`);
      reprintLinksUnresolved++;
    }
  }
}

// ---------------------------------------------------------------------------
// SUMMARY
// ---------------------------------------------------------------------------

console.log("\n=== Ingestion complete ===");
console.log(`Total entries seen:      ${totalParsed}`);
console.log(`Inserted:                ${totalInserted}`);
console.log(`Skipped (_copy):         ${totalSkippedCopy}`);
console.log(`Skipped (invalid):       ${totalSkippedInvalid}`);
console.log(`Reprint links resolved:  ${reprintLinksResolved}`);
console.log(`Reprint links unresolved:${reprintLinksUnresolved}`);

db.close();