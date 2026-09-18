# Project plan — Remove `dbgenerated(...)` from Prisma 8

Spec: [`spec.md`](spec.md). Deferred items: [`deferred.md`](deferred.md). **Linear:** not yet created; add the project and three issues, then fill the IDs below.

## Slices

| Slice | Folder | Branch | Depends on | Owner | Linear |
|---|---|---|---|---|---|
| A — The `sql` tagged literal for raw SQL defaults | [`slices/a-sql-default-literal/`](slices/a-sql-default-literal/spec.md) | `remove-dbgenerated-sql-literal` | nothing | agent 1 | TBD |
| B — Codec-owned PSL literals (ADR 184, PSL half) | [`slices/b-codec-psl-literals/`](slices/b-codec-psl-literals/spec.md) | `remove-dbgenerated-codec-psl-literals` | nothing | agent 2 | TBD |
| C — Delete `dbgenerated`, regenerate Supabase, upgrade instruction | [`slices/c-remove-dbgenerated/`](slices/c-remove-dbgenerated/spec.md) | `remove-dbgenerated-delete` | A and B merged | agent 1 | TBD |

Each slice is one PR against `main`. Slice plans (dispatch decomposition) are written at build time at `slices/<slice>/plan.md` by the slice's implementer following the slice spec; the specs are complete enough that the plan is a sequencing document, not a design document.

## Sequencing

```
main ──┬── A (parallel) ──┐
       └── B (parallel) ──┴── C
```

- A and B start together from the same `main` commit (`f3574a34a7` or later).
- A and B share one file: `packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts`, function `scalarDefaultArms`. A appends a `taggedLiteral(...)` arm after the function arms. B replaces `str(), numLiteral(), bool()` with `literal()`. Whichever merges second rebases and resolves that one function by hand; the result is `[literal(), ...funcArms, taggedLiteral(tags)]` for scalars and `[list(literal()), ...funcArms, taggedLiteral(tags)]` for lists. Both also touch `DefaultArgValue` in the same file, each adding its own union member.
- A and B both add a file under `psl-parser/src/attribute-spec/combinators/` and a member to `ArgTypeKind` in `attribute-spec/types.ts`; distinct names, so the rebase is mechanical.
- No other file is touched by both. If an implementer finds one, they stop and report before editing it.
- C starts only from a `main` that contains both A and B.

## Coordination between the two agents

- Agent 2 (slice B) owns the `Codec` interface change and every codec class. Agent 1 (slice A) does not add or change codec members.
- Agent 1 (slice A) owns the tokenizer, parser node, tag registry, TypeScript `sql` tag and helpers, `gen_random_uuid()`, and the SQLite verify-side resolver. Agent 2 does not touch those.
- Interfaces slice C relies on, which A and B must ship exactly as specified: `ControlMutationDefaults.defaultLiteralTagRegistry` (A5), `TaggedLiteralValue` (A4), `Codec.encodePsl` / `Codec.decodePsl` and `PslLiteral` (B1, B2), `mapDefault(columnDefault, { codec })` and `formatPslLiteral` (B6). A change to any of these names or shapes is reported to the orchestrator before it lands.
- Both agents record any question the spec does not answer in their PR body under "Spec gaps" and stop on the halt conditions their spec lists. They do not choose an alternative.

## Validation gates per slice

Every slice: `pnpm typecheck` at root, `pnpm test:packages`, `pnpm test:integration`, `pnpm fixtures:check`, `pnpm lint:deps`, `pnpm lint:docs`, plus the grep gates in its Definition of done. Slices B and C also run `pnpm test:e2e`. Slice C also runs the Supabase package tests and the upgrade-instruction validation.

## Project health checks

- Opening: this plan. Both slices A and B have specs; C waits.
- After A merges and after B merges: confirm `main` is green and the shared-file rebase (above) produced the specified arm order.
- Before C starts: confirm both specs' Definitions of done held on `main` (re-run the grep gates).
- Before close-out: the project Definition of done in `spec.md`.

## Retro triggers

- Any halt condition fired.
- The shared-file rebase needed more than the one function described above.
- A codec's PSL form did not fit the one rule in B3.
- Any spec gap recorded in a PR body.

## Close-out

After C merges and the final retro is recorded:

1. Move `editor-tooling-brief.md` to `docs/design/` (or hand it to Serhii's tracker and delete it, his choice).
2. Move `deferred.md` items 1 to 3 into a Linear issue each or into `docs/TechDebt`-equivalent for this repo; item 5 is already dated.
3. Confirm the three ADR amendments are in the ADR index.
4. Delete `projects/remove-dbgenerated/`.
