import { describe, expect, it } from 'vitest';
import type { PslExtensionBlock, PslModel, PslSpan } from '../src/control/psl-ast';
import {
  BUILTIN_PSL_KIND_KEYS,
  makePslNamespace,
  makePslNamespaceEntries,
  namespacePslExtensionBlocks,
} from '../src/control/psl-ast';

const SPAN: PslSpan = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
};

function makeModel(name: string): PslModel {
  return { kind: 'model', name, fields: [], attributes: [], span: SPAN };
}

function makeExtensionBlock(
  discriminator: string,
  name: string,
  keyword: string = discriminator,
): PslExtensionBlock {
  return {
    kind: discriminator,
    keyword,
    name,
    parameters: {},
    blockAttributes: [],
    attributes: {},
    span: SPAN,
  };
}

describe('makePslNamespace / makePslNamespaceEntries', () => {
  describe('entries structure', () => {
    it('groups built-in models under entries["model"]', () => {
      const user = makeModel('User');
      const post = makeModel('Post');
      const ns = makePslNamespace({
        kind: 'namespace',
        name: 'public',
        entries: makePslNamespaceEntries([user, post], [], []),
        span: SPAN,
      });

      expect(ns.entries['model']?.['User']).toBe(user);
      expect(ns.entries['model']?.['Post']).toBe(post);
    });

    it('groups extension-contributed blocks under entries[discriminator]', () => {
      const block = makeExtensionBlock('policy_select', 'ReadPosts');
      const ns = makePslNamespace({
        kind: 'namespace',
        name: 'public',
        entries: makePslNamespaceEntries([], [], [block]),
        span: SPAN,
      });

      expect(ns.entries['policy_select']?.['ReadPosts']).toBe(block);
    });

    it('addresses a built-in kind and an extension-contributed kind through the same entries[kind][name] expression', () => {
      const user = makeModel('User');
      const policy = makeExtensionBlock('policy_select', 'ReadUsers');
      const ns = makePslNamespace({
        kind: 'namespace',
        name: 'public',
        entries: makePslNamespaceEntries([user], [], [policy]),
        span: SPAN,
      });

      // Both resolve via the uniform coordinate path entries[kind][name].
      const builtInResult = ns.entries['model']?.['User'];
      const extensionResult = ns.entries['policy_select']?.['ReadUsers'];

      expect(builtInResult).toBe(user);
      expect(extensionResult).toBe(policy);
      // Confirm both expressions share the same shape (kind + name on the node).
      expect(builtInResult?.kind).toBe('model');
      expect(builtInResult?.name).toBe('User');
      expect(extensionResult?.kind).toBe('policy_select');
      expect(extensionResult?.name).toBe('ReadUsers');
    });
  });

  describe('derived accessors', () => {
    it('models accessor returns models from entries', () => {
      const user = makeModel('User');
      const ns = makePslNamespace({
        kind: 'namespace',
        name: 'public',
        entries: makePslNamespaceEntries([user], [], []),
        span: SPAN,
      });

      expect(ns.models).toEqual([user]);
    });

    it('models/compositeTypes are non-enumerable on the namespace object', () => {
      const ns = makePslNamespace({
        kind: 'namespace',
        name: 'public',
        entries: makePslNamespaceEntries([makeModel('User')], [], []),
        span: SPAN,
      });

      const ownKeys = Object.keys(ns);
      expect(ownKeys).not.toContain('models');
      expect(ownKeys).not.toContain('compositeTypes');
      // Only the stored fields are enumerable.
      expect(ownKeys).toContain('kind');
      expect(ownKeys).toContain('name');
      expect(ownKeys).toContain('entries');
      expect(ownKeys).toContain('span');
    });

    it('spreading the namespace does not duplicate entity data alongside entries', () => {
      const user = makeModel('User');
      const ns = makePslNamespace({
        kind: 'namespace',
        name: 'public',
        entries: makePslNamespaceEntries([user], [], []),
        span: SPAN,
      });

      const spread = { ...ns };
      expect(Object.hasOwn(spread, 'models')).toBe(false);
      expect(Object.hasOwn(spread, 'compositeTypes')).toBe(false);
    });
  });

  describe('BUILTIN_PSL_KIND_KEYS and namespacePslExtensionBlocks', () => {
    it('BUILTIN_PSL_KIND_KEYS contains model and compositeType but not enum', () => {
      expect(BUILTIN_PSL_KIND_KEYS.has('model')).toBe(true);
      expect(BUILTIN_PSL_KIND_KEYS.has('compositeType')).toBe(true);
      // 'enum' is now claimed by the extension-block grammar (TML-2853-D1),
      // so it must NOT be in BUILTIN_PSL_KIND_KEYS — that would cause
      // namespacePslExtensionBlocks to skip enum extension blocks.
      expect(BUILTIN_PSL_KIND_KEYS.has('enum')).toBe(false);
    });

    it('namespacePslExtensionBlocks returns only extension blocks, not built-ins', () => {
      const user = makeModel('User');
      const policy = makeExtensionBlock('policy_select', 'ReadUsers');
      const ns = makePslNamespace({
        kind: 'namespace',
        name: 'public',
        entries: makePslNamespaceEntries([user], [], [policy]),
        span: SPAN,
      });

      const extBlocks = namespacePslExtensionBlocks(ns);
      expect(extBlocks).toHaveLength(1);
      expect(extBlocks[0]).toBe(policy);
    });
  });

  describe('N:1 keyword-to-discriminator grouping (fake shape_circle/shape_square contribution)', () => {
    it('routes two distinct keywords sharing one discriminator into the same entries[kind] slot', () => {
      const circle = makeExtensionBlock('shape', 'Round', 'shape_circle');
      const square = makeExtensionBlock('shape', 'Boxy', 'shape_square');
      const ns = makePslNamespace({
        kind: 'namespace',
        name: 'public',
        entries: makePslNamespaceEntries([], [], [circle, square]),
        span: SPAN,
      });

      expect(Object.keys(ns.entries['shape'] ?? {})).toEqual(['Round', 'Boxy']);
      expect(ns.entries['shape']?.['Round']).toBe(circle);
      expect(ns.entries['shape']?.['Boxy']).toBe(square);
    });

    it('each block keeps its own keyword despite sharing a kind', () => {
      const circle = makeExtensionBlock('shape', 'Round', 'shape_circle');
      const square = makeExtensionBlock('shape', 'Boxy', 'shape_square');

      expect(circle.kind).toBe('shape');
      expect(square.kind).toBe('shape');
      expect(circle.keyword).toBe('shape_circle');
      expect(square.keyword).toBe('shape_square');
    });
  });
});
