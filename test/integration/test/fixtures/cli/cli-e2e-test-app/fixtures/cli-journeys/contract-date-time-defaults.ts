import {
  dateStringColumn,
  int4Column,
  intervalColumn,
  timeStringColumn,
  timestampStringColumn,
  timestamptzJsDateColumn,
  timestamptzStringColumn,
  timetzColumn,
} from '@internal/adapter-postgres/column-types';
import { defineContract, field, model } from '@internal/postgres/contract-builder';

export const contract = defineContract({
  models: {
    Moment: model('Moment', {
      fields: {
        id: field.column(int4Column).id(),
        jsDate: field.column(timestamptzJsDateColumn).default(new Date('2024-01-01T00:00:00.000Z')),
        instantText: field.column(timestamptzStringColumn).default('2024-01-01 00:00:00+00'),
        localText: field.column(timestampStringColumn).default('2024-01-01 12:34:56.500'),
        dayText: field.column(dateStringColumn).default('0044-03-15 BC'),
        clockText: field.column(timeStringColumn()).default('12:34:56.500'),
        zoned: field.column(timetzColumn()).default('12:34:56+02'),
        span: field.column(intervalColumn()).default({ months: 14, days: 3, micros: 14706500000n }),
      },
    }).sql({ table: 'moment' }),
  },
});
