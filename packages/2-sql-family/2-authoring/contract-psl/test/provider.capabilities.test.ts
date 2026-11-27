import { buildSymbolTable, createBinder } from '@internal/psl-parser';
import { hasPslInterpreter } from '@internal/psl-parser/interpret';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { isSourceGivenNoCapabilities, prismaContract } from '../src/exports/provider';
import { createPostgresTestContext, postgresTarget } from './fixtures';

const schema = `// use prisma-8
model User {
  id Int @id
}
`;

function interpretWith(capabilities?: Record<string, Record<string, boolean>>) {
  const { source } = prismaContract('./schema.prisma', {
    target: postgresTarget,
    createNamespace: createTestSqlNamespace,
    ...(capabilities === undefined ? {} : { capabilities }),
  });
  if (!hasPslInterpreter(source)) throw new Error('expected an interpret-capable source');
  const context = createPostgresTestContext({
    capabilities: { sql: { returning: true, lateral: true } },
  });
  const { document, sources } = parse(schema, './schema.prisma');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    defaultNamespaceId: 'public',
  });
  const { binder } = createBinder({ symbolTable, sources, context });
  const result = source.interpret({ documents: [document], sources, symbolTable, binder }, context);
  if (!result.ok) throw new Error(result.failure.summary);
  return result.value.capabilities;
}

describe('prismaContract capabilities', () => {
  it('writes the capabilities of the context when given none', () => {
    expect(interpretWith()).toEqual({ sql: { returning: true, lateral: true } });
  });

  it('adds the capabilities it is given to those of the context, in one list', () => {
    expect(
      interpretWith({ sql: { interactiveTransactions: true }, http: { batch: true } }),
    ).toEqual({
      sql: { returning: true, lateral: true, interactiveTransactions: true },
      http: { batch: true },
    });
  });
});

describe('the record of sources given no capabilities', () => {
  const sourceWith = (capabilities?: Record<string, Record<string, boolean>>) =>
    prismaContract('./schema.prisma', {
      target: postgresTarget,
      createNamespace: createTestSqlNamespace,
      ...(capabilities === undefined ? {} : { capabilities }),
    }).source;

  it.each([
    ['no capabilities option', undefined, true],
    ['an empty matrix', {}, false],
    ['only false flags', { sql: { returning: false } }, false],
  ])('records a source given %s: %s', (_, capabilities, recorded) => {
    expect(isSourceGivenNoCapabilities(sourceWith(capabilities))).toBe(recorded);
  });
});
