# Slice 3, dispatch h: docs and full checks

Dispatch h of `projects/data-types-completion/slices/3/plan.md`. Read the slice plan's row h and "Carried forward" in `slices/3/handover.md`. Dispatches a to g are done. You may edit `docs/` in this dispatch; ADR 254 changes are limited to item 1.

## Build

1. **ADR 254.** Check every statement against the code and list each mismatch in the report with the line; fix only factual mismatches (a renamed function, a moved file). Update its status line. State in "Date and time types" that a text codec's `fromWire` keeps PostgreSQL's year text, and its `toWire` converts it. Name `DataType.fromCodec`, the constructor codecs use, where the ADR describes codecs.
2. **ADR 184** gets a note that ADR 254 supersedes it. **ADR 204** and **ADR 207** get retrospective notes naming the renamed codec methods.
3. **Codec authoring guide** (`docs/reference/codec-authoring-guide.md`): the four methods, the value, projections read by `fromWire`, `DataType.fromCodec`. Rewrite its "canonical JSON guarantee" if dispatch b left any of it.
4. `docs/reference/scalar-types.md`, `docs/reference/error-reference.md` (including `emptyResultJson` → `emptyResultWire`), `docs/reference/aggregate-descriptor-guide.md` (`emptyResultJson`), `psl-editor-tooling-tagged-literals.md` (the new tags), subsystem 5's sentence on the driver boundary, and the READMEs listed in `slices/3/notes/inventory-codec.md` section 8.
5. The slice 3 grep check in the project `plan.md` returns only what it allows; fix any code it finds. Give its pattern word boundaries so `encodeJson` does not match Mongo's `encodeJsonValue`.
6. Every check in the project `plan.md` "Checks every slice runs", except the full `test:integration` and `test:e2e` suites. Save each output under `wip/s3/`.

## Done when

All checks pass. Report in under 400 words: commits; ADR 254 mismatches found and fixed; each check and its result, with coverage per package against its `coverage.config.json` thresholds.
