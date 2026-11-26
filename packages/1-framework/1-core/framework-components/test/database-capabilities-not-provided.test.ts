import { describe, expect, it } from 'vitest';
import {
  capabilitiesNotProvidedIssue,
  type DatabaseCapabilitiesNotProvided,
  databaseCapabilitiesNotProvidedText,
} from '../src/control/database-capabilities-not-provided';

function textOf(findings: DatabaseCapabilitiesNotProvided['findings']): string {
  return databaseCapabilitiesNotProvidedText({ database: 'PostgreSQL', findings });
}

describe('the text for a database that does not provide what a contract requires', () => {
  it('names the first version that provides the missing capabilities, the version the database runs, and the version to state', () => {
    expect(
      textOf([
        {
          kind: 'missing-capabilities',
          databaseVersion: '15.4',
          matchingVersion: 15,
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
          matchingVersion: 15,
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

  it('lists three first versions with commas and a final "and"', () => {
    expect(
      textOf([
        {
          kind: 'missing-capabilities',
          databaseVersion: '15.4',
          matchingVersion: 15,
          capabilities: [
            { capability: 'sql.a', firstVersion: 16 },
            { capability: 'sql.b', firstVersion: 17 },
            { capability: 'sql.c', firstVersion: 18 },
          ],
        },
      ]),
    ).toBe(
      'Your contract requires database capabilities first available in PostgreSQL 16 (sql.a), PostgreSQL 17 (sql.b) and PostgreSQL 18 (sql.c), but this database runs PostgreSQL 15.4. Either upgrade the database, or remove the capabilities from your contract: state version 15, and take them out of its capabilities list if it lists them.',
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
      databaseCapabilitiesNotProvidedText({
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

describe('the issue for a database that does not provide what a contract requires', () => {
  it('carries the data and the text rendered from it, with the expected node as its subject', () => {
    const notProvided: DatabaseCapabilitiesNotProvided = {
      database: 'PostgreSQL',
      findings: [{ kind: 'older-than-supported', databaseVersion: '14.10', oldestSupported: 15 }],
    };
    const expected = {
      id: 'capabilities',
      nodeKind: 'database-capabilities',
      isEqualTo: () => true,
      children: () => [],
    };

    expect(capabilitiesNotProvidedIssue({ path: ['capabilities'], expected, notProvided })).toEqual(
      {
        path: ['capabilities'],
        expected,
        explanation: {
          text: 'This release of Prisma requires PostgreSQL 15 or later. This database runs PostgreSQL 14.10. Upgrade the database to PostgreSQL 15 or later.',
          cause: 'capabilities-not-provided',
          notProvided,
        },
      },
    );
  });
});
