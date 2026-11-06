import {
  composeCheckWirePrefix,
  computeCheckContentHash,
  formatWireName,
} from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
import { attributeText, fieldText } from './print-support';
import {
  deserialize,
  INT_COLUMN,
  INT_FIELD,
  PUBLIC,
  printing,
  TEXT_COLUMN,
  TEXT_FIELD,
} from './refusal-support';

const membership = `"type" IN ('bug', 'feature')`;
const prefix = composeCheckWirePrefix('Task', 'type', 'membership');
const derivedCheck = {
  name: formatWireName(prefix, computeCheckContentHash(membership)),
  prefix,
  expression: membership,
};

function taskContract(checks: readonly (typeof derivedCheck)[]) {
  const variant = {
    storage: { table: 'Task', namespaceId: 'public', fields: {} },
    fields: {},
    relations: {},
    base: { namespace: PUBLIC, model: 'Task' },
  };
  return deserialize({
    roots: { Task: { namespace: PUBLIC, model: 'Task' } },
    namespaces: {
      public: {
        models: {
          Task: {
            storage: {
              table: 'Task',
              namespaceId: 'public',
              fields: { id: { column: 'id' }, type: { column: 'type' } },
            },
            fields: { id: INT_FIELD, type: TEXT_FIELD },
            relations: {},
            discriminator: { field: 'type' },
            variants: {
              bug: { namespace: PUBLIC, model: 'Bug' },
              feature: { namespace: PUBLIC, model: 'Feature' },
            },
          },
          Bug: variant,
          Feature: variant,
        },
      },
    },
    storage: {
      namespaces: {
        public: {
          id: 'public',
          entries: {
            table: {
              Task: {
                columns: {
                  id: INT_COLUMN,
                  type: {
                    ...TEXT_COLUMN,
                    valueSet: {
                      plane: 'storage',
                      entityKind: 'valueSet',
                      namespaceId: 'public',
                      entityName: 'Task.type',
                    },
                  },
                },
                uniques: [],
                indexes: [],
                foreignKeys: [],
                primaryKey: { columns: ['id'] },
                checks,
              },
            },
            valueSet: { 'Task.type': { kind: 'valueSet', values: ['bug', 'feature'] } },
          },
        },
      },
    },
  });
}

describe('a discriminator column with its value set and membership check', () => {
  it('is written as the plain field, without the check or an enum the PSL source derives', () => {
    const document = printing(taskContract([derivedCheck]))();
    const task = document.namespaces
      .flatMap((namespace) => namespace.models)
      .find((model) => model.name === 'Task');
    expect({
      fields: task?.fields.map(fieldText),
      attributes: task?.attributes.map(attributeText),
    }).toEqual({
      fields: ['id Int @id', 'type String'],
      attributes: ['@@discriminator(type)'],
    });
  });

  it('is refused when its table lacks the membership check', () => {
    expect(printing(taskContract([]))).toThrow(`lacks the check "${derivedCheck.name}"`);
  });
});
