-- ============================================================================
-- schema.sql
--
-- SQLite schema for monster data, ingested from 5etools bestiary JSON.
-- Design: hybrid of real columns (for anything the combat tracker needs to
-- filter/sort/display fast) and JSON text columns (for irregular-shaped
-- data that's still uniform enough not to need its own table), plus fully
-- separate child tables for the "block" content (traits/actions/spells)
-- so the stat block renderer can query each section directly.
--
-- Every shape decision below (AC, CR, spellcasting frequency keys, etc.)
-- was checked against the real 503-monster 2024 Monster Manual data plus
-- bestiary-rhw.json, not assumed.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- CORE MONSTER TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE monsters (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,

    name                            TEXT NOT NULL,
    source                          TEXT,               -- e.g. "XMM"
    page                            INTEGER,

    size                            TEXT,                -- single letter, e.g. "M", "G"

    -- `type` in the JSON can be a plain string OR a nested object (swarm info,
    -- tags). Store the primary type as a real column for filtering, and the
    -- full original shape as JSON so nothing about swarms/tags gets lost.
    creature_type                   TEXT,                -- e.g. "dragon"
    type_raw                        TEXT,                -- JSON, full original type field

    -- Same pattern for alignment: some monsters have variable/chance-based
    -- alignment ({"alignment":["N"],"chance":50}), not just a flat array.
    alignment_display               TEXT,                -- e.g. "Chaotic Evil"
    alignment_raw                   TEXT,                -- JSON, full original alignment field

    -- AC was checked across all 503 monsters in the 2024 MM data: always a
    -- plain integer in this file (no "natural armor"/"from item" wrapper
    -- objects like older 2014-format monsters sometimes have). Real column
    -- since the tracker needs this instantly, every combat, every row.
    ac                              INTEGER NOT NULL,

    hp_average                      INTEGER,
    hp_formula                      TEXT,                -- e.g. "21d20 + 147"

    -- Speed is a small, uniformly-shaped object -> JSON is fine here, the
    -- tracker doesn't need to filter/sort by speed.
    speed                           TEXT,                -- JSON: {"walk":40,"fly":80,"swim":40,...}

    -- Real columns: needed constantly for modifier math (initiative, saves,
    -- skill checks) — not worth burying in JSON.
    str                              INTEGER,
    dex                              INTEGER,
    con                              INTEGER,
    int                              INTEGER,
    wis                              INTEGER,
    cha                              INTEGER,

    saves                            TEXT,               -- JSON: {"dex":9,"con":15,...} (proficient saves only)
    skills                           TEXT,               -- JSON: {"perception":16,"stealth":9}

    senses                           TEXT,               -- JSON array: ["Blindsight 60 ft.", "Darkvision 120 ft."]
    passive_perception               INTEGER,

    languages                        TEXT,               -- display string, e.g. "Common, Draconic"

    -- These four all use 5etools' conditional-wrapper shapes your Zod schema
    -- already validated (e.g. resistances that only apply "while in dragon
    -- form"). Store as JSON — normalizing these into rows isn't worth it,
    -- since they're rendered as a block of text, not queried individually.
    damage_immunities                TEXT,               -- JSON
    damage_resistances               TEXT,               -- JSON
    damage_vulnerabilities           TEXT,               -- JSON
    condition_immunities             TEXT,               -- JSON

    -- CR is either a plain string ("21") or {cr, xp, xpLair} for monsters
    -- with a lair variant. cr stored as TEXT because fractional CRs like
    -- "1/4" aren't valid numbers; cr_numeric is a derived sortable copy.
    cr                                TEXT NOT NULL,      -- e.g. "21", "1/4"
    cr_numeric                       REAL,                -- e.g. 21, 0.25 (for sorting/filtering)
    xp                                INTEGER,
    xp_lair                          INTEGER,             -- NULL if no lair variant

    proficiency_bonus                INTEGER,             -- derived from CR via lookup table at ingestion

    -- Raw initiative.proficiency value from the JSON (a MULTIPLIER on
    -- proficiency_bonus — see the initiative discussion: 1 = normal,
    -- 0.5 = half, 2 = expertise). Kept around for debugging/homebrew edits.
    initiative_proficiency_multiplier REAL,

    -- Precomputed final value: dexMod + (proficiency_bonus * multiplier).
    -- This is what the combat tracker actually reads — never recompute
    -- this live from the raw fields during a session.
    initiative_bonus                 INTEGER NOT NULL,

    -- Legendary action economy. NULL for non-legendary monsters.
    legendary_action_uses            INTEGER,
    legendary_action_uses_lair       INTEGER,

    environment                      TEXT,                -- JSON array, e.g. ["Forest","Hill"] (nullable)

    -- Full original monster JSON, kept as a safety net. If a future
    -- sourcebook has a field we haven't accounted for yet, or the renderer
    -- needs something we didn't think to pull into its own column, this
    -- means nothing was permanently lost at ingestion time.
    source_json                      TEXT NOT NULL
);

CREATE INDEX idx_monsters_name ON monsters(name);
CREATE INDEX idx_monsters_cr_numeric ON monsters(cr_numeric);

-- ----------------------------------------------------------------------------
-- TRAITS / ACTIONS / BONUS ACTIONS / REACTIONS / LEGENDARY ACTIONS
--
-- All five share the exact same shape in the source JSON: an array of
-- {name, entries[]} objects. bonus_actions is a genuinely new 2024 category
-- (checked: 108/503 monsters in the MM have one) — not something to merge
-- into monster_actions, since 2024 stat blocks render it as its own section.
-- ----------------------------------------------------------------------------

CREATE TABLE monster_traits (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    monster_id    INTEGER NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    entries       TEXT NOT NULL,   -- JSON array (raw entries, still has {@tags})
    order_index   INTEGER NOT NULL
);

CREATE TABLE monster_actions (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    monster_id     INTEGER NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    entries        TEXT NOT NULL,  -- JSON array
    -- Parsed out of a name like "Acid Breath {@recharge 5}" at ingestion,
    -- so the tracker can flag "this is available" without re-parsing tags
    -- during a live session. NULL for actions with no recharge mechanic.
    recharge_value INTEGER,
    order_index    INTEGER NOT NULL
);

CREATE TABLE monster_bonus_actions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    monster_id    INTEGER NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    entries       TEXT NOT NULL,
    order_index   INTEGER NOT NULL
);

CREATE TABLE monster_reactions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    monster_id    INTEGER NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    entries       TEXT NOT NULL,
    order_index   INTEGER NOT NULL
);

CREATE TABLE monster_legendary_actions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    monster_id    INTEGER NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    entries       TEXT NOT NULL,
    order_index   INTEGER NOT NULL
);

CREATE INDEX idx_traits_monster ON monster_traits(monster_id);
CREATE INDEX idx_actions_monster ON monster_actions(monster_id);
CREATE INDEX idx_bonus_actions_monster ON monster_bonus_actions(monster_id);
CREATE INDEX idx_reactions_monster ON monster_reactions(monster_id);
CREATE INDEX idx_legendary_actions_monster ON monster_legendary_actions(monster_id);

-- ----------------------------------------------------------------------------
-- SPELLCASTING
--
-- Three tables, because a spellcasting block, the spells inside it, and (for
-- leveled casters) slot counts are all genuinely different things with
-- different cardinality:
--   - A monster can have more than one spellcasting block (e.g. innate +
--     Wizard-style prepared casting).
--   - Two distinct shapes were checked against real data and are both
--     covered by the frequency/slots split below:
--       1. 2024-style innate casters (checked across all 132 spellcasters
--          in bestiary-xmm.json): will / daily 1-3 (with an "e" suffix
--          meaning "each" — separate use per spell rather than a shared
--          pool) / recharge / restLong / legendary. No slot counts involved.
--       2. 2014-style leveled/prepared casters (checked against
--          bestiary-mm.json's Acolyte): a "spells" object keyed by level
--          number, where each level has its own spell list AND its own
--          slot count (cantrips excepted — unlimited, no slot count).
-- ----------------------------------------------------------------------------

CREATE TABLE monster_spellcasting_blocks (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    monster_id       INTEGER NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,           -- usually "Spellcasting" or "Innate Spellcasting"
    header_entries   TEXT,                    -- JSON array, e.g. the "no Material components..." intro line
    footer_entries   TEXT,                    -- JSON array, nullable
    ability          TEXT,                    -- e.g. "cha"
    display_as       TEXT,                    -- e.g. "action" (whether it's cast as an action or bonus action)
    order_index      INTEGER NOT NULL
);

CREATE TABLE monster_spellcasting_spells (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    block_id     INTEGER NOT NULL REFERENCES monster_spellcasting_blocks(id) ON DELETE CASCADE,
    -- One of: 'will', 'daily_1', 'daily_1e', 'daily_2', 'daily_2e', 'daily_3',
    -- 'recharge', 'rest_long', 'legendary' (2024-style innate casters), OR
    -- 'level_0' through 'level_9' (2014-style prepared/leveled casters,
    -- e.g. bestiary-mm.json's Acolyte: "spells": {"0": {...cantrips...},
    -- "1": {"slots": 3, "spells": [...]}}). 'level_0' = cantrips specifically.
    frequency    TEXT NOT NULL,
    -- Spell name/source come from extractSpellReferences() in the tag
    -- parser — this is the join key back to the spells table once that
    -- exists. No stable spell ID exists in 5etools data, hence name-based.
    -- Note: 2014-style spell tags sometimes omit the source pipe entirely
    -- (e.g. "{@spell light}" rather than "{@spell light|PHB}") — spell_source
    -- being nullable already accounts for this.
    spell_name   TEXT NOT NULL,
    spell_source TEXT,                        -- e.g. "XPHB"; NULL if the tag had no source
    -- e.g. "(level 4 version)" — captured by extractSpellReferences(),
    -- rendered as static text next to the spell link, never clickable.
    note         TEXT,
    order_index  INTEGER NOT NULL
);

-- Slot counts for leveled/prepared casters (2014-style "spells": {...}
-- shape). Only populated for frequency values 'level_1' through 'level_9' —
-- cantrips ('level_0') have no slot limit, so there's no row for them here.
-- Separate table rather than a column on the block, because a single block
-- can have slots at multiple levels simultaneously (levels 1-9 each with
-- their own count).
CREATE TABLE monster_spellcasting_slots (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    block_id     INTEGER NOT NULL REFERENCES monster_spellcasting_blocks(id) ON DELETE CASCADE,
    level        INTEGER NOT NULL,            -- 1 through 9
    slots        INTEGER NOT NULL
);

CREATE INDEX idx_spellcasting_blocks_monster ON monster_spellcasting_blocks(monster_id);
CREATE INDEX idx_spellcasting_spells_block ON monster_spellcasting_spells(block_id);
CREATE INDEX idx_spellcasting_spells_name ON monster_spellcasting_spells(spell_name);
CREATE INDEX idx_spellcasting_slots_block ON monster_spellcasting_slots(block_id);
