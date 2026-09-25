import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { contributedTypeScope } from '../src/contributed-type-scope';
import { parse } from '../src/parse';
import {
  contributedScope,
  documentScope,
  isNamespaceLike,
  lookupMember,
  namespaceScope,
} from '../src/scope';
import { buildSymbolTable } from '../src/symbol-table';

const TYPE_CONSTRUCTORS: AuthoringTypeNamespace = {
  String: { kind: 'typeConstructor', output: { codecId: 'fixture/scalar@1' } },
  pgvector: { Vector: { kind: 'typeConstructor', output: { codecId: 'fixture/vector@1' } } },
};

function scopesFor(schema: string) {
  const { document, sources } = parse(schema, 'scope.prisma');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: {},
  });
  const contributed = contributedScope(contributedTypeScope(TYPE_CONSTRUCTORS));
  const top = documentScope(symbolTable.topLevel, contributed);
  return { symbolTable, contributed, top };
}

const SCHEMA = [
  'model Shared {',
  '  id Int',
  '}',
  'namespace app {',
  '  model Item {',
  '    id Int',
  '  }',
  '  model Shared {',
  '    id Int',
  '  }',
  '}',
  'namespace other {',
  '  model Hidden {',
  '    id Int',
  '  }',
  '}',
].join('\n');

describe('a scope searches itself, then delegates to its parent', () => {
  it('answers from the namespace before the document', () => {
    const { symbolTable, top } = scopesFor(SCHEMA);
    const app = symbolTable.topLevel.namespaces['app']!;
    const scope = namespaceScope(app, top);

    expect(scope.lookup('Shared')).toEqual({
      kind: 'model',
      symbol: app.models['Shared'],
      namespace: app,
    });
  });

  it('reaches the document scope for a name the namespace does not declare', () => {
    const { symbolTable, top } = scopesFor(SCHEMA);
    const app = symbolTable.topLevel.namespaces['app']!;
    const scope = namespaceScope(app, top);

    expect(scope.lookup('Shared')?.kind).toBe('model');
    expect(namespaceScope(symbolTable.topLevel.namespaces['other']!, top).lookup('Shared')).toEqual(
      {
        kind: 'model',
        symbol: symbolTable.topLevel.models['Shared'],
      },
    );
  });

  it('reaches the contributed root through the document scope', () => {
    const { symbolTable, top } = scopesFor(SCHEMA);
    const scope = namespaceScope(symbolTable.topLevel.namespaces['app']!, top);

    expect(scope.lookup('String')).toMatchObject({
      kind: 'contributedType',
      symbol: { name: 'String', path: ['String'] },
    });
  });

  it('never reaches a sibling namespace', () => {
    const { symbolTable, top } = scopesFor(SCHEMA);
    const scope = namespaceScope(symbolTable.topLevel.namespaces['app']!, top);

    expect(scope.lookup('Hidden')).toBeUndefined();
  });

  it('stops at the contributed root, which has no parent', () => {
    const { contributed } = scopesFor(SCHEMA);

    expect(contributed.lookup('Nothing')).toBeUndefined();
  });
});

describe('a qualified reference is two steps', () => {
  it('finds the qualifier then the member inside it', () => {
    const { symbolTable, top } = scopesFor(SCHEMA);
    const qualifier = top.lookup('app');

    expect(qualifier).toEqual({
      kind: 'namespace',
      symbol: symbolTable.topLevel.namespaces['app'],
    });
    if (qualifier === undefined || !isNamespaceLike(qualifier)) throw new Error('not a namespace');
    expect(lookupMember(qualifier, 'Item')).toEqual({
      kind: 'model',
      symbol: symbolTable.topLevel.namespaces['app']!.models['Item'],
      namespace: symbolTable.topLevel.namespaces['app'],
    });
    expect(lookupMember(qualifier, 'Missing')).toBeUndefined();
  });

  it('takes the same two steps through a contributed namespace', () => {
    const { top } = scopesFor(SCHEMA);
    const qualifier = top.lookup('pgvector');

    expect(qualifier).toMatchObject({
      kind: 'contributedNamespace',
      symbol: { name: 'pgvector', path: ['pgvector'] },
    });
    if (qualifier === undefined || !isNamespaceLike(qualifier)) throw new Error('not a namespace');
    expect(lookupMember(qualifier, 'Vector')).toMatchObject({
      kind: 'contributedType',
      symbol: { name: 'Vector', path: ['pgvector', 'Vector'] },
    });
  });

  it('reports a qualifier that resolves to something else as not a namespace', () => {
    const { top } = scopesFor(SCHEMA);
    const qualifier = top.lookup('Shared');

    expect(qualifier?.kind).toBe('model');
    expect(qualifier === undefined ? undefined : isNamespaceLike(qualifier)).toBe(false);
  });
});
