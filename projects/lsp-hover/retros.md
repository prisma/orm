# lsp-hover — retros

## 2026-10-06 — Final retro: four mid-flight design changes, all on how the binder matches and what it records

**Trigger:** mandatory final retro at project close (invariant I10).

**What happened:**
- **Delivery.** Both slices shipped (#30569 merged, #30591 open). The persistent implementer and reviewer worked through 15 dispatch rounds, and the reviewer's 9 findings were all resolved.
- **Mid-flight design changes.** There were four:
  1. **Doc comments:** the `///` reader moved from the language server onto the AST (`docComment()`, `HasDocComment`).
  2. **Declaration names:** the binder records declarations on their name nodes, so hover needs no special case.
  3. **Fixed identifiers:** a mismatched fixed identifier fails to match. This replaced an exact-match shortcut the orchestrator had decided on alone.
  4. **Scalar leaves:** they match by syntactic shape, after manual QA found `@default(autoincrement())` gave no hover.
- **Other changes.** The operator removed `ParameterSymbol.owner`, which nothing read. In the final QA round, the reviewer found that the QA script's N/A and coverage claims were wrong.

**Root cause:**
- **Binder matching.** The slice spec stated "only the matching alternative's records survive" without checking how the binder decides a match. Since #30381, every leaf rule counted as matched whatever was written, which no project artefact recorded. Unit tests used hand-built specs that never arranged leaves in production order, so neither tests nor review could fail (F39).
- **The shortcut.** The orchestrator answered the implementer's halt by deciding a design question alone, reading "decide routine defaults yourself" as covering design.
- **`///` placement.** It came from reading a limit on callers ("only the language server reads it") as a decision about where the code lives.
- **`owner`.** It came from a spec that added a field with no named reader.
- **The QA coverage gaps.** They came from N/A reasons written without a search, and a coverage table copied instead of derived (F40).

**Landing surface(s):**

- Project-context: `drive/calibration/failure-modes.md` § F39, test spec consumers with production specs; § F40, QA N/A and coverage claims need cited evidence.
- Project-context: `drive/retro/README.md` § Recurring-pattern catalogue, the 2026-10-06 lsp-hover entry.
- ADR: binder matching in `oneOf`, decided at close-out (see `design-decisions.md` §§ 4–5 and the close-out PR).
