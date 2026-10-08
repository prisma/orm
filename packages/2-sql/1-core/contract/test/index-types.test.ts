import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { createIndexTypeRegistry, defineIndexTypes } from '../src/index-types';

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
