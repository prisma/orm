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

## Gaps in the policy, found while recording it on `main`

Found on 2026-11-24 by the reviews of prisma/orm#31194, which records the policy as decision records. None is decided. Each names the project it most affects.

1. **Nothing is specified until the reference documentation exists.** The policy says behaviour is specified when the reference documentation states it, and no package ships one. Either the reference is needed for `8.0.0`, or something else specifies an API until it exists. Affects project 8, which is placed Later.
2. **Narrowing the policy.** Nothing says that a later change that weakens the policy takes effect only at the next major version.
3. **Deprecating a GA API in favour of one below GA.** The policy allows a GA API to be replaced by a `preview_` one. Kubernetes forbids the equivalent.
4. **"Critical" is undefined** in "critical and security fixes" for the previous major version.
5. **Supported versions.** "Adds support when its maker releases" reads as the same day. "Fix any TypeScript break in a patch" can clash with the rule against type changes that break a user's code. TypeScript never ends support for a version, so the event that ends ours must be defined. Affects project 11.
6. **Bun and Deno.** The policy covers "the other runtimes", and `docs/Supported Versions.md` says best effort.
7. **A change to Prisma's own tables that is not additive** needs a command the user runs, and that is not among the listed exceptions to "no changes". Affects project 7.
8. **Driver types.** One decision record re-exports the database driver's types and says that works with one major version of the driver only. If `8.0.0` exports them, how they are exposed must be decided before `8.0.0`. Affects project 3.

## More gaps, found by a reader with no context

Found on 2026-11-24 by a review of a summary of the policy written for the team. None is decided. Where a design agreed since then answers one in part, that is noted.

9. **"A tool makes any change an upgrade needs" cannot hold for the listed exceptions.** No tool can fix code that relied on a bug, or on unspecified detail such as row order. And the release candidates ship written upgrade instructions, which the same section says do not count. Affects project 10.
10. **Two rules about input disagree.** "A source one release accepts, every later release accepts" and "a release may reject input that an earlier release accepted" cannot both hold if the contract source counts as input.
11. **A later release that emits a different `contract.json` for the same contract source.** The policy says a new storage hash is then acceptable, but the marker no longer matches after the user emits. The design for project 2 covers the case where only the format or the hashing rules would differ. It does not cover a release that derives different storage content from the same source.
12. **A deploy in progress, and going back to the earlier release.** "An earlier release may fail on what a later one wrote" together with "the ORM brings its own tables up to date" could make earlier instances fail while a deploy is in progress. The design for project 7 answers this for Prisma's own tables: within a major version their migrations only add. Going back to an earlier release after a later one has run is not addressed.
13. **A Preview option or argument on a GA method.** The points not yet decided in `maturity-levels.md` cover flags, config options, attributes and error codes, and not arguments or fields. Affects project 6.
14. **Changes to inferred types.** How "code that compiles keeps compiling" is checked for a change that no exported declaration shows. Project 4's design is taking this up with generated type tests.
15. **Work for the next major version.** Where it lives, given one release line.

