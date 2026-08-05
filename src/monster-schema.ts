// monster-schema.ts
//
// This file defines the "shape" that every monster must have.
// Zod checks real JSON data against these rules at runtime.
// A lot of the comments were created by AI to better explain what is happening in the code.
// It was my first time using Typescript and Zod

import { number, z } from "zod";

// -----------------------------------------------------
// SMALL REUSABLE PIECES
// -----------------------------------------------------

// z.string() means "this value must be text."
// z.number() means "this value must be a number."
// z. object({...}) means "this value must be an object with these exact keys"

// Some monsters have a simple AC (just a number, e.g. 16)
// Some have a complex AC (an object explaining why the AC is that high, e.g. from armor).
// z.union([...]) means "this value can be either of these shapes"

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
    xpLair: z.number().optional(), // .optional() = the key might not exist
  }),
]);

// A single trait, action, or reaction entry (they all share this shape).
// "entries" is a list of strings - the actual descriptive text.
const FeatureEntrySchema = z.object({
  name: z.string(),
  entries: z.array(z.string()),
});

// Speed can get complicated (walk, fly, swim, burrow - and fly sometimes has
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
  // .partial() makes every key in this object optional at once.
  // Every monster has "walk", but not every monster can fly, swim, etc.,
  // so instead of writing .optional() five times, .partial() does it for
  // the whole object in one shot.

// ---------------------------------------------
// THE MAIN MONSTER SCHEMA
// ---------------------------------------------

export const MonsterSchema = z.object({
  // --- Fields every single monster has ---
  name: z.string(),
  source: z.string(),
  size: z.array(z.string()), // e.g. ["M"] or ["S", "M"] for variable sized creatures
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

  // --- Fields that exist on some monsters but not others ---
  // Everthing below is .optional() because the key may not appear at all
  // in a given monster's JSON.
  save: z.record(z.string(), z.string()).optional(),
  // z.record(keyType, valueType) = "an object with any number of keys,
  // where i dont know the key names in advance." Saving throws are a good
  // example: some monsters have { dex: "+5", wis: "+5"}, others have none,
  // and the keys present vary monster to monster.

  skill: z.record(z.string(), z.string()).optional(),
  senses: z.array(z.string()).optional(),
  passive: z.number().optional(),
  languages: z.array(z.string()).optional(),
  resist: z.array(z.string()).optional(),
  immune: z.array(z.string()).optional(),
  vulnerable: z.array(z.string()).optional(),
  conditionImmune: z.array(z.string()).optional(),

  trait: z.array(FeatureEntrySchema).optional(),
  action: z.array(FeatureEntrySchema).optional(),
  bonus: z.array(FeatureEntrySchema).optional(),
  reaction: z.array(FeatureEntrySchema).optional(),
  legendary: z.array(FeatureEntrySchema).optional(),
  legendaryActionsLair: z.number().optional(),

  environment: z.array(z.string()).optional(),
  hasToken: z.boolean().optional(),
});

// ----------------------------------------------
// THE INFERRED TYPESCRIPT TYPE
// ----------------------------------------------

// This one line gives me full TYpescript type called "Monster" that
// matches the schema above exactly - I never have to write it by hand,
// and if i edit the schema later, this type updates automatically.
export type Monster = z.infer<typeof MonsterSchema>;