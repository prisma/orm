/**
 * The PSL support this adapter contributes for its target's data types: the value entries the
 * target declares, plus the two tags that lower their own bodies and name no data type, which sit
 * under reserved keys and come from the family. ADR 254.
 */

import { sqlDefaultLiteralTagEntry } from '@internal/family-sql/control';
import type { AuthoringDataTypeEntry } from '@internal/framework-components/authoring';
import { loweringEntryKey } from '@internal/framework-components/authoring';
import { sqliteDataTypeEntries } from '@internal/target-sqlite/data-types';

export function createSqliteDataTypeEntries(): Readonly<Record<string, AuthoringDataTypeEntry>> {
  return {
    ...sqliteDataTypeEntries(),
    [loweringEntryKey('sql')]: sqlDefaultLiteralTagEntry('sql'),
    [loweringEntryKey('sqlite.sql')]: sqlDefaultLiteralTagEntry('sqlite.sql'),
  };
}
