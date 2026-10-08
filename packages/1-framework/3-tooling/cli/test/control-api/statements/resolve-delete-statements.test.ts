import { describe, expect, it } from 'vitest';
import {
  resolveStatements,
  type StatementOrigin,
} from '../../../src/control-api/statements/resolve-statements';
import type { StatementText } from '../../../src/control-api/statements/statement-text';
import { contractOf, expectFailure, expectValue } from './statement-fixtures';

const origin = contractOf({ app: { models: { Profile: {}, Legacy: {} } } });
const destination = contractOf({ app: { models: { User: {} } } });

const missingOrigin: StatementOrigin = {
  kind: 'missing',
  hash: 'sha256:abc',
  snapshotDirectory: 'migrations/snapshots',
  unreadable: undefined,
};

function remove(text: string): StatementText {
  return { verb: 'delete', text };
}

function rename(text: string): StatementText {
  return { verb: 'rename', text };
}

describe('resolveStatements, delete statements', () => {
  it('passes a delete through unresolved, since it is matched against the plan', () => {
    const result = resolveStatements({
      statements: [remove('Legacy'), rename('Profile:User'), remove('audit_log')],
      origin: { kind: 'contract', contract: origin },
      destination,
    });

    expect(expectValue(result)).toEqual([
      {
        kind: 'rename',
        entity: 'model',
        from: { namespaceId: 'app', model: 'Profile' },
        to: { namespaceId: 'app', model: 'User' },
      },
    ]);
  });

  it('needs no origin contract for a delete', () => {
    const result = resolveStatements({
      statements: [remove('Legacy'), remove('User.name')],
      origin: missingOrigin,
      destination,
    });

    expect(expectValue(result)).toEqual([]);
  });

  it('refuses a rename beside a delete when the origin contract is unknown', () => {
    const result = resolveStatements({
      statements: [remove('Legacy'), rename('Profile:User')],
      origin: missingOrigin,
      destination,
    });

    expectFailure(result, 'MIGRATION.STATEMENT_ORIGIN_UNKNOWN', 'sha256:abc');
  });

  it('refuses a delete with no name', () => {
    const result = resolveStatements({
      statements: [remove('  ')],
      origin: { kind: 'contract', contract: origin },
      destination,
    });
    expectFailure(result, 'MIGRATION.STATEMENT_INVALID', 'names nothing');
  });

  it('accepts any name a subject can have, including storage names with a ":"', () => {
    const result = resolveStatements({
      statements: ['public.a:b', 'public.User.nick:name', 'dropTable.audit_old', 'rawSql'].map(
        remove,
      ),
      origin: missingOrigin,
      destination,
    });
    expect(expectValue(result)).toEqual([]);
  });
});
