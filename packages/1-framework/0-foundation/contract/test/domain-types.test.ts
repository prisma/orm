import { describe, expect, it } from 'vitest';
import { asNamespaceId } from '../src/namespace-id';

function crossRef(model: string, namespace = 'default') {
  return { namespace: asNamespaceId(namespace), model };
}

import type {
  ContractEmbedRelation,
  ContractField,
  ContractFieldType,
  ContractModel,
  ContractReferenceRelation,
  ContractRelation,
  ContractValueObject,
  ScalarFieldType,
  ValueObjectFieldType,
} from '../src/domain-types';

type AssertExtends<T, U> = T extends U ? true : never;

describe('contract types', () => {
  it('ContractField carries nullable and typed scalar', () => {
    const field: ContractField = {
      nullable: true,
      type: { kind: 'scalar', codecId: 'pg/text@1' },
    };
    expect(field.nullable).toBe(true);
    expect(field.type.kind).toBe('scalar');
  });

  it('ContractFieldType narrows on kind to scalar', () => {
    const fieldType: ContractFieldType = { kind: 'scalar', codecId: 'pg/text@1' };
    if (fieldType.kind === 'scalar') {
      const _codecId: string = fieldType.codecId;
      expect(_codecId).toBe('pg/text@1');
    }
  });

  it('ContractFieldType narrows on kind to valueObject', () => {
    const fieldType: ContractFieldType = { kind: 'valueObject', name: 'Address' };
    if (fieldType.kind === 'valueObject') {
      const _name: string = fieldType.name;
      expect(_name).toBe('Address');
    }
  });

  it('ScalarFieldType accepts optional typeParams', () => {
    const scalar: ScalarFieldType = {
      kind: 'scalar',
      codecId: 'pg/jsonb@1',
      typeParams: { schema: {} },
    };
    expect(scalar.typeParams).toBeDefined();
  });

  it('ContractField supports many modifier', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'scalar', codecId: 'pg/text@1' },
      many: true,
    };
    expect(field.many).toBe(true);
  });

  it('ContractField supports dict modifier', () => {
    const field: ContractField = {
      nullable: false,
      type: { kind: 'valueObject', name: 'Address' },
      dict: true,
    };
    expect(field.dict).toBe(true);
  });

  it('ValueObjectFieldType extends ContractFieldType', () => {
    const _check: AssertExtends<ValueObjectFieldType, ContractFieldType> = true;
    expect(_check).toBe(true);
  });

  it('ContractReferenceRelation requires on and allows all cardinalities', () => {
    const relation: ContractReferenceRelation = {
      to: crossRef('Post'),
      cardinality: '1:N',
      on: { localFields: ['id'], targetFields: ['userId'] },
    };
    expect(relation.to.model).toBe('Post');
    expect(relation.on.localFields).toEqual(['id']);

    const _extendsRelation: AssertExtends<ContractReferenceRelation, ContractRelation> = true;
    expect(_extendsRelation).toBe(true);
  });

  it('ContractEmbedRelation has no on and excludes N:1 cardinality', () => {
    const relation: ContractEmbedRelation = {
      to: crossRef('Address'),
      cardinality: '1:N',
    };
    expect(relation.to.model).toBe('Address');
    expect('on' in relation).toBe(false);

    const _extendsRelation: AssertExtends<ContractEmbedRelation, ContractRelation> = true;
    expect(_extendsRelation).toBe(true);

    // @ts-expect-error — N:1 is reference-only, not assignable to ContractEmbedRelation
    const _n1NotEmbed: AssertExtends<{ to: string; cardinality: 'N:1' }, ContractEmbedRelation> =
      true;
    void _n1NotEmbed;
  });

  it('ContractRelation is a union of reference and embed', () => {
    const ref: ContractRelation = {
      to: crossRef('Post'),
      cardinality: 'N:1',
      nullable: false,
      on: { localFields: ['postId'], targetFields: ['id'] },
    };
    const embed: ContractRelation = {
      to: crossRef('Address'),
      cardinality: '1:1',
    };
    expect(ref.to.model).toBe('Post');
    expect(embed.to.model).toBe('Address');
  });

  it('ContractModel supports polymorphism fields', () => {
    const model: ContractModel = {
      fields: {
        type: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
      },
      relations: {},
      storage: {},
      discriminator: { field: 'type' },
      variants: { Special: { value: 'special' } },
    };
    expect(model.discriminator?.field).toBe('type');
    expect(model.variants).toBeDefined();
  });

  it('ContractModel supports base for variant models', () => {
    const model: ContractModel = {
      fields: {},
      relations: {},
      storage: {},
      base: crossRef('Parent'),
    };
    expect(model.base?.model).toBe('Parent');
  });

  it('ContractModel supports owner for component membership', () => {
    const model: ContractModel = {
      fields: {
        street: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
      },
      relations: {},
      storage: {},
      owner: 'User',
    };
    expect(model.owner).toBe('User');
  });

  it('ContractValueObject holds fields without identity', () => {
    const vo: ContractValueObject = {
      fields: {
        street: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
        city: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
        zip: { nullable: true, type: { kind: 'scalar', codecId: 'pg/text@1' } },
      },
    };
    expect(Object.keys(vo.fields)).toEqual(['street', 'city', 'zip']);
  });

  it('ContractValueObject field can reference another value object', () => {
    const vo: ContractValueObject = {
      fields: {
        home: { nullable: false, type: { kind: 'valueObject', name: 'Address' } },
        work: { nullable: true, type: { kind: 'valueObject', name: 'Address' } },
      },
    };
    expect(vo.fields['home']!.type.kind).toBe('valueObject');
  });
});
