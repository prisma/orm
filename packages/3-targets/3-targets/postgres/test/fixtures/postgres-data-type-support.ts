import type { DataTypeSupport } from '@internal/framework-components/authoring';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import {
  SQL_EXPRESSION_DATA_TYPE_ID,
  sqlExpressionAuthoringEntry,
  sqlExpressionDataType,
} from '@internal/sql-contract/sql-expression';
import { postgresDataTypeEntries, postgresDataTypes } from '../../src/exports/data-types';

/** The data types a Postgres stack registers: the SQL family's `sql/expression` first, then the target's. */
export const postgresDataTypeSupport: DataTypeSupport = {
  entries: {
    [SQL_EXPRESSION_DATA_TYPE_ID]: sqlExpressionAuthoringEntry,
    ...postgresDataTypeEntries(),
  },
  lookup: createDataTypeLookup([sqlExpressionDataType, ...postgresDataTypes]),
};
