import { describe, expect, it } from 'vitest';
import { contract, plan, planned, refusal, schemaCollection } from './mongo-statement-fixtures';

const INT = { codecId: 'mongo/int32@1' };
const STR = { codecId: 'mongo/string@1' };
const schema = [schemaCollection('members')];

describe('MongoMigrationPlanner, a rewrite blocked by a model that joins its documents', () => {
  it('names the earlier migration of a cast when the blocking model is new to the collection', () => {
    const guest = (codec: typeof INT) => ({
      collection: 'members',
      fields: ['_id', 'guest', 'age'],
      types: { age: codec },
    });
    const [conflict] = refusal(
      plan({
        from: contract('from', { Guest: guest(STR) }, { members: {} }),
        to: contract(
          'to',
          {
            Member: { collection: 'members', fields: ['_id', 'age'], types: { age: INT } },
            Guest: guest(INT),
          },
          { members: {} },
        ),
        schema,
      }),
    );
    expect(conflict?.why).toBe(
      'Collection "members" stores several models and no discriminator tells their documents apart, so casting the field would cast it in the documents of "Member" too. To change it in "Guest" documents only, move the models to separate collections, or keep the field\'s type in the contract. Or make the change in an earlier migration, before model "Member" is added to collection "members".',
    );
  });

  describe('a model already in the collection that starts storing the field', () => {
    const from = contract(
      'from',
      {
        Guest: { collection: 'members', fields: ['_id', 'guest', 'name'] },
        Visitor: { collection: 'members', fields: ['_id', 'visitor'] },
      },
      { members: {} },
    );
    const renamed = {
      Guest: {
        collection: 'members',
        fields: ['_id', 'guest', 'name'],
        storedAs: { name: 'fullName' },
      },
    };

    it('names the earlier migration that renames the field before that model stores it, which plans', () => {
      const to = contract(
        'to',
        { ...renamed, Visitor: { collection: 'members', fields: ['_id', 'visitor', 'name'] } },
        { members: {} },
      );
      const earlier = contract(
        'earlier',
        { ...renamed, Visitor: { collection: 'members', fields: ['_id', 'visitor'] } },
        { members: {} },
      );
      const [conflict] = refusal(plan({ from, to, schema }));
      expect({
        why: conflict?.why,
        earlier: planned(plan({ from, to: earlier, schema })).labels,
      }).toEqual({
        why: 'The stored name of field "Guest.name" changes from "name" to "fullName". Collection "members" stores several models and no discriminator tells their documents apart, so renaming the field would rename it in the documents of "Visitor" too. To change it, move the models to separate collections, or keep the stored name "name" in the contract. Or make the change in an earlier migration, before model "Visitor" stores field "name".',
        earlier: ['Rename field name to fullName in collection members'],
      });
    });

    it('names no earlier migration for a fill, which reaches its documents either way', () => {
      const [conflict] = refusal(
        plan({
          from,
          to: contract(
            'to',
            {
              Guest: { collection: 'members', fields: ['_id', 'guest', 'name', 'level'] },
              Visitor: { collection: 'members', fields: ['_id', 'visitor'] },
            },
            { members: {} },
          ),
          schema,
        }),
      );
      expect(conflict?.why?.includes('earlier migration')).toBe(false);
    });
  });
});
