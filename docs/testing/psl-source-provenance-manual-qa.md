# Manual QA — PSL source provenance

> **Be the PSL author and extension author.** Drive the live parser, provider, and editor-facing APIs with real temporary files and live text buffers, then judge whether filenames and locations point at the source the user actually edited.
>
> **Out of scope of this script.** Do not re-run unit suites, lint, typecheck, or fixture regeneration here. Those are CI gates recorded separately. This script exercises user-observable source provenance and diagnostic quality only.
>
> **Spec:** source provenance design in ADR 253 and the parser README public API.
> **Plan:** not linked here because the implementation plan is transient.
> **PR:** fill in when the PR exists.

## Table of contents

| # | Scenario | What it proves | Isolation | Covers |
| - | --- | --- | --- | --- |
| 1 | Emit a malformed copied demo schema | CLI diagnostics name the authored schema file and source-local line | tmpdir | AC-1, AC-3 |
| 2 | Parse live editor text without rereading disk | Editor-facing pipeline uses the provided buffer and URI, not stale disk contents | tmpdir | AC-1, AC-3 |
| 3 | Exercise an extension-style attribute diagnostic | Attribute diagnostics flowing through `AttributeCtx` retain the owning file | tmpdir | AC-1 |
| 4 | Load an unreadable schema path | Read errors report the attempted path before any `SourceFile` exists | tmpdir | AC-1 |
| 5 | Exploratory: provenance edge probes | Probe adjacent malformed and detached-node flows for surprising ownership behaviour | tmpdir | exploratory |

> Scenarios marked as scripted scenarios use temporary directories only. They may read the repository clone and built package outputs, but they must not modify demos, examples, or tracked files.

## Acceptance criteria

- **AC-1:** PSL post-parse diagnostic filenames originate from `SourceFile`; file-read errors may report the attempted input path directly.
- **AC-2:** Coordinate conversion is file-local; editor semantic-token style consumers use a `SourceFile` resolved through `PslSources`.
- **AC-3:** Required filenames, root ownership, and single-file behaviour remain observable; there is no fallback to an unrelated file.

## Pre-flight

1. Start from a clean worktree: `git status --short` prints nothing except files created by the QA runner in its own scratch area.
2. Build the packages the scenarios import if the handoff did not already do so: `pnpm --filter @internal/psl-parser build && pnpm --filter @internal/language-server build && pnpm --filter @internal/sql-contract-psl build && pnpm --filter @internal/cli build`.
3. Create a scratch root: `export PN_QA_TMP="$(mktemp -d -t psl-source-provenance-qa-XXXXXX)"`.
4. Set `REPO_ROOT` to this repository root if the runner is not already there: `export REPO_ROOT="$(pwd)"`.
5. When the run is complete, remove the scratch root with `rm -rf "$PN_QA_TMP"`. Each scenario also has a restore note for its own scratch directory.

## Scenario 1 — Emit a malformed copied demo schema

**What you're proving from the user's seat:** A user running the CLI against a PSL file with a syntax error sees diagnostics pointing at the schema file they authored in the scratch project, not at an internal synthetic name or a stale path from the demo source.

**Covers:** AC-1, AC-3

**Isolation:** `tmpdir`

**Oracle:** The diagnostic envelope for a malformed PSL schema must name the scratch `src/prisma/contract.prisma` path and line/column of the malformed declaration. The copied demo is only a source template; no demo path should appear in the reported diagnostic.

**Preconditions:**

- Pre-flight completed.
- `packages/1-framework/3-tooling/cli/dist/bin.mjs` exists from the pre-flight build.

### Steps

1. Create a scratch app by copying the demo, then corrupt only the scratch schema:

   ```bash
   mkdir -p "$PN_QA_TMP/scenario-1"
   cp -R "$REPO_ROOT/examples/prisma-8-demo/." "$PN_QA_TMP/scenario-1/"
   rm -rf "$PN_QA_TMP/scenario-1/node_modules"
   ln -s "$REPO_ROOT/examples/prisma-8-demo/node_modules" "$PN_QA_TMP/scenario-1/node_modules"
   printf '\nmodel Broken {\n  id Int @id\n  name\n}\n' >> "$PN_QA_TMP/scenario-1/src/prisma/contract.prisma"
   ```

2. Run the real CLI from the scratch app:

   ```bash
   cd "$PN_QA_TMP/scenario-1"
   PRISMA_TELEMETRY_DISABLED=1 node "$REPO_ROOT/packages/1-framework/3-tooling/cli/dist/bin.mjs" contract emit --json >out.json 2>err.txt; status=$?; printf 'exit=%s\n' "$status"; cat out.json; cat err.txt
   ```

### What you should see

- The command fails.
- The diagnostic output names `src/prisma/contract.prisma` or the equivalent scratch absolute path.
- The diagnostic points at the appended malformed `name` field line, not at the original demo source path and not at an internal filename.

### Failure modes

- Diagnostic path is missing, synthetic, or points at the repository demo instead of the scratch copy.
- The diagnostic line/column is absent or clearly points at a different declaration.
- The CLI crashes without a structured diagnostic envelope.

### Restore

Remove the copied app when finished if you are not removing the whole scratch root:

```bash
rm -rf "$PN_QA_TMP/scenario-1"
```

## Scenario 2 — Parse live editor text without rereading disk

**What you're proving from the user's seat:** An editor can supply unsaved text for a URI and get diagnostics for that live buffer even when the file on disk contains a clean schema.

**Covers:** AC-1, AC-3

**Isolation:** `tmpdir`

**Oracle:** `runPipeline(filename, text, inputs)` is the editor parse boundary. The `filename` should be preserved as the source filename, while diagnostics should reflect the `text` argument, not bytes read from disk.

**Preconditions:**

- Pre-flight completed.

### Steps

1. Create a clean on-disk schema and run a live-buffer script with different unsaved text:

   ```bash
   mkdir -p "$PN_QA_TMP/scenario-2"
   cat >"$PN_QA_TMP/scenario-2/schema.prisma" <<'PSL'
   model User {
     id Int @id
   }
   PSL
   pnpm --dir "$REPO_ROOT/packages/1-framework/3-tooling/language-server" exec tsx -e '
     import { runPipeline } from "./src/pipeline.ts";
     const filename = process.argv[1]!;
     const unsaved = "model User {\n  id Int @id\n}\n\nmodel User {\n  id Int @id\n}\n";
     const result = runPipeline(filename, unsaved, { scalarTypes: ["String", "Int", "Boolean", "DateTime"], pslBlockDescriptors: {} });
     console.log(JSON.stringify({ filename: result.sourceFile.filename, codes: result.diagnostics.map((diagnostic) => diagnostic.code) }, null, 2));
   ' "$PN_QA_TMP/scenario-2/schema.prisma"
   ```

### What you should see

- The printed filename is the scratch schema path.
- The diagnostic codes include `PSL_DUPLICATE_DECLARATION`, even though the file on disk has only one `User` model.

### Failure modes

- The pipeline reports no duplicate declaration.
- The filename is not the scratch schema path.
- The script reads or mutates the on-disk schema to produce the diagnostic.

### Restore

Remove the scenario scratch directory when finished if you are not removing the whole scratch root:

```bash
rm -rf "$PN_QA_TMP/scenario-2"
```

## Scenario 3 — Exercise an extension-style attribute diagnostic

**What you're proving from the user's seat:** A diagnostic created while interpreting an attribute receives the source file associated with the attribute node, matching how extension authors receive `AttributeCtx` diagnostics.

**Covers:** AC-1

**Isolation:** `tmpdir`

**Oracle:** Attribute interpretation diagnostics must serialize `sourceId` from the `SourceFile` resolved for the attribute node.

**Preconditions:**

- Pre-flight completed.

### Steps

1. Run a direct extension-author-style attribute interpretation probe:

   ```bash
   mkdir -p "$PN_QA_TMP/scenario-3"
   pnpm --dir "$REPO_ROOT/packages/1-framework/2-authoring/psl-parser" exec tsx -e '
     import { modelAttribute, interpretAttribute, nodePslSpan } from "./src/exports/index.ts";
     import { parse } from "./src/parse.ts";
     import { ModelDeclarationAst } from "./src/syntax/ast/declarations.ts";
     const filename = process.argv[1]!;
     const { document, sources } = parse("model User {\n  id Int @id\n\n  @@qa\n}\n", filename);
     const model = [...document.declarations()].find((item) => item instanceof ModelDeclarationAst)!;
     const attribute = [...model.attributes()][0]!;
     const spec = modelAttribute("qa", { documentation: "QA diagnostic probe", refine: (_parsed, ctx, node) => [{ code: "QA_ATTRIBUTE", message: "qa diagnostic", sourceId: ctx.sources.sourceFileFor(node.syntax).filename, span: nodePslSpan(node.syntax, ctx.sources) }] });
     console.log(JSON.stringify(interpretAttribute(attribute, spec, { sources }), null, 2));
   ' "$PN_QA_TMP/scenario-3/extension-author.prisma"
   ```

### What you should see

- The result is `ok: false` with a `_failure` diagnostic whose `code` is `QA_ATTRIBUTE`.
- The diagnostic `sourceId` is `$PN_QA_TMP/scenario-3/extension-author.prisma`.
- Its span points at the `@@qa` attribute, not the model header or a default filename.

### Failure modes

- `sourceId` is missing or different from the supplied filename.
- The diagnostic span points at the wrong syntax node.
- The probe must invent a separate semantic filename unrelated to `ctx.sources.sourceFileFor(node.syntax).filename` to work.

### Restore

Remove the scenario scratch directory when finished if you are not removing the whole scratch root:

```bash
rm -rf "$PN_QA_TMP/scenario-3"
```

## Scenario 4 — Load an unreadable schema path

**What you're proving from the user's seat:** A file-read failure occurs before parsing and correctly reports the attempted user path as the one exception to `SourceFile`-derived post-parse provenance.

**Covers:** AC-1

**Isolation:** `tmpdir`

**Oracle:** The provider read-error diagnostic should use the path the user configured, because no source text or `SourceFile` exists yet.

**Preconditions:**

- Pre-flight completed.

### Steps

1. Run the SQL PSL provider load path against a missing file with a minimal context:

   ```bash
   mkdir -p "$PN_QA_TMP/scenario-4"
   pnpm --dir "$REPO_ROOT/packages/2-sql/2-authoring/contract-psl" exec tsx -e '
     import { prismaContract } from "./src/provider.ts";
     const schemaPath = process.argv[1]!;
     const source = prismaContract(schemaPath, { target: { id: "qa-target", family: "sql", control: {} }, createNamespace: () => ({ models: {}, views: {}, enums: {}, relations: {}, valueSets: {}, nativeEnums: {}, roles: {}, policies: {} }) as never });
     void source.source.load({ resolvedInputs: [schemaPath], authoringContributions: { pslBlockDescriptors: {}, type: {} } } as never).then((result) => console.log(JSON.stringify(result, null, 2)));
   ' "$PN_QA_TMP/scenario-4/missing/schema.prisma"
   ```

### What you should see

- The result is a failure with `PSL_SCHEMA_READ_FAILED`.
- The diagnostic `sourceId` is the missing scratch path.
- No post-parse diagnostic is present, because parsing never ran.

### Failure modes

- The read error uses a synthetic filename or an unrelated config path.
- The provider throws instead of returning a structured read-error result.
- A post-parse diagnostic appears even though no source was readable.

### Restore

Remove the scenario scratch directory when finished if you are not removing the whole scratch root:

```bash
rm -rf "$PN_QA_TMP/scenario-4"
```

## Scenario 5 — Exploratory: provenance edge probes

**Charter.** Explore nearby PSL source-provenance edges for 20 minutes using scratch files and direct package APIs. Focus on malformed blocks, detached-node ownership, same-text schemas under different filenames, and editor/live-buffer combinations that the scripted scenarios do not cover.

**Covers:** exploratory

**Isolation:** `tmpdir`

**Time budget:** 20 minutes

**Notes capture:** Record each command, the source text used, and any surprising diagnostic path, line, or fallback behaviour. Findings are classified in the QA run report, not in this script.

### Restore

Remove the scenario scratch directory when finished if you are not removing the whole scratch root:

```bash
rm -rf "$PN_QA_TMP/scenario-5"
```

## Final cleanup

After all scenarios and evidence capture are complete, remove the scratch root and verify cleanup:

```bash
rm -rf "$PN_QA_TMP"
test ! -e "$PN_QA_TMP" && printf 'scratch cleanup verified\n'
```

## Scenarios deliberately not in this script

| AC | Why it is not a manual-QA scenario |
| --- | --- |
| AC-2 | Pure coordinate helper placement and semantic-token encoding are covered by code audit and automated editor tests. Manual QA would only re-run assertions; scenario 2 covers the user-visible editor provenance flow. |
| Build/lint/test gates | CI and the D5 validation matrix run these. Re-running them here adds no user-observable judgement. |

## Sign-off coverage map

| AC ID | Scenario(s) covering it |
| --- | --- |
| AC-1 | 1, 3, 4 |
| AC-2 | N/A for manual QA; see deliberate exclusions |
| AC-3 | 1, 2 |
