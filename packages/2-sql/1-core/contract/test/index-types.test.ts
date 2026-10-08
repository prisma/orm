import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  accessMethodOf,
  createIndexTypeRegistry,
  defineIndexTypes,
  indexTypeRegistryOf,
  rendersIndexBody,
} from '../src/index-types';

describe('defineIndexTypes builder', () => {
  it('starts empty', () => {
    const builder = defineIndexTypes();
    expect(builder.entries).toEqual([]);
  });

  it('add() yields a new builder with the entry appended', () => {
    const optionsValidator = type({ key_field: 'string' });
    const builder = defineIndexTypes().add('bm25', { options: optionsValidator });
    expect(builder.entries).toHaveLength(1);
    expect(builder.entries[0]?.type).toBe('bm25');
    expect(builder.entries[0]?.options).toBe(optionsValidator);
  });

  it('add() composes multiple distinct entries in order', () => {
    const a = type({ a: 'string' });
    const b = type({ b: 'string' });
    const builder = defineIndexTypes().add('alpha', { options: a }).add('beta', { options: b });
    expect(builder.entries.map((e) => e.type)).toEqual(['alpha', 'beta']);
  });

  it("creates an index with its type's access method, the type literal unless declared", () => {
    const { entries } = defineIndexTypes()
      .add('btree', { options: type('object') })
      .add('search', { options: type('object'), accessMethod: 'gin' });
    expect(entries.map((entry) => [accessMethodOf(entry), rendersIndexBody(entry)])).toEqual([
      ['btree', false],
      ['gin', true],
    ]);
  });

  it('add() does not mutate the prior builder', () => {
    const opts = type({ x: 'string' });
    const a = defineIndexTypes();
    const b = a.add('alpha', { options: opts });
    expect(a.entries).toEqual([]);
    expect(b.entries).toHaveLength(1);
  });

  it('add() throws on duplicate type literal in the same builder', () => {
    const opts = type({ x: 'string' });
    const builder = defineIndexTypes().add('dup', { options: opts });
    expect(() => builder.add('dup', { options: opts })).toThrow(/already declared/);
  });
});

describe('createIndexTypeRegistry', () => {
  it('register stores an entry; get returns it', () => {
    const registry = createIndexTypeRegistry();
    const entry = { type: 'demo', options: type({ fillfactor: 'number' }) };
    registry.register(entry);
    expect(registry.get('demo')).toBe(entry);
  });

  it('has reports presence', () => {
    const registry = createIndexTypeRegistry();
    expect(registry.has('absent')).toBe(false);
    registry.register({ type: 'present', options: type({ k: 'string' }) });
    expect(registry.has('present')).toBe(true);
  });

  it('get returns undefined for unknown types', () => {
    const registry = createIndexTypeRegistry();
    expect(registry.get('nonesuch')).toBeUndefined();
  });

  it('register throws on duplicate type', () => {
    const registry = createIndexTypeRegistry();
    const opts = type({ key: 'string' });
    registry.register({ type: 'gin', options: opts });
    expect(() => registry.register({ type: 'gin', options: opts })).toThrow(/already registered/);
  });

  it('error message names the offending type', () => {
    const registry = createIndexTypeRegistry();
    registry.register({ type: 'gist', options: type({ k: 'string' }) });
    expect(() => registry.register({ type: 'gist', options: type({ k: 'string' }) })).toThrow(
      /gist/,
    );
  });

  it('two registries are independent', () => {
    const a = createIndexTypeRegistry();
    const b = createIndexTypeRegistry();
    a.register({ type: 'shared', options: type({ k: 'string' }) });
    expect(a.has('shared')).toBe(true);
    expect(b.has('shared')).toBe(false);
  });
});

describe('indexTypeRegistryOf', () => {
  it('registers the index types of the target and every extension pack that declares some', () => {
    const registry = indexTypeRegistryOf(
      {
        id: 'target',
        indexTypes: defineIndexTypes().add('ordered', { options: type('object') }),
      },
      [
        { id: 'no-indexes' },
        {
          id: 'search',
          indexTypes: defineIndexTypes().add('search', { options: type('object') }),
        },
      ],
    );

    expect([registry.has('ordered'), registry.has('search')]).toEqual([true, true]);
  });

  it('refuses a pack whose indexTypes is not a registration', () => {
    expect(() =>
      indexTypeRegistryOf({ id: 'target' }, [{ id: 'broken', indexTypes: 'nope' }]),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.PACK_CONTRIBUTION_INVALID' }));
  });

  describe('an index type whose access method is not its own name', () => {
    const convertedSearch = defineIndexTypes().add('search', {
      options: type('object'),
      accessMethod: 'gin',
    });

    it('is accepted from the target, which converts it', () => {
      const registry = indexTypeRegistryOf({ id: 'target', indexTypes: convertedSearch });

      expect(registry.get('search')).toMatchObject({ type: 'search', accessMethod: 'gin' });
    });

    it('is refused from an extension pack, naming the pack and the access method', () => {
      expect(() =>
        indexTypeRegistryOf({ id: 'target' }, [{ id: 'search-pack', indexTypes: convertedSearch }]),
      ).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
          message: expect.stringContaining('"search-pack"'),
          why: expect.stringContaining('target'),
          fix: expect.stringContaining('accessMethod'),
          meta: { indexType: 'search', accessMethod: 'gin', packId: 'search-pack' },
        }),
      );
    });

    it('is accepted from an extension pack that declares its own name as the access method', () => {
      const registry = indexTypeRegistryOf({ id: 'target' }, [
        {
          id: 'bm25-pack',
          indexTypes: defineIndexTypes().add('bm25', {
            options: type('object'),
            accessMethod: 'bm25',
          }),
        },
      ]);

      expect(registry.has('bm25')).toBe(true);
    });
  });
});
