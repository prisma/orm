# Brief: filtered-many-writes D6 — documentation and upgrade declaration

## Task

Document the nested operations this slice added, and declare that they require no upgrade steps.

## Scope

**In:**
- `packages/3-extensions/sql-orm-client/README.md`: the nested-write section gains `r.where(w).updateAll(data)`, `r.where(w).deleteAll()`, both without `where`, and the array return from a relation callback.
- The user-facing docs that describe nested writes today. Find them by searching `docs/` and the CLI's quick-reference templates for `connect(` / `disconnect(`; update each place that lists the nested operations. If no user-facing doc lists them, say so in the report and add nothing new outside the README.
- One `upgrade-instructions/pending/<name>/` entry in the form the existing entries use, declaring no required changes (`changes: []`). The feature is additive; write no upgrade instruction text.

**What the docs must say:**
- These operations change or delete only rows related to the record being updated. State what "related" means for one-to-many (the child's foreign key) and many-to-many (a junction row).
- Unlike the collection's `updateAll` / `deleteAll`, the nested forms do not require `where`; without it they apply to every related row.
- They are available on to-many relations, inside `update()` only.
- `updateAll` data cannot set the column that links the child to the parent.
- Many-to-many `deleteAll` deletes the related rows and issues nothing on the junction table; what happens to junction rows is decided by the schema's foreign-key action.
- Operations returned in an array run in array order.

**Out:**
- Implementation details: no function names from `mutation-executor.ts`, no statement shapes, no description of how filters are resolved.
- Any path under `projects/` in a long-lived file.
- Source or test changes.
- Docs for `upsert` or the conflict options on `create`; other slices.

## Completed when

- [ ] README and every existing user-facing listing of nested operations describe the new operations with the six points above.
- [ ] The pending upgrade entry exists with `changes: []`.
- [ ] `pnpm check:upgrade-coverage --mode pr --prev $(git merge-base HEAD origin/main) --head HEAD` passes.
- [ ] `rg -n "projects/" <each file you changed>` returns nothing.
- [ ] `pnpm --filter @internal/sql-orm-client lint` passes, and the repo's markdown or docs lint if one covers the files you changed.

## Standing instruction

Stay focused on the goal; control scope. Docs describe behaviour a user can observe.

## Operational metadata

- **Time-box:** 45 minutes.
- **Halt conditions:** the upgrade-coverage check asks for instruction text you would have to invent.
