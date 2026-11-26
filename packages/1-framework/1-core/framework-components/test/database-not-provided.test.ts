import { describe, expect, it } from 'vitest';
import {
  type DatabaseNotProvided,
  databaseNotProvidedText,
} from '../src/control/database-not-provided';

function textOf(findings: DatabaseNotProvided['findings']): string {
  return databaseNotProvidedText({ database: 'PostgreSQL', findings });
}

describe('the text for a database that does not provide what a contract requires', () => {
  it('names the first version that provides the missing capabilities, the version the database runs, and the version to state', () => {
    expect(
      textOf([
        {
          kind: 'missing-capabilities',
          databaseVersion: '15.4',
          versionToState: 15,
          capabilities: [{ capability: 'sql.mergeReturning', firstVersion: 17 }],
        },
      ]),
    ).toBe(
      'Your contract requires database capabilities first available in PostgreSQL 17 (sql.mergeReturning), but this database runs PostgreSQL 15.4. Either upgrade the database, or remove the capabilities from your contract: state version 15, and take them out of its capabilities list if it lists them.',
    );
  });

  it('names each first version once, with the capabilities it provides', () => {
    expect(
      textOf([
        {
          kind: 'missing-capabilities',
          databaseVersion: '15.4',
          versionToState: 15,
          capabilities: [
            { capability: 'sql.jsonTable', firstVersion: 16 },
            { capability: 'sql.mergeReturning', firstVersion: 17 },
            { capability: 'sql.uuidv7', firstVersion: 17 },
          ],
        },
      ]),
    ).toBe(
      'Your contract requires database capabilities first available in PostgreSQL 16 (sql.jsonTable) and PostgreSQL 17 (sql.mergeReturning, sql.uuidv7), but this database runs PostgreSQL 15.4. Either upgrade the database, or remove the capabilities from your contract: state version 15, and take them out of its capabilities list if it lists them.',
    );
  });

  it('says the oldest supported version for a database older than it', () => {
    expect(
      textOf([{ kind: 'older-than-supported', databaseVersion: '14.10', oldestSupported: 15 }]),
    ).toBe(
      'This release of Prisma requires PostgreSQL 15 or later. This database runs PostgreSQL 14.10. Upgrade the database to PostgreSQL 15 or later.',
    );
  });

  it('says the version could not be read, and how the database reports it', () => {
    expect(textOf([{ kind: 'version-not-read', versionQuery: 'SHOW server_version_num' }])).toBe(
      "Prisma could not read this database's PostgreSQL version, so it cannot check that the database provides what your contract requires. Check that the connection reaches a PostgreSQL server, and that SHOW server_version_num returns its version there.",
    );
  });

  it('names the database the target names', () => {
    expect(
      databaseNotProvidedText({
        database: 'MariaDB',
        findings: [
          { kind: 'older-than-supported', databaseVersion: '10.4.1', oldestSupported: '10.6' },
        ],
      }),
    ).toBe(
      'This release of Prisma requires MariaDB 10.6 or later. This database runs MariaDB 10.4.1. Upgrade the database to MariaDB 10.6 or later.',
    );
  });
});
