import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { createIndexTypeRegistry, defineIndexTypes, indexTypeRegistryOf } from '../src/index-types';

describe('defineIndexTypes builder', () => {
  it('starts empty', () => {
    const builder = defineIndexTypes();
    expect(builder.entries).toEqual([]);
  });

  it('add() yields a new builder with the entry appended', () => {
    const optionsValidator = type({ key_field: 'string' });
    const builder = defineIndexTypes().add('bm25', {
      options: optionsValidator,
      backsForeignKey: false,
    });
    expect(builder.entries).toHaveLength(1);
    expect(builder.entries[0]?.type).toBe('bm25');
    expect(builder.entries[0]?.options).toBe(optionsValidator);
  });

  it('add() composes multiple distinct entries in order', () => {
    const a = type({ a: 'string' });
    const b = type({ b: 'string' });
    const builder = defineIndexTypes()
      .add('alpha', { options: a, backsForeignKey: false })
      .add('beta', { options: b, backsForeignKey: false });
    expect(builder.entries.map((e) => e.type)).toEqual(['alpha', 'beta']);
  });

  it('add() does not mutate the prior builder', () => {
    const opts = type({ x: 'string' });
    const a = defineIndexTypes();
    const b = a.add('alpha', { options: opts, backsForeignKey: false });
    expect(a.entries).toEqual([]);
    expect(b.entries).toHaveLength(1);
  });

  it('add() throws on duplicate type literal in the same builder', () => {
    const opts = type({ x: 'string' });
    const builder = defineIndexTypes().add('dup', { options: opts, backsForeignKey: false });
    expect(() => builder.add('dup', { options: opts, backsForeignKey: false })).toThrow(
      /already declared/,
    );
  });
});

describe('createIndexTypeRegistry', () => {
  it('register stores an entry; get returns it', () => {
    const registry = createIndexTypeRegistry();
    const entry = { type: 'demo', options: type({ fillfactor: 'number' }), backsForeignKey: true };
    registry.register(entry);
    expect(registry.get('demo')).toBe(entry);
  });

  it('has reports presence', () => {
    const registry = createIndexTypeRegistry();
    expect(registry.has('absent')).toBe(false);
    registry.register({ type: 'present', options: type({ k: 'string' }), backsForeignKey: false });
    expect(registry.has('present')).toBe(true);
  });

  it('get returns undefined for unknown types', () => {
    const registry = createIndexTypeRegistry();
    expect(registry.get('nonesuch')).toBeUndefined();
  });

  it('register throws on duplicate type', () => {
    const registry = createIndexTypeRegistry();
    const opts = type({ key: 'string' });
    registry.register({ type: 'gin', options: opts, backsForeignKey: false });
    expect(() => registry.register({ type: 'gin', options: opts, backsForeignKey: false })).toThrow(
      /already registered/,
    );
  });

  it('error message names the offending type', () => {
    const registry = createIndexTypeRegistry();
    registry.register({ type: 'gist', options: type({ k: 'string' }), backsForeignKey: false });
    expect(() =>
      registry.register({ type: 'gist', options: type({ k: 'string' }), backsForeignKey: false }),
    ).toThrow(/gist/);
  });

  it('says whether a registered type can back a foreign key, and no unregistered type can', () => {
    const registry = createIndexTypeRegistry();
    registry.register({ type: 'ordered', options: type('object'), backsForeignKey: true });
    registry.register({ type: 'search', options: type('object'), backsForeignKey: false });

    expect(['ordered', 'search', 'unknown'].map((t) => registry.backsForeignKey(t))).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('refuses an entry that does not say whether it can back a foreign key', () => {
    const registry = createIndexTypeRegistry();
    const entry = { type: 'legacy', options: type('object') };

    expect(() => registry.register(entry as never)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        message: expect.stringContaining('"legacy"'),
        why: expect.stringContaining('foreign key'),
        fix: expect.stringContaining('backsForeignKey'),
      }),
    );
  });

  it('names the pack that registered an entry without backsForeignKey', () => {
    expect(() =>
      indexTypeRegistryOf([
        {
          id: 'legacy-pack',
          indexTypes: { entries: [{ type: 'legacy', options: type('object') }] },
        },
      ]),
    ).toThrow(
      expect.objectContaining({
        message: expect.stringContaining('"legacy-pack"'),
        meta: expect.objectContaining({ indexType: 'legacy', packId: 'legacy-pack' }),
      }),
    );
  });
});

describe('indexTypeRegistryOf', () => {
  it('registers the index types of every pack that declares some', () => {
    const registry = indexTypeRegistryOf([
      {
        id: 'target',
        indexTypes: defineIndexTypes().add('ordered', {
          options: type('object'),
          backsForeignKey: true,
        }),
      },
      { id: 'no-indexes' },
      {
        id: 'search',
        indexTypes: defineIndexTypes().add('search', {
          options: type('object'),
          backsForeignKey: false,
        }),
      },
    ]);

    expect([registry.backsForeignKey('ordered'), registry.backsForeignKey('search')]).toEqual([
      true,
      false,
    ]);
  });

  it('refuses a pack whose indexTypes is not a registration', () => {
    expect(() => indexTypeRegistryOf([{ id: 'broken', indexTypes: 'nope' }])).toThrow(
      expect.objectContaining({ code: 'CONTRACT.PACK_CONTRIBUTION_INVALID' }),
    );
  });

  it('two registries are independent', () => {
    const a = createIndexTypeRegistry();
    const b = createIndexTypeRegistry();
    a.register({ type: 'shared', options: type({ k: 'string' }), backsForeignKey: false });
    expect(a.has('shared')).toBe(true);
    expect(b.has('shared')).toBe(false);
  });
});
