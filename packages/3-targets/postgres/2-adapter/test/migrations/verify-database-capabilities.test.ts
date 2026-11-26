import { VERIFY_CODE_DATABASE_CAPABILITIES_NOT_PROVIDED } from '@internal/family-sql/control';
import { PostgresDatabaseSchemaNode } from '@internal/target-postgres/types';
import { describe, expect, it } from 'vitest';
import { contract, familyInstance, frameworkComponents } from './fixtures/runner-fixtures';

describe('the PostgreSQL family instance and a database that does not provide what the contract requires', () => {
  const result = familyInstance.verifySchema({
    contract,
    schema: new PostgresDatabaseSchemaNode({
      namespaces: {},
      roles: [],
      extensions: [],
      existingSchemas: ['public'],
      serverVersionNumber: 140010,
    }),
    strict: false,
    frameworkComponents,
  });

  it('fails verification with its own code and the rendered text', () => {
    expect(result).toMatchObject({
      ok: false,
      code: VERIFY_CODE_DATABASE_CAPABILITIES_NOT_PROVIDED,
      summary:
        'This release of Prisma requires PostgreSQL 15 or later. This database runs PostgreSQL 14.10. Upgrade the database to PostgreSQL 15 or later.',
    });
  });

  it('classifies every issue verification returns, the capabilities issue as structural with no entity kind', () => {
    const capabilitiesIssue = result.schema.issues.find(
      (issue) => issue.path.join('/') === 'capabilities',
    );
    expect(capabilitiesIssue).toBeDefined();
    expect(
      result.schema.issues.map((issue) => ({
        path: issue.path.join('/'),
        granularity: familyInstance.classifySubjectGranularity(issue),
        entityKind: familyInstance.classifyEntityKind(issue),
      })),
    ).toContainEqual({ path: 'capabilities', granularity: 'structural', entityKind: undefined });
  });
});
