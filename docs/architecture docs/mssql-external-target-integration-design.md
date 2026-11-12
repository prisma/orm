# Proposal: supported external database targets in Prisma 8 tooling

**Status:** Proposed; design review only.
**Date:** 2026-11-12.
**Proposed repository:** `prisma/orm`.

## Summary

Allow an independently published database facade to participate in the normal Prisma 8 initialization and artifact-emission workflow without adding its package names or database-specific code to Prisma's shared tooling.

SQL Server is the motivating use case. The mechanism should work for any external target that implements Prisma's supported public contracts. This proposal does not add SQL Server's database implementation to upstream Prisma, change the query API, or introduce a plugin runtime. SQL Server-specific behavior remains in the separate target, adapter, driver, and facade.

**Compatibility boundary:** installing or declaring an external package must not activate it, change an existing import root, or make unrelated package metadata a new failure condition for built-in workflows. External naming requires explicit project opt-in; existing projects without that opt-in keep their current behavior.

**Requested decision:** agree on the explicit project-selection and registration boundaries, import-resolution contract, and bounded initialization scope before an implementation PR. Names and metadata syntax below are proposals, not existing supported APIs.

## 1. Problem and verified baseline

An application should be able to install an independently published SQL Server package, initialize its Prisma configuration, and generate artifacts using supported public exports. Today, two gaps in Prisma's shared tooling prevent this workflow:

1. **Target selection:** `prisma orm init --target mssql` is rejected because initialization only recognizes built-in target IDs.
2. **Generated import resolution:** The project import resolver does not recognize an external SQL Server facade, so it cannot map generated framework, SQL-family, and target references to that package's public exports.

Important distinction: **ordinary third-party public imports already pass through the resolver unchanged.** This is not a request to make every external import legal, publish private target/adapter/driver packages, or add MSSQL aliases to the built-in map.

The original published-package observations were made against `8.0.0-rc.20`, source revision [`10b7bedcefafc63484b0ac9a9ae34fdedee54b30`][rc20]. On 2026-11-12, source inspection at [the reference revision][reference] confirmed that these two boundaries remain. This is a source comparison, not a claim that the latest canonical published CLI was executed.

| Boundary | PostgreSQL control | External target today | Relevant source |
| --- | --- | --- | --- |
| Target selection | Accepted through built-in aliases | Unknown ID rejected | [Init input values][input-values] |
| Project root | Declared facade selects its published root | Unknown facade does not select an external root | [Project discovery][project-root], [import roots][import-roots] |
| Generated internal reference | Built-in mapping selects a public export | No external mapping contract | [Public shell map][shells], [import roots][import-roots] |
| Already-public third-party reference | Preserved | Preserved | [Specifier resolver][import-roots] |

Original reproducible boundary evidence is available in [the feasibility record](https://github.com/microsoft/mssql-prisma/blob/041bfce5272ba8110073781d070e6a078ffa77cd/docs/public-sdk-feasibility.json) and [the consumer probe](https://github.com/microsoft/mssql-prisma/blob/041bfce5272ba8110073781d070e6a078ffa77cd/test/feasibility/consumer/cli-boundaries.ts).

## 2. Goals and non-goals

### Goals

- Keep the familiar `prisma orm init` and contract-emission workflow.
- Let a package own its identity, public entrypoints, and database-specific starter.
- Preserve the existing PostgreSQL, MongoDB, internal-workspace, and decomposed public-package behavior when the project has not opted into external naming, even when external packages are also declared or installed.
- Ensure files emitted through the selected external root refer to direct, publicly exported dependencies, never leaked private workspace paths; do not broaden legacy-root audits as part of this change.
- Fail unsupported or ambiguous requests explicitly before initialization effects.
- Keep target/adapter/driver/control responsibilities and public runtime contracts unchanged.

### Initial scope

One explicitly selected, installed, directly declared external facade; one TypeScript starter mode; exact import mappings; normal config and artifact paths. Registration applies to all existing artifact writers that already receive the project's import resolver.

Project selection is explicit and persistent so later commands do not infer an active facade from installed dependencies. The proposed selection is naming-only tooling data, not another source of runtime/pack composition.

### Non-goals

- SQL Server query lowering, transport, codecs, authentication, introspection, migration execution, or a full database implementation.
- Adding a new ORM API, command family, runtime plugin loader, or global registry.
- Installing a package guessed from an unknown target ID, registry lookup, or automatic package discovery over the network.
- External PSL authoring, database probing, Prisma 7 adoption, or adding external choices to the no-flags interactive database picker in this first increment.
- Multiple active database facades in one application, migration between facades, or implementing support for every package-manager storage model.
- Reworking built-in target registration as part of this change.

These are boundaries of this tooling increment, not a claim that SQL Server's overall product requirements may be dropped.

## 3. Proposed developer experience

Illustrative SQL Server package name and proposed metadata only; no released integration or supported selection API is asserted:

```sh
pnpm add @example/orm-mssql
```

Explicitly select that facade in the application's own `package.json`, preserving its other fields. The proposed naming-only selection is:

```json
{
  "prismaNext": {
    "tooling": {
      "externalTarget": {
        "version": 1,
        "facade": "@example/orm-mssql"
      }
    }
  }
}
```

Then use the normal commands:

```sh
pnpm exec prisma orm init --target mssql --authoring typescript
pnpm exec prisma contract emit
```

The selector binds to one exact declared package; its package-owned registration supplies the `mssql` ID and starter. Subsequent commands use the same explicit binding. Removing the selector restores existing dependency-based naming rules; it does not migrate the config, schema, or database.

The example assumes the normal compatible `prisma` executable is already available. Package installation and CLI version selection continue to follow existing Prisma setup conventions; registration does not pick or promise an unreleased CLI version.

The facade owns its target, adapter, and driver composition. An application developer uses its public config, authoring, and runtime exports, not internal ASTs or a checkout of Prisma.

Initialization writes the normal config, schema, runtime example, and supporting files. It uses existing consent, manifest/script merging, environment preservation, installation, and emission behavior rather than a parallel external-target path.

## 4. Proposed package registration contract

### 4.1 Static, versioned metadata

The recommended starting point is a small JSON registration in the installed facade's `package.json`, tentatively named `prismaNext.externalTarget`. Tooling reads this data only after the application explicitly selects that exact package as described in section 4.4. It does not import the package or enumerate other installed manifests.

```ts
interface ExternalTargetRegistrationV1 {
  readonly version: 1;
  readonly id: string;
  readonly label: string;
  readonly imports: Readonly<Record<string, string>>;
  readonly init: {
    readonly typescript: {
      readonly schema: string;
      readonly db: string;
    };
    readonly env: string;
    readonly quickReference: string;
  };
}
```

- `id`: lowercase CLI selector matching `^[a-z][a-z0-9-]*$`; not an npm package name, runtime capability declaration, or replacement for the target descriptor. CLI input follows the existing case-normalization convention.
- `label`: nonempty display text; does not grant capabilities.
- `imports`: exact emitted source specifier to facade export subpath, as below.
- `schema` and `db`: nonempty UTF-8 TypeScript source strings owned by the facade.
- `env`: an environment-file example with placeholders, never real credentials.
- `quickReference`: package-owned getting-started Markdown.
- The facade identity is derived from the application's declared dependency and verified against the installed package's `name`; it is not supplied twice in registration metadata.

For the selected package, absence of the registration field means it cannot satisfy the external request; invalid registration or an unsupported version is also an explicit error. No internal/built-in fallback is allowed. Metadata in unselected packages is not read or validated, whether valid, malformed, or from a future version. Unknown additive fields are ignored in version 1; incompatible semantics require a new version and explicit support by the consuming CLI.

### 4.2 Exact public import mapping

For example, within a registered facade named `@example/orm-example`:

```json
{
  "imports": {
    "@internal/contract/types": "./contract/types",
    "@internal/sql-contract/types": "./family-contract/types",
    "@internal/target-example/codec-types": "./target/codec-types"
  }
}
```

The resolver joins the verified facade name and declared subpath. The first entry therefore resolves to `@example/orm-example/contract/types`.

These keys identify references already produced by Prisma's emitters or package contributions; **they do not authorize an application to import `@internal/*`.** They must not be interpreted as a stability promise for private module names. An external package remains compatible only with the public SDK versions it supports. Existing public contribution specifiers should be used directly where possible, without adding a mapping.

This private-source-key exposure is an explicit design tradeoff for review. If maintainers prefer stable public emission identities, agree on those before implementation; do not silently make private names a supported extension API.

### 4.3 Facade requirements

The bounded starter convention requires:

- Public `./config` and `./runtime` entrypoints.
- `./config` exporting the normal `defineConfig` helper, accepting the contract source path and `db.connection` used by the shared config template.
- Explicit public exports for every mapped subpath and every self-import in the starter. These may delegate to supported Prisma public packages; no vendoring is required.
- Compatible public Prisma dependencies/peers, declared by the facade.
- All mandatory external driver peers resolved by the application's initial installation; this increment does not infer a target-specific peer list.

If a target cannot implement this narrow config convention, version 1 does not silently reinterpret its connection options. A broader config-template contract would require a separate design decision.

Metadata-version validation is not SDK compatibility negotiation. Normal package peer constraints and existing runtime/config compatibility checks remain authoritative; no incompatible package is automatically upgraded or downgraded.

### 4.4 Explicit project selection

The proposed application-manifest field is `prismaNext.tooling.externalTarget`, distinct from the facade's registration:

```ts
interface ExternalTargetSelectionV1 {
  readonly version: 1;
  readonly facade: string;
}
```

The application selects one exact direct dependency or dev dependency by package name. It does not repeat the target ID, import mappings, or runtime stack. The selected facade owns those mappings and its CLI ID; `prisma.config.ts` continues to own runtime/pack composition.

The application field is the activation boundary for external naming, not package presence, a matching target ID found by a scan, or a process-global registration. Its absence preserves legacy root selection. Its presence is explicit opt-in: invalid selection or selected-package metadata fails rather than falling back.

The field name and location require maintainer agreement alongside the narrow ADR 150 clarification in section 6. This is a concrete review candidate, not an already available public API. If maintainers prefer a config-owned naming field, agree on its public contract and pre-config bootstrap behavior first; do not replace this binding with automatic dependency discovery.

## 5. Normative behavior

### 5.1 Selection, isolation, and package resolution

1. Use the existing nearest application-manifest rules. Do not combine dependencies or selectors from unrelated parent workspace manifests.
2. With no application selector, preserve the existing built-in/default init dispatch and internal/facade/platform root-selection branches. Do not scan installed dependency manifests, add external-package conflicts, change import precedence, or apply external-only validation. An unknown target still fails with the existing unknown-target code; guidance may explain explicit opt-in.
3. With a selector, validate its version and exact package name, then require that package in the application's `dependencies` or `devDependencies`. Transitive installation alone is insufficient.
4. Resolve only that selected package's manifest using the supported Node/node_modules layout, including ancestor hoisting, scoped packages, and pnpm links. Validate the name before constructing filesystem paths. The package need not export `./package.json`. Read static data without evaluating an entrypoint or config; do not inspect other installed package manifests.
5. Validate the selected registration and reject a built-in ID/alias collision. External init requires an explicit matching target flag. An unmatched ID, missing selected package, or invalid selected metadata is an error, never a download, guessed package, or internal/built-in-root fallback.
6. For later artifact commands, the same persisted selector chooses the external naming root. The CLI target flag is not an implicit global registration. Config remains the source of runtime composition; normal config validation must reject a mismatched configured target rather than overriding the stack.
7. An opted-in external workflow must not compose with a declared built-in facade; fail before init effects and identify the conflicting declaration. Other installed external packages are unselected data, not competing active facades. Their IDs and metadata cannot cause duplicate-ID failures.

The compatibility cases are:

| Project / request | Required behavior |
| --- | --- |
| No selector; built-in or no-flags init | Existing flags, prompts, defaults, errors, templates, dependency handling, and effects; no external manifest reads |
| No selector; any existing root mode | Existing root and audit behavior, even with valid, malformed, unreadable, or future-version external packages installed |
| Valid selector; matching external init or later artifact command | Validate only the selected package; use its external naming data |
| Selector or selected package invalid | Explicit failure; do not fall back, ignore errors, or substitute PostgreSQL |
| Selector present; built-in or no-flags init | Explicitly opted-in project only: fail before effects and explain that returning to built-in initialization requires removing the selector; do not discover external picker choices |

Switching between externally selected and built-in setups is not automated in this increment. The user must deliberately remove or change the selector and align the normal config. Existing built-in-to-built-in consent and dependency cleanup remain unchanged for projects without a selector.

Errors reading the application's own manifest retain existing handling. Unreadable or malformed selected-package metadata is reported with its package and path; unrelated package manifests are not read, silently caught, or repaired. One selected external root may deliberately replace decomposed public-package naming, but merely installing a facade must never do so. No selector means the existing internal-workspace fallback is also unchanged.

The proposed selected-package resolution is limited to supported node_modules layouts. PnP or other virtual filesystems need an explicit resolution design and tests before being claimed supported. No process-global mutable cache is introduced.

### 5.2 Validation and import resolution

The additional registration validation and direct-import audit below apply only to an explicitly selected external root. Existing internal, built-in-facade, and decomposed public roots retain their current resolver and audit behavior.

- Registration must have the supported version and required field types. Use the repository's existing schema-validation conventions, not a second validation framework.
- The installed package name must match the declared dependency key. npm aliases that disagree with that identity are rejected in this increment.
- Mapping keys must be exact source specifiers in the supported emitted-internal namespace. Values must be explicit safe `./subpath` keys in the facade's exports. Reject wildcards, absolute paths, traversal, backslashes, fragments, and URLs.
- Null or disabled export targets are invalid. Conditional exports must expose the applicable Node ESM/type surfaces; declaration presence alone is not proof that a packed package resolves. Verify resolution in consumer tests.
- Registered roots rewrite only explicitly mapped internal references. An unmapped internal reference fails; it is not guessed, preserved, or routed through PostgreSQL.
- Already-public and relative specifiers retain their existing resolution. Separately, the external-root artifact audit rejects references to packages not directly declared by the application, with the established exemptions for relative imports and Node builtins. Do not apply this broader audit to legacy roots or reject a previously accepted third-party import there.
- Use the same immutable project resolver for contract declarations, migrations, and snapshot declarations. Do not add independent per-writer mapping tables.
- Changing import roots must not change contract content, hashes, SQL, or query semantics.

### 5.3 Initialization and templates

For an explicitly selected external initialization, preflight validates registration, target conflicts, selected mode, declared template imports, and existing init prerequisites before scaffold writes, package-manager calls, or database access.

The following restrictions apply only to that external initialization in the first increment. They must not narrow existing PostgreSQL/MongoDB authoring, probing, adoption, prompt, or re-init behavior:

- Explicit TypeScript authoring is supported. If an explicit target is selected interactively and authoring is omitted, offer only supported TypeScript authoring; retain existing noninteractive required-flag behavior.
- Explicit PSL, probing, strict probing, or Prisma 7 adoption must fail without effects. An existing option-conflict error may take precedence when flags already contradict one another.
- Shared tooling generates the standard `definePrismaConfig` wrapper and calls the facade's config helper. It does not import SQL Server-specific types.
- The facade's schema and db source strings are written as text, with no template evaluation, shell commands, post-discovery hooks, or arbitrary output filenames. Discovery and preflight must not execute these snippets.
- Use the existing init file plan: the schema occupies the selected path and `db.ts` is its sibling. Version 1 snippets assume the normal emitted `contract.json`/`contract.d.ts` names. Test nondefault schema directories; incompatible custom output layouts require a clear error or future contract.
- A real starter must consume its locally emitted contract with the normal typed hydration pattern, not a prebound demonstration client. It must not depend on interpolation of filesystem paths or secrets.
- Reject undeclared package imports and unexported facade self-imports in templates. Relative imports must be consistent with the scaffold layout; packed-consumer execution/typechecking verifies that consistency.
- Preserve the installed facade's dependency specification, including on re-init; do not install an unqualified latest version over it.
- Keep normal consent/overwrite handling and existing `.env` preservation. Automated switching into or out of external naming is outside this increment; require deliberate selector/config/dependency changes, not guessed cleanup. Do not replace existing built-in-to-built-in removal prompts or flags.
- `--skip-install` means no package-manager calls and no automatic contract emit. Success means scaffolding succeeded, not that the database works.

Normal config loading and emission after installation may execute trusted package code, as today. The "no execution" guarantee applies to registration discovery and preflight, not to the subsequent Prisma workflow.

### 5.4 Errors and structured output

| Condition | Required result |
| --- | --- |
| Unknown external ID / selected facade not installed | Precondition failure; explain explicit selection and install-first workflow; no effects |
| Invalid selector, selected registration, or unsupported version | Identify selection/package, manifest, field, and reason; no fallback |
| Selected reserved ID or selected external/built-in facade conflict | Deterministic failure identifying the selected package and conflict |
| Unselected external registration, including duplicate IDs or invalid metadata | Not read or validated; no new error or root change |
| Unsupported external init mode | Precondition failure before writes/install/probe; no new restrictions on built-ins |
| Built-in/no-flags init in an explicitly opted-in external project | Explain deliberate opt-out; no effects or package execution |
| Missing map or unusable export | Explicit generation/validation failure identifying the specifier |
| Re-init | Existing consent and preservation semantics |
| Built-in invalid manifest/flags | Preserve existing structured codes and exit behavior |

Use the repository's existing structured-error envelope and conventions. An external-init-specific code may be added where existing codes are insufficient; exact naming is part of implementation review, not fixed by this draft. Successful init output reports the registered normalized ID, not a built-in union or arbitrary unchecked text. It retains all other existing output fields.

Do not include credentials or environment-file contents in diagnostics. Preflight failures leave files, dependencies, and database state unchanged. Post-write installation/emission failures retain existing init reporting and partial-scaffold semantics; this proposal does not promise transactional rollback.

## 6. Architecture and repository ownership

```text
Application's explicit naming selector + declared facade dependency
    -> selected package's static manifest only
    -> selected registration validation
    -> existing init/file-plan and import-resolver seams
    -> public config + schema + runtime example + emitted artifacts
```

| Owner | Proposed responsibility |
| --- | --- |
| `prisma/orm`: `packages/0-shared/publish-surface` | Validated naming data, opt-in external root, exact resolution and external-only direct-import audit; existing root precedence unchanged without opt-in |
| `prisma/orm`: framework CLI tooling | Explicit project selection, selected-package resolution, preflight, shared scaffold orchestration, diagnostics/output; no dependency-wide discovery |
| Existing emission/migration/snapshot callers | Receive the same project resolver through existing seams |
| External facade repository | Metadata, starter text, public exports, peers, target/adapter/driver composition, database behavior |
| `prisma/prisma-cli` | Later consume the released toolchain; verify canonical executable wiring |

No new framework contract, migration-domain vocabulary, AST, adapter SPI, or driver interface is proposed. CLI tooling learns generic package registration, not SQL Server storage or execution semantics. If implementation requires such a domain change, stop and bring it back to design review.

**ADR 150 needs explicit clarification.** Its text prohibits manifest discovery and makes config the only source of pack composition. The existing project-root resolver already reads the application's package manifest for artifact naming; this proposal additionally reads installed package metadata. We request agreement on a narrow bootstrap/naming exception for an explicit application selector and its one selected package, or a maintainer-preferred alternative, before implementation. It does not permit installed-dependency scans. It must not discover/activate operation packs, infer the runtime stack, or override `prisma.config.ts`. Runtime/control composition remains config-only. This draft does not claim that the exception is already approved.

The substantive fix therefore belongs in **`prisma/orm`**. The [unified CLI](https://github.com/prisma/prisma-cli/blob/8285143a8c1af46a38c9f76f16b8df93559a3c9b/packages/cli/package.json) consumes `@prisma/orm-toolchain`; duplicating target validation there would split ownership. After a compatible toolchain release, update both CLI consumer manifests and lockfile as necessary in a separate `prisma/prisma-cli` change and test the actual published-command boundary. No new CLI-engine API is currently proposed.

### Pattern applicability

All pattern references below are pinned to [Prisma ORM revision](https://github.com/prisma/orm/tree/5c9c31b33539ba5da7e29707b9534fa33a591f3b).


| Pattern / rule | Application and acceptance |
| --- | --- |
| [Package layering][package-layering] | Keep naming/validation below tooling; no framework-to-target imports. Validate with `pnpm lint:deps`. |
| [Lowest consuming layer][lowest-layer] | Keep selected registration naming in the existing publish-surface layer and filesystem work in tooling; reuse `ImportSpecifierResolver`, not a new domain SPI. Validate build/types and all artifact callers, including legacy roots with unselected external packages. |
| [Adapter SPI][adapter-spi], [no target branches][no-target-branches] | Runtime dialect behavior stays in adapters. Registration contains target-owned data; shared code must not branch on `mssql` or route it through PostgreSQL. Verify built-in paths do not read external manifests or change output. |
| [Capability gating][capability-gating] | Registration grants no database capability. Unsupported external starter modes are refused only after explicit selection; built-in modes and runtime capability checks are unchanged. |
| [Declaration-merging registries][merging] | Not applicable: this is project-local tooling data, not global contributed query typing. No module augmentation or global mutation. |
| [Framework-domain boundary][framework-rule] | Do not add storage/control concepts or runtime interfaces. Review any new CLI exports as tooling-only changes. |
| [Family-agnostic CLI / ADR 150][cli-adr] | Preserve config-only runtime composition. The explicit naming selector and selected-package metadata need the narrowly scoped clarification described above, not dependency scanning or an implicit waiver of the ADR. |

AST/IR, stateful-service factories, and authoring-warning patterns do not require new implementations: this increment introduces no AST, service, lowering, or warning-sink behavior. The [existing facade model][public-surface-adr] remains the packaging reference, not a new parallel framework.

## 7. Alternatives and tradeoffs

| Alternative | Assessment |
| --- | --- |
| Add MSSQL names to the built-in target/shell tables | Small immediate patch but every external target would need an upstream change; does not meet the external ownership goal. |
| Rely only on already-public imports | Preferred for package contributions where possible, but alone does not provide external init or rewrite framework/family references in generated artifacts. |
| Scan all declared dependency manifests for registrations | Rejected: unrelated package contents become new built-in failure conditions and package installation can change root selection. Explicit package selection is required instead. |
| Let config inject a resolver | May help emission, but init occurs before a usable config and would still lack bootstrap information; risks separate configuration sources. |
| Execute a package-exported registration hook | More flexible but executes package code to discover it and expands the extension/security/versioning surface. Not needed for the bounded starter. |
| Static metadata plus packaged template files | Avoids long JSON strings and may improve authoring. Adds asset-path validation and tarball/file-loading rules; a reasonable maintainer-preferred variant. |
| Explicit application selector plus selected-package static metadata with inline strings (recommended starting point) | One package identity for bootstrap and later naming; no dependency scan, new asset loader, or executable hook. Adds explicit application metadata, so its placement and ADR 150 clarification require maintainer agreement. Inline snippets remain deliberately small. |

The recommendation is not a requirement to accept the exploratory prototype's representation. Choose inline strings versus constrained package assets during design review, before committing to a public metadata schema.

## 8. Regression specification and acceptance

The implementation must add tests at the actual boundaries, not only unit tests of a synthetic parser.

| ID | Scenario | Required assertion |
| --- | --- | --- |
| R01 | Existing PostgreSQL and MongoDB initialization without external opt-in | Existing config/templates, aliases, defaults, structured output, consent, invalid-input errors, install and re-init behavior preserved |
| R02 | Explicitly selected installed direct external facade | Explicit TypeScript init succeeds with normalized ID and declared public imports; no built-in name substitution |
| R03 | Selected direct dev dependency, workspace, scoped/pnpm-linked and hoisted installs | Correct nearest project selector/manifest and package identity; no parent-selector merging or transitive-only registration |
| R04 | Missing/unknown/reserved selection or selected facade conflict | Deterministic error; zero writes, installs, probes, or module evaluation; unselected external IDs do not conflict |
| R05 | Selected version/type/name/export/map invalidity | Fail malformed selection/metadata, disabled exports, traversal, wildcard and undeclared mappings; verify conditional ESM/type exports; no legacy-root fallback |
| R06 | Unsupported external modes and option combinations | Selected external PSL/probe/adoption refused at preflight; external authoring prompt only offers supported choices; existing built-in modes unchanged |
| R07 | External import root | Exact mappings work; absent internal mapping fails; public imports remain unchanged; undeclared scoped/unscoped imports fail artifact audit |
| R08 | Existing root modes without external opt-in | Internal, built-in facade, decomposed public-package behavior and audit unchanged; no process-global registration leakage |
| R09 | Artifact propagation | Contract emission, migration rendering, and snapshot declarations use the selected external resolver, including codec/operation contributions |
| R10 | Artifact semantics | Same contract/hash inputs produce identical hashes/content apart from expected import specifiers; no SQL or query change |
| R11 | Re-init and skip-install | Preserve facade version/spec and `.env`; require consent; preserve existing partial-failure semantics; skip-install causes no install/emit |
| R12 | Scaffold relocation and type safety | Nondefault schema directory retains correct sibling artifacts; a changed starter schema affects emitted types; db example consumes those local types |
| R13 | Clean packed public consumer | Outside the monorepo, install actual packed facade/toolchain artifacts; resolve exports, emit, and typecheck using only public dependencies, with no workspace alias/path mapping |
| R14 | Canonical executable follow-up | Compatible `prisma` executable accepts init and emission through mounted ORM commands, not only an internal command-family harness |
| R15 | Native platform checks | Affected build/type/unit/package-consumer checks on supported Windows, Linux, and macOS clients; portable paths and argument handling |
| R16 | Built-in/default init with unrelated external dependencies/devDependencies | Compare with the pinned baseline: aliases, no-flags prompts/defaults, invalid flags, PSL, probes, adoption, and re-init unchanged; guard filesystem reads so accessing unrelated installed manifests fails the test |
| R17 | Legacy roots with unselected external packages | Test valid metadata, invalid JSON, unreadable manifests, unsupported versions, reserved/duplicate IDs, and missing installs; PostgreSQL facade/platform/internal roots, emitted imports, and existing import-audit results match the baseline; no unselected manifest reads |
| R18 | Persistent, project-local external selection | A fresh process uses the same selected package for contract/migration/snapshot emission; only that package is inspected; other external registrations cannot redirect it; no selector means legacy root rules |
| R19 | Selected failure, config consistency, and explicit opt-out | Invalid selected metadata never falls back; normal config target mismatch fails without stack substitution; selected built-in-facade conflict fails; opted-in built-in/default init explains opt-out before effects; removing the selector restores legacy naming, not an automatic config/database migration |

Use a purpose-built functioning test facade for R13; an empty contract object and successful file writes alone are not end-to-end integration evidence. Package fixtures must obey the same public-export rules expected of contributors.

Repository validation should use existing commands: root `pnpm build`, affected package test/typecheck scripts, `pnpm lint:deps`, relevant lint/manifest checks, and existing public-package/consumer checks extended as needed. Do not bypass layering or weaken private-import guards to make the fixture pass.

No live database is required to prove registration, static scaffolding, or import resolution. SQL Server execution, cleanup, authentication, and release/platform qualification remain separately required for the database implementation.

## 9. Delivery and design decisions

### Proposed sequence

1. **This design-only PR:** review goals, ownership, schema, failure behavior, and acceptance. No runtime changes, package pins, or prototype implementation.
2. **After agreement, core ORM implementation:** preserve the existing branches first; add explicit project selection and selected-package-only resolution, then bounded TypeScript init using existing seams. Cover R16-R19 alongside existing regressions and clean packed-consumer acceptance.
3. **Release and CLI consumption:** consume the released toolchain and qualify the canonical executable in `prisma/prisma-cli`.
4. **External target integration:** implement/publish an approved facade and separately qualify real database behavior.

Avoid publishing a registration contract as stable before design agreement. Keep local experiments separate; the eventual implementation must be reconciled with the agreed design and then-current compatible upstream release.

### Decisions requested from maintainers

1. Is the explicit application selector in section 4.4 the right bootstrap/naming boundary, with package-owned static registration and an ADR 150 clarification limited to that one selected package? Are the proposed fields/version envelopes appropriate, or should a supported config contract carry naming selection? Dependency-wide scanning and activation by package presence are excluded.
2. Should emission mappings identify existing source specifiers, or should this use a stable public emission identity? The proposal must not freeze private module names accidentally.
3. Are inline schema/db strings acceptable for the initial increment, or are constrained packaged template assets preferable?
4. Is install-first, one explicitly selected facade, TypeScript initialization an acceptable initial scope, with existing runtime/control contracts unchanged and automated switching into/out of external naming excluded?
5. Do the proposed ORM/toolchain ownership and later canonical-CLI acceptance match the intended release process?

### Evidence status

This is a proposal, not a claim of merged or supported functionality. Source references were checked at the pinned revision on 2026-11-12. An earlier local exploratory implementation informed feasibility; it is not part of this design PR and does not determine the accepted contract. Its focused test results do not substitute for the acceptance matrix, complete upstream CI, packed-consumer coverage, or canonical-CLI/platform qualification. Subsequent source-level comparisons found that the prototype's dependency-wide discovery can reject PostgreSQL projects on unrelated metadata, and a valid unselected external package can reject an existing facade or redirect a platform root. This revision rejects that approach and adds the explicit selection, no-unselected-reads, and R16-R19 requirements. The prototype has not been corrected by this documentation update; the new requirements/tests are proposed, not passes. The prototype has not established every requirement in this draft; in particular, usable conditional exports and the functioning packed-consumer/relocation journey require dedicated acceptance work after design agreement.

[reference]: https://github.com/prisma/orm/tree/5c9c31b33539ba5da7e29707b9534fa33a591f3b
[rc20]: https://github.com/prisma/orm/tree/10b7bedcefafc63484b0ac9a9ae34fdedee54b30
[input-values]: https://github.com/prisma/orm/blob/5c9c31b33539ba5da7e29707b9534fa33a591f3b/packages/1-framework/3-tooling/cli/src/commands/init/input-values.ts
[project-root]: https://github.com/prisma/orm/blob/5c9c31b33539ba5da7e29707b9534fa33a591f3b/packages/1-framework/3-tooling/cli/src/utils/project-import-root.ts
[import-roots]: https://github.com/prisma/orm/blob/5c9c31b33539ba5da7e29707b9534fa33a591f3b/packages/0-shared/publish-surface/src/import-roots.ts
[shells]: https://github.com/prisma/orm/blob/5c9c31b33539ba5da7e29707b9534fa33a591f3b/packages/0-shared/publish-surface/src/shells.ts
[package-layering]: https://github.com/prisma/orm/blob/5c9c31b33539ba5da7e29707b9534fa33a591f3b/docs/architecture%20docs/patterns/package-layering.md
[lowest-layer]: https://github.com/prisma/orm/blob/5c9c31b33539ba5da7e29707b9534fa33a591f3b/docs/architecture%20docs/patterns/spi-at-lowest-consuming-layer.md
[adapter-spi]: https://github.com/prisma/orm/blob/5c9c31b33539ba5da7e29707b9534fa33a591f3b/docs/architecture%20docs/patterns/adapter-spi.md
[capability-gating]: https://github.com/prisma/orm/blob/5c9c31b33539ba5da7e29707b9534fa33a591f3b/docs/architecture%20docs/patterns/capability-gating.md
[merging]: https://github.com/prisma/orm/blob/5c9c31b33539ba5da7e29707b9534fa33a591f3b/docs/architecture%20docs/patterns/declaration-merging-registries.md
[no-target-branches]: https://github.com/prisma/orm/blob/5c9c31b33539ba5da7e29707b9534fa33a591f3b/.agents/rules/no-target-branches.mdc
[framework-rule]: https://github.com/prisma/orm/blob/5c9c31b33539ba5da7e29707b9534fa33a591f3b/.agents/rules/never-change-the-framework-domain.mdc
[public-surface-adr]: https://github.com/prisma/orm/blob/5c9c31b33539ba5da7e29707b9534fa33a591f3b/docs/architecture%20docs/adrs/ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md
[cli-adr]: https://github.com/prisma/orm/blob/5c9c31b33539ba5da7e29707b9534fa33a591f3b/docs/architecture%20docs/adrs/ADR%20150%20-%20Family-Agnostic%20CLI%20and%20Pack%20Entry%20Points.md
