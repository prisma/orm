# Design: stating the database version in a Prisma schema contract

Status: proposal, 2026-11-26. Not built. The plan requires this design before the project closes.

## The problem

A contract written in TypeScript states its own requirements:

```ts
export const contract = defineContract({
  version: 17,
  capabilities: [neonAdapter.capabilities, neonHttp.capabilities],
  // models…
});
```

A contract written in the Prisma schema language cannot. Its version and capabilities are in the config's contract entry, beside the path to the file:

```ts
export default defineConfig({
  contract: { path: './prisma/contract.prisma', version: 17 },
});
```

That is a compromise. The contract file should state what the contract requires. It also has a practical cost: `orm init` writes the config from a template in the framework, which knows nothing of a target's options, so it cannot write the version there.

## Proposal

A `database` block at the top of the contract file:

```prisma
database {
  version = 17
}
```

With the capabilities of a connection other than the default one:

```prisma
database {
  version      = 17
  capabilities = [sql.interactiveTransactions]
}
```

- **`version`** is the value the config option takes today. It is required when the block is present.
- **`capabilities`** is optional. It lists capability keys the connection provides. A contract file cannot import a driver, so the keys are written by hand, and the language server completes and checks them against the keys the configured components know. When it is omitted, the facade's default list applies, as today. When it is stated, it replaces the default, as today.
- **One block per contract.** A second block is an error.

## How it is evaluated

The interpreter cannot evaluate a version: which capabilities PostgreSQL 17 provides is the target's knowledge. So it does not. The contract source provider is already given the target by the facade. The facade gives it one more thing: a function from `{ version, capabilities }` to a resolved capability list, which for PostgreSQL is `postgresContractCapabilities`. The interpreter reads the block as syntax, hands its values to that function, and gets back the list it already works with.

- The interpreter still receives one capability list and never interprets a version.
- A version the target does not support is reported at the block's position in the file, with the target's own message.
- A target that gives the provider no such function does not accept the block, and says so.

## The config options

They keep working until the next major version, as the compatibility policy requires.

- Stated in the file only, or in the config only: that value is used.
- Stated in both, with the same values: accepted.
- Stated in both, with different values: an error that names both places. Neither silently wins.

`orm init` writes the block into the starter contract, which the target package's own template produces, so the framework's config template needs no change. Writing the version that `--probe-db` reads still needs the probe to run before the starter contract is written.

## Alternatives

- **An attribute on a `datasource` block, as in Prisma 7 (`datasource db { provider = "postgresql" }`).** A Prisma 8 contract names no target and holds no connection settings; a `datasource` block would suggest it does.
- **A comment pragma (`// database 17`), beside the existing `// use prisma-8`.** A requirement of the contract should be syntax the formatter, the language server and the printer all understand, not a comment.
- **`version` as an attribute of `types { }` or of a namespace.** Neither is about the database as a whole.
- **Naming a driver (`driver = "neon-http"`).** The file would need a registry of driver names. A list of capability keys needs none, and says what the contract requires.

## Open points

- The block's name. `database` says what the version is the version of. `requires` would say what the block is for, and leaves room for requirements that are not about the database.
- Whether `contract infer` writes the block from the database it reads.
- How the printer orders the block relative to `types { }`.
</content>
