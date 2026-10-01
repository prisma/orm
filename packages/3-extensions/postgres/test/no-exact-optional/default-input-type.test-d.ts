import { test } from 'vitest';
import { defineContract, enumType, member } from '../../src/exports/contract-builder';

const Level = enumType(
  'Level',
  { codecId: 'pg/int4@1' as const, nativeType: 'int4' },
  member('Low', 1),
  member('High', 10),
);

test('.default() takes the codec input type in a project without exactOptionalPropertyTypes', () => {
  defineContract({ enums: { Level } }, ({ field, model }) => ({
    models: {
      Accepted: model('Accepted', {
        fields: {
          id: field.id.uuidv4String(),
          scalar: field.text().default('x'),
          list: field.text().many().default(['x']),
          level: field.namedType(Level).default(Level.members.Low),
          levels: field.namedType(Level).many().default([Level.members.Low]),
        },
      }),
      Refused: model('Refused', {
        fields: {
          id: field.id.uuidv4String(),
          // @ts-expect-error pg/text@1 takes a string, not an array
          scalar: field.text().default(['x']),
          // @ts-expect-error a list field takes an array
          list: field.text().many().default('x'),
          // @ts-expect-error an enum field takes one member value, not an array
          level: field.namedType(Level).default([Level.members.Low]),
          // @ts-expect-error an enum list field takes an array of member values
          levels: field.namedType(Level).many().default(Level.members.Low),
        },
      }),
    },
  }));
});
