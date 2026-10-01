---
changes:
  - id: ts-enum-member-written-as-stored
    summary: |
      `defineContract` from the Postgres and SQLite packages now refuses an `enumType` member that its codec takes but stores as a different value, with `CONTRACT.ENUM_INVALID`. A uuid member written with an upper-case hex digit, in braces, or with hyphens anywhere other than the 8-4-4-4-12 positions Postgres prints (including none) is refused, because `pg/uuid@1` stores lower-case 8-4-4-4-12 text. Write each refused member as the error message says, re-emit, and apply a migration that replaces the enum's CHECK constraint.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\benumType\('
---

## `ts-enum-member-written-as-stored`

The types of a TypeScript contract name each `enumType` member as written, in `db.enums` and in the types of the fields that use the enum, while `contract.json` and the database hold what the column's codec stores. The two now have to be the same value, so `defineContract` refuses a member its codec stores as something else and says what to write:

```text
CONTRACT.ENUM_INVALID: enumType("Key"): member "A" is written "A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11", but the column stores "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11". Write the member as "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11".
```

A member its codec does not take at all, such as text that is not a uuid on `pg/uuid@1`, is refused with a different message; `codecs-check-stored-json` describes it.

Refused members:

- On a uuid column (`pg/uuid@1`), a member with an upper-case hex digit, in braces, or with hyphens anywhere other than the 8-4-4-4-12 positions (including none). Write it in lower case, hyphenated 8-4-4-4-12.
- A member that got past the type check with a value of another type its codec still takes, for example through a cast: the number `1` on `pg/int8@1`, which stores `"1"`, is refused with "Write the member as 1n".

1. Run `prisma contract emit`, or run the code that calls `defineContract`. Each refused member is reported with the value to write. To find uuid members first, search the calls to `member(` in your contract for a uuid that is not lower case, hyphenated 8-4-4-4-12. The detection for this change looks for calls to `enumType(`; if you import it under another name, as in `import { enumType as defineEnum }`, it does not find them, so search for that name.
2. Rewrite each refused member as the message says. Code that reads members through the enum, such as `Key.members.A` or `db.enums.public.Key.members.A`, needs no change. Code that compares a value with the old spelling does: values read from the database were always in the stored form.
3. Re-emit. If a column uses the enum, its membership CHECK constraint's expression changes, and a CHECK constraint's name is derived from its expression, so the storage hash and the constraint's name both change. Plan and apply a migration: it drops the old CHECK constraint and adds the new one. Dropping a constraint is a destructive operation, so the plan needs the destructive operation class allowed.
