import { domainModelsAtDefaultNamespace } from '@internal/contract/types';
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { sql } from '@internal/sql-contract/sql-expression';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { type ContractInput, defineContract, field, model, rel } from '../src/contract-builder';
import { columnDescriptor } from './helpers/column-descriptor';

const int4Column = columnDescriptor('pg/int4@1');

const bareFamilyPack: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

function defineTestContract(models: NonNullable<ContractInput['models']>) {
  return defineContract({
    ...testTypeLookups,
    family: bareFamilyPack,
    target: postgresTargetPack,
    createNamespace: createTestSqlNamespace,
    models,
  });
}

type HasOne = ReturnType<typeof rel.hasOne>;

function userWith(profile: HasOne) {
  return model('User', {
    fields: { id: field.column(int4Column).id() },
    relations: { profile },
  });
}

function tenantUserWith(profile: HasOne) {
  return model('User', {
    fields: { tenantId: field.column(int4Column), id: field.column(int4Column) },
    relations: { profile },
  }).attributes(({ fields, constraints }) => ({
    id: constraints.id([fields.tenantId, fields.id]),
  }));
}

function notUniqueError(fields: readonly string[]) {
  return expect.objectContaining({
    code: 'CONTRACT.RELATION_INVALID',
    message: `Relation "User.profile" is one-to-one, but the fields ${fields.map((name) => `"${name}"`).join(', ')} of model "Profile" are not unique. Add a unique constraint over exactly those fields, or make "profile" a hasMany relation.`,
    meta: {
      modelName: 'User',
      relationName: 'profile',
      targetModel: 'Profile',
      fields,
      reason: 'has-one-key-not-unique',
    },
  });
}

function relationOf(
  contract: ReturnType<typeof defineTestContract>,
  modelName: string,
  relationName: string,
) {
  return domainModelsAtDefaultNamespace(contract.domain)[modelName]?.relations[relationName];
}

function profileRelation(contract: ReturnType<typeof defineTestContract>) {
  return relationOf(contract, 'User', 'profile');
}

describe('a hasOne relation key', () => {
  it('is refused when the target field is not unique', () => {
    const Profile = model('Profile', {
      fields: { id: field.column(int4Column).id(), userId: field.column(int4Column) },
    });
    expect(() =>
      defineTestContract({ User: userWith(rel.hasOne(Profile, { by: 'userId' })), Profile }),
    ).toThrow(notUniqueError(['userId']));
  });

  it('is accepted when the target field is the primary key', () => {
    const Profile = model('Profile', {
      fields: { userId: field.column(int4Column).id() },
    });
    expect(
      profileRelation(
        defineTestContract({ User: userWith(rel.hasOne(Profile, { by: 'userId' })), Profile }),
      ),
    ).toMatchObject({
      cardinality: '1:1',
      on: { localFields: ['id'], targetFields: ['userId'] },
    });
  });

  it('is accepted when the target field is unique', () => {
    const Profile = model('Profile', {
      fields: { id: field.column(int4Column).id(), userId: field.column(int4Column).unique() },
    });
    expect(
      profileRelation(
        defineTestContract({ User: userWith(rel.hasOne(Profile, { by: 'userId' })), Profile }),
      ),
    ).toMatchObject({
      cardinality: '1:1',
      on: { localFields: ['id'], targetFields: ['userId'] },
    });
  });

  it('is accepted when a unique index covers exactly the target field', () => {
    const Profile = model('Profile', {
      fields: { id: field.column(int4Column).id(), userId: field.column(int4Column) },
    }).sql(({ cols, constraints }) => ({
      indexes: [constraints.index([cols.userId], { unique: true })],
    }));
    expect(
      profileRelation(
        defineTestContract({ User: userWith(rel.hasOne(Profile, { by: 'userId' })), Profile }),
      ),
    ).toMatchObject({
      cardinality: '1:1',
    });
  });

  it('is refused when the only unique index over the target field is partial', () => {
    const Profile = model('Profile', {
      fields: { id: field.column(int4Column).id(), userId: field.column(int4Column) },
    }).sql(({ cols, constraints }) => ({
      indexes: [
        constraints.index([cols.userId], { unique: true, where: sql`(user_id IS NOT NULL)` }),
      ],
    }));
    expect(() =>
      defineTestContract({ User: userWith(rel.hasOne(Profile, { by: 'userId' })), Profile }),
    ).toThrow(notUniqueError(['userId']));
  });

  it('is refused when the only unique index over the target field is an expression index', () => {
    const Profile = model('Profile', {
      fields: { id: field.column(int4Column).id(), userId: field.column(int4Column) },
    }).sql(({ constraints }) => ({
      indexes: [
        constraints.index({ expression: sql`("userId")`, unique: true, name: 'profile_user' }),
      ],
    }));
    expect(() =>
      defineTestContract({ User: userWith(rel.hasOne(Profile, { by: 'userId' })), Profile }),
    ).toThrow(notUniqueError(['userId']));
  });

  it('is refused when the target fields are covered only by a larger unique', () => {
    const Profile = model('Profile', {
      fields: {
        id: field.column(int4Column).id(),
        tenantId: field.column(int4Column),
        userId: field.column(int4Column),
      },
    }).attributes(({ fields, constraints }) => ({
      uniques: [constraints.unique([fields.tenantId, fields.userId, fields.id])],
    }));
    expect(() =>
      defineTestContract({
        User: tenantUserWith(rel.hasOne(Profile, { by: ['tenantId', 'userId'] })),
        Profile,
      }),
    ).toThrow(notUniqueError(['tenantId', 'userId']));
  });

  it('is refused when only part of the target fields is unique', () => {
    const Profile = model('Profile', {
      fields: {
        id: field.column(int4Column).id(),
        tenantId: field.column(int4Column),
        userId: field.column(int4Column).unique(),
      },
    });
    expect(() =>
      defineTestContract({
        User: tenantUserWith(rel.hasOne(Profile, { by: ['tenantId', 'userId'] })),
        Profile,
      }),
    ).toThrow(notUniqueError(['tenantId', 'userId']));
  });

  it('is accepted when a unique lists the target fields in another order', () => {
    const Profile = model('Profile', {
      fields: {
        id: field.column(int4Column).id(),
        tenantId: field.column(int4Column),
        userId: field.column(int4Column),
      },
    }).attributes(({ fields, constraints }) => ({
      uniques: [constraints.unique([fields.userId, fields.tenantId])],
    }));
    expect(
      profileRelation(
        defineTestContract({
          User: tenantUserWith(rel.hasOne(Profile, { by: ['tenantId', 'userId'] })),
          Profile,
        }),
      ),
    ).toMatchObject({
      cardinality: '1:1',
      on: { localFields: ['tenantId', 'id'], targetFields: ['tenantId', 'userId'] },
    });
  });

  it('is accepted alongside a belongsTo over the same unique fields', () => {
    const User = userWith(rel.hasOne(() => Profile, { by: 'userId' }));
    const Profile = model('Profile', {
      fields: { id: field.column(int4Column).id(), userId: field.column(int4Column).unique() },
      relations: { user: rel.belongsTo(User, { from: 'userId', to: 'id' }) },
    });
    const contract = defineTestContract({ User, Profile });
    expect(profileRelation(contract)).toMatchObject({ cardinality: '1:1' });
    expect(relationOf(contract, 'Profile', 'user')).toMatchObject({
      cardinality: 'N:1',
      on: { localFields: ['userId'], targetFields: ['id'] },
    });
  });
});
