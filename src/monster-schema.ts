// monster-schema.ts
//
// This file defines the "shape" that every monster must have.
// Zod checks real JSON data against these rules at runtime.

import { z } from "zod";

// ---------------------------------------------------------------------------
// SMALL REUSABLE PIECES
// ---------------------------------------------------------------------------

// z.string() means "this value must be text."
// z.number() means "this value must be a number."
// z.object({...}) means "this value must be an object with these exact keys."

// Some monsters have a simple AC (just a number, e.g. 16).
// Some have a complex AC (an object explaining WHY the AC is that high, e.g. from armor).
// z.union([...]) means "this value can be EITHER of these shapes."
const ArmorClassEntrySchema = z.union([
  z.number(),
  z.object({
    ac: z.number(),
    from: z.array(z.string()), // z.array(x) means "a list of x"
  }),
]);

// Challenge Rating is either a plain string ("4") or, for monsters with lair
// actions, an object with extra XP info.
const ChallengeRatingSchema = z.union([
  z.string(),
  z.object({
    cr: z.string(),
    xpLair: z.number().optional(), // .optional() = this key might not exist
  }),
]);

// Most lines of trait/action text are just plain strings. But some
// (like a Beholder's "Eye Rays," which needs a numbered sub-list of ten
// different ray effects) embed a whole nested list object instead of text.
//
// This is a "d10 table" shape: { type: "list", items: [ {name, entries}, ... ] }
// A list item's text can show up under TWO different key names depending
// on the source: "entries" (an array, for multiple lines of text) or
// "entry" (a single string, for just one line). Both are optional here
// because a given item will only ever have ONE of the two — but Zod
// doesn't enforce "exactly one of these two fields" by default, so this
// is a deliberately loose check that just accepts either without fussing.
const ListItemSchema = z.object({
  type: z.literal("item"),
  name: z.string().optional(),
  entries: z.array(z.string()).optional(),
  entry: z.string().optional(),
});

const NestedListSchema = z.object({
  type: z.literal("list"),
  style: z.string().optional(),
  items: z.array(ListItemSchema),
});

// An entry line can be EITHER plain text OR one of these nested lists.
const EntryLineSchema = z.union([z.string(), NestedListSchema]);

// A single trait, action, or reaction entry (they all share this shape).
const FeatureEntrySchema = z.object({
  name: z.string(),
  entries: z.array(EntryLineSchema),
});

// Speed can get complicated (walk, fly, swim, burrow — and fly sometimes has
// a "(hover)" condition attached instead of being a plain number).
const SpeedValueSchema = z.union([
  z.number(),
  z.object({
    number: z.number(),
    condition: z.string(),
  }),
]);

const SpeedSchema = z
  .object({
    walk: SpeedValueSchema,
    fly: SpeedValueSchema,
    swim: SpeedValueSchema,
    burrow: SpeedValueSchema,
    climb: SpeedValueSchema,
    canHover: z.boolean(),
  })
  .partial();
  // .partial() makes EVERY key in this object optional at once.
  // Every monster has "walk", but not every monster can fly, swim, etc.,
  // so instead of writing .optional() five times, .partial() does it for
  // the whole object in one shot.

// Damage resistances/immunities/vulnerabilities and condition immunities are
// USUALLY a simple list of strings, e.g. resist: ["cold", "fire"].
//
// But sometimes an entry needs to explain an exception, like:
//   Archmage's conditionImmune: charmed, but ONLY while a spell called
//   Mind Blank is active.
//   Half-Dragon's resist: not a fixed damage type — it depends on which
//   trait option the DM picked ("special" case).
//
// Both exception shapes get wrapped in an object instead of being a plain
// string, so we need a union covering all three possibilities.

const SpecialNoteEntrySchema = z.object({
  special: z.string(),
});

// .loose() means "allow any OTHER keys on this object besides the
// ones I've named, and don't complain about them." We need this here
// because the wrapping key repeats the field's own name (e.g. a
// conditionImmune entry has a key literally called "conditionImmune"
// inside it) — rather than writing a separate schema for every field name,
// .loose() lets us accept that extra key generically.
// (Note: older Zod versions called this .passthrough() — same idea, .loose()
// is just the current name for it.)
const ConditionalNoteEntrySchema = z
  .object({
    note: z.string(),
    cond: z.boolean().optional(),
  })
  .loose();

const DamageOrConditionEntrySchema = z.union([
  z.string(),
  SpecialNoteEntrySchema,
  ConditionalNoteEntrySchema,
]);

// ---------------------------------------------------------------------------
// THE MAIN MONSTER SCHEMA
// ---------------------------------------------------------------------------

export const MonsterSchema = z.object({
  // --- Fields every single monster has ---
  name: z.string(),
  source: z.string(),
  size: z.array(z.string()), // e.g. ["M"] or ["S", "M"] for variable-size creatures
  alignment: z.array(z.string()).optional(), // some (like constructs) have none
  ac: z.array(ArmorClassEntrySchema),
  hp: z.object({
    average: z.number(),
    formula: z.string(),
  }),
  speed: SpeedSchema,

  // --- Ability scores: every monster has all six ---
  str: z.number(),
  dex: z.number(),
  con: z.number(),
  int: z.number(),
  wis: z.number(),
  cha: z.number(),

  cr: ChallengeRatingSchema,

  // --- Fields that exist on SOME monsters but not others ---
  // Everything below is .optional() because the key may not appear at all
  // in a given monster's JSON.
  save: z.record(z.string(), z.string()).optional(),
  // z.record(keyType, valueType) = "an object with any number of keys,
  // where I don't know the key names in advance." Saving throws are a good
  // example: some monsters have {dex: "+5", wis: "+5"}, others have none,
  // and the keys present vary monster to monster.

  skill: z.record(z.string(), z.string()).optional(),
  senses: z.array(z.string()).optional(),
  passive: z.number().optional(),
  languages: z.array(z.string()).optional(),
  resist: z.array(DamageOrConditionEntrySchema).optional(),
  immune: z.array(DamageOrConditionEntrySchema).optional(),
  vulnerable: z.array(DamageOrConditionEntrySchema).optional(),
  conditionImmune: z.array(DamageOrConditionEntrySchema).optional(),

  trait: z.array(FeatureEntrySchema).optional(),
  action: z.array(FeatureEntrySchema).optional(),
  bonus: z.array(FeatureEntrySchema).optional(),
  reaction: z.array(FeatureEntrySchema).optional(),
  legendary: z.array(FeatureEntrySchema).optional(),
  legendaryActionsLair: z.number().optional(),

  environment: z.array(z.string()).optional(),
  hasToken: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// THE INFERRED TYPESCRIPT TYPE
// ---------------------------------------------------------------------------

// This one line gives you a full TypeScript type called "Monster" that
// matches the schema above EXACTLY — you never have to write it by hand,
// and if you edit the schema later, this type updates automatically.
export type Monster = z.infer<typeof MonsterSchema>;