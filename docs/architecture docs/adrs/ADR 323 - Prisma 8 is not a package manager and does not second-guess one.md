# ADR 323 — Prisma 8 is not a package manager and does not second-guess one

**Status:** Accepted
**Date:** 2026-11-18

---

`prisma orm init` sets up a project. One of its steps installs packages, and it does that by running the project's own package manager. Here the package manager is pnpm, and the install fails:

```text
$ prisma orm init

✘ pnpm add @prisma/orm-postgres
ERR_PNPM_IGNORED_BUILDS  Ignored build scripts: some-native-module
help: Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.

✘ [CLI.INIT_INSTALL_FAILED] Failed to install dependencies
  why: pnpm exited with code 1.
```

`init` stops there. It shows what pnpm said and says that the install failed. Its next action, "Run the install yourself", carries the command, so the user can run it and act on pnpm's answer.

## Decision

Prisma 8 is not a package manager. It hands every install to the project's package manager and trusts it to do its job, including the safety checks it applies. When the package manager says an install failed, the install failed.

| When the package manager reports a failure | Prisma 8 |
| --- | --- |
| Shows the package manager's output and reports the step as failed | does this |
| Names the command that failed, so the user can run it | does this |
| Reads the error text to decide that the failure does not matter, and carries on | never |
| Runs the install again with a flag or a setting that switches the failing check off | never |
| Answers the question the package manager put to the user, such as which build scripts to approve | never |
| Runs the install again with a different package manager | never |

Use instead: the package manager's own command. In the example, the user runs `pnpm approve-builds`, then runs `prisma orm init` again.

## Why the failure in the example is real

The example looks like a failure that could be ignored, which is why it is the example.

Some packages run a script when they are installed, to compile a native module or to download a binary. A script like that runs arbitrary code on the user's machine, so pnpm refuses to run one until the project's owner has approved it. When it skips a script, pnpm still puts the package's files on disk, and then exits with an error so that the skipped script is not missed.

The files are there, so `init` could check that the package it asked for can be found, treat the install as done, and continue. That check proves less than it seems to:

- **It shows that the files were linked. It does not show that the package works.** A package whose script compiles its native module is on disk and broken.
- **Prisma 8 cannot tell the two cases apart.** Whether a package needs its script is a fact about that package. A rule that accepts the failure for the dependencies of today accepts it for whichever dependency is added next.
- **The check exists to put a decision in front of the project's owner.** If `init` continues, approves the script, or switches the check off, the owner never makes that decision.

The same reasoning holds for any failure a package manager reports. Prisma 8 would have to know why the package manager failed, and whether that reason matters for this project, better than the package manager does. It does not, and it should not try to.

## Where the decision comes from

Will Madden, 2026-11-18: "We delegate to package managers at various times in a project's lifecycle. We have the guiding principle that we are not a package manager. We do not want to be." And: "If pnpm says its installation failed, we don't second-guess it, and we don't work around it."

Two statements the project already makes point the same way. The [vision](../../design/00-purpose/vision.md#values) says "Code must be explicit and unambiguous, never magical." The [project intent](../../design/00-purpose/project-intent.md) asks for "No hidden extra round-trips, fallbacks or guesses."

## Consequences

- **Prisma 8 fixes its own packages.** When installing a package that Prisma 8 publishes trips a package manager's check, the fix is in that package. For the example, that means the published packages carry no dependency that has an install script.
- **A defect in a package manager is fixed in the package manager.** Suppose a version of a package manager links a package to a folder it never creates. Prisma 8 reports that to the package manager's maintainers. Its docs, or the fix text of its own error, tell users of the affected versions how to repair the project. `init` does not change how it installs to avoid the defect.
- **Detecting which package manager a project uses is not second-guessing.** Prisma 8 still works out which package manager to run, and a user can still name one. What it does not do is change that choice after a failure.

No revisit-if condition is recorded.

## Alternatives considered

- **Treat skipped build scripts as a warning when the installed package can be found.** This is the check described above. It cannot tell a package that works without its script from one that does not.
- **Run the install with the build-script check switched off, or write the approval into the project's workspace file.** Both take away the decision the check gives the project's owner.
- **Retry a failed install with another package manager.** A different package manager resolves the dependency tree its own way and writes its own lockfile, so the project ends up installed by a tool it does not use. Choosing to retry also means reading the first package manager's error text to decide what went wrong.
