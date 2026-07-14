# Brief: D4 — kit combinators `str(value)` + `json()` for the Mongo index surface

> Fresh implementer. Slice `mongo-attributes`, branch `tml-2956-mongo-attributes`. Do NOT push or touch GitHub. ONE signed commit. Tests-first. **psl-parser (kit) only — no Mongo/SQL package changes.**

## ⛔ TOOLING RULE (operator standing order — non-negotiable)
**NEVER call the regex / codebase-search MCP tool — it HANGS and deadlocks.** SEARCH-FREE brief. Use `rg`/`grep` in the **terminal** only; reading named files is fine. If under-specified, STOP and report.

## Why
The Mongo `@@index`/`@@unique`/`@@textIndex` argument surface (migrated in later dispatches) needs two leaf combinators the kit lacks:
- **`str(value)`** — a pinned string literal, for the index `type` set (`type: "hashed"`, `"2dsphere"`, `"2d"`, `"text"` — digit-leading, so they can't be bare identifiers). The ADR calls for this alongside `num(value)`/`identifier(name)`.
- **`json()`** — reads an opaque JSON **object** from a quoted JSON string (`filter: "{\"status\": \"active\"}"`, `weights: "{\"title\": 10}"`). ADR § "Surface policy" names this the one text-encoded exception. It replaces the interpreter's `parseJsonArg`.

The field-element grammar (`name(sort: Desc)`, `wildcard(scope)`) needs **no** new combinator — it composes from the existing `funcCall(name, sig)` dynamically over the model's fields (done in D5). This dispatch is just the two leaves.

## Part A — `str(value)` overload (`combinators/str.ts`)
Today `str()` returns `ArgType<string>` (any string literal). Add a pinned overload, mirroring `combinators/num.ts` (`num()` / `num(value)`) exactly:
```ts
export function str(): ArgType<string>;
export function str(value: string): ArgType<string>;
export function str(value?: string): ArgType<string> {
  return {
    kind: 'str',
    label: value === undefined ? 'string' : JSON.stringify(value),
    parse: (arg, ctx): Result<string, readonly PslDiagnostic[]> => {
      if (arg instanceof StringLiteralExprAst) {
        const parsed = arg.value();
        if (parsed !== undefined && (value === undefined || parsed === value)) return ok(parsed);
      }
      const message = value === undefined ? 'Expected a string literal' : `Expected ${JSON.stringify(value)}`;
      return notOk([leafDiagnostic(ctx, arg, message)]);
    },
  };
}
```
(The unpinned `str()` behaviour is unchanged — all existing callers keep working. Use `JSON.stringify(value)` for the label/message so the quotes show, e.g. `Expected "hashed"`.)

## Part B — `json()` combinator (new file `combinators/json.ts`)
Reads a quoted JSON string literal and parses it to a JSON **object**. Behaviour matches the interpreter's current `parseJsonArg` (decoded string → `JSON.parse` → must be a non-array object):
```ts
import type { PslDiagnostic } from '@prisma-next/framework-components/psl-ast';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { StringLiteralExprAst } from '../../syntax/ast/expressions';
import type { ArgType } from '../types';
import { leafDiagnostic } from './diagnostic';

// Reads an opaque JSON object from a quoted JSON string — the ADR's one text-encoded surface
// exception (e.g. a Mongo index `filter` / `weights`). The string is decoded by the parser, then
// JSON-parsed; a non-object (array/scalar) or invalid JSON is a diagnostic.
export function json(): ArgType<Record<string, unknown>> {
  return {
    kind: 'json',
    label: 'JSON object',
    parse: (arg, ctx): Result<Record<string, unknown>, readonly PslDiagnostic[]> => {
      if (!(arg instanceof StringLiteralExprAst)) {
        return notOk([leafDiagnostic(ctx, arg, 'Expected a JSON object string')]);
      }
      const raw = arg.value();
      if (raw !== undefined) {
        try {
          const parsed: unknown = JSON.parse(raw);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            return ok(blindCast<Record<string, unknown>, 'JSON.parse of a validated non-array object literal is a string-keyed record'>(parsed));
          }
        } catch {
          // fall through to the diagnostic
        }
      }
      return notOk([leafDiagnostic(ctx, arg, 'Expected a valid JSON object')]);
    },
  };
}
```
Import `blindCast` from `@prisma-next/utils/casts` (the one justified narrow cast — `JSON.parse` returns `any`/`unknown`; narrowing a validated object to `Record<string, unknown>` needs it). No bare `as`.

## Part C — export `json`
Add `export { json } from '../attribute-spec/combinators/json';` to `packages/1-framework/2-authoring/psl-parser/src/exports/index.ts` (alphabetical, near `int`/`identifier`). `str` is already exported (the overload needs no export change).

## Tests — `test/attribute-spec-combinators.test.ts`
Add focused unit tests (tests-first):
- **`str(value)`**: `str('hashed')` accepts `"hashed"` → `'hashed'`; rejects `"2dsphere"` and a bare identifier and a number; the unpinned `str()` still accepts any string. (Mirror the existing `num(value)` test block's structure.)
- **`json()`**: accepts `"{\"a\": 1}"` → `{ a: 1 }`; rejects a non-object JSON string (`"[1,2]"`, `"5"`), an invalid-JSON string, and a bare identifier / number literal.
Use the existing `argOf(...)` helper in that test file to build the expression + ctx.

## Scope
**In:** `str(value)` overload; the `json()` combinator + its export; their unit tests. **Out:** any Mongo/SQL package change; the index migration (D5); wiring `json()` into any spec.

## Constraints
No `any` (use `unknown` + the single justified `blindCast` in `json`); no other bare `as`; no file-ext imports; never suppress biome; `pnpm` not `npm`. Commit once: `git commit -s` (DCO), explicit staging, no `--amend`, NO push, no GitHub. Read-only on `projects/**`, `.agents/**`.

## Gates (all green, in order)
1. `pnpm --filter @prisma-next/psl-parser build && typecheck && test`
2. `pnpm --filter @prisma-next/sql-contract-psl typecheck && test` and `pnpm --filter @prisma-next/mongo-contract-psl typecheck && test` (must stay green with NO edits — the `str()` overload + new `json` export are additive)
3. `pnpm lint:deps` (0) and `pnpm lint:framework-vocabulary` (bump threshold to the exact new count ONLY if the two combinators' comments move it; prefer rewording)

## Report back
The `str(value)` overload + `json()` shape; confirmation the unpinned `str()` and all existing psl-parser/sql/mongo tests stay green with no edits; how you handled the `json` cast (the single `blindCast`); the new unit tests; all gate results; the commit SHA. If `arg.value()` on a `StringLiteralExprAst` does NOT return the JSON-decoded (unescaped) content — so `JSON.parse` would need different pre-processing — STOP and report what it returns.
