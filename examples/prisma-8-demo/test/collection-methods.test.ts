import type { Collection } from '@prisma/orm-postgres/orm-client';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Contract } from '../src/prisma/contract.d';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };
import { db } from '../src/prisma/db';

type ModelName = keyof Contract['domain']['namespaces']['public']['models'] & string;
type MethodName<M extends ModelName> = keyof Collection<Contract, M>['using'] & string;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const methodNames = {
  Bug: [],
  Feature: [],
  Post: ['embedding_nearest', 'post_search', 'post_title_search'],
  PostTag: [],
  Tag: [],
  Task: [],
  User: [],
} as const satisfies { readonly [M in ModelName]: readonly MethodName<M>[] };

describe('the contributed methods of the demo contract', () => {
  it('are the same in the types and at run time', () => {
    type TypesAgree = {
      [M in ModelName]: Same<MethodName<M>, (typeof methodNames)[M][number]>;
    }[ModelName];
    expectTypeOf<TypesAgree>().toEqualTypeOf<true>();

    const models = Object.keys(contractJson.domain.namespaces.public.models) as ModelName[];
    expect(
      Object.fromEntries(
        models.map((model) => [model, Object.keys(db.orm.public[model].using).sort()]),
      ),
    ).toEqual(methodNames);
  });
});
