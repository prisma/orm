import sqlFamilyPack from '@internal/family-sql/pack';
import { assembleDataTypeSupport } from '@internal/framework-components/authoring';
import {
  type ComposedAuthoringHelpers,
  createComposedAuthoringHelpers,
} from '@internal/sql-contract-ts/contract-builder';
import { assemblePostgresCodecRegistryWithBuiltins } from '@internal/target-postgres/codecs';
import postgresPack from '@internal/target-postgres/pack';

const { support } = assembleDataTypeSupport([sqlFamilyPack, postgresPack], () => undefined);

const helpers = createComposedAuthoringHelpers({
  family: sqlFamilyPack,
  target: postgresPack,
  codecLookup: assemblePostgresCodecRegistryWithBuiltins([], support.lookup),
});

type PostgresHelpers = ComposedAuthoringHelpers<
  typeof sqlFamilyPack,
  typeof postgresPack,
  undefined
>;

/**
 * The field builders of the `defineContract` callback for Postgres, without extensions: `field.column(type.TimestamptzTemporal())`. Use it outside a contract, for example to declare the fields of a query fragment.
 */
export const field: PostgresHelpers['field'] = helpers.field;

/**
 * The generator function calls of the `defineContract` callback for Postgres, without extensions, for `.onCreate(...)` and `.onUpdate(...)`: `gen.now()`, `gen.uuid(7)`, `gen.cuid(2)`, `gen.ulid()`, `gen.nanoid(16)` and `gen.ksuid()`.
 */
export const gen: PostgresHelpers['gen'] = helpers.gen;

/**
 * The type constructors and type aliases of the `defineContract` callback for Postgres, without extensions, for `field.column(...)`: `type.TimestamptzTemporal()`, `type.Ulid()`, `type.temporal.CreatedAt()`.
 */
export const type: PostgresHelpers['type'] = helpers.type;
