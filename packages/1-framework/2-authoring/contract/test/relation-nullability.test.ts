import type { ApplicationDomain, ContractModelBase } from '@internal/contract/types';
import { crossRef, UNBOUND_DOMAIN_NAMESPACE_ID } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  resolveToOneRelationNullable,
  withDerivedToOneRelationNullability,
} from '../src/relation-nullability';

describe('resolveToOneRelationNullable', () => {
  describe('owning side', () => {
    it('is nullable when any local field is nullable', () => {
      expect(
        resolveToOneRelationNullable({
          declaredNullable: undefined,
          localFieldNullability: [false, true],
          ownsReference: true,
        }),
      ).toEqual({ nullable: true, contradiction: undefined });
    });

    it('is required when every local field is required', () => {
      expect(
        resolveToOneRelationNullable({
          declaredNullable: undefined,
          localFieldNullability: [false, false],
          ownsReference: true,
        }),
      ).toEqual({ nullable: false, contradiction: undefined });
    });

    it('accepts a declaration that agrees with the local fields', () => {
      expect(
        resolveToOneRelationNullable({
          declaredNullable: true,
          localFieldNullability: [true],
          ownsReference: true,
        }),
      ).toEqual({ nullable: true, contradiction: undefined });
      expect(
        resolveToOneRelationNullable({
          declaredNullable: false,
          localFieldNullability: [false],
          ownsReference: true,
        }),
      ).toEqual({ nullable: false, contradiction: undefined });
    });

    it('reports declared-optional when declared nullable over required fields', () => {
      expect(
        resolveToOneRelationNullable({
          declaredNullable: true,
          localFieldNullability: [false],
          ownsReference: true,
        }),
      ).toEqual({ nullable: false, contradiction: 'declared-optional' });
    });

    it('reports declared-required when declared required over a nullable field', () => {
      expect(
        resolveToOneRelationNullable({
          declaredNullable: false,
          localFieldNullability: [false, true],
          ownsReference: true,
        }),
      ).toEqual({ nullable: true, contradiction: 'declared-required' });
    });
  });

  describe('non-owning side', () => {
    it('is always nullable, whatever the local fields say', () => {
      expect(
        resolveToOneRelationNullable({
          declaredNullable: undefined,
          localFieldNullability: [false],
          ownsReference: false,
        }),
      ).toEqual({ nullable: true, contradiction: undefined });
    });

    it('accepts a nullable declaration', () => {
      expect(
        resolveToOneRelationNullable({
          declaredNullable: true,
          localFieldNullability: [],
          ownsReference: false,
        }),
      ).toEqual({ nullable: true, contradiction: undefined });
    });

    it('reports declared-required when declared required', () => {
      expect(
        resolveToOneRelationNullable({
          declaredNullable: false,
          localFieldNullability: [],
          ownsReference: false,
        }),
      ).toEqual({ nullable: true, contradiction: 'declared-required' });
    });
  });
});

describe('withDerivedToOneRelationNullability', () => {
  const field = { nullable: false, type: { kind: 'scalar' as const, codecId: 'pg/int4@1' } };

  function domainWith(relations: ContractModelBase['relations']): ApplicationDomain {
    return {
      namespaces: {
        [UNBOUND_DOMAIN_NAMESPACE_ID]: {
          models: {
            Post: { fields: { id: field, authorId: field }, relations, storage: {} },
            User: { fields: { id: field }, relations: {}, storage: {} },
          },
        },
      },
    };
  }

  function relationsOf(domain: ApplicationDomain) {
    return domain.namespaces[UNBOUND_DOMAIN_NAMESPACE_ID]?.models['Post']?.relations;
  }

  it('fills a missing nullable on a same-space to-one relation from the lookup', () => {
    const domain = domainWith({
      author: {
        to: crossRef('User'),
        cardinality: 'N:1',
        on: { localFields: ['authorId'], targetFields: ['id'] },
      } as never,
    });
    const seen: string[][] = [];
    const derived = withDerivedToOneRelationNullability(domain, ({ relation }) => {
      seen.push([...relation.on.localFields]);
      return { ownsReference: true, localFieldNullability: [true] };
    });
    expect(seen).toEqual([['authorId']]);
    expect(relationsOf(derived)).toEqual({
      author: {
        to: crossRef('User'),
        cardinality: 'N:1',
        nullable: true,
        on: { localFields: ['authorId'], targetFields: ['id'] },
      },
    });
  });

  it('fills a missing nullable on a non-owning 1:1 side with true whatever its fields say', () => {
    const domain = domainWith({
      profile: {
        to: crossRef('User'),
        cardinality: '1:1',
        on: { localFields: ['id'], targetFields: ['postId'] },
      } as never,
    });
    const derived = withDerivedToOneRelationNullability(domain, () => ({
      ownsReference: false,
      localFieldNullability: [false],
    }));
    expect(relationsOf(derived)?.['profile']).toMatchObject({ nullable: true });
  });

  it('keeps a present nullable and never consults the lookup', () => {
    const domain = domainWith({
      author: {
        to: crossRef('User'),
        cardinality: 'N:1',
        nullable: false,
        on: { localFields: ['authorId'], targetFields: ['id'] },
      },
    });
    const derived = withDerivedToOneRelationNullability(domain, () => {
      throw new Error('lookup must not run');
    });
    expect(relationsOf(derived)?.['author']).toMatchObject({ nullable: false });
  });

  it('defaults a cross-space to-one relation to nullable without consulting the lookup', () => {
    const domain = domainWith({
      author: {
        to: { ...crossRef('User'), space: 'auth' },
        cardinality: 'N:1',
        on: { localFields: ['authorId'], targetFields: ['id'] },
      } as never,
    });
    const derived = withDerivedToOneRelationNullability(domain, () => {
      throw new Error('lookup must not run');
    });
    expect(relationsOf(derived)?.['author']).toMatchObject({ nullable: true });
  });

  it('leaves to-many and embed relations untouched', () => {
    const domain = domainWith({
      posts: {
        to: crossRef('User'),
        cardinality: '1:N',
        on: { localFields: ['id'], targetFields: ['authorId'] },
      },
      profile: { to: crossRef('User'), cardinality: '1:1' },
    });
    const derived = withDerivedToOneRelationNullability(domain, () => ({
      ownsReference: true,
      localFieldNullability: [true],
    }));
    expect(relationsOf(derived)).toEqual(relationsOf(domain));
  });
});
