import sqlFamilyPack from '@internal/family-sql/pack';
import {
  type ComposedAuthoringHelpers,
  createComposedAuthoringHelpers,
} from '@internal/sql-contract-ts/contract-builder';
import { createSqliteBuiltinCodecLookup } from '@internal/target-sqlite/codecs';
import sqlitePack from '@internal/target-sqlite/pack';

const helpers = createComposedAuthoringHelpers({
  family: sqlFamilyPack,
  target: sqlitePack,
  codecLookup: createSqliteBuiltinCodecLookup(),
});

type SqliteHelpers = ComposedAuthoringHelpers<typeof sqlFamilyPack, typeof sqlitePack, undefined>;

/**
 * The field builders of the `defineContract` callback for SQLite, without extensions: `field.column(type.DateTime())`. Use it outside a contract, for example to declare the fields of a query fragment.
 */
export const field: SqliteHelpers['field'] = helpers.field;

/**
 * The type constructors and type aliases of the `defineContract` callback for SQLite, without extensions, for `field.column(...)`: `type.DateTime()`, `type.sql.Ulid()`, `type.temporal.CreatedAt()`.
 */
export const type: SqliteHelpers['type'] = helpers.type;
