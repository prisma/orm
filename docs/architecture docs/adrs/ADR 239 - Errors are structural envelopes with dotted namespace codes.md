# ADR 239 — Errors are structural envelopes with dotted namespace codes

Status: **Accepted**. Amended 2026-08-11: completed-with-findings settlement (`Diagnostic` values in completed envelopes with documented exit codes) and typed `nextActions` remediation.

Supersedes: [ADR 027 — Error Envelope & Stable Codes](ADR%20027%20-%20Error%20Envelope%20Stable%20Codes.md), [ADR 068 — Error mapping to RuntimeError](ADR%20068%20-%20Error%20mapping%20to%20RuntimeError.md).

Related: [Error Handling: Failures, Operational Errors, and Bugs](../../Error%20Handling.md).

## A failure, a finding, and a bug

Three snippets carry most of this ADR. First, the shared shapes:

```ts
// foundation: the shared, code-agnostic surface
export interface StructuredError extends Error {
  readonly code: `${string}.${string}`; // NAMESPACE.SUBCODE
  readonly why?: string;
  readonly fix?: string; // retired prose — set alongside nextActions until the last raise site converts
  readonly nextActions?: readonly NextAction[]; // optional on the raise side; the serialized envelope always carries it
  readonly where?: { readonly path?: string; readonly line?: number };
  readonly severity?: 'error' | 'warn' | 'info';
  readonly meta?: Record<string, unknown>;
  readonly cause?: unknown;
  readonly docsUrl?: string;
}

export interface NextAction {
  readonly kind: 'run-command' | 'open-url' | 'user-choice' | 'edit-file' | 'done';
  readonly label: string;
  readonly command?: string;
  readonly commands?: readonly string[];
  readonly url?: string; // open-url only — a URL is not a command; putting one in `command` tells a consumer to execute it
  readonly reason?: string;
}

// a finding: the same fields as pure data — no Error prototype, no stack, never thrown
export interface Diagnostic {
  readonly code: `${string}.${string}`;
  readonly severity: 'error' | 'warn' | 'info';
  readonly summary: string;
  readonly why?: string;
  readonly nextActions: readonly NextAction[]; // a serialized shape — required, `[]` when there is nothing to suggest
  readonly where?: { readonly path?: string; readonly line?: number };
  readonly meta?: Record<string, unknown>;
  readonly docsUrl?: string;
}

export function isStructuredError(e: unknown): e is StructuredError {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as { code?: unknown }).code === 'string' &&
    /^[A-Z][A-Z0-9]*\.[A-Z][A-Z0-9_]*$/.test((e as { code: string }).code) &&
    typeof (e as { message?: unknown }).message === 'string'
  );
}
```

A **failure** is raised where it is detected, by a factory owned by the namespace's module, and the same value works thrown or as a `Result` failure:

```ts
// the migration system owns the MIGRATION namespace: it declares its codes
export type MigrationCode = `MIGRATION.${MigrationSubcode}`;
type MigrationSubcode = 'FILE_MISSING' | 'HASH_MISMATCH' | 'DESTRUCTIVE_CHANGES' /* … */;

export function errorMigrationFileMissing(dir: string): StructuredError {
  return structuredError('MIGRATION.FILE_MISSING', 'Migration file not found', {
    why: `No migration.ts under "${dir}".`,
    nextActions: [
      { kind: 'run-command', label: 'Create the migration', command: '{bin} migration new' },
      { kind: 'edit-file', label: 'Point the config at the right migrations directory', reason: `"${dir}" does not exist.` },
    ],
    meta: { dir },
  });
}

throw errorMigrationFileMissing(dir);         // internal fast-abort
return notOk(errorMigrationFileMissing(dir)); // boundary Result failure — same value, no conversion
```

A **finding** is neither thrown nor a failure. A command that ran to its end and found problems returns them as data, with the exit code it documents:

```ts
// `migration check` ran to its end; the integrity violations it found are its result
return {
  exitCode: INTEGRITY_FAILED, // 4, documented by this command
  diagnostics: danglingRefs.map((ref) => ({
    code: 'MIGRATION.CHECK_DANGLING_REF',
    severity: 'error',
    summary: `Ref "${ref.name}" points at a hash no migration produces`,
    where: { path: ref.path },
    nextActions: [
      { kind: 'run-command', label: 'Repoint the ref', command: `{bin} ref set ${ref.name} <valid-hash>` },
      { kind: 'run-command', label: 'Or delete it', command: `{bin} ref delete ${ref.name}` },
    ],
  })),
};
```

A **bug** takes a third path, and it is not this scheme:

```ts
import { InternalError, assertNever } from '@internal/utils/internal-error';

switch (node.kind) {
  case 'a': return handleA(node);
  case 'b': return handleB(node);
  default:  return assertNever(node); // throws InternalError; also a compile-time exhaustiveness check
}
```

## Decision

Every user-facing error in Prisma Next is a **structural envelope** identified by a dotted `NAMESPACE.SUBCODE` code. It is recognized by a **structural type predicate** — a field-shape check, never `instanceof` and never a shared prototype — so the same value is recognizable when thrown, when carried as a `Result` failure, and after it has crossed a network boundary or been imported through two copies of the library in a monorepo.

The shared surface is a **convenience, not an enforcement mechanism**. Foundation provides one interface (`StructuredError`), one predicate (`isStructuredError`), one factory (`structuredError`), and one docs-URL helper. It standardizes structure and behavior; it does **not** enumerate the codes. Each namespace's codes are declared as a typed union in the single module that owns that namespace, and that module's factories brand their envelopes. A code the owning module hasn't declared is a compile error *there*; nothing polices codes globally at runtime, deliberately.

A command settles one of two ways. It **completes** — it ran to its end and has a result to report, and that result may be good news or bad news — or it **errors**, meaning it could not do its job at all. A command that completes reports what it found as `Diagnostic` values inside a completed envelope, each carrying the same dotted code an error would carry, alongside a documented per-command exit code. A command that errors produces a `StructuredError` on the error path. The test is one question: *was finding these problems the job?* If yes, they are diagnostics on a completed result. If no — the command could not reach a documented outcome — it is an error. `migration check` reporting eleven integrity violations completed successfully at its job; it did not fail.

A `Diagnostic` is a recorded finding: pure data, never thrown, no stack. It carries the error envelope's fields with three deliberate differences: `summary` plays the role the error's `message` plays (required on both, one spelling per shape); `cause` is absent because a diagnostic is wire-safe data — the serialized error envelope drops `cause` at the boundary for the same reason; and `severity` is required where the error's is optional, because an error has a default (`'error'`) and data carries no defaults — a diagnostic spells its severity out. A consumer therefore reads one shape on both settlement paths.

Bugs are outside the scheme entirely. An invariant break throws an `InternalError`, which is never meant to be caught except at the outermost boundary for crash reporting. The distinction is the one drawn in [Error Handling.md](../../Error%20Handling.md): **failures and operational errors are structured envelopes; findings are diagnostics; bugs are `InternalError`.**

Numeric `PN-DOMAIN-NNNN` codes are retired. A published-code crosswalk (below) maps every one to its dotted name. **Error codes freeze at RC**; the crosswalk is the compatibility contract for the rename.

## Why one scheme, and why structural

This ADR collapsed five parallel error systems — a numeric `PN-DOMAIN-NNNN` class, two dotted envelope families, a migration-tools error class, and a bare-word enum carried on `Result` failures — that disagreed on spelling, on carrier (thrown vs `Result` value), and on whether a code existed at all. Even the two superseded ADRs disagreed on the format (`NAMESPACE.SUBCODE` vs `E.NAMESPACE.SUBCODE`). A consumer could not match errors by code because there was no one code space to match against. The split between "CLI presentation error" and "runtime error" was historical, not principled: the systems carried nearly identical fields. One envelope shape means one code space for the crosswalk, the docs tooling, and consumer matching.

**Structural, not nominal**, because a Prisma Next error must be recognized in places a prototype cannot survive:

- across the **control plane / execution plane** split, which do not share a runtime;
- across a **network boundary**, where an envelope is serialized to JSON and rehydrated with no prototype at all;
- in a **monorepo with duplicate library copies**, where `instanceof` against one copy's class fails for the other copy's instance.

## The scheme

**Format.** `NAMESPACE.SUBCODE`. `NAMESPACE` is one of the closed list below. `SUBCODE` is `UPPER_SNAKE_CASE`, noun-first (`MARKER_MISSING`, `HASH_MISMATCH`, `RUNNER_FAILED`) so codes group by subject. A quoted exact-match search for a code finds every occurrence.

**Namespaces are meaning-based and closed.** The list is governed by this ADR; each namespace has exactly one owning module that declares its code union. Ownership and meaning coincide: an error detected by the CLI but *about* the contract↔DB relationship is `CONTRACT`, not `CLI`; a runner apply failure surfaced through the CLI is `MIGRATION`, not `CLI`.

| Namespace | Meaning | Owning module |
|---|---|---|
| `CONFIG` | Config file load + validation, missing required config | `1-core/config` |
| `CLI` | Invocation: flag parsing, output format, `init`, command usage | `1-core/errors` + `cli`; shared with `@prisma/cli-engine` since the S5 cutover — the engine mints its own `CLI.*` codes (`CLI.UNKNOWN_COMMAND`, `CLI.INVALID_ARGUMENTS`, `CLI.PROMPT_CANCELLED`, `CLI.INTERNAL_ERROR`, …) while this repo keeps `CLI.INIT_*` and the other ORM-tooling codes |
| `CONTRACT` | Contract authoring (TS builders), emit, validation, marker/sign/verify | `0-foundation/contract` + `1-core/errors` + sql runtime |
| `PSL` | PSL parse / format / interpret | `psl-parser` + `contract-psl` |
| `PLAN` | Query planning | `relational-core` + `1-core/errors` |
| `RUNTIME` | Query execution: codecs, transactions, prepare, streams, middleware wiring | `framework-components` + sql runtime |
| `ORM` | ORM client API misuse | `sql-orm-client` + mongo orm |
| `DRIVER` | Driver / adapter transport + error normalization | drivers + adapters |
| `BUDGET` | Budget middleware | sql runtime middleware |
| `LINT` | Lint middleware | sql runtime middleware |
| `MIGRATION` | Migration authoring, tooling, planning, runner apply | `3-tooling/migration` + sql family/targets |

**Extensions.** In-repo extensions are ordinary namespaces named by the extension, uppercased: `SUPABASE`, `POSTGIS`, `PGVECTOR`, `PARADEDB`, … Core namespaces are reserved. Third-party extensions get a documented convention only — namespace = extension name uppercased — and the public code type is widened to the template-literal shape `` `${Uppercase<string>}.${string}` ``. Nothing polices third-party codes at runtime; they are outside the stability promise.

**Targets and adapters.** Target and adapter packages do not get namespaces of their own — there is no `SQLITE.*`, `POSTGRES.*`, or `ADAPTER.*`. A target-specific failure is still a failure of a core concern, and it uses that concern's namespace: rendering or executing a query uses `RUNTIME` (with `meta.target`/`meta.feature` identifying the target-specific condition), transport uses `DRIVER`, migration apply uses `MIGRATION`. The target name is data, not taxonomy. This keeps the namespace an answer to "what went wrong" rather than "which package said so", and keeps codes stable if a check moves between a target pack and shared code.

## The foundation surface

One module owns the shared shape. It exports:

- `StructuredError` — the interface above. `code` is the one required field beyond `Error`; `why` / `fix` / `nextActions` / `where` / `severity` / `meta` / `cause` / `docsUrl` are optional. `nextActions` is optional here and required on the serialized shapes — see [Which surface guarantees `nextActions`](#which-surface-guarantees-nextactions).
- `NextAction` and `Diagnostic` — the two shapes above.
- `isStructuredError(e): e is StructuredError` — structural predicate. It checks the identifying fields only (the code shape and a message); it is identification, not schema validation, so it deliberately does not probe `nextActions` or the optional fields. Completeness is the serializing side's job: a boundary that emits or rehydrates an envelope normalizes a missing `nextActions` to `[]` before handing the value to typed consumers.
- `structuredError(code, message, options?)` — the convenience factory. Brands a plain `Error` with the fields (via `Object.assign` + a non-enumerable `name`), returning `Error & StructuredError`. Usable as a throw target or a `Result` failure value.
- `docsUrlFor(code)` — returns `` `${DOCS_BASE}#${code}` ``, where `DOCS_BASE` is `https://docs.prisma.io/docs/orm/v8/reference/error-reference` — one errors page, the dotted code as the fragment (e.g. `…/error-reference#CONTRACT.MARKER_MISSING`). The version segment is a single token (`v8`, flipped from `next` when the RC shipped); a factory may override `docsUrl` for a code with its own page. Centralizing the URL made that flip a one-line edit. `scripts/list-error-codes.mjs` enumerates every published code from source and has a `--verify <page>` mode the docs site uses to prove the reference page lists all of them.

`severity` defaults to `error`. `cause` carries the provenance chain — a driver's `sqlState`, the wrapped original error — and is what the driver-error mapping populates. Redaction is a policy, not a field: `meta` must be redaction-safe and secrets are excluded.

## Remediation is typed, not prose

Remediation is a `nextActions` array, not a freeform sentence.

The reason is the audience. A remediation string like ``'Update the ref with `prisma-next ref set <name> <valid-hash>` or delete it.'`` is two actions, a command, and an argument placeholder, all fused into one sentence that only a human can take apart. An agent has to parse English to find out that there is a command to run and what it is. A `NextAction` states it directly: a `kind` the caller can branch on, a `label` for display, and a `command` (or `commands`) that is executable as written. Human presentation loses nothing: the CLI renders each action as a `→` line under the error, label then command.

The `kind` values are `run-command` (there is a command to run — `command` for a single command, `commands` for an ordered sequence run first to last; the two are alternatives, never both), `open-url` (the user should visit `url` — a URL is not a command, and putting one in `command` would tell a consumer to execute it), `user-choice` (the user must decide between the listed options), `edit-file` (a file needs a human edit), and `done` (nothing further is required — used to close out a multi-step flow). The shape is deliberately flat rather than a per-kind discriminated union: it mirrors the CLI engine's wire protocol type, and a consumer branches on `kind` and reads the fields that kind documents. A `command` may contain an angle-bracket placeholder (`<valid-hash>`) when only the user can supply the value; everything outside angle brackets is literal and runnable.

A `command` never names a binary. The error factories live in libraries that do not know — and must not decide — which executable the user invoked; the same `MIGRATION.UNKNOWN_REF` is raised under `prisma-next` in this repo and under a differently-named binary wherever else the libraries are embedded. So a command is written with a `{bin}` placeholder — `{bin} ref set <name> <hash>` — and the surface that renders or serializes the envelope substitutes the running binary's name. The two placeholder styles say different things: angle brackets mark a value only the user can supply and are left in place, while `{bin}` is always resolved before a consumer sees the action. After substitution every emitted `command` is runnable as written.

`Diagnostic` carries the same field for the same reason, and the two shapes stay aligned field-for-field (the exact mapping is in the Decision section). That alignment is the point: a consumer that can read a finding can read an error.

### Which surface guarantees `nextActions`

Two surfaces make different promises about the field, and conflating them produces a claim that is false of one of them.

**The serialized envelope requires it.** `Diagnostic`, the completed and errored JSON envelopes, and the CLI engine's wire protocol all declare `nextActions` as a required array that is `[]` when there is nothing to suggest. A consumer reading a serialized envelope never has to distinguish "no remediation" from "field absent", and a boundary that emits or rehydrates an envelope normalizes a missing field to `[]`. In this repo that boundary is `CliStructuredError.toEnvelope()`, so every surface that serializes an envelope — `--json` error output included — inherits the guarantee rather than re-implementing it.

**The raise side converges on it.** `StructuredError` — the value a factory constructs and a call site throws — declares `nextActions` optional, because the conversion is ratcheted rather than atomic (see [Adoption and freeze scope](#adoption-and-freeze-scope)). A factory that has not been converted yet still carries only `fix` prose, and forcing it to spell an empty array would record a false claim: that the site was reviewed and found to have no remediation, when in fact it has remediation that is still prose. The field becomes required on the raise side when the last site converts and `fix` is deleted from the type.

## The severity scale

`severity` is three-valued, `'error' | 'warn' | 'info'`, on both `StructuredError` and `Diagnostic`, and the two scales are the same scale on purpose — trimming one without the other would break the field-for-field identity.

`'info'` is not decorative; it has producers. `CLI.INIT_USER_ABORTED` — raised when a user cancels an `init` prompt — ships with `severity: 'info'`, and that is the right value: nothing went wrong, the user changed their mind, and rendering it in red would misreport it. The migration-status diagnostics publish `'warn' | 'info'` in their machine-readable JSON schema, so consumers already match on `'info'`.

## User-facing versus internal

[Error Handling.md](../../Error%20Handling.md) draws the line this ADR mechanizes:

- **Failure** (expected: bad input, builder misuse, capability gating, policy block) → `StructuredError`.
- **Operational error** (expected external fault: connection refused, driver error) → `StructuredError`, populated from the driver via `cause`.
- **Finding** (the command's own output: an integrity violation, schema drift, a lint hit) → `Diagnostic` on a completed result. Not thrown, not converted to a failure at any boundary.
- **Bug** (invariant break, impossible branch, post-validation type break) → `InternalError`.

`InternalError extends Error` lives in foundation with a doc comment stating the contract: *never catch this except at the outermost boundary; it is a bug in Prisma Next, not a user error.* It carries a structural marker (`isInternalError(e)` predicate) so the CLI top-level handler recognizes it — again structurally, not by `instanceof` — and prints "internal error, please report" with the stack, distinct from both a structured envelope and a bare uncaught throw.

`invariant()` and `assertDefined()` throw `InternalError`, and `assertNever(value: never): never` throws `InternalError` while doubling as a compile-time exhaustiveness check.

## Exit codes

Exit codes follow the reserved table in [CLI Style Guide § Exit Codes](../../CLI%20Style%20Guide.md#exit-codes). They key off how the command *settled* — completed or errored — and, within "completed", off what the command documents:

| Code | Settlement | Meaning |
|---|---|---|
| `0` | completed | The command ran to its end and found nothing to report. |
| `1` | errored | `InternalError` or an uncaught throw — a bug in Prisma Next. Nothing else ever exits `1`. |
| `2` | errored | An expected `StructuredError`: the command could not do its job. Usage, config, missing prerequisite. |
| `3` | errored | The user declined an interactive prompt (`USER_ABORTED`). |
| `4`–`99` | completed | A documented per-command outcome. The command ran to its end and its findings are diagnostics in the completed envelope. |
| `130`, `143` | — | Delivered signals: SIGINT and SIGTERM (POSIX `128 + N`). |

Two rules make the table unambiguous.

**Findings never exit `2`.** `2` means the command could not do its job. `migration check` finding integrity violations did its job; it exits its documented `4` (`INTEGRITY_FAILED`) and carries the violations as diagnostics. It exits `2` only when it could not run the check at all — an unresolvable migration reference, an unknown `--space`. `db verify` follows the same split: drift found is a documented completed code, an unreachable database is an error.

**A severity-`error` diagnostic requires a non-zero exit code.** A command that completed while recording something it calls an error must say so in its exit code; otherwise a shell pipeline would read success. The converse does not hold — a documented non-zero code may accompany warnings only.

Each command declares its `4`–`99` codes inline, in the `exitCodes` map on its own definition, and spells out what each one means at the end of its `--help` description. The declaration and the description are separate jobs: the declaration is what makes a non-zero completed exit code legal at all — a command that settles with a number it never declared is a construction error — while the description is what a user reads, because nothing renders the map itself. The same number may mean different things in different commands; the dotted code on each diagnostic disambiguates within the class.

**The envelope a settlement produces.** In JSON output both settlement paths share one envelope contract, discriminated by `ok`:

```ts
type CompletedEnvelope = {
  ok: true;
  result: unknown;                        // the command's own payload
  exitCode: number;                       // 0 or a documented 4–99 code
  diagnostics: readonly Diagnostic[];
  nextActions: readonly NextAction[];
};
type ErroredEnvelope = {
  ok: false;
  error: Diagnostic;                      // the serialized StructuredError
  diagnostics: readonly Diagnostic[];
  nextActions: readonly NextAction[];     // copied from the primary error
};
```

`nextActions` at the top level lets a consumer read remediation uniformly without knowing which path settled. A command whose JSON output predates this contract converges on it as it converts: a bespoke findings collection (for example a `failures` array) becomes `diagnostics`, a bespoke top-level summary moves into `result`, and the exit code appears on the envelope instead of living only in the process status.

## Banning bare throws

A `throw new Error(...)` is neither a structured failure nor a labeled bug — it is an unrecognizable string. A Biome GritQL plugin `no-bare-throw.grit` flags `throw new Error(` at severity `info`, and a CI ratchet (`scripts/lint-throws.mjs`, modeled on the cast ratchet) counts the diagnostics at HEAD versus the merge base and fails if the count rises. The count only falls; each sweep converts a cluster to `StructuredError` (user-facing) or `InternalError` (bug) and ratchets down.

Scope of the ban:

- **Banned:** `throw new Error(`. Test files are excluded (as the cast plugin excludes them).
- **Not banned:** `throw new TypeError` / `throw new RangeError` — legitimate JS semantics for genuine type/range violations, codified into `StructuredError` later if a code is warranted, not forced by the ratchet.

## Adoption and freeze scope

The **taxonomy** — the namespace list, the naming conventions, and the crosswalk of every published code — froze at RC, validated against the entire throw surface so there are no namespace gaps. What grows afterwards is the **sweep**: codeless user-facing throws are converted plane by plane under the fixed conventions. Adding a code to a previously-codeless site is additive and non-breaking; only renames of already-published codes break consumers, and those are all recorded in the crosswalk.

The `fix` → `nextActions` field migration trails the same way: the target shape is frozen here, and the call sites that still pass a `fix` string convert cluster by cluster under a ratchet. A converted site sets **both** fields — `fix` for the surfaces that still render prose, `nextActions` for the ones that read structure — so the sweep never regresses what a user sees. Carrying both is the transition cost, not the destination; `fix` leaves the type when the last site converts (see [Alternatives considered](#alternatives-considered)). The same trail carries the completed-envelope JSON shape — commands whose JSON output predates this ADR converge on the one contract (a `diagnostics` array and the documented exit code on the envelope) as they convert. Freezing the shape before the sweep is what keeps `Diagnostic` and the error envelope aligned — converting first and settling the shape afterwards would let the two drift while half the tree used each spelling.

## Crosswalk (retired → dotted)

The 46 numeric codes. Grouped by destination namespace; a `↦ merges` note marks a code that folds into an existing dotted code.

### → CONFIG

| Retired | Factory | New |
|---|---|---|
| PN-CLI-4001 | `errorConfigFileNotFound` | `CONFIG.FILE_NOT_FOUND` |
| PN-CLI-4002 | `errorContractConfigMissing` | `CONFIG.CONTRACT_MISSING` |
| PN-CLI-4005 | `errorDatabaseConnectionRequired` | `CONFIG.DB_CONNECTION_REQUIRED` |
| PN-CLI-4006 | `errorQueryRunnerFactoryRequired` | `CONFIG.QUERY_RUNNER_FACTORY_REQUIRED` |
| PN-CLI-4007 | `errorFamilyReadMarkerSqlRequired` | `CONFIG.FAMILY_READ_MARKER_REQUIRED` |
| PN-CLI-4009 | `errorConfigValidation` | `CONFIG.VALIDATION_FAILED` |
| PN-CLI-4010 | `errorDriverRequired` | `CONFIG.DRIVER_REQUIRED` |
| PN-CLI-4011 | `errorContractMissingExtensions` | `CONFIG.MISSING_EXTENSION_PACKS` |

### → CLI

| Retired | Factory | New |
|---|---|---|
| PN-CLI-4004 | `errorFileNotFound` | `CLI.FILE_NOT_FOUND` |
| PN-CLI-4008 | `errorJsonFormatNotSupported` | `CLI.JSON_FORMAT_UNSUPPORTED` |
| PN-CLI-4012 | `errorMigrationCliInvalidConfigArg` (`--config` given without a path) | `CLI.CONFIG_ARG_MISSING_PATH` |
| PN-CLI-4013 | `errorMigrationCliUnknownFlag` | `CLI.UNKNOWN_FLAG` |
| PN-CLI-4014 | `errorInvalidOutputFormat` | `CLI.INVALID_OUTPUT_FORMAT` |
| PN-CLI-4015 | `errorOutputFormatMutex` | `CLI.OUTPUT_FORMAT_CONFLICT` |
| PN-CLI-4999 | `errorUnexpected` | `CLI.UNEXPECTED` |
| PN-CLI-5002 | `errorInitReinitNeedsForce` | `CLI.INIT_REINIT_NEEDS_FORCE` |
| PN-CLI-5003 | `errorInitMissingFlags` | `CLI.INIT_MISSING_FLAGS` |
| PN-CLI-5004 | `errorInitInvalidFlagValue` | `CLI.INIT_INVALID_FLAG_VALUE` |
| PN-CLI-5005 | `errorInitStrictProbeWithoutProbe` | `CLI.INIT_STRICT_PROBE_WITHOUT_PROBE` |
| PN-CLI-5006 | `errorInitUserAborted` | `CLI.INIT_USER_ABORTED` (exit 3) |
| PN-CLI-5007 | `errorInitInstallFailed` | `CLI.INIT_INSTALL_FAILED` |
| PN-CLI-5008 | `errorInitEmitFailed` | `CLI.INIT_EMIT_FAILED` |
| PN-CLI-5010 | `errorInitInvalidManifest` | `CLI.INIT_INVALID_MANIFEST` |
| PN-CLI-5011 | `errorInitInvalidTsconfig` | `CLI.INIT_INVALID_TSCONFIG` |
| PN-CLI-5012 | `errorInitProbeFailed` | `CLI.INIT_PROBE_FAILED` |
| PN-CLI-5013 | `errorInitSkillInstallFailed` | `CLI.INIT_SKILL_INSTALL_FAILED` |
| PN-CLI-5014 | `errorInitAuthoringSchemaPathMismatch` | `CLI.INIT_AUTHORING_SCHEMA_PATH_MISMATCH` |

### → CONTRACT

| Retired | Factory | New |
|---|---|---|
| PN-CLI-4003 | `errorContractValidationFailed` | `CONTRACT.VALIDATION_FAILED` |
| PN-CON-4016 | `errorEnumCodecNotInPackStack` | `CONTRACT.ENUM_CODEC_NOT_IN_PACK_STACK` |
| PN-RUN-3000 | `errorRuntime` | `CONTRACT.VERIFY_FAILED` |
| PN-RUN-3001 | `errorMarkerMissing` | `CONTRACT.MARKER_MISSING` ↦ merges with existing runtime code |
| PN-RUN-3002 | `errorHashMismatch` | `CONTRACT.MARKER_MISMATCH` ↦ merges with existing runtime code |
| PN-RUN-3003 | `errorTargetMismatch` | `CONTRACT.TARGET_MISMATCH` |
| PN-RUN-3004 | `errorSchemaVerificationFailed` | `CONTRACT.SCHEMA_VERIFICATION_FAILED` |
| PN-RUN-3005 | `errorMarkerRowCorrupt` | `CONTRACT.MARKER_ROW_CORRUPT` |
| PN-RUN-3006 | `errorMarkerReadFailed` | `CONTRACT.MARKER_READ_FAILED` |
| PN-RUN-3010 | `errorMarkerRequired` | `CONTRACT.MARKER_REQUIRED` |

### → MIGRATION

| Retired | Factory | New |
|---|---|---|
| PN-CLI-4020 | `errorMigrationPlanningFailed` | `MIGRATION.PLANNING_FAILED` |
| PN-CLI-4021 | `errorTargetMigrationNotSupported` | `MIGRATION.TARGET_UNSUPPORTED` |
| PN-RUN-3020 | `errorRunnerFailed` | `MIGRATION.RUNNER_FAILED` |
| PN-RUN-3030 | `errorDestructiveChanges` | `MIGRATION.DESTRUCTIVE_CHANGES` |
| PN-MIG-2001 | `errorUnfilledPlaceholder` / `placeholder` | `MIGRATION.UNFILLED_PLACEHOLDER` |
| PN-MIG-2002 | `errorMigrationFileMissing` | `MIGRATION.FILE_MISSING` ↦ merges with existing tooling code |
| PN-MIG-2003 | `errorMigrationInvalidDefaultExport` | `MIGRATION.INVALID_DEFAULT_EXPORT` |
| PN-MIG-2004 | `errorMigrationPlanNotArray` | `MIGRATION.PLAN_NOT_ARRAY` |
| PN-MIG-2005 | `errorDataTransformContractMismatch` | `MIGRATION.DATA_TRANSFORM_CONTRACT_MISMATCH` |
| PN-MIG-2006 | `errorMigrationTargetMismatch` | `MIGRATION.TARGET_MISMATCH` |

### Codes published outside the factory files

Direct `CliStructuredError` constructions and sibling numeric schemes. Same crosswalk contract, with one caveat: `PN-CLI-4012` was published with two unrelated meanings, so it appears both in the CLI table above (the `--config` flag error) and below (`db verify`'s invalid `--mode`). A consumer migrating a match on that numeric code must split by producing command; every other retired code maps one-to-one.

| Retired | Where | New |
|---|---|---|
| PN-MIG-2007 | postgres target `errorPostgresMigrationStackMissing` | `MIGRATION.POSTGRES_CONTROL_STACK_MISSING` |
| PN-MIG-2008 | sqlite target `errorSqliteMigrationStackMissing` | `MIGRATION.SQLITE_CONTROL_STACK_MISSING` |
| PN-MIG-5001 | contract-space aggregate loader (layout violation) | `MIGRATION.CONTRACT_SPACE_LAYOUT_VIOLATION` |
| PN-MIG-5002 | contract-space integrity / orphan marker | `MIGRATION.CONTRACT_SPACE_VIOLATION` |
| PN-CLI-4012 (collision) | `db verify` invalid `--mode` — the same rendered code as the `--config` flag error, two unrelated meanings; the dotted split retires the collision | `CLI.INVALID_VERIFY_MODE` |
| PN-CLI-5009 | `init` invalid output document | `CLI.INIT_INVALID_OUTPUT_DOCUMENT` |
| PN-SCHEMA-0001 | SQL schema-verify failure (the `SCHEMA` domain's only producer; the domain is dropped with it) | `CONTRACT.SCHEMA_VERIFICATION_FAILED` |

The `migration check` failure catalogue (`PN-MIG-CHECK-NNN`) converts to self-describing `MIGRATION.CHECK_*` codes. `PN-MIG-CHECK-002` covered two unrelated violation kinds; the dotted split separates them. These are **diagnostic** codes: they ride in the completed envelope alongside `migration check`'s documented exit code, not on the error path. The code space is the same one errors draw from — that is the point of one code space — but the carrier is a finding.

| Retired | New |
|---|---|
| PN-MIG-CHECK-001 | `MIGRATION.CHECK_HASH_MISMATCH` |
| PN-MIG-CHECK-002 (missing file) | `MIGRATION.CHECK_FILE_MISSING` |
| PN-MIG-CHECK-002 (provided-invariants disagree) | `MIGRATION.CHECK_PROVIDED_INVARIANTS_MISMATCH` |
| PN-MIG-CHECK-002 (package unloadable) | `MIGRATION.CHECK_PACKAGE_UNLOADABLE` |
| PN-MIG-CHECK-003 | `MIGRATION.CHECK_UNREACHABLE_MIGRATION` |
| PN-MIG-CHECK-004 | `MIGRATION.CHECK_DANGLING_REF` |
| PN-MIG-CHECK-005 | `MIGRATION.CHECK_SNAPSHOT_HASH_MISMATCH` |
| PN-MIG-CHECK-006 | `MIGRATION.CHECK_SNAPSHOT_UNPARSEABLE` |
| PN-MIG-CHECK-007 | `MIGRATION.CHECK_NOOP_SELF_EDGE` |
| PN-MIG-CHECK-008 | `MIGRATION.CHECK_ORPHAN_SPACE_DIR` |
| PN-MIG-CHECK-009 | `MIGRATION.CHECK_DECLARED_BUT_UNMIGRATED` |
| PN-MIG-CHECK-010 | `MIGRATION.CHECK_HEAD_REF_MISSING` |
| PN-MIG-CHECK-011 | `MIGRATION.CHECK_HEAD_REF_NOT_IN_GRAPH` |
| PN-MIG-CHECK-012 | `MIGRATION.CHECK_REF_UNREADABLE` |
| PN-MIG-CHECK-013 | `MIGRATION.CHECK_TARGET_MISMATCH` |
| PN-MIG-CHECK-014 | `MIGRATION.CHECK_SPACE_DISJOINTNESS_VIOLATION` |
| PN-MIG-CHECK-015 | `MIGRATION.CHECK_CONTRACT_UNREADABLE` |
| PN-MIG-CHECK-016 | `MIGRATION.CHECK_DUPLICATE_MIGRATION_HASH` |

### Dotted-code reconciliations (no rename except where noted)

- `DRIVER.*` — already dotted; `DRIVER` becomes a real namespace. No code strings change.
- `RUNTIME.MISSING_MUTATION_DEFAULT_GENERATOR` and `RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING` (near-duplicates) → single `RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING`.
- The migration runner's bare-word enum values `EXECUTION_FAILED`, `SCHEMA_VERIFY_FAILED`, `PRECHECK_FAILED`, `POSTCHECK_FAILED`, `POLICY_VIOLATION`, `FOREIGN_KEY_VIOLATION`, `DESTINATION_CONTRACT_MISMATCH`, `LEGACY_MARKER_SHAPE`, `MARKER_ORIGIN_MISMATCH`, `MARKER_CAS_FAILURE` → `MIGRATION.<VALUE>` on the `Result` failure (the failure already carries a summary and details; only the code string changes).
- `PLAN.INVALID` / `PLAN.UNSUPPORTED` had no production callers and are deleted rather than migrated.
- The remaining `MIGRATION.*` / `RUNTIME.*` / `PLAN.*` / `CONTRACT.*` / `LINT.*` / `BUDGET.*` codes already conform; no rename.

## Consequences

### Positive

- One code space: consumers, dashboards, and CI match errors by dotted code, not brittle strings; the crosswalk is the single rename record.
- Recognition survives the control/execution split, the wire, and duplicate imports, because it is structural.
- The same envelope serves a throw and a `Result` failure — no per-boundary conversion type.
- A command that reports problems does not have to throw to do it. `migration check` returns its violations; the exit code says how it went; nothing on the path is an exception.
- Remediation is executable. An agent branches on each action's `kind` and runs the `command` a `run-command` action carries, instead of parsing a sentence; the human rendering is the same `→` line it always was.
- Codes live with the code that raises them; a new namespace is a new owning module, not an edit to a central registry.
- The ratchet lets the taxonomy freeze while the mechanical sweep of the remaining throw sites trails safely.

### Negative

- No global compile-time guarantee that every code is unique across namespaces — uniqueness is a convention checked by the crosswalk + review, not the type system. (A namespace's own union is enforced locally.)
- The structural predicate accepts any object of the right shape, including a hand-rolled look-alike; this is the deliberate cost of prototype-independence.
- `severity` is retained though nearly every error is `error`; the `warn`/`info` values earn their place on advisory lint, budget, and status surfaces, and on the user-abort envelope.
- Two settlement paths mean a command author has a judgement call to make at every return site. The rule ("was finding these problems the job?") is a sentence, not a type, and the only mechanical check is the runtime one: a severity-`error` diagnostic must come with a non-zero exit code.
- `nextActions` is more work to write than a prose sentence — three fields instead of a clause. That cost is paid once per factory and recovered by every agent that would otherwise parse the prose.

## Alternatives considered

**A single `StructuredError` base class, recognized by `instanceof`.** Rejected: a shared prototype does not survive the control/execution plane split, JSON round-trips across the network, or duplicate library copies in a monorepo — the exact conditions where errors must still be recognized. A class is fine as an *implementation convenience* for throwing (as `InternalError` is), but recognition must be structural.

**Two envelopes (CLI presentation vs runtime) sharing only a code format.** Rejected: the split is historical, not principled. Two shapes means two crosswalks, two docs pipelines, and a conversion type at every boundary between them, for no capability the one shape lacks.

**Keep numeric `PN-DOMAIN-NNNN` codes.** Rejected: dotted names are self-describing; numeric codes force a lookup table to read any log line.

**One physical union module listing every code.** Rejected: it would have to sit in a low foundation package yet name codes owned by high packages (sql, targets, extensions), inverting the layering that `pnpm lint:deps` enforces. The per-namespace union keeps each code with its owner; the "central registry" is this ADR's crosswalk (documentation), not a type.

**Findings as structured failures exiting `2`.** Rejected: it makes a command throw in order to report what it was asked to find, and it puts "the check found eleven violations" in the same exit-code bucket as "you passed an unknown flag". A shell pipeline cannot tell those apart, and the command has to invent a wrapper failure whose only content is a list of findings. Exit `2` is reserved for a command that could not do its job.

**A separate `Finding` shape, unrelated to the error envelope.** Rejected: two shapes means two renderers, two JSON schemas, and two things for a consumer to learn, for a distinction that is about *carrier*, not content. A dangling ref is the same information whether the command aborted on it or listed it. `Diagnostic` carries the envelope's fields precisely so the two never drift.

**Support `fix` prose alongside `nextActions` permanently.** Rejected as an end state: two indefinitely-supported remediation fields guarantee they eventually disagree. Every factory would have to keep a sentence and a structured list in sync by hand, and consumers would have to decide which one wins when they differ. If prose is wanted around an action, it is that action's `reason`.

What is rejected is the permanent dual surface, not a period in which both exist. The transition is the stated adoption path: `fix` stays on the type, a converted factory sets both fields, and a ratchet drives the count of prose-only sites down cluster by cluster (see [Adoption and freeze scope](#adoption-and-freeze-scope)). During that window the two fields *are* maintained by hand at converted sites, which is exactly the cost this alternative names — it is accepted as bounded and paid down, rather than accepted as the design. `fix` is deleted from the type when the last raise site converts, and that deletion is what closes the alternative out.

**Trim severity to `'error' | 'warn'`.** Rejected on evidence: `CLI.INIT_USER_ABORTED` ships with `severity: 'info'`, and the migration-status diagnostics publish `'warn' | 'info'` in their JSON schema. See [The severity scale](#the-severity-scale).

**Convert every existing throw site in one change.** Rejected: it is not one coherent review, and it collides with the code freeze at RC. Only the *codes* must freeze; the conversion is ratcheted down afterward, plane by plane.
