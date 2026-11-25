# Spikes, 2026-11-24: can API Extractor read our packages, and in what form do we commit the result?

Both ran on the built declarations of all 22 packages under `packages/9-public/@prisma/` (1,037 import paths) with API Extractor 7.60.1. Scripts and output are in the gitignored `wip/api-check-spike/`.

## 1. API Extractor's Markdown reports

- All paths succeed. 240 seconds in one process. 258,654 lines, 27 MB.
- A facade path that forwards a platform path is reported as the forwarding line only (140 of the 163 paths of `@prisma/orm-postgres`).
- `declare module` augmentations appear in no report.
- With forgotten-export warnings written into the report, the reports contain absolute paths, line numbers and hashed chunk names.
- One declaration repeats in up to 40 reports.

Conclusion: not what we commit.

## 2. API Extractor's doc model, flattened to one line per item

- All paths succeed. 238 seconds in one process, 70 seconds with four worker processes. Two runs are byte-identical.
- 72,899 lines, 9.9 MB. Two thirds are non-exported types repeated per path; listed once per package the total is about 33,000 lines.
- The doc model omits forwards, default-export marking and `declare module` augmentations; all are recovered with the TypeScript compiler API.
- About 1,000 lines carry API Extractor's `_N` names and 145 the bundler's `$N` names. 1,206 lines contain `import("...")` type text. 158 lines exceed 1,000 characters.
- Sensitivity: an added optional parameter changes one line; an added required property adds one line; a removed export removes its lines; `@deprecated` adds one line.

Conclusion: this is the list. Not verified: whether `_N` numbering is stable across unrelated edits; namespace members (none exist).

## Prior art

How 32 TypeScript projects and the available tools handle this is in the gitignored `wip/prior-art/` (three files, a source link per claim). The parts the design relies on are cited in the project spec.
