# DM Combat Tool — Roadmap

Custom full-stack DM tool for running D&D 5e combat, replacing gaps in the Foundry VTT + Obsidian workflow. Ships eventually to Google Play via Capacitor for use on a Galaxy tablet during sessions.

**Stack:** Node.js + Express (backend) · React (frontend) · SQLite → Turso (database) · Railway or Fly.io (hosting) · Capacitor (Android packaging)

**Data source:** [5etools GitHub repo](https://github.com/5etools-mirror-3/5etools-src) (same source Foundry's Plutonium importer uses)

---

## ✅ Done

- [x] Zod monster schema built against real 2024 Monster Manual data (`bestiary-xmm.json`, 503 entries)
- [x] 503/503 monsters passing schema validation
- [x] Schema handles union types for nested list entries in trait/action text blocks
- [x] Schema handles conditional wrapper objects in resist/immune/vulnerable/conditionImmune fields
- [x] Schema handles both plural `entries` arrays and singular `entry` string keys
- [x] TypeScript/Zod tooling sorted: pinned `typescript@5.6.3` (fixes ts-node 10.9.2 mismatch), using `.loose()` instead of deprecated `.passthrough()`
- [x] `tsconfig.json` set up with `rootDir`, `outDir`, `strict`, `esModuleInterop`

- [x] SQLite table design locked (`schema.sql`) — core `monsters` table with scalar columns for fast tracker access, separate child tables per block type (traits/actions/bonus actions/reactions/legendary actions), two-table spellcasting design covering both 2024 innate-caster and 2014 leveled/prepared-caster shapes
- [x] 2014/2024 edition collision handled: `(name, source)` as the real uniqueness key (not `name` alone), `edition` column, and a `monster_reprint_links` junction table resolving 5etools' `reprintedAs` field — covers plain reprints, renames, one-to-two splits, and retired monsters with no successor
- [x] Decided: monster search/picker always shows both editions when both exist (no default-hide-legacy toggle)

- [x] **Tag parser utility** — `tokenize()`, `renderPlainText()`, `extractSpellReferences()` built and tested against real data: 15/15 unit tests + full-corpus smoke test (0 errors, 0 unknown tags) across all 503 2024 monsters AND 70 rhw monsters (which surfaced 3 extra tags: `atk`, `dcYourSpellSave`, `hitYourSpellAttack` — now handled)
- [x] **Initiative calculation** — confirmed `initiative.proficiency` is a multiplier (not a flat add) by reverse-engineering the Ancient Black Dragon's real +16 from the DDB screenshot; formula validated end-to-end in the schema test insert (came out to exactly 16)

- [x] Monster Zod schema hardened against real 2014-era data (`bestiary-mm.json`, `bestiary-vgm.json`, `bestiary-vrgr.json`): fixed a `tags` array bug that had silently broken 132 of 503 2024 monsters, wired up the already-built `alignmentEntrySchema` that wasn't actually being used, added a recursive nested-`entries` block (`z.lazy()`) for named sub-sections like Night Hag's Heartstone, and extended list items to accept plain strings. Final tally: 503/503 (XMM), 450/450 (MM), 136/143 (VGM), 34/35 (VRGR) — all remaining failures are `_copy`-template monsters, tracked separately below.

- [x] **Monster ingestion script** — reads any number of bestiary files, validates every monster, skips `_copy` templates and schema failures with clear warnings (never silent drops), computes derived fields (edition, CR-based proficiency bonus, per-edition initiative math), inserts into all 10 tables, resolves `reprintedAs` links in a second pass. Extended to 6 real sourcebooks (XMM, MM, VGM, VRGR, MPMM, RHW) spanning both rules editions and every reprint generation. **Final: 1,454 monsters inserted, 604 reprint links resolved, 0 unresolved.**
  - Found and fixed along the way: `Empyrean`'s "type is chosen from a list" shape (`{choose:[...]}`), and a `{special: "..."}` text variant that shows up on **AC, alignment, and CR** (not just HP, which the original schema comments already anticipated) for summoned-creature templates like Reanimated Companion and Sacred Statue — `ac` and `cr` are now nullable columns to match, with the full instructional text always preserved in `ac_raw`.
  - **Initiative is edition-dependent**: 2024 monsters use DEX mod + (CR-based proficiency bonus × multiplier); 2014 monsters get ZERO proficiency bonus added — pure DEX mod only, since that field didn't exist yet. Confirmed against real data: the same "Ancient Black Dragon" name resolves to two rows — XMM correctly comes out to +16, MM (2014) correctly comes out to +2.

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
- [ ] **`_copy` template resolution** — 8 monsters across VGM/VRGR (e.g. the Booyahg variants, The Bagman) aren't full stat blocks in the JSON; they're instructions to derive one from a base monster (`_copy.name`/`_copy.source`) plus modifications (`_mod`: text find/replace, trait append, etc.). Currently skipped at ingestion with a console warning rather than resolved — revisit if these specific monsters turn out to matter.

---

## Notes / Decisions Log

- Not contributing to the unmaintained Combat Enhancements Foundry module — no license file, legally murky. Building original software instead.
- Turso is for later (when the backend goes remote) — keep using local SQLite (`better-sqlite3`) for now. Migration later is low-friction since Turso is file-compatible with SQLite.
- 2024 monster JSON `initiative.proficiency` is a **multiplier** on CR-based proficiency bonus, not a flat add. Most monsters: `1` (normal). Some: `0.5` (half). High-CR/legendary: `2` (expertise).
- 2014→2024 reprints aren't always simple renames (`Acolyte` → `Priest Acolyte`) or 1:1 (`Gray Ooze` splits into `Gray Ooze` + `Psychic Gray Ooze`), and some have no 2024 version at all (`Bugbear Chief`). Always resolve via 5etools' `reprintedAs` field, never by matching names.