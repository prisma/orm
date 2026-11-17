import type { ContractField, ContractValueObject } from '@internal/contract/types';
import { crossRef } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  derive,
  embedMany,
  embedOne,
  jsonSchemas,
  model,
  objectId,
} from './collection-validator-helpers';
import { scalarField, voArrayField, voField } from './derive-json-schema-helpers';

const label = () => scalarField('mongo/string@1');
const openObject = { bsonType: 'object' };

function closed(properties: Record<string, unknown>, required: string[] = []) {
  return {
    bsonType: 'object',
    ...(required.length > 0 ? { required } : {}),
    properties,
    additionalProperties: false,
  };
}

function rootSchema(properties: Record<string, unknown>, required: string[]) {
  return closed({ _id: { bsonType: 'objectId' }, ...properties }, ['_id', ...required].sort());
}

function deriveThing(
  fields: Record<string, ContractField>,
  valueObjects: Record<string, ContractValueObject>,
) {
  return jsonSchemas(
    derive({
      roots: { things: crossRef('Thing') },
      models: { Thing: model({ _id: objectId(), ...fields }) },
      valueObjects,
    }),
  )['things'];
}

describe('deriveCollectionValidators for types that contain themselves', () => {
  describe('value objects', () => {
    const navItem = {
      fields: { label: label(), children: voArrayField('NavItem') },
    };

    it('describes a value object that contains itself in full, and its own field as a list of open objects', () => {
      expect(deriveThing({ items: voArrayField('NavItem') }, { NavItem: navItem })).toEqual(
        rootSchema(
          {
            items: {
              bsonType: 'array',
              items: closed(
                {
                  label: { bsonType: 'string' },
                  children: { bsonType: 'array', items: openObject },
                },
                ['children', 'label'],
              ),
            },
          },
          ['items'],
        ),
      );
    });

    it('describes the recursive type in full again in a sibling field', () => {
      const described = closed(
        { label: { bsonType: 'string' }, children: { bsonType: 'array', items: openObject } },
        ['children', 'label'],
      );

      expect(
        deriveThing({ main: voField('NavItem'), footer: voField('NavItem') }, { NavItem: navItem }),
      ).toEqual(rootSchema({ main: described, footer: described }, ['footer', 'main']));
    });

    it('writes an optional value object inside itself as an open object or null', () => {
      expect(
        deriveThing(
          { head: voField('Node') },
          { Node: { fields: { label: label(), next: voField('Node', true) } } },
        ),
      ).toEqual(
        rootSchema(
          {
            head: closed(
              {
                label: { bsonType: 'string' },
                next: { oneOf: [{ bsonType: 'null' }, openObject] },
              },
              ['label'],
            ),
          },
          ['head'],
        ),
      );
    });

    it('keeps the nullable forms of a list at the repeat', () => {
      expect(
        deriveThing(
          { root: voField('Node') },
          { Node: { fields: { children: voArrayField('Node', true, true) } } },
        ),
      ).toEqual(
        rootSchema(
          {
            root: closed({
              children: {
                bsonType: ['null', 'array'],
                items: { oneOf: [{ bsonType: 'null' }, openObject] },
              },
            }),
          },
          ['root'],
        ),
      );
    });

    it('opens every field that refers back into the group of the type it entered', () => {
      expect(
        deriveThing(
          { a: voField('A') },
          {
            A: { fields: { label: label(), b: voField('B') } },
            B: { fields: { as: voArrayField('A') } },
          },
        ),
      ).toEqual(
        rootSchema(
          { a: closed({ label: { bsonType: 'string' }, b: openObject }, ['b', 'label']) },
          ['a'],
        ),
      );
    });

    it('describes only the entry type of a group whose types all refer to each other', () => {
      const names = ['T0', 'T1', 'T2'];
      const valueObjects = Object.fromEntries(
        names.map((name) => [
          name,
          {
            fields: Object.fromEntries(
              names.filter((other) => other !== name).map((other) => [other, voField(other, true)]),
            ),
          },
        ]),
      );
      const openOrNull = { oneOf: [{ bsonType: 'null' }, openObject] };

      expect(deriveThing({ t: voField('T0') }, valueObjects)).toEqual(
        rootSchema({ t: closed({ T1: openOrNull, T2: openOrNull }) }, ['t']),
      );
    });

    it('keeps the validator small when many types refer to each other', () => {
      const names = Array.from({ length: 8 }, (_, index) => `T${index}`);
      const valueObjects = Object.fromEntries(
        names.map((name) => [
          name,
          { fields: Object.fromEntries(names.map((other) => [other, voField(other, true)])) },
        ]),
      );

      expect(JSON.stringify(deriveThing({ t: voField('T0') }, valueObjects)).length).toBeLessThan(
        2000,
      );
    });

    it('describes a type that is not in the group in full inside the group', () => {
      expect(
        deriveThing(
          { items: voArrayField('NavItem') },
          {
            NavItem: { fields: { icon: voField('Icon'), children: voArrayField('NavItem') } },
            Icon: { fields: { name: label() } },
          },
        ),
      ).toEqual(
        rootSchema(
          {
            items: {
              bsonType: 'array',
              items: closed(
                {
                  icon: closed({ name: { bsonType: 'string' } }, ['name']),
                  children: { bsonType: 'array', items: openObject },
                },
                ['children', 'icon'],
              ),
            },
          },
          ['items'],
        ),
      );
    });

    it('describes two fields of the same type that is not recursive in full', () => {
      const address = closed({ city: { bsonType: 'string' } }, ['city']);

      expect(
        deriveThing(
          { home: voField('Address'), work: voField('Address') },
          { Address: { fields: { city: label() } } },
        ),
      ).toEqual(rootSchema({ home: address, work: address }, ['home', 'work']));
    });
  });

  describe('embedded models', () => {
    it('describes a model embedded in itself in full, and its own embed as a list of open objects', () => {
      const validators = derive({
        roots: { roots: crossRef('Root') },
        models: {
          Root: model({ _id: objectId() }, { relations: { nodes: embedMany('Node') } }),
          Node: model({ label: label() }, { relations: { children: embedMany('Node') } }),
        },
      });

      expect(jsonSchemas(validators)['roots']).toEqual(
        rootSchema(
          {
            nodes: {
              bsonType: 'array',
              items: closed(
                {
                  label: { bsonType: 'string' },
                  children: { bsonType: 'array', items: openObject },
                },
                ['label'],
              ),
            },
          },
          [],
        ),
      );
    });

    it('opens every embed that refers back into the group of the model it entered', () => {
      const validators = derive({
        roots: { roots: crossRef('Root') },
        models: {
          Root: model({ _id: objectId() }, { relations: { a: embedOne('A') } }),
          A: model({}, { relations: { b: embedOne('B') } }),
          B: model({}, { relations: { a: embedOne('A') } }),
        },
      });

      expect(jsonSchemas(validators)['roots']).toEqual(
        rootSchema({ a: closed({ b: openObject }) }, []),
      );
    });

    describe('in a polymorphic collection', () => {
      const typeField = () => scalarField('mongo/string@1');
      const task = (variants: Record<string, string>) =>
        model(
          { _id: objectId(), type: typeField() },
          {
            discriminator: { field: 'type' },
            variants: Object.fromEntries(
              Object.entries(variants).map(([value, name]) => [value, crossRef(name)]),
            ),
          },
        );
      const tasksBase = {
        bsonType: 'object',
        required: ['_id', 'type'],
        properties: { _id: { bsonType: 'objectId' }, type: { bsonType: 'string' } },
      };

      it('opens the embed of a root model that embeds itself, for comparison', () => {
        const validators = derive({
          roots: { nodes: crossRef('Node') },
          models: {
            Node: model({ _id: objectId() }, { relations: { children: embedMany('Node') } }),
          },
        });

        expect(jsonSchemas(validators)['nodes']).toEqual(
          rootSchema({ children: { bsonType: 'array', items: openObject } }, []),
        );
      });

      it('opens the embed of a variant that embeds itself, as for a root model', () => {
        const validators = derive({
          roots: { tasks: crossRef('Task') },
          models: {
            Task: task({ bug: 'Bug' }),
            Bug: model(
              { _id: objectId(), type: typeField() },
              { relations: { subtasks: embedMany('Bug') } },
            ),
          },
        });

        expect(jsonSchemas(validators)['tasks']).toEqual({
          ...tasksBase,
          oneOf: [
            {
              properties: {
                _id: { bsonType: 'objectId' },
                type: { enum: ['bug'] },
                subtasks: { bsonType: 'array', items: openObject },
              },
              required: ['type'],
              additionalProperties: false,
            },
          ],
        });
      });

      it('describes the base model in full where a variant embeds it', () => {
        const validators = derive({
          roots: { tasks: crossRef('Task') },
          models: {
            Task: task({ bug: 'Bug' }),
            Bug: model(
              { _id: objectId(), type: typeField() },
              { relations: { parent: embedOne('Task') } },
            ),
          },
        });

        expect(jsonSchemas(validators)['tasks']).toEqual({
          ...tasksBase,
          oneOf: [
            {
              properties: {
                _id: { bsonType: 'objectId' },
                type: { enum: ['bug'] },
                parent: { ...tasksBase, additionalProperties: false },
              },
              required: ['type'],
              additionalProperties: false,
            },
          ],
        });
      });
    });
  });
});
