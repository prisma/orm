import {
  boolColumn,
  float8Column,
  int2Column,
  int4Column,
  jsonbColumn,
  numericColumn,
  textColumn,
} from '@internal/adapter-postgres/column-types';
import { autoincrement, defineContract, field, model } from '@internal/postgres/contract-builder';

export const contract = defineContract({
  models: {
    T: model('T', {
      fields: {
        id: field.column(int4Column).default(autoincrement()).id(),
        name: field.column(textColumn).default('anonymous'),
        small: field.column(int2Column).default(100),
        count: field.column(int4Column).default(100000),
        price: field.column(numericColumn(10, 2)).default('1.50'),
        ratio: field.column(float8Column).default(1.5),
        active: field.column(boolColumn).default(true),
        meta: field.column(jsonbColumn).default({ plan: 'free', seats: 1 }),
        scores: field.column(int4Column).many().default([1, 2]),
        docs: field.column(jsonbColumn).many().default([{}, []]),
      },
    }).sql({ table: 't' }),
  },
});
