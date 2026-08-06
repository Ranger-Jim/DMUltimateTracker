/**
 * tagParser.ts
 *
 * 5etools stores rich text (trait/action/spell descriptions) with inline
 * markup tags like:
 *   {@spell Melf's Acid Arrow|XPHB} (level 4 version)
 *   {@atkr m,r} {@hit 13}, reach 15 ft. {@h}17 ({@damage 2d8 + 8}) Slashing damage
 *
 * This file has two jobs:
 *  1. TOKENIZE a raw string into an ordered list of "this is plain text" /
 *     "this is a tag" segments. This is what the React stat block renderer
 *     will eventually use to turn tags into bold text, tooltips, links, etc.
 *  2. Provide a simple PLAIN-TEXT fallback renderer, so right now — before
 *     any UI exists — we can already turn this markup into readable text
 *     for testing, debugging, or a very basic first-pass stat block.
 *
 * The full list of tags below was NOT guessed — it was extracted by scanning
 * all 503 monsters in bestiary-xmm.json for every distinct {@tagName ...}
 * that actually appears. So this registry covers 100% of real usage in that
 * file, not just the handful we happened to see in the dragon.
 */

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

// A "discriminated union" — a TS pattern where a `type` field tells you which
// shape you're looking at. TextSegment and TagSegment are different shapes,
// but because they share a `type` field with different literal values
// ("text" vs "tag"), TypeScript can narrow which one you have inside an
// `if (segment.type === "tag")` check, and know which extra fields exist.
export interface TextSegment {
  type: "text";
  value: string;
}

export interface TagSegment {
  type: "tag";
  /** The tag name, e.g. "spell", "dc", "hit" (without the leading @) */
  tag: string;
  /** The tag's pipe-separated parameters, e.g. {@spell Fear|XPHB} -> ["Fear", "XPHB"] */
  params: string[];
  /** The original matched text, e.g. "{@spell Fear|XPHB}" — handy for debugging */
  raw: string;
}

// The union type itself: a Segment is EITHER a TextSegment OR a TagSegment.
// The `|` here is a type-level "or", not a runtime operator.
export type Segment = TextSegment | TagSegment;

// Optional structured result for spell extraction (used for ingestion into
// the monster_spellcasting table we discussed).
export interface SpellReference {
  name: string;
  source?: string;
  /** Trailing plain text right after the tag, e.g. "(level 4 version)" */
  note?: string;
}

// ---------------------------------------------------------------------------
// TOKENIZER
// ---------------------------------------------------------------------------

// Matches {@tagName ...anything except a closing brace...}
// Capture group 1 = the tag name. We grab everything else ourselves below
// so we can split params on "|" ourselves rather than fighting the regex.
const TAG_REGEX = /\{@(\w+)([^}]*)\}/g;

/**
 * Splits a raw 5etools string into an ordered array of plain-text and tag
 * segments. Concatenating every segment's underlying text back together
 * (ignoring formatting) reproduces the original string.
 */
export function tokenize(text: string): Segment[] {
  const segments: Segment[] = [];

  // lastIndex tracks where we are in `text` as we walk from match to match.
  let lastIndex = 0;

  // `.exec()` on a regex with the "g" flag is stateful: each call picks up
  // where the last one left off. This loop pattern (call exec in a while
  // condition) is the standard way to iterate over ALL matches manually.
  let match: RegExpExecArray | null;
  while ((match = TAG_REGEX.exec(text)) !== null) {
    const [raw, tagName, rawParams] = match;
    const matchStart = match.index;

    // Anything between the end of the last match and the start of this one
    // is plain text — push it first so segment order matches the original.
    if (matchStart > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, matchStart) });
    }

    // rawParams looks like " Fear|XPHB" (note the leading space after @spell).
    // Trim it, then split on "|". A tag with no params (like {@h}) gives us
    // rawParams === "", and "".split("|") -> [""], so we filter that out.
    const trimmed = rawParams.trim();
    const params = trimmed === "" ? [] : trimmed.split("|");

    segments.push({ type: "tag", tag: tagName, params, raw });

    lastIndex = matchStart + raw.length;
  }

  // Trailing plain text after the last tag (or the whole string, if there
  // were no tags at all).
  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }

  return segments;
}

// ---------------------------------------------------------------------------
// PLAIN-TEXT RENDERING REGISTRY
// ---------------------------------------------------------------------------

// Full names for the ability score codes 5etools uses in {@actSave dex} etc.
const ABILITY_NAMES: Record<string, string> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

// Full names for the attack-roll type codes used in {@atkr m,r} (2024 rules
// merged weapon/spell attacks into just "melee" (m) and "ranged" (r)).
const ATTACK_TYPE_NAMES: Record<string, string> = {
  m: "Melee",
  r: "Ranged",
};

// Small helper: 5etools' "name|source|displayText" pattern shows up on
// spell/item/creature/condition/etc. tags. The display text — if present —
// is what a human should actually read; otherwise fall back to the name.
// `params[2]` may be undefined (TS knows this because params is string[],
// and array access by index is always `T | undefined` under strict mode
// unless you've turned on noUncheckedIndexedAccess — worth doing later).
function nameOrDisplayText(params: string[]): string {
  return params[2] ?? params[0] ?? "";
}

// Shared renderer for {@atkr ...} and its shorter alias {@atk ...}.
// p[0] is a COMMA-separated list inside one pipe-param, e.g. "m,r" —
// different from every other tag, which pipe-separates its params.
function renderAttackRoll(p: string[]): string {
  const codes = (p[0] ?? "").split(",").map((c) => c.trim());
  const names = codes.map((c) => ATTACK_TYPE_NAMES[c] ?? c);
  return `${names.join(" or ")} Attack Roll:`;
}

// The registry: a function per tag name that takes that tag's params and
// returns the plain-text substitution. `Record<string, T>` is TS shorthand
// for "an object whose keys are strings and whose values are all type T" —
// here T is a function type: (params: string[]) => string.
const TAG_RENDERERS: Record<string, (params: string[]) => string> = {
  // --- dice / numbers, shown as-is ---
  damage: (p) => p[0] ?? "",
  dice: (p) => p[0] ?? "",

  // --- name|source|displayText style tags ---
  spell: nameOrDisplayText,
  variantrule: nameOrDisplayText,
  creature: nameOrDisplayText,
  hazard: nameOrDisplayText,
  item: nameOrDisplayText,
  action: nameOrDisplayText,
  status: nameOrDisplayText,
  condition: nameOrDisplayText,
  skill: (p) => p[0] ?? "",

  // --- attack / save mechanics ---
  hit: (p) => `+${p[0] ?? ""}`,
  dc: (p) => `DC ${p[0] ?? ""}`,
  // Pulled out to a named function (rather than inlined in the object
  // literal) so `atk` can reuse it below — object literals can't reference
  // their own sibling properties while still being built, since the object
  // doesn't exist yet at that point in evaluation.
  atkr: renderAttackRoll,
  // {@atk m,r} turned up in bestiary-rhw.json (Reflections on Ho... whatever
  // sourcebook) as a shorter alias for the exact same tag — same
  // comma-separated code format, same meaning, just an older/alternate name.
  atk: renderAttackRoll,
  recharge: (p) => (p[0] ? `(Recharge ${p[0]}-6)` : "(Recharge 6)"),

  // --- summoned-companion placeholder tags ---
  // These appear in "Tasha's summon" style stat blocks, where a number
  // depends on whatever PC summoned the creature, not the monster's own
  // stats. {@dcYourSpellSave} never carries a param — its rendered text is
  // fixed. {@hitYourSpellAttack ...} DOES carry a param, but checking every
  // usage across bestiary-rhw.json shows it's always the exact same fixed
  // explanatory phrase — so treating it as literal text to display (rather
  // than something to parse further) matches how 5etools actually uses it.
  dcYourSpellSave: () => "your spell save DC",
  hitYourSpellAttack: (p) => p[0] ?? "your spell attack modifier",

  // --- zero-argument "marker" tags: these exist purely to inject a label
  // at a spot in the text, e.g. {@h}17 (2d8) damage -> "Hit: 17 (2d8) damage"
  h: () => "Hit:",
  actSave: (p) => `${ABILITY_NAMES[p[0] ?? ""] ?? p[0] ?? ""} Saving Throw:`,
  actSaveFail: () => "Failure:",
  actSaveSuccess: () => "Success:",
  actSaveSuccessOrFail: () => "Success or Failure:",
  actSaveFailBy: (p) => `Failure (by ${p[0] ?? "?"} or more):`,
  actTrigger: () => "Trigger:",
  actResponse: () => "Response:",

  // {@hom} just flags "this bit is homebrew/reference content" in the
  // 5etools UI (e.g. shows an icon) — it carries no readable text itself.
  hom: () => "",
};

/**
 * Converts a raw 5etools string into plain, readable text by resolving
 * every tag through the registry above. Unknown tags (ones we haven't
 * added yet) fall back to just showing their first parameter, so nothing
 * silently disappears if 5etools adds a new tag we haven't handled.
 */
export function renderPlainText(text: string): string {
  return tokenize(text)
    .map((segment) => {
      if (segment.type === "text") return segment.value;

      const renderer = TAG_RENDERERS[segment.tag];
      if (renderer) return renderer(segment.params);

      // Fallback for any tag not yet in the registry.
      return segment.params[0] ?? "";
    })
    .join("");
}

// ---------------------------------------------------------------------------
// SPELL EXTRACTION (for monster_spellcasting ingestion)
// ---------------------------------------------------------------------------

/**
 * Pulls every {@spell ...} reference out of a string, along with any
 * trailing plain-text note that immediately follows it (e.g. the
 * "(level 4 version)" upcast note) — since that text isn't part of the
 * tag itself but is mechanically important to keep.
 */
export function extractSpellReferences(text: string): SpellReference[] {
  const segments = tokenize(text);
  const results: SpellReference[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment.type !== "tag" || segment.tag !== "spell") continue;

    const [name, source] = segment.params;
    if (!name) continue; // Guard against a malformed tag with no name.

    // Look at the very next segment: if it's plain text, grab the leading
    // parenthetical note off the front of it (there may be more text after
    // the note, like a comma continuing the sentence — we only want the
    // "(...)" part directly attached to this spell).
    let note: string | undefined;
    const next = segments[i + 1];
    if (next?.type === "text") {
      const noteMatch = next.value.match(/^\s*(\([^)]*\))/);
      if (noteMatch) note = noteMatch[1];
    }

    results.push({ name, source, note });
  }

  return results;
}