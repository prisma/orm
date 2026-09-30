# Manual QA — SQL namespace resolution

Be an app author emitting a Postgres contract, not a test runner. Compare the emitted relations with the schema you wrote and judge whether a typo produces one actionable diagnostic.

Spec: [SQL conversion](spec.md). PR: not opened. Out of scope: database execution, workspace tests, Mongo/LSP conversion, and the known deferred extension-block model-reference resolver.

## Table of contents

| # | Scenario | What it proves | Isolation | Covers |
| - | --- | --- | --- | --- |
| 1 | Emit same-named models in two namespaces | FKs and backrelations remain namespace-local | tmpdir | SC-2, SC-3 |
| 2 | Misspell a field type (negative control, judgement) | One readable binder diagnostic, no fallback duplicate | tmpdir | SC-4 |
| 3 | Explore qualification and constructor diagnostics | Correct distinction between bare types and extension calls | tmpdir | SC-4 |

## Pre-flight

Use Node >=24 and the rebuilt branch CLI after syncing main. Record `git rev-parse HEAD` and `git status --short`; existing project artifacts may be dirty, but production files must be clean. Gate exceptions remain documented separately; this is not a claim that workspace tests or fixtures are green.

Set `REPO` to the absolute checkout path and `PN_QA_TMP=$(mktemp -d /tmp/sql-conversion-qa.XXXXXX)`. Each scenario owns a separate subdirectory. The checkout is read-only during QA; no additional clone or agent is needed for this bounded run. Commands below use the contributor aliases for the real public facade (`@internal/postgres/config` = published `@prisma/orm-postgres/config`; `@prisma/cli-engine` = published `prisma/config`). Link each scratch `node_modules/@internal/postgres` to `$REPO/packages/3-extensions/postgres` and `node_modules/@prisma/cli-engine` to `$REPO/packages/1-framework/3-tooling/cli/node_modules/@prisma/cli-engine`.

Start every `contract.prisma` below with the required `// use prisma-8` directive on its own first line (including exploratory inputs). In every scenario write `prisma.config.ts`:

```ts
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig } from '@internal/postgres/config';
export default definePrismaConfig({ orm: defineConfig({ contract: './contract.prisma' }) });
```

Use this actual offline CLI command from the scenario directory:

```bash
PRISMA_TELEMETRY_DISABLED=1 node "$REPO/packages/1-framework/3-tooling/cli/dist/bin.mjs" contract emit --config ./prisma.config.ts --format human --no-color
```

Audience coverage: **app authors** exercise the CLI/config/schema flow below. **Extension authors** observe the uncomposed-extension diagnostic in scenario 3. N/A for authoring a new extension descriptor: this slice introduces no new descriptor SPI; parser node typing and shared pairing generics are compile-time/package-test coverage.

## Scenario 1 — Emit namespace-local relations

**What you're proving from the user's seat:** Identically named models can coexist without foreign keys silently pointing at another namespace or false backrelation ambiguity.

**Covers:** SC-2, SC-3. **Isolation:** `tmpdir`.

**Oracle:** The written namespace is the relation target; `public.Membership.user` references `public.public_users`, and the auth equivalent references `auth.auth_users`.

**Preconditions:** Pre-flight complete; no other scenario dependencies.

### Steps

1. In scenario-1, write `contract.prisma` with the following two blocks (the second is the same shape with its own mapped names):

```prisma
namespace public {
  model User {
    id Int @id
    memberships Membership[]
    @@map("public_users")
  }
  model Membership {
    id Int @id
    userId Int
    user User @relation(fields: [userId], references: [id])
    @@map("public_memberships")
  }
}
namespace auth {
  model User {
    id Int @id
    memberships Membership[]
    @@map("auth_users")
  }
  model Membership {
    id Int @id
    userId Int
    user User @relation(fields: [userId], references: [id])
    @@map("auth_memberships")
  }
}
```

2. Run the pre-flight CLI command. Read `contract.json`, especially `storage.namespaces.*.entries.table.*.foreignKeys` and `domain.namespaces.*.models.*.relations`.

### What you should see

Exit 0; emitted JSON and TypeScript declarations. Each FK and both domain relation directions stay in their own namespace. No ambiguity complaint.

### Failure modes

Cross-namespace target substitution, false ambiguity, missing backrelation, or unreadable emitted artifact.

### Restore

Retain output excerpts in the report, remove scenario-1, and check `git status --short` against the pre-flight baseline.

## Scenario 2 — Refuse a typo once

**What you're proving from the user's seat:** A typo is easy to locate without two competing diagnoses.

**Covers:** SC-4. **Isolation:** `tmpdir`.

**Oracle:** Existing binder code `PSL_UNRESOLVED_REFERENCE`, naming `Missing`, with a useful source location and no `PSL_UNSUPPORTED_FIELD_TYPE` duplicate.

**Preconditions:** Pre-flight complete; independent of scenario 1.

### Steps

1. Write scenario-2 `contract.prisma`:

```prisma
model Document {
  id Int @id
  payload Missing
}
```

2. Run the CLI command and inspect the human output and exit status.

### What you should see

A nonzero exit and one diagnostic naming the typo, its file and line. No output contract is emitted. This proves the single field-type failure boundary, not that every malformed relation produces only one diagnostic: independent referenced-field failures can legitimately cascade.

### Failure modes

Successful emission, duplicate fallback complaint, missing location, or misleading extension-composition advice.

### Restore

Capture output, remove scenario-2, and compare git status.

## Scenario 3 — Exploratory: qualification and extension calls

**Charter:** Explore bare `pgvector.Vector` versus `pgvector.Vector(1536)` with no extension composed; also try an explicitly qualified namespace relation. Judge whether the former names the missing type and the latter explains how to compose the extension, without duplicate voices.

**Covers:** SC-4 plus exploratory qualification coverage. **Isolation:** `tmpdir`. **Time budget:** 3 minutes; stop on completion or budget. **Preconditions:** pre-flight only.

Record the exact schemas and CLI output in the report. Do not probe the known extension-block resolver or broaden into Mongo/LSP. Remove the scratch directory after preserving evidence and compare git status.

## Scenarios deliberately not in this script

| Criterion | Why N/A |
| --- | --- |
| SC-1 | Deletion of private sets/helpers is source inspection, not a user journey. |
| Parser generic/node identity and Prisma7 source compatibility | Compile-time and focused package tests provide the appropriate evidence. |

## Sign-off coverage map

| Criterion | Scenarios |
| --- | --- |
| SC-1 | N/A — source audit |
| SC-2 | 1 |
| SC-3 | 1 |
| SC-4 | 2, 3 |
