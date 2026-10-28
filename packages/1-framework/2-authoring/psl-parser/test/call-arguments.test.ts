import { describe, expect, it } from 'vitest';
import { argumentsByParameter, printTypeConstructorCall } from '../src/call-arguments';
import { contributedTypeAt } from '../src/contributed-type-scope';
import { parse } from '../src/parse';
import type { ResolvedTypeConstructorCall } from '../src/resolve';
import { PslSources } from '../src/source-file';
import { buildSymbolTable } from '../src/symbol-table';

function callOf(type: string): ResolvedTypeConstructorCall {
  const { document, sources } = parse(`model M {\n  f ${type}\n}\n`, 'schema.prisma');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources: new PslSources([[document.syntax, sources.sourceFileFor(document.syntax)]]),
    defaultNamespaceId: 'public',
  });
  const call = symbolTable.defaultNamespace.models['M']?.fields['f']?.typeConstructor;
  if (call === undefined) throw new Error(`${type} is not a call`);
  return call;
}

const parameters = ['precision', 'onCreate', 'onUpdate'];

describe('printTypeConstructorCall', () => {
  it('prints the path and each argument, named ones with their name', () => {
    expect(printTypeConstructorCall(callOf('ns.f( 3 ,onUpdate:   now)'))).toBe(
      'ns.f(3, onUpdate: now)',
    );
  });

  it('prints a call with no arguments', () => {
    expect(printTypeConstructorCall(callOf('f()'))).toBe('f()');
  });
});

describe('argumentsByParameter', () => {
  it('fills parameters by position, then by name', () => {
    expect(argumentsByParameter(callOf('f(3, onUpdate: now)').args, parameters)).toEqual(
      new Map([
        ['precision', '3'],
        ['onUpdate', 'now'],
      ]),
    );
  });

  it('fills the first parameter with a positional argument written after a named one, as mapPslHelperArgs does', () => {
    expect(argumentsByParameter(callOf('f(onUpdate: now, 3)').args, parameters)).toEqual(
      new Map([
        ['precision', '3'],
        ['onUpdate', 'now'],
      ]),
    );
  });

  it.each([
    ['a positional argument past the last parameter', 'f(3, now, now, now)'],
    ['a name no parameter has', 'f(frequency: now)'],
    ['a parameter filled twice', 'f(3, precision: 4)'],
    ['a parameter a later positional argument fills', 'f(precision: 4, 3)'],
  ])('refuses %s', (_, type) => {
    expect(argumentsByParameter(callOf(type).args, parameters)).toBeUndefined();
  });
});

describe('contributedTypeAt', () => {
  const char = { kind: 'typeConstructor', output: { codecId: 'sql/char@1' } } as const;
  const namespace = { sql: { Char: char } };

  it('finds the descriptor at a path', () => {
    expect(contributedTypeAt(namespace, ['sql', 'Char'])).toBe(char);
  });

  it.each([[['sql']], [['sql', 'Char', 'More']], [['sql', 'Missing']], [['Missing']], [[]]])(
    'finds nothing at %j',
    (path) => {
      expect(contributedTypeAt(namespace, path)).toBeUndefined();
    },
  );
});
