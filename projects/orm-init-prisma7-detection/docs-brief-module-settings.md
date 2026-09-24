# Docs brief: stop steering upgraders to `NodeNext`

Target: the Prisma 7 to 8 guides in `prisma/web`, starting with `apps/docs/content/docs/guides/upgrade-prisma-orm/postgresql.mdx`, section 2.6 "Include the generated types". The same fix applies to any page that shows a tsconfig for a Prisma 8 project.

## The problem

A user reported that after following the guide they had to rewrite every relative import in their project to end in `.js`. The cause is the tsconfig the guide's example project uses: `"module": "NodeNext"` with `"type": "module"` in `package.json`, compiled with `tsc` and run with plain `node`. Under that setting TypeScript requires the file extension on every relative import, because Node's ESM loader requires it at runtime. This is Node's rule, not Prisma's, but the guide leads people into it.

Prisma 8 does need an ESM-capable `module` setting for two reasons: the ORM package ships ESM only, and `db.ts` imports `contract.json` with `with { type: "json" }`, which TypeScript accepts only under `esnext`, `node18`, `node20`, `nodenext`, or `preserve`. It does not need `NodeNext` specifically.

## What the guide should say instead

Replace the current 2.6 text with guidance in this order:

1. **Already on an ESM-capable `module` setting?** Keep it. Add `"resolveJsonModule": true` and the generated declarations to `include`. Nothing else changes.
2. **On `commonjs`?** The smallest change is `"module": "preserve"` and `"moduleResolution": "bundler"`, plus `resolveJsonModule` and the `include` entry. This accepts extensionless imports and the JSON import attribute, so no import rewrites. It works when the project runs through `tsx`, `vite`, `next`, `esbuild`, or any bundler, which is most projects. These are the exact options `prisma orm init` writes into an existing tsconfig today.
3. **Compile with `tsc` and run with plain `node`?** Then `NodeNext` is the right setting and Node needs the `.js` extension on every relative import. Say this plainly in one sentence and link to the TypeScript docs on it. Do not present it as the default path.

Keep the existing note that import attributes need TypeScript 5.3 or later.

## The example project

`prisma/prisma8-and-7-example` uses `NodeNext` with `tsc` and `node dist/...`. That is why it needs `.js` imports. Either switch it to `preserve` plus `bundler` with `tsx` for `start`, or keep it and add a README sentence explaining that the extensions are a consequence of that choice. The guide should not inherit the example's tsconfig without explaining it.

## Verified: CommonJS projects need no module change

Tested 2026-09-14 on Node 24.13 with TypeScript 5.9.3 against the workspace build:

- At runtime, a plain `.cjs` file can `require("./contract.json")` and `require("@prisma/orm-postgres/runtime")`, and `postgres({ contractJson, url })` constructs the client. Node's `require(esm)` handles the ESM-only package because it has no top-level await.
- For types, a `.cts` file (or a `.ts` file in a package without `"type": "module"`) that does `import postgres from "@prisma/orm-postgres/runtime"` and `import contractJson from "./contract.json"` typechecks clean under `"module": "nodenext"`. No import attribute, no `.js` extensions, no `type: module`.
- `"module": "node16"` rejects it (TS1479), and `"moduleResolution": "node10"` cannot resolve the package at all. So the guidance for CommonJS is exactly: `nodenext` plus `resolveJsonModule`, and a `db.ts` that imports the JSON without the `with { type: "json" }` attribute.

This becomes option 2 in the list above, ahead of `preserve` plus `bundler`: a CommonJS project keeps CommonJS and changes two tsconfig lines. The `preserve` plus `bundler` option stays for projects that want to move to ESM and run through a bundler or `tsx`.

Note for engineering, not for the docs page: `orm init` currently scaffolds `db.ts` with the import attribute and warns when `package.json` is not `"type": "module"`. Init could instead write the attribute-free import for CommonJS projects, since that form works in both.

## Facts behind this brief

- `orm init` tsconfig defaults: `packages/1-framework/3-tooling/cli/src/commands/init/templates/tsconfig.ts` sets `module: 'preserve'`, `moduleResolution: 'bundler'`, `resolveJsonModule: true`, and merges them into an existing tsconfig.
- `db.ts` template: `packages/1-framework/3-tooling/cli/src/commands/init/templates/code-templates.ts` imports `./contract.json` with `with { type: 'json' }`.
- `@prisma/orm-postgres` exports only `.mjs` files.
- Example project at tag `step-2`: `tsconfig.json` uses `NodeNext`, `package.json` has `"type": "module"`, `"start": "node dist/src/server.js"`, and `src/app.ts` imports end in `.js`.
