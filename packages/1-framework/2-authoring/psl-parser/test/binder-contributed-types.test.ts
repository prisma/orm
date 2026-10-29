import { describe, expect, it } from 'vitest';
import { EMPTY_DATA_TYPES } from '../src/attribute-spec/spec-context';
import { contributedTypeOf } from '../src/binder';
import { contributedTypeCodecId } from '../src/contributed-type-scope';
import { bindProject, text, varchar } from './binder-contributed-types.helpers';

describe('createBinder — contributed types', () => {
  it('binds a type-constructor name to the type-constructor descriptor', () => {
    const { resolve } = bindProject('model Post {\n  title String\n  slug db.VarChar(10)\n}');

    expect(resolve('title')).toEqual({
      kind: 'contributedType',
      symbol: { kind: 'contributedType', name: 'String', path: ['String'], descriptor: text },
    });
    expect(resolve('slug')).toEqual({
      kind: 'contributedType',
      symbol: {
        kind: 'contributedType',
        name: 'VarChar',
        path: ['db', 'VarChar'],
        descriptor: varchar,
      },
    });
  });

  describe('contributedTypeOf', () => {
    it('returns the contributed type a field resolves to', () => {
      const { resolve, binder } = bindProject('model Post {\n  title String\n}');

      expect(contributedTypeOf(resolve('title'), binder, undefined)).toEqual({
        symbol: { kind: 'contributedType', name: 'String', path: ['String'], descriptor: text },
        call: undefined,
      });
    });

    it('follows a named type to the contributed type of its base', () => {
      const { resolve, binder } = bindProject(
        'types {\n  Slug = db.VarChar(10)\n}\nmodel Post {\n  slug Slug\n}',
      );

      expect(resolve('slug')?.kind).toBe('namedType');
      expect(contributedTypeOf(resolve('slug'), binder, undefined)).toMatchObject({
        symbol: { kind: 'contributedType', name: 'VarChar', path: ['db', 'VarChar'] },
        call: { path: ['db', 'VarChar'] },
      });
    });

    it('returns undefined for a resolution that is not a contributed type', () => {
      const { resolve, binder } = bindProject(
        'model Author {\n  id String\n}\nmodel Post {\n  author Author\n  missing Nope\n}',
      );

      expect(contributedTypeOf(resolve('author'), binder, undefined)).toBeUndefined();
      expect(contributedTypeOf(resolve('missing'), binder, undefined)).toBeUndefined();
      expect(contributedTypeOf(undefined, binder, undefined)).toBeUndefined();
    });
  });

  describe('contributedTypeCodecId of a type choice', () => {
    const { resolve, binder, symbolTable } = bindProject(
      [
        'types {',
        '  Stamp = Moment(as: text)',
        '}',
        'model Post {',
        '  bare Moment',
        '  named Moment(storage: narrow)',
        '  positional Moment(text)',
        '  aliased Stamp',
        '  refused Moment(as: text, storage: narrow)',
        '  unknownNamed Moment(bogus: narrow)',
        '  twice Moment(text, as: date)',
        '}',
      ].join('\n'),
    );
    const codecOf = (fieldName: string) => {
      const field = symbolTable.defaultNamespace.models['Post']?.fields[fieldName];
      const use = contributedTypeOf(resolve(fieldName), binder, field?.typeConstructor);
      return use === undefined
        ? 'no contributed type'
        : contributedTypeCodecId(use, EMPTY_DATA_TYPES);
    };

    it('is the codec of the constructor the call chooses, bare, named or positional', () => {
      expect({
        bare: codecOf('bare'),
        named: codecOf('named'),
        positional: codecOf('positional'),
      }).toEqual({
        bare: 'fixture/wide-date@1',
        named: 'fixture/narrow-date@1',
        positional: 'fixture/wide-text@1',
      });
    });

    it('follows a type alias to the call it is written as', () => {
      expect(codecOf('aliased')).toBe('fixture/wide-text@1');
    });

    it('is unknown for a call the column refuses, as the column reads the call', () => {
      expect({
        refused: codecOf('refused'),
        unknownNamed: codecOf('unknownNamed'),
        twice: codecOf('twice'),
      }).toEqual({ refused: undefined, unknownNamed: undefined, twice: undefined });
    });
  });
});
