import { describe, expect, it } from 'vitest';
import * as runtimeEntry from '../src/exports/runtime';
import * as staticEntry from '../src/exports/static';

const earlyAccessNames = (entry: object) =>
  Object.keys(entry)
    .filter((name) => name.startsWith('ea_') || name.startsWith('Ea_'))
    .sort();

const unprefixedNames = [
  'PostgresRuntimeImpl',
  'buildPostgresQueryMembers',
  'buildPostgresStaticContext',
  'connectWithBinding',
  'resolveOptionalPostgresBinding',
  'toDriverCursorOptions',
  'validateCursorOptions',
  'validatePostgresContract',
  'validateTransactionOptions',
];

describe('the parts of postgres() that a client built on it reuses', () => {
  it('are exported from the runtime and static entries under Early Access names only', () => {
    expect({
      runtime: earlyAccessNames(runtimeEntry),
      static: earlyAccessNames(staticEntry),
      unprefixed: [...Object.keys(runtimeEntry), ...Object.keys(staticEntry)].filter((name) =>
        unprefixedNames.includes(name),
      ),
    }).toEqual({
      runtime: [
        'Ea_PostgresRuntimeImpl',
        'ea_buildPostgresQueryMembers',
        'ea_connectWithBinding',
        'ea_resolveOptionalPostgresBinding',
        'ea_toDriverCursorOptions',
        'ea_validateCursorOptions',
        'ea_validateTransactionOptions',
      ],
      static: ['ea_buildPostgresStaticContext', 'ea_validatePostgresContract'],
      unprefixed: [],
    });
  });
});
