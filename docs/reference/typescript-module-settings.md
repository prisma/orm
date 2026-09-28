# TypeScript module settings for Prisma 8 projects

Which `tsconfig.json` settings a Prisma 8 project needs, which ones work for which kind of project, and what `prisma orm init` writes. Guides that show a tsconfig for a Prisma 8 project, including the Prisma ORM 7 to 8 upgrade guides, should follow this page.

## What Prisma 8 requires

- **An ESM-capable `module` setting.** The `@prisma/orm-*` packages ship ES modules only; every export is an `.mjs` file.
- **`resolveJsonModule: true`.** The scaffolded `db.ts` imports the emitted `contract.json`.
- **The import attribute, where the file is an ES module.** `db.ts` imports the contract with `with { type: 'json' }`. TypeScript accepts that attribute only when `module` is `esnext`, `node18`, `node20`, `nodenext`, or `preserve`, and only from TypeScript 5.3.
- **The emitted declarations in `include`,** so `contract.d.ts` is part of the program.
- **A type import path that resolves under every `module` setting.** `db.ts` imports the `Contract` type from `./contract.d.js`, which TypeScript maps to `contract.d.ts`. The extensionless `./contract.d` fails with TS2307 under `nodenext`, `node18`, and `node20` whenever the file is an ES module. `./contract.js` resolves under every setting when the contract is PSL, but with TypeScript authoring a `contract.ts` sits beside `contract.d.ts` and `./contract.js` resolves to the source file, whose export is `contract`, so it fails with TS2724. `./contract.d.ts` needs `allowImportingTsExtensions`.

Prisma 8 does not require `NodeNext`. Under `"module": "NodeNext"` with `"type": "module"` in `package.json`, TypeScript requires a `.js` extension on every relative import, because Node's ESM loader requires one at runtime. That is Node's rule, and it only matters to projects that compile with `tsc` and run the output with plain `node`.

## Which settings to use

| Project | Settings | Notes |
| --- | --- | --- |
| Already on an ESM-capable `module` | Keep it; add `resolveJsonModule` and the `include` entry. `moduleResolution` must be `bundler` (with `esnext` or `preserve`) or the matching `node*` value; `node` and `node10` cannot resolve the packages (TS2307) | Nothing else changes. A project on `nodenext`, `node18`, or `node20` without `"type": "module"` is CommonJS and follows the next row. |
| CommonJS, staying CommonJS | `"module": "nodenext"` and `resolveJsonModule`; `db.ts` imports the JSON without the `with { type: "json" }` attribute | No `"type": "module"`, no `.js` extensions, no import attribute. The attribute-free import works only because `nodenext` emits `db.ts` as CommonJS here; keeping the attribute fails with TS2856. `node20` behaves the same; `node18` rejects the ESM-only package from CommonJS with TS1479. |
| Running through `tsx`, `vite`, `next`, `esbuild`, or another bundler | `"module": "preserve"`, `"moduleResolution": "bundler"`, `resolveJsonModule` | Accepts extensionless imports and the import attribute. Needs TypeScript 5.4 or later, the release that added `preserve`. This is what `prisma orm init` writes. |
| Running the `.ts` files directly with `node` (type stripping) | Either of the two pairs above plus `"allowImportingTsExtensions": true` | Node needs the `.ts` extension on every relative import and keeps the `with { type: "json" }` attribute. `nodenext` with `rewriteRelativeImportExtensions` also typechecks. |
| Compiled with `tsc` and run with plain `node` as ES modules | `"module": "NodeNext"` (or `node18`, `node20`) | Every relative import needs its `.js` extension. |

## What `prisma orm init` writes

- It merges `module: 'preserve'`, `moduleResolution: 'bundler'`, and `resolveJsonModule: true` into an existing `tsconfig.json`, and adds `node` to `compilerOptions.types` while keeping the entries already there, so `process.env` typechecks in a project with an explicit `types` list (`packages/1-framework/3-tooling/cli/src/commands/init/templates/tsconfig.ts`). It does this whatever the project's current `module` setting is, and reports only that it updated the file.
- It scaffolds `db.ts` with the `with { type: 'json' }` import and the `./contract.d.js` type import (`templates/code-templates.ts`). Releases up to 8.0.0-rc.17 wrote `./contract.d`, which fails under `nodenext`, `node18`, and `node20` as ES modules.
- When `package.json` declares a `"type"` other than `"module"`, it keeps the user's value and warns that `db.ts` will not load under it (`commands/init/hygiene-package-scripts.ts`). For a CommonJS project, the attribute-free import from the table above would load, because the file runs as CommonJS; Node requires the attribute when the file runs as an ES module.

## How the CommonJS option was verified

Tested on Node 24.13 with TypeScript 5.9.3 against the workspace build:

- At runtime, a plain `.cjs` file can `require("./contract.json")` and `require("@prisma/orm-postgres/runtime")`, and `postgres({ contractJson, url })` constructs the client. Node's `require(esm)` loads the ESM-only package because it has no top-level `await`.
- For types, a `.cts` file, or a `.ts` file in a package without `"type": "module"`, that imports `@prisma/orm-postgres/runtime` and `./contract.json` typechecks under `"module": "nodenext"` with no import attribute and no `.js` extensions.
- `"module": "node16"` rejects the same file with TS1479, and `"moduleResolution": "node10"` cannot resolve the package at all.

## How the full matrix was verified

Tested on Node 26.8 with TypeScript 5.9.3 and 7.0.2 (both agree on every row) against `@prisma/orm-postgres@8.0.0-rc.12`, using the `db.ts`, `contract.json`, and `contract.d.ts` that `prisma orm init` writes. `tsc --noEmit` results:

| `module` | `moduleResolution` | `package.json` `type` | `with` attribute | `Contract` import | Result |
| --- | --- | --- | --- | --- | --- |
| `esnext` | `bundler` | `module` | yes | `./contract.d` or `./contract.js` | pass |
| `preserve` | `bundler` | `module` or none | yes | `./contract.d` or `./contract.js` | pass |
| `nodenext` | `nodenext` or unset | `module` | yes | `./contract.d.js` (or `./contract.js` without a `contract.ts` sibling) | pass |
| `nodenext` | `nodenext` | `module` | yes | `./contract.d` | TS2307 |
| `nodenext` | `nodenext` | none or `commonjs` | no | `./contract.d` or `./contract.js` | pass |
| `nodenext` | `nodenext` | none | yes | any | TS2856 |
| `node18` | unset | none | no | any | TS1479 |
| `node20` | unset | none | no | `./contract.d` or `./contract.js` | pass |
| `node18`, `node20` | unset (or `nodenext` for `node18`) | `module` | yes | `./contract.d.js` | pass |
| `node18`, `node20` | unset | `module` | yes | `./contract.d` | TS2307 |
| `node16` | unset | `module` | yes | any | TS2823 |
| `es2022` | `bundler` | `module` | yes | any | TS2823 |
| `commonjs` | `node` | none | either | any | TS2307 on the package |
| unset | unset | `module` | yes | any | TS5070 (`resolveJsonModule` needs a non-classic resolution) |
| `esnext` | `node` or `node10` | `module` | yes | any | TS2307 on the package |
| `nodenext` or `preserve` | matching | `module` | yes | `./contract.d.js`, with `allowImportingTsExtensions` | pass (type stripping) |

The `Contract` type import, checked in every setting above both with and without a `contract.ts` beside `contract.d.ts` (TypeScript authoring): `./contract.d.js` passes every cell. `./contract.js` passes every cell without the sibling and fails every cell with it (TS2724, it resolves to `contract.ts`). `./contract.d` fails under `nodenext`, `node18`, and `node20` as ES modules regardless of the sibling.

Runtime, each constructing the client without a database connection:

- `tsx` with `preserve`/`bundler` and extensionless imports, with and without `"type": "module"`.
- `tsc` then `node dist` for the CommonJS `nodenext` case, and `ts-node` on the same source.
- `tsc` then `node dist` for the ES-module `nodenext` case with `.js` imports.
- `node src/main.ts` with Node's type stripping, `.ts` extensions on relative imports, and the `with` attribute.
