# Review: how capabilities are named, declared and reported, compared with dependency managers

Written 2026-11-27, at the operator's request, before the client warning's wording is settled. Read for it: the glossary entry "Capability", the capability ownership rule, ADR 031, ADR 065, ADR 117, ADR 207 and ADR 335, and every source file that declares a capability or reports one missing.

## Our model, stated as a dependency manager would state it

A capability is a fact that one part of the stack provides and the contract requires. That is the model of RPM and OSGi exactly, and both call the thing a "capability":

| System | Provider side | Requirer side | Environment requirement |
| --- | --- | --- | --- |
| RPM | `Provides: <capability>` | `Requires: <capability>` | (same mechanism) |
| OSGi | `Provide-Capability` | `Require-Capability` | `osgi.ee` (the Java version) |
| Debian | `Provides:` (virtual packages) | `Depends:` | (same mechanism) |
| npm | the installed package | `dependencies`, `peerDependencies` | `engines: { node: ">=18" }` |
| RubyGems / Bundler | the installed gem | `add_dependency`, `gem` in the Gemfile | `required_ruby_version` |
| Cargo | `[features]` | `[dependencies]`, `required-features` | `rust-version` (a minimum) |
| Prisma 8 today | adapter's and driver's `capabilities`; the target's table | contract's `capabilities` | `databaseVersion` |

So the word "capability" is conventional. What every other system does and we do not is **name the direction**: provides versus requires. We use the bare word `capabilities` on both sides.

## Findings

### 1. The contract's requirements are named as if they were the contract's abilities

`contract.json` has `capabilities`. Read cold, "the contract's capabilities" means what the contract can do, as "the adapter's capabilities" means what the adapter can do. Every system above names the requirer side with "requires" or "depends". The glossary and the ownership rule already have to tell readers that the contract's list is "requirements"; the name does not.

**Recommendation:** rename the contract's field to `requiredCapabilities`. Keep `capabilities` on the providers (adapter, driver, the target's table), where "what it is capable of" is the right reading. This changes the stored format of `contract.json`, so it must land before 8.0, and it should be raised with the stored-format work on contract hashes. Every fixture and signed database changes in this pull request anyway.

### 2. The input named `capabilities` does two jobs, and is named for neither

The `capabilities` option of `defineContract` and the config's contract entry is documented as "the capabilities the connection provides". It is also how an author turns a database capability off (`{ sql: { jsonAgg: false } }`), which is not a fact about the connection at all. Its value then becomes part of the contract's requirements. So one option is a provider statement, an opt-out, and a source of requirements at once, under a name that says none of those.

Cargo separates these into `default-features = false` and `features = [...]`; Babel's preset-env separates `targets` (the environment) from `exclude` (opt-outs).

**Recommendation, for discussion:** treat `databaseVersion` and the connection as one statement of the environment the contract is written for, as npm's `engines` and Babel's `targets` do, and the opt-out as a separate option. For example `connection: postgresDriverCapabilities` (replacing the default) and `disabledCapabilities: ['sql.jsonAgg']`. This reshapes a public option, which ADR 335 settled as one list, so it reverses part of that decision.

### 3. `databaseVersion` means a minimum but reads as an exact version

A contract for 17 is signed against 17 and 18 alike, and newer servers are treated as the newest row. That is Cargo's `rust-version` or RubyGems' `required_ruby_version`: the oldest version the project supports. The doc comment says "the PostgreSQL version the database runs", which is the exact-version reading. The name is defensible (Cargo uses the bare word too). The doc comment and the glossary should say "the oldest PostgreSQL version the database may run".

### 4. Our messages leave out where a requirement came from

Package managers report the chain that produced a requirement, because the user rarely added it directly:

- npm `ERESOLVE`: "Could not resolve dependency: peer react@"^17" from foo@1.0.0 … foo@"*" from the root project".
- Bundler: "In Gemfile: rails was resolved to 7.0, which depends on activesupport (= 7.0)".
- apt: "x : Depends: y (>= 2) but 1 is to be installed".

Our client warning says only that the contract requires the capability. This is the gap the operator named: the user may never have written a capabilities list, because the flag came from the default connection list. `contract.json` records no origin for a flag, so the client cannot say where it came from.

**Options, for discussion:**

- **The client facade names the default.** The PostgreSQL client knows `defaultConnectionCapabilities` and its own driver. When a missing flag is one the default list provides, it can say so: "Your contract requires sql.interactiveTransactions because it was written for the default PostgreSQL driver, which provides it. This client's driver does not." No stored-format change, and it covers the common case. A flag outside the default list keeps the general text.
- **The contract records each flag's origin.** Every message could then name it. This changes the stored format for a message, and the origin of a requirement is not part of what the contract promises.

The first is the cheaper and is enough for the case we know about.

### 5. The remedy names a concept users do not have

"Install a component that provides them" uses "component", which is our framework's word ([Framework Component](../../docs/glossary.md#framework-component)). Package managers name the kind of thing to install, or the exact package: npm says "install peer dependencies", Cargo says "consider enabling them by passing `--features="y"`". Users know "adapter", "driver" and "extension". The client knows which of the three is missing a flag only by elimination, but the kinds are few enough to name.

### 6. Missing-capability errors use six phrasings

| Where | Phrasing |
| --- | --- |
| ORM client (`ORM.CAPABILITY_MISSING`) | `requires contract capability "returning"` |
| ORM client, other calls | `requires capability postgres.distinctOn` |
| Prisma schema interpreter | `the contract's capabilities for target "postgres" do not include "sql.scalarList"` |
| PostgreSQL renderer, locking | `The contract does not list capability ${capability}` |
| SQLite migrations | `The "checkConstraint" capability is Postgres-only` |
| Shared remedy, `missingCapabilityRemedy()` | `A contract lists the capabilities its database and connection provide` |

The keys are sometimes namespaced and sometimes not, and sometimes quoted and sometimes not. The shared remedy describes the contract's list as what the database "provides", the reading finding 1 is about, and it is a statement with no action in it. Package managers use one form everywhere: "<requirer> requires <name>, which <provider> does not provide". **Recommendation:** one form, with the namespaced key in backticks, and one remedy that says where the user states the environment.

### 7. Stale text this pull request should fix

These describe the runtime merging the stack's capabilities into the contract, which this pull request removed:

- [sql-orm-client README](../../packages/3-extensions/sql-orm-client/README.md), the `onConflict: 'skip'` section: "The runtime adds the adapter's capabilities to the contract, so a contract emitted before the adapter reported a key still has it when the call runs."
- [contract-definition.ts](../../packages/2-sql-family/2-authoring/contract-ts/src/contract-definition.ts), [contract-dsl.ts](../../packages/2-sql-family/2-authoring/contract-ts/src/contract-dsl.ts) and [contract-types.ts](../../packages/2-sql-family/2-authoring/contract-ts/src/contract-types.ts): doc comments saying the capabilities join "as `prisma contract emit` and the runtime join them".

### 8. "Capability" also means an optional family feature

ADR 207 uses "capability" for an optional method on a family instance (`SchemaViewCapable`, `PslContractInferCapable`), which is a different concept. One user-facing message carries it: `contract infer`'s refusal says "The configured family does not implement the PslContractInferCapable capability". Not this project's scope; recorded in [deferred.md](deferred.md).

## What already matches the convention

- **The database refusal** has the shape of RubyGems' and Cargo's environment errors: what is required, then what is there. Cargo: "requires rustc 1.70 or newer, while the currently active rustc version is 1.65". Ours: "requires database capabilities first available in PostgreSQL 17 (…), but this database runs PostgreSQL 15.4".
- **The ownership model** (each fact declared by the component that knows it) is RPM's and OSGi's: a provider declares what it provides, and a resolver matches requirements against providers.
- **Stating the environment, not the features,** is how npm's `engines`, Cargo's `rust-version` and Babel's `targets` work.
