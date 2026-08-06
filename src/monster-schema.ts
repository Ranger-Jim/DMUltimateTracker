// monster-schema.ts
import { z } from "zod";

// Some fields (AC, alignment, resist/immune/etc.) occasionally use plain
// instructional text instead of real game data — most commonly for
// summoned-creature templates whose stats scale with whoever summoned them
// (e.g. AC: "10 plus your Intelligence modifier") or monsters whose value
// depends on something else entirely (e.g. alignment: "as the eidolon's
// alignment"). Defined up here since AC and alignment both need it below,
// not just resist/immune/vulnerable/conditionImmune further down the file.
const SpecialNoteEntrySchema = z.object({
  special: z.string(),
});

const ArmorClassEntrySchema = z.union([
  z.number(),
  z.object({
    ac: z.number(),
    from: z.array(z.string()).optional(),
    condition: z.string().optional(),
    braces: z.boolean().optional(),
  }).loose(),
  SpecialNoteEntrySchema,
]);

const alignmentEntrySchema = z.union([
  z.string(),
  z.object({
    alignment: z.array(z.string()),
    chance: z.number(),
  }).loose(),
  SpecialNoteEntrySchema,
]);

const ChallengeRatingSchema = z.union([
  z.string(),
  z.object({
    cr: z.string(),
    xpLair: z.number().optional(),
  }),
]);

const ListItemSchema = z.object({
  type: z.enum(["item", "itemSub"]),
  name: z.string().optional(),
  entries: z.array(z.string()).optional(),
  entry: z.string().optional(),
});

// A list item can be a fully-structured object (name + entries, for things
// like a Beholder's named eye-ray effects) OR just a plain string (for a
// simpler bullet list with no per-item name, like Martial Arts Adept's
// unarmed-strike effect options).
const ListItemEntrySchema = z.union([z.string(), ListItemSchema]);

const NestedListSchema = z.object({
  type: z.literal("list"),
  style: z.string().optional(),
  items: z.array(ListItemEntrySchema),
});

// A named sub-section embedded inside a trait's entries — e.g. Night Hag's
// "Heartstone" write-up nested inside the broader "Night Hag Items" trait:
//   { type: "entries", name: "Heartstone", entries: ["This lustrous..."] }
// Its own `entries` array can (in principle) contain more of these nested
// blocks, so this type is RECURSIVE — it refers to itself. z.lazy() tells
// Zod "don't build this schema's shape right now, wait until it's actually
// used to parse something" — which is what makes self-reference possible.
// Without it, Zod would need the full shape defined before it exists,
// which is impossible for something that can contain more of itself.
const NestedEntriesBlockSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    type: z.literal("entries"),
    name: z.string().optional(),
    entries: z.array(EntryLineSchema),
  }).loose()
);

// An entry line can be plain text, a nested list (e.g. a Beholder's ten
// numbered eye-ray effects), OR a named nested sub-section (Night Hag's
// Heartstone/Soulbag write-ups). This is also wrapped in z.lazy() because
// it's now part of the same recursive relationship as the schema above:
// EntryLineSchema uses NestedEntriesBlockSchema, which uses EntryLineSchema.
// `z.ZodType<any>` on both is a deliberate simplification — fully typing a
// recursive structure like this is possible but adds real complexity for
// not much practical benefit at this stage; `any` here just means "trust
// the runtime check," which Zod still enforces correctly either way.
const EntryLineSchema: z.ZodType<any> = z.lazy(() =>
  z.union([z.string(), NestedListSchema, NestedEntriesBlockSchema])
);

const FeatureEntrySchema = z.object({
  name: z.string(),
  entries: z.array(EntryLineSchema),
});

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

const HitPointsSchema = z.union([
  z.object({
    average: z.number(),
    formula: z.string(),
  }),
  z.object({
    special: z.string(),
  }),
]);

const typeTagSchema = z.union([
  z.string(),
  z.object({
    tag: z.string(),
    prefix: z.string().optional(),
    prefixHidden: z.boolean().optional(),
  }).loose(),
]);

// Most skills are just a plain bonus string, e.g. {"perception": "+7"}.
// But some monsters have a special "other" entry: a set of skills where
// only ONE actually applies (DM's choice or situational), e.g. Adult
// Oblex's "other": [{"oneOf": {"arcana":"+7","history":"+7",...}}].
const SkillValueSchema = z.union([
  z.string(),
  z.array(
    z.object({
      oneOf: z.record(z.string(), z.string()),
    }).loose()
  ),
]);

const CreatureTypeSchema = z.union([
  z.string(),
  z.object({
    type: z.union([
      z.string(),
      z.object({
        choose: z.array(z.string()),
      }),
    ]),
    tags: z.array(typeTagSchema).optional(),
    // ^ FIX: tags is a LIST of tags (["chromatic"] or [{tag:"elf",...}]),
    // not a single tag. Without z.array() here, every monster whose type
    // is an object — not just Drow, but every tagged dragon too — fails,
    // since Zod expects exactly one tag value where the JSON actually has
    // an array. Also .optional(): a type object doesn't always have tags
    // at all (e.g. some "choose" shapes might omit it).
  }),
]);

export const MonsterSchema = z.object({
  name: z.string(),
  source: z.string(),
  size: z.array(z.string()),
  type: CreatureTypeSchema,
  alignment: z.array(alignmentEntrySchema).optional(),
  // ^ FIX: was z.array(z.string()), which ignored the alignmentEntrySchema
  // union you already built above. That union handles variable-alignment
  // monsters like Cloud Giant ({"alignment":["N","G"],"chance":50}) — but
  // only if MonsterSchema actually points at it.
  ac: z.array(ArmorClassEntrySchema),
  hp: HitPointsSchema,
  speed: SpeedSchema,
  str: z.number(),
  dex: z.number(),
  con: z.number(),
  int: z.number(),
  wis: z.number(),
  cha: z.number(),
  cr: ChallengeRatingSchema.optional(),
  pbNote: z.string().optional(),
  save: z.record(z.string(), z.string()).optional(),
  skill: z.record(z.string(), SkillValueSchema).optional(),
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

export type Monster = z.infer<typeof MonsterSchema>;