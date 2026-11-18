import type { ApplicationDomain } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { otherModelsReached, selectedVariantOf, variantFilter } from '../src/model-documents';

const field = (stored: string) => ({ field: stored });

const domain = {
  namespaces: {
    app: {
      models: {
        Task: {
          fields: { type: {}, title: {} },
          relations: {},
          storage: { collection: 'items', fields: { type: field('kind'), title: field('title') } },
          discriminator: { field: 'type' },
          variants: { bug: { namespace: 'app', model: 'Bug' } },
        },
        Bug: {
          fields: { severity: {} },
          relations: {},
          storage: { fields: { severity: field('severity') } },
          base: { namespace: 'app', model: 'Task' },
        },
        Note: {
          fields: { title: {} },
          relations: {},
          storage: { collection: 'items', fields: { title: field('title') } },
        },
      },
    },
  },
} as unknown as ApplicationDomain;

describe('variantFilter', () => {
  it("selects a variant's documents by its discriminator's stored name and value", () => {
    expect(variantFilter({ field: 'kind', value: 'bug' })).toEqual({ kind: 'bug' });
  });
});

describe('selectedVariantOf', () => {
  it("names a variant's stored discriminator field and its value, and nothing for a root model", () => {
    expect([
      selectedVariantOf(domain, { namespaceId: 'app', model: 'Bug' }),
      selectedVariantOf(domain, { namespaceId: 'app', model: 'Task' }),
    ]).toEqual([{ field: 'kind', value: 'bug' }, undefined]);
  });
});

describe('otherModelsReached', () => {
  it('reaches another root model without a filter, and not one that cannot hold a variant value', () => {
    expect([
      otherModelsReached(
        domain,
        { namespaceId: 'app', model: 'Task' },
        'items',
        undefined,
        'title',
      ),
      otherModelsReached(
        domain,
        { namespaceId: 'app', model: 'Bug' },
        'items',
        { field: 'kind', value: 'bug' },
        undefined,
      ),
    ]).toEqual([['Note'], []]);
  });
});
