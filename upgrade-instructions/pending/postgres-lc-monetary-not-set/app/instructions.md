---
changes:
  - id: postgres-lc-monetary-not-set
    summary: |
      The PostgreSQL driver no longer sets `lc_monetary=C` on its connections, so a pooled Prisma Postgres URL connects. An application with `money` columns (`Money` in PSL, `@db.Money` in a Prisma 7 schema) now needs the database to print `money` in the `C` form itself. Run `SHOW lc_monetary` as the application's role. `C`, `POSIX`, `en_US` and Prisma Postgres need no action. Under any other locale a `money` read fails with `RUNTIME.LC_MONETARY_NOT_C`: set `ALTER ROLE <role> SET lc_monetary = 'C'` or `ALTER DATABASE <database> SET lc_monetary = 'C'` before deploying the upgrade. Raw SQL that selects `money` as text now prints in the database's own locale.
    detection:
      glob: "**/*.{prisma,ts,mts,cts,sql,json}"
      matches:
        - '(?<![\w$])Money(?![\w$])'
        - 'pg/money@1'
        - '::\s*(?:money|MONEY)(?![\w$])'
---

# `money` needs the database's `lc_monetary` to print the `C` form

Earlier releases started every PostgreSQL connection with `lc_monetary=C`, so `money` read and wrote the same value in any locale. A per-transaction connection pooler, such as the pooled address of Prisma Postgres, refuses a connection that asks for that setting, so the driver no longer sends it. The database must now provide it.

This matters only if the application reads or writes `money` columns.

1. Connect as the role the application uses and run `SHOW lc_monetary`.
2. If it prints `C`, `POSIX` or `en_US`, with or without an encoding suffix (`C.UTF-8`, `en_US.UTF-8`), stop. Prisma Postgres also needs no action.
3. Otherwise, set it before you deploy the upgrade, while the old release still forces `C` on its own connections:

   ```sql
   ALTER ROLE app_role SET lc_monetary = 'C';
   -- or, for every role:
   ALTER DATABASE app_db SET lc_monetary = 'C';
   ```

   Prefer the role. The database setting also changes how every other client of that database prints and reads `money`.

   The setting applies to server connections opened afterwards. Behind a connection pooler, it takes effect once the pooler replaces its existing server connections.

If you upgrade first, a `money` read fails with `RUNTIME.LC_MONETARY_NOT_C`. Under a locale with two fraction digits, such as `de_DE` or `en_GB`, nothing is stored wrong, and setting `lc_monetary` afterwards is enough.

Under a locale with no or three fraction digits, such as `ja_JP`, `ko_KR` or `ar_KW`, upgrading first also stores wrong amounts. PostgreSQL scales a written value by the locale's fraction digits, so `1234.56` is stored as 1235 units under `ja_JP`. After you set `lc_monetary` to `C`, those rows read back 100 times too small (or 10 times too large under a three-digit locale), with no error. If the application wrote `money` values between the upgrade and the change, correct those rows before you change the setting.

Raw SQL of your own that selects a `money` value as text printed the `C` form, `$1,234.56`, on Prisma's connections. It now prints in the database's locale.

The CLI needs nothing: it sets `lc_monetary` itself while it reads the database and applies migrations.
