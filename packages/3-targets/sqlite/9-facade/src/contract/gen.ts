import sqlFamilyPack from '@internal/family-sql/pack';
import { createGeneratorHelpers } from '@internal/framework-components/components';
import type { ComposedAuthoringHelpers } from '@internal/sql-contract-ts/contract-builder';
import sqlitePack from '@internal/target-sqlite/pack';

/**
 * The generator function calls of the `defineContract` callback for SQLite, built from the same family and target packs, for `.onCreate(...)` and `.onUpdate(...)`: `gen.now()`, `gen.uuid(7)`, `gen.cuid(2)`, `gen.ulid()`, `gen.nanoid(16)` and `gen.ksuid()`.
 */
export const gen: ComposedAuthoringHelpers<
  typeof sqlFamilyPack,
  typeof sqlitePack,
  undefined
>['gen'] = createGeneratorHelpers([sqlFamilyPack, sqlitePack]);
