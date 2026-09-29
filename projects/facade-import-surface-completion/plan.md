# Project plan — facade-import-surface-completion

One slice, one PR, no parallelisation. The project's purpose decomposes cleanly into a single reviewable change because the work is composition + tree-shake-preserving subpath wiring — no behaviour change, no new framework surface.

## Slices

### `slices/facade-completion/`

**Spec:** [`slices/facade-completion/spec.md`](slices/facade-completion/spec.md)
**Plan:** [`slices/facade-completion/plan.md`](slices/facade-completion/plan.md)
**Linear issue:** [TML-2526](https://linear.app/prisma-company/issue/TML-2526/facades-must-re-export-everything-users-import-in-their-app)
**Dispatches:** 7 (D0 research; D1 postgres `/migration`; D2 mongo parity + control + barrel drop; D3 sqlite façade; D4 renderer + fixtures; D5 examples; D6 skills + final pass).
**Sequencing:** D0 → (D1 ∥ D2 ∥ D3) → D4 → D5 → D6.

Delivers every FR and NFR in the project spec.

## Direct changes

None — every change belongs to the single slice.

## Sequencing

```text
[D0 research] → [D1 postgres /migration]
              ↘ [D2 mongo /config + /control + drop barrel] → [D4 renderer + fixtures] → [D5 examples] → [D6 skills + final pass] → PR
              ↘ [D3 sqlite façade] ───────────────────────────────────────────────────────────────────────────────────────────────↗
```

## Close-out (required)

- [ ] Verify all PDoD items in [`spec.md`](spec.md) § Project Definition of Done.
- [ ] Run mandatory final retro; record under `retros.md`; land lessons in canonical surface (`drive/calibration/**` or agent-skill cluster).
- [ ] Migrate long-lived docs into `docs/`. Candidates: any ADR-worthy decisions about façade-as-contract or tree-shake-by-default that surface during implementation (likely an §"Façade contract" addition to [ADR 211](../../docs/architecture%20docs/adrs/ADR%20211%20-%20prisma-next%20bin-only%20distribution.md) or [ADR 207](../../docs/architecture%20docs/adrs/ADR%20207%20-%20A%20serverless%20Postgres%20connection%20has%20the%20same%20query%20interface%20as%20a%20postgres%20client.md), or a new ADR if the principle is durable enough).
- [ ] Strip repo-wide references to `projects/facade-import-surface-completion/**`.
- [ ] Delete `projects/facade-import-surface-completion/`.
- [ ] TML-2526 reaches its terminal state via the GitHub integration on PR merge.
