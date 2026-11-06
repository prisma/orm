import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { resolveStatements } from '../../../src/control-api/statements/resolve-statements';
import type { StatementText } from '../../../src/control-api/statements/statement-text';
import { contractOf, expectFailure, expectValue } from './statement-fixtures';

const UNRESOLVED = 'MIGRATION.STATEMENT_UNRESOLVED';
const INVALID = 'MIGRATION.STATEMENT_INVALID';

const convert = (text: string): StatementText => ({ verb: 'convert', text });
const rename = (text: string): StatementText => ({ verb: 'rename', text });

function tasks(values: Readonly<Record<string, string>>) {
  return {
    models: {
      Task: { fields: ['id', 'type'], discriminator: 'type', variants: values },
      Bug: { base: 'Task', fields: ['severity'] },
      Epic: { base: 'Task' },
      Defect: { base: 'Task' },
      User: { fields: ['id'] },
    },
  };
}

const origin = contractOf({ app: tasks({ bug: 'Bug', epic: 'Epic', defect: 'Defect' }) });
const destination = contractOf({ app: tasks({ issue: 'Bug', epic: 'Epic', fault: 'Defect' }) });

function resolve(
  statements: readonly StatementText[],
  from: ReturnType<typeof contractOf> = origin,
  to: ReturnType<typeof contractOf> = destination,
) {
  return resolveStatements({
    statements,
    origin: { kind: 'contract', contract: from },
    destination: to,
  });
}

describe('resolveStatements, variant converts', () => {
  it('resolves a variant whose discriminator value changed, named alone or with its namespace', () => {
    const statement = {
      kind: 'convert',
      entity: 'model',
      model: { namespaceId: asNamespaceId('app'), model: 'Bug' },
    };
    expect([
      expectValue(resolve([convert('Bug')])),
      expectValue(resolve([convert('app.Bug')])),
    ]).toEqual([[statement], [statement]]);
  });

  it('refuses a variant whose discriminator value did not change', () => {
    expectFailure(
      resolve([convert('Epic')]),
      UNRESOLVED,
      'The variant "Epic" has the discriminator value "epic" in the origin and destination contracts, so it has no values to convert',
      'Leave out --convert Epic.',
    );
  });

  it('refuses a model that is not a variant in both contracts', () => {
    const from = contractOf({ app: tasks({ bug: 'Bug', epic: 'Epic' }) });
    expectFailure(
      resolve([convert('User')]),
      UNRESOLVED,
      'The model "User" is not a variant in both contracts; a --convert statement names a field, or a variant whose discriminator value changed',
    );
    expectFailure(
      resolve([convert('Defect')], from),
      UNRESOLVED,
      'The model "Defect" is not a variant in both contracts',
    );
  });

  it('refuses a second convert of the same variant', () => {
    expectFailure(
      resolve([convert('Bug'), convert('app.Bug')]),
      INVALID,
      'An earlier statement already converts "Bug".',
    );
  });

  it('refuses a name that reads both as a variant and as a field, naming each', () => {
    const from = contractOf({
      app: tasks({ bug: 'Bug' }),
      billing: { models: { app: { fields: ['Bug'] } } },
    });
    const to = contractOf({
      app: tasks({ issue: 'Bug' }),
      billing: {
        models: { app: { fields: ['Bug'], fieldTypes: { Bug: { codecId: 'test/int@1' } } } },
      },
    });
    expectFailure(
      resolve([convert('app.Bug')], from, to),
      UNRESOLVED,
      '"app.Bug" reads both as variant "app.Bug" and as field "billing.app.Bug"',
    );
  });

  it('follows a rename of the variant', () => {
    const variants = (values: Readonly<Record<string, string>>) => ({
      models: {
        Task: { fields: ['id', 'type'], discriminator: 'type', variants: values },
        ...Object.fromEntries(Object.values(values).map((model) => [model, { base: 'Task' }])),
      },
    });
    const from = contractOf({ app: variants({ bug: 'Issue', epic: 'Epic' }) });
    const to = contractOf({ app: variants({ defect: 'Bug', epic: 'Epic' }) });
    expect(expectValue(resolve([rename('Issue:Bug'), convert('Bug')], from, to)).at(1)).toEqual({
      kind: 'convert',
      entity: 'model',
      model: { namespaceId: asNamespaceId('app'), model: 'Bug' },
    });
  });

  it('still refuses a backfill that names a model', () => {
    expectFailure(
      resolve([{ verb: 'backfill', text: 'Bug' }]),
      INVALID,
      '"Bug" names a model; a --backfill statement names a field.',
    );
  });
});
