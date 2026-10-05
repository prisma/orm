import sqlFamilyPack from '@internal/family-sql/pack';
import {
  type ComposedAuthoringHelpers,
  createComposedAuthoringHelpers,
} from '@internal/sql-contract-ts/contract-builder';
import postgresPack from '@internal/target-postgres/pack';

/**
 * The field builders of the `defineContract` callback for Postgres, without extensions: `field.text()`, `field.temporal.timestamptz()`, `field.uuidString()`, and `field.column(columnType)`. Use it outside a contract, for example to declare the fields of a scope.
 */
export const field: ComposedAuthoringHelpers<
  typeof sqlFamilyPack,
  typeof postgresPack,
  undefined
>['field'] = createComposedAuthoringHelpers({
  family: sqlFamilyPack,
  target: postgresPack,
}).field;
