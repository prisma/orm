---
changes:
  - id: psl-schema-requires-use-prisma-8-directive
    summary: |
      `prisma contract emit` now refuses to load a PSL schema file that does not carry
      `// use prisma-8` as its first line, failing with `PSL_NO_OPTED_IN_SCHEMA_FILES`. Add the
      directive to every PSL schema file your `contract.source.inputs` matches.
    detection:
      glob: "**/*.prisma"
      regex:
        - '^(?!\s*// *use +(?:prisma-8|prisma-next)(?: *)(?!\S))'
    script: ./scripts/add-use-prisma-8-directive.mjs
---

## `psl-schema-requires-use-prisma-8-directive`

Every PSL schema file `prisma contract emit` reads must now carry `// use prisma-8` as its
literal first line (before any other comment or whitespace beyond leading blank lines). A file a
configured glob matches but that lacks the directive is silently excluded from the emitted
contract; if excluding it would leave zero opted-in files, emission fails outright:

```
CONTRACT.SOURCE_LOAD_FAILED
  why: No schema file carries the "// use prisma-8" directive
  PSL_NO_OPTED_IN_SCHEMA_FILES: None of the matched files carry the "// use prisma-8" directive: <path>
```

Run the colocated codemod over every PSL schema file `contract.source.inputs` names (a plain path
or a glob):

```bash
node scripts/add-use-prisma-8-directive.mjs 'prisma/**/*.prisma'
```

It inserts `// use prisma-8` followed by a blank line at the top of every matched file that lacks
the directive (or its earlier `// use prisma-next` spelling); a file that already carries either
form is left untouched, so running it twice is a no-op. This is the same directive `orm init`
already scaffolds into a fresh project.

The directive is content, not configuration: it does not change `contract.source.inputs`, the
emitted `contract.json`, or any migration history. Re-run `prisma contract emit` afterward to
confirm the schema loads.
