# Non-ported — methods-upsert-native-atomic

- `packages/client/tests/functional/methods/upsert/native-atomic/tests.ts` › `should only use ON CONFLICT when update arguments do not have any nested queries` — ON CONFLICT strategy selection vs nested-mutation update — requires `$on('query')` log event API to inspect emitted SQL; tests internal engine strategy, not observable behaviour
- `packages/client/tests/functional/methods/upsert/native-atomic/tests.ts` › `should only use ON CONFLICT when there is only 1 unique field in the where clause` — ON CONFLICT strategy when multiple unique fields used — query-log inspection API not available in Prisma 8
- `packages/client/tests/functional/methods/upsert/native-atomic/tests.ts` › `should only use ON CONFLICT when the unique field defined in where clause has the same value as defined in the create arguments` — ON CONFLICT strategy for create/where value parity — query-log inspection API not available in Prisma 8
