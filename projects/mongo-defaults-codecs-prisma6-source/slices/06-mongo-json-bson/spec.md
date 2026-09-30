# Slice 6: `Json` means JSON; `Bson` means any BSON value

_Parent: `projects/mongo-defaults-codecs-prisma6-source/`. Branch `mongo-json-bson`, stacked on slice 4 (PR #30406). The normative specification is `../../design/scalar-naming.md` § 5 (`Json`), § 6 (`Bson`), § 8 (upgrade fragments), § 9 (the scalar-types reference doc). This file adds only the slice contract around it._

## At a glance

```prisma
model Event {
  id      ObjectId @id
  payload Json   // JSON values only; validator lists the JSON-representable BSON types
  raw     Bson   // any BSON value; validator {}; decoded as BsonValue
}
```

## Chosen design

Exactly `design/scalar-naming.md` § 5 and § 6. Decisions the implementer does not remake: the `targetTypes` list for `Json` and the validator derivation reading the whole list; encode and decode refusal rules and exact messages with the dotted path; `Bson`'s token, codec id, PSL name, TS helper, structural `BsonValue`, EJSON v2 canonical JSON form, unconstrained validator; the docs and fragment content. If the design doc is silent on something, stop and report; do not choose.

## Coherence rationale

One reviewer reads the two codecs side by side with the design tables; the tightening and the new type are the same decision seen from both sides.

## Scope

In: § 5, § 6, § 8, § 9 of the design doc; the `Bson` PSL name registered in the adapter's scalar map (not deprecated, no alias); `CodecTypes` and the TS builder map; `derive-json-schema` reading a `targetTypes` list; `docs/reference/scalar-types.md` for Mongo; the Prisma 6 reader unchanged (Prisma 6 has no `Bson`); the codec authoring guide and subsystem 10 paragraph.

Out: Postgres and SQLite (`design/scalar-naming.md` § 4, § 7, own project); a Mongo `contract print` printer; the driver wire contract.

## Pre-investigated edge cases

- `mongo/json@1` decode must accept a `long` within the safe-integer range as a `number` and refuse one outside it with the path.
- A `Bson` field's decoded values come from the driver's own `bson` copy, so `BsonValue` is structural (tag plus methods), never the `bson` classes.
- The validator derivation currently reads `targetTypes[0]`; the list form must not change any existing fixture's validator (every existing codec has one target type), proven by `fixtures:check` with an empty `contract.json` diff before the `Json` fixtures are touched.

## Slice Definition of Done

Inherits `drive/calibration/dod.md`. Slice-specific: every test named in design § 5 and § 6 exists and was red first; `bson-scalars` and `temporal-presets` journeys still pass; the `Json` fixture in `bson-scalars` gains a `Bson` field and the end-to-end assertions from § 6; `docs/reference/scalar-types.md` exists with the Mongo table and the cross-target concept table; upgrade fragments per § 8 with tested detection patterns; per-package lint and upgrade coverage against the stacked base in every gate.
