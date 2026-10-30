import { castUnchanged, type DataType, readJsonString } from '@internal/framework-components/codec';
import { sqlDataType } from '@internal/sql-contract/data-type';
import { pgText } from '@internal/target-postgres/data-types';

/**
 * PostgreSQL's case-insensitive text. Its stored form is the text as written, and it takes a value written as text unchanged.
 */
export const citextCitext = sqlDataType('citext/citext', {
  texts: [{ text: 'citext', written: true, catalog: true }],
  read: (json) => readJsonString('citext/citext', json),
  casts: { [pgText.id]: castUnchanged },
});

export const citextDataTypes: readonly DataType[] = [citextCitext];
