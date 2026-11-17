import type { ApplicationDomain } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { otherModelsReached, variantFilterOf } from '../src/model-documents';

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

describe('variantFilterOf', () => {
  it("selects a variant's documents by the base's stored discriminator, and none for a root model", () => {
    expect([
      variantFilterOf(domain, { namespaceId: 'app', model: 'Bug' }),
      variantFilterOf(domain, { namespaceId: 'app', model: 'Task' }),
    ]).toEqual([{ kind: 'bug' }, undefined]);
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
        { kind: 'bug' },
        undefined,
      ),
    ]).toEqual([['Note'], []]);
  });
});
