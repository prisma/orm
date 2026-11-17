# ADR 323 — Prisma 8 is not a package manager and does not second-guess one

**Status:** Proposed
**Date:** 2026-11-18

---

`prisma orm init` installs packages by running the project's package manager. In a pnpm 12 project the install can end like this:

```text
✘ pnpm add @prisma/orm-postgres
 ERR_PNPM_IGNORED_BUILDS  Ignored build scripts: esbuild, msgpackr-extract, workerd
```

pnpm exits 1 because three dependencies have build scripts that nobody approved. The packages are on disk, so it is tempting for `init` to read the error text, decide the install really worked, and carry on. It does not. `init` stops with `CLI.INIT_INSTALL_FAILED`, and the user runs `pnpm approve-builds`.

## Decision

Never. Prisma 8 is not a package manager. It hands installs to the project's package manager and trusts it to do its job, safety checks included.

- When a package manager reports that it failed, Prisma 8 reports that failure. It does not match the package manager's error text to decide that the failure can be ignored.
- Prisma 8 does not work around a package manager's check. It passes no flag and writes no setting that switches a check off, and it does not answer a question the package manager puts to the user, such as which build scripts to approve.

Use instead: the package manager's own command. Prisma 8's error names the command that failed, so the user can run it and act on what the package manager says.

## Context

Will Madden, 2026-11-18: "We delegate to package managers at various times in a project's lifecycle. We have the guiding principle that we are not a package manager. We do not want to be. We rely on them for safety checks and behaviors like the one they introduced here. If pnpm says its installation failed, we don't second-guess it, and we don't work around it."

On the build-script case in particular: "how do we know that the package didn't actually depend on that build script?" Prisma 8 cannot know. A package whose script compiles a native module would be on disk and broken, and a check that accepts the failure for today's dependencies accepts it for whatever dependency is added next.

The decision rests on two statements the project already makes. The [vision](../../design/00-purpose/vision.md#values) says "Code must be explicit and unambiguous, never magical." The [project intent](../../design/00-purpose/project-intent.md) asks for "No hidden extra round-trips, fallbacks or guesses."

## Consequences

- **Prisma 8 fixes its own packages.** When a package Prisma 8 publishes trips a package manager's check, the fix is in that package. The published packages should carry no dependency that has an install script.
- **A defect in a package manager is fixed in the package manager.** Prisma 8 reports it there. Its docs, or the fix text of its own error, name the repair for affected versions. `init` does not change how it installs to avoid the defect.
- **`init` does not retry a failed install with another package manager.** A retry that is chosen by reading the first package manager's error text is the same second-guessing.

No revisit-if condition is recorded.

## Alternatives considered

- **Treat the unapproved build scripts as a warning when the packages resolve.** Resolving shows the files were linked. It does not show that a package works without its script.
- **Run the install with the check switched off, or write the approval into the workspace file.** Approving build scripts is the decision the check exists to give the project's owner.
