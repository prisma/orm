import { describe, expect, it } from 'vitest';
import { sqliteTargetDescriptorMeta } from '../src/core/descriptor-meta';
import sqliteTargetPack from '../src/exports/pack';

describe('sqliteTargetDescriptorMeta', () => {
  it('declares no namespace support, so emitted model names carry no namespace segment', () => {
    expect(sqliteTargetDescriptorMeta.supportsNamespaces).toBe(false);
  });

  it('declares the expected defaultNamespaceId', () => {
    expect(sqliteTargetDescriptorMeta.defaultNamespaceId).toBe('__unbound__');
  });
});

describe('sqliteTargetPack', () => {
  it('matches the descriptor metadata', () => {
    expect(sqliteTargetPack).toEqual(sqliteTargetDescriptorMeta);
  });
});
