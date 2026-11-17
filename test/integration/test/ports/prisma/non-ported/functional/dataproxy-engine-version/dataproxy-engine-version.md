# Non-ported — dataproxy-engine-version

- `packages/client/tests/functional/dataproxy-engine/version/tests.ts` › `check versions on \`_engine\`` — data-proxy mode exposes private `_engine` client/remote version and engine hash values before and after `$connect` — Prisma 8 has no generated Prisma Client `_engine` object or Data Proxy executor lifecycle, so the subject cannot be expressed through its public API.
