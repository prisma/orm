import { describe, expect, it } from 'vitest';
import { loadFixtureSchema, loadFixtureTable } from './support';

describe('omitted referential actions', () => {
  const onDelete = async (tableName: string) =>
    (await loadFixtureTable('referential-action-defaults', tableName)).foreignKeys.map((fk) => ({
      onDelete: fk['onDelete'],
      onUpdate: fk['onUpdate'],
    }));

  it('restricts deletes when any foreign key field is required, as Prisma 7 does', async () => {
    expect(await onDelete('MixedChild')).toEqual([{ onDelete: 'restrict', onUpdate: 'cascade' }]);
  });

  it('sets null on delete only when every foreign key field is optional', async () => {
    expect(await onDelete('OptionalChild')).toEqual([{ onDelete: 'setNull', onUpdate: 'cascade' }]);
  });

  it('accepts an optional relation field over required fields, with the foreign key of a required relation', async () => {
    expect(await onDelete('Post')).toEqual([{ onDelete: 'restrict', onUpdate: 'cascade' }]);
  });
});

describe('@ignore on a relation field', () => {
  it('omits the back-relations and the junction that pair with an ignored relation field', async () => {
    const result = await loadFixtureSchema('ignored-relation-back-relations');
    if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
    const models = result.value.domain.namespaces['public']?.models ?? {};
    expect({
      models: Object.keys(models).sort(),
      userRelations: Object.keys(models['User']?.relations ?? {}),
    }).toEqual({ models: ['Post', 'Profile', 'Tag', 'User'], userRelations: [] });
  });
});

describe('one relation name on implicit many-to-many relations in two schemas', () => {
  it('lowers a junction table in each schema, wired to its own pair of models', async () => {
    const targets = async (namespaceId: string) =>
      (await loadFixtureTable('relation-name-in-two-schemas', '_X', namespaceId)).foreignKeys.map(
        (fk) => (fk['target'] as { namespaceId: string; tableName: string }).tableName,
      );
    expect({ one: await targets('one'), two: await targets('two') }).toEqual({
      one: ['A', 'B'],
      two: ['C', 'D'],
    });
  });
});

describe('a model named like an implicit junction model', () => {
  it('loads when the model is in another schema than the junction', async () => {
    const result = await loadFixtureSchema('junction-name-in-other-schema');
    if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
    const { namespaces } = result.value.domain;
    expect({
      one: Object.keys(namespaces['one']?.models ?? {}).sort(),
      two: Object.keys(namespaces['two']?.models ?? {}).sort(),
    }).toEqual({ one: ['Post', 'PostToTag', 'Tag'], two: ['PostToTag'] });
  });
});

describe('implicit many-to-many junction relation fields', () => {
  it('are named after the tables they reference, as contract infer names them', async () => {
    const result = await loadFixtureSchema('implicit-many-to-many');
    if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
    const models = result.value.domain.namespaces['public']?.models ?? {};
    expect({
      PostToTag: Object.keys(models['PostToTag']?.relations ?? {}),
      Favorites: Object.keys(models['Favorites']?.relations ?? {}),
      Follows: Object.keys(models['Follows']?.relations ?? {}),
    }).toEqual({
      PostToTag: ['post', 'tag'],
      Favorites: ['post', 'user'],
      Follows: ['user', 'userUser'],
    });
  });
});
