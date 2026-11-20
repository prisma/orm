---
changes:
  - id: postgres-autoincrement-sequence-follows-column-type
    summary: |
      On PostgreSQL, changing the integer type of an `autoincrement()` column now also changes the sequence the column owns to the new width, and checks both afterwards. Before, a column widened from `int4` to `int8` kept an `integer` sequence, which stops at 2147483647. An `ops.json` written before this change has an `alterColumnType` without the sequence step, and an `alter type of "<column>"` step that does not name the new type; run `migration.ts` again for each migration that is not applied yet. For a database where such a migration is already applied, run `ALTER SEQUENCE … AS bigint` on the sequence `pg_get_serial_sequence` names yourself.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "alter type of \\"(?:[^"\\]|\\.)*?\\"",(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify column \\"(?:[^"\\]|\\.)*?\\" has type \\"(?:smallint|integer|bigint)\\""'
---

# The sequence of an `autoincrement()` column follows the column's type

An `autoincrement()` column takes its values from a sequence it owns. `ALTER COLUMN … TYPE` does not change that sequence, so a column widened from `int4` to `int8` kept a sequence `AS integer`, and inserts failed once it reached 2147483647. An `alterColumnType` on such a column, planned or hand-written in `migration.ts`, now also runs `ALTER SEQUENCE … AS <new width>`. It first refuses, before any step, when the sequence has already handed out a value past a narrower width. Its postcheck asks for both the column type and the sequence width. A column whose `nextval(...)` default reads a sequence it does not own changes type as before, and that sequence is left alone.

## `postgres-autoincrement-sequence-follows-column-type`

The detection matches every integer `alterColumnType` written before this change, and none written after it; only those on an `autoincrement()` column need action.

- Migration not applied yet: write its `ops.json` again before you apply it. Run its `migration.ts` (`node migration.ts`), or delete the package and run `prisma migration plan` again.
- Migration already applied: the sequence still has the old width. Change it to the column's width, for example `ALTER SEQUENCE "public"."user_id_seq" AS bigint`. `pg_get_serial_sequence('"public"."user"', 'id')` names the sequence.
