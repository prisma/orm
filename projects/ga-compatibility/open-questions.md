# GA readiness: open questions

Each question is worked on one at a time, from the top. When one is agreed, it is written into [spec.md](spec.md) and removed from this list.

Status is one of: **in discussion**, **waiting** (on research or on another question), **not started**.

## In discussion

Nothing. The remaining points on maturity levels are in section 6 of `maturity-levels.md` and belong to plan task 1.

## Not started

Nothing. The first pass over the remaining topics is recorded in the spec (sections 4.3, 5.4, 5.5, 6.4, 11, 12) and as tasks in the plan.

## Proposed by the author, not yet discussed

These are not in the spec. Their text is in [analysis.md](analysis.md).

- The contract's format version is also removed from the profile hash and the execution hash.
- Within a major, the rules for hashing stored content do not change, or stored content is hashed by the rules of the format version it was written in.
- A deprecation ships with a tool that moves code to the replacement.
- A change that cannot be translated mechanically counts against making it.
- The verification approach.

## Wording in the spec still to settle (found in review)

- Section 4.3 says the requirement to pin an exact version ends at `8.0.0`. It does not say whether that means users' pins only, or also the exact pins between our own packages.
