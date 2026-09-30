# TypeScript module settings for Prisma 8 projects

Which `tsconfig.json` settings a Prisma 8 project needs, which ones work for which kind of project, and what `prisma orm init` writes. Guides that show a tsconfig for a Prisma 8 project, including the Prisma ORM 7 to 8 upgrade guides, should follow this page.

## What Prisma 8 requires

- **An ESM-capable `module` setting.** The `@prisma/orm-*` packages ship ES modules only; every export is an `.mjs` file.
- **`resolveJsonModule: true`.** The scaffolded `db.ts` imports the emitted `contract.json`.
- **The import attribute, where the file is an ES module.** `db.ts` imports the contract with `with { type: 'json' }`. TypeScript accepts that attribute only when `module` is `esnext`, `node18`, `node20`, `nodenext`, or `preserve`, and only from TypeScript 5.3.
- **The emitted declarations in `include`,** so `contract.d.ts` is part of the program.

Prisma 8 does not require `NodeNext`. Under `"module": "NodeNext"` with `"type": "module"` in `package.json`, TypeScript requires a `.js` extension on every relative import, because Node's ESM loader requires one at runtime. That is Node's rule, and it only matters to projects that compile with `tsc` and run the output with plain `node`.

## Which settings to use

| Project | Settings | Notes |
| --- | --- | --- |
| Already on an ESM-capable `module` | Keep it; add `resolveJsonModule` and the `include` entry | Nothing else changes. |
| CommonJS, staying CommonJS | `"module": "nodenext"` and `resolveJsonModule`; `db.ts` imports the JSON without the `with { type: "json" }` attribute | No `"type": "module"`, no `.js` extensions, no import attribute. The attribute-free import works only because `nodenext` emits `db.ts` as CommonJS here; a file emitted as an ES module needs the attribute. |
| Running through `tsx`, `vite`, `next`, `esbuild`, or another bundler | `"module": "preserve"`, `"moduleResolution": "bundler"`, `resolveJsonModule` | Accepts extensionless imports and the import attribute. Needs TypeScript 5.4 or later, the release that added `preserve`. This is what `prisma orm init` writes. |
| Compiled with `tsc` and run with plain `node` as ES modules | `"module": "NodeNext"` | Every relative import needs its `.js` extension. |

## What `prisma orm init` writes

- It merges `module: 'preserve'`, `moduleResolution: 'bundler'`, and `resolveJsonModule: true` into an existing `tsconfig.json`, and adds `node` to `compilerOptions.types` while keeping the entries already there, so `process.env` typechecks in a project with an explicit `types` list (`packages/1-framework/3-tooling/cli/src/commands/init/templates/tsconfig.ts`). It does this whatever the project's current `module` setting is, and reports only that it updated the file.
- It scaffolds `db.ts` with the `with { type: 'json' }` import (`templates/code-templates.ts`).
- When `package.json` declares a `"type"` other than `"module"`, it keeps the user's value and warns that `db.ts` will not load under it (`commands/init/hygiene-package-scripts.ts`). For a CommonJS project, the attribute-free import from the table above would load, because the file runs as CommonJS; Node requires the attribute when the file runs as an ES module.

## How the CommonJS option was verified

Tested on Node 24.13 with TypeScript 5.9.3 against the workspace build:

- At runtime, a plain `.cjs` file can `require("./contract.json")` and `require("@prisma/orm-postgres/runtime")`, and `postgres({ contractJson, url })` constructs the client. Node's `require(esm)` loads the ESM-only package because it has no top-level `await`.
- For types, a `.cts` file, or a `.ts` file in a package without `"type": "module"`, that imports `@prisma/orm-postgres/runtime` and `./contract.json` typechecks under `"module": "nodenext"` with no import attribute and no `.js` extensions.
- `"module": "node16"` rejects the same file with TS1479, and `"moduleResolution": "node10"` cannot resolve the package at all.
