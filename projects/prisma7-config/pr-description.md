## Overview

Give Prisma 7 its own canonical config filename so Prisma 7 and Prisma 8 can coexist during migration. Automatic discovery now prefers `prisma7.config.*`, while existing `prisma.config.*` projects continue to work through a quiet compatibility fallback.

## Changes

- Prefer the complete `prisma7.config.{js,ts,mjs,cjs,mts,cts}` family at the project root, then `.config/prisma7.*`, before invoking legacy discovery. Explicit `--config` paths remain authoritative, and relative schema, migration, Typed SQL, and view paths still resolve from the selected file.
- Treat a discovered Prisma 7 config as authoritative: load or validation failures report that file and stop instead of falling through to a valid legacy config. Legacy fallback occurs only when no versioned candidate exists and adds no warning beyond the existing loaded-file diagnostic.
- Reuse the supported JavaScript/TypeScript selection policy for bootstrap project detection and seed inspection, including legacy flat and `index.*` locations and ordering, while preserving `package.json` seed precedence. Do not add legacy JSON, JSONC, JSON5, YAML, YML, or TOML candidates.
- Make both `prisma init` and `prisma7 init` generate `prisma7.config.ts` with their identity-appropriate config imports, and update completion, help, initialization output, and actionable CLI guidance to teach the versioned filename.
- Extend the packed Prisma 7 compatibility E2E to prove precedence, hard-failure behavior, quiet fallback, and init output through both installed entrypoints: `.bin/prisma7` and the packed transitive `prisma` CLI entry.

## Why

Prisma 7 and Prisma 8 cannot safely auto-discover the same filename when their config contracts may differ. A versioned namespace prevents accidental cross-version loading, while absence-only, warning-free fallback keeps existing Prisma 7 projects working unchanged.

## Scope

This PR is limited to Prisma 7 config discovery, bootstrap inspection of supported JavaScript/TypeScript candidates, init output, concrete filename guidance, and compatibility coverage. It does not add bootstrap support for legacy JSON/JSONC/JSON5/YAML/YML/TOML configs, implement or parse Prisma 8 config, convert config contents, add legacy-fallback warnings, change explicit `--config` semantics, or rename other Prisma conventions.
