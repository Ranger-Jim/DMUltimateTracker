# DM Combat Tool — Roadmap

Custom full-stack DM tool for running D&D 5e combat, replacing gaps in the Foundry VTT + Obsidian workflow. Ships eventually to Google Play via Capacitor for use on a Galaxy tablet during sessions.

**Stack:** Node.js + Express (backend) · React (frontend) · SQLite → Turso (database) · Railway or Fly.io (hosting) · Capacitor (Android packaging)

**Data source:** [5etools GitHub repo](https://github.com/5etools-mirror-3/5etools-src) (same source Foundry's Plutonium importer uses)

---

## ✅ Done

- [x] Zod monster schema built against real 2024 Monster Manual data (`bestiary-xmm.json`, 503 entries) and Ravneloft: The horrors within (`bestiary-rhw`, 70 entries)
- [x] 503/503 monsters passing schema validation
- [x] Schema handles union types for nested list entries in trait/action text blocks
- [x] Schema handles conditional wrapper objects in resist/immune/vulnerable/conditionImmune fields
- [x] Schema handles both plural `entries` arrays and singular `entry` string keys
- [x] TypeScript/Zod tooling sorted: pinned `typescript@5.6.3` (fixes ts-node 10.9.2 mismatch), using `.loose()` instead of deprecated `.passthrough()`
- [x] `tsconfig.json` set up with `rootDir`, `outDir`, `strict`, `esModuleInterop`

---

## 🔨 In Progress / Up Next

### 1. Tag parser utility (do this before ingestion)
5etools text is full of inline markup tags — `{@spell}`, `{@dc}`, `{@hit}`, `{@damage}`, `{@condition}`, `{@atk}`, etc. This shows up in traits, actions, legendary actions, and spellcasting blocks, so it needs to be solved once as a shared utility rather than per-field.
- [ ] Write parser/regex helpers to extract tag type + value (e.g. `{@spell Melf's Acid Arrow|XPHB}` → name + source)
- [ ] Decide how parsed tags render in the UI (plain text? styled/linked spans?)
- [ ] Handle trailing plain-text notes after tags (e.g. `(level 4 version)` on upcast spells) — don't lose these

### 2. Initiative calculation
- [ ] Build CR → proficiency bonus lookup table (CR 0–4 → +2, 5–8 → +3, 9–12 → +4, 13–16 → +5, 17–20 → +6, 21–24 → +7, 25–28 → +8, 29–30 → +9)
- [ ] Implement `initiativeMod = dexMod + (proficiencyBonusForCR × initiative.proficiency)`
- [ ] Precompute and store final `initiativeBonus` as a plain int column at ingestion time (don't recompute live in the tracker)
- [ ] Keep raw `initiative.proficiency` value around too, for debugging/homebrew editing later
- [ ] Confirm whether any of the 503 monsters use an `initiative.special` field (not just `proficiency`) and make sure schema accounts for it

### 3. SQLite table design
- [ ] Core `monsters` table: scalar fields as real columns (name, AC, HP, speed, CR, type, initiativeBonus, etc.) for fast filtering/sorting in the tracker
- [ ] Separate tables per block type, each with `monster_id` FK + `order_index`:
  - `monster_traits`
  - `monster_actions`
  - `monster_legendary_actions`
  - `monster_reactions`
  - `monster_spellcasting` (spell_name, frequency — will/1e/2e/3e/daily/etc — note)
- [ ] Decide storage for free-form nested entries within a block (JSON column vs. further normalization)

### 4. Monster ingestion script
- [ ] `better-sqlite3` setup (sync API, no async ceremony)
- [ ] Read validated monsters → insert into `monsters` + child tables
- [ ] Run tag parser on trait/action/spell text during ingestion (or store raw and parse at render time — decide which)
- [ ] Test against full 503-entry set

---

## 🗺️ On the Horizon

- [ ] **Spells**: Zod schema for 5etools spell JSON
- [ ] **Spells**: ingestion script → `spells` table
- [ ] **Spells**: join monster spellcasting blocks to `spells` table by name (normalized name as lookup key, since 5etools has no stable spell ID)
- [ ] Backend API (Node + Express) serving monster/spell data
- [ ] React frontend scaffold
- [ ] Initiative tracker UI: name, AC, initiative, current/max HP (with shorthand `+5/-5` edits), status effects visible per row without extra clicks
- [ ] Auto-display stat block when a combatant's turn begins
- [ ] Monster Manual–style stat block rendering component
- [ ] Spell hover tooltips (full spell text, pulled from `spells` table)
- [ ] Saved party/PC configurations
- [ ] Capacitor wrapping for Android / Play Store distribution

---

## 💭 Stretch Goals (parked, not active)

- [ ] **Homebrew monster creator** — build new monsters by copying/adapting existing traits/actions as a starting point (not a shared/deduplicated library, since most trait text is baked with monster-specific stats — copy-then-edit is the realistic workflow)
- [ ] D&D Beyond PC import (deferred as its own complex problem)

---

## Notes / Decisions Log

- Not contributing to the unmaintained Combat Enhancements Foundry module — no license file, legally murky. Building original software instead.
- Turso is for later (when the backend goes remote) — keep using local SQLite (`better-sqlite3`) for now. Migration later is low-friction since Turso is file-compatible with SQLite.
- 2024 monster JSON `initiative.proficiency` is a **multiplier** on CR-based proficiency bonus, not a flat add. Most monsters: `1` (normal). Some: `0.5` (half). High-CR/legendary: `2` (expertise).
