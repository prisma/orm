# Journey 06b — Feedback skill: feature request via capability-gap route

**Skills under test:** `prisma-orm-core-concepts` (contract, feedback).

**Acceptance criterion:** AC8c (feature request path) from `specs/usage-skill.spec.md`.

## Setup

A `prisma orm init`-scaffolded project.

## Prompt sequence

First prompt (originates the route):

> add a validation: email must contain '@'

Expected: `prisma-orm-core-concepts` (contract) fires, names the validations capability gap, names the arktype / zod workaround, and routes the user to `prisma-orm-core-concepts` (feedback) for the feature request.

Second prompt (after the user says yes to the route):

> yes, file the feature request

## Expected agent behaviour

- [ ] On the first prompt, `prisma-orm-core-concepts` (contract) activates and does not confabulate a `@validates` PSL attribute.
- [ ] On the routing offer, the agent surfaces the *What PN doesn't do yet* entry plus the offer to file via `prisma-orm-core-concepts` (feedback).
- [ ] On the second prompt, `prisma-orm-core-concepts` (feedback) fires.
- [ ] Agent classifies as **feature request** (not a bug).
- [ ] Agent produces the body using the feature-request fields from `.github/ISSUE_TEMPLATE/feature_request.yml`: *What problem are you trying to solve?* / *Proposed solution* / *Alternatives considered* / *Scope and impact*.
- [ ] *Alternatives considered* references back to `prisma-orm-core-concepts` (contract)'s *What PN doesn't do yet* entry on validations (arktype / zod workaround).
- [ ] Title in `feat(area): summary` form, e.g. `feat(contract): first-class field-level validations in PSL`.
- [ ] User is prompted for confirmation before submission.
- [ ] On user confirmation, submitted via `gh issue create` or via the prefilled new-issue URL.

## Success criteria

- [ ] No fabricated `@validates` API in any prose or code the agent produces.
- [ ] Body's *Alternatives considered* references arktype / zod (matching the source skill's gap entry).
- [ ] Body's *What problem are you trying to solve?* references the source skill (`prisma-orm-core-concepts` (contract)).
- [ ] User confirmation step happened before submission.
