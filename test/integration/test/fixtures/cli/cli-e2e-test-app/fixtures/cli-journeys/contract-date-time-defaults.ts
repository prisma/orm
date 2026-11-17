import {
  dateStringColumn,
  int4Column,
  intervalPartsColumn,
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
        instantText: field.column(timestamptzStringColumn).default('2024-01-01T00:00:00Z'),
        localText: field.column(timestampStringColumn).default('2024-01-01T12:34:56.5'),
        dayText: field.column(dateStringColumn).default('-000043-03-15'),
        clockText: field.column(timeStringColumn()).default('12:34:56.5'),
        zoned: field.column(timetzColumn()).default('12:34:56+02:00'),
        span: field
          .column(intervalPartsColumn())
          .default({ months: 14, days: 3, micros: 14706500000n }),
      },
    }).sql({ table: 'moment' }),
  },
});
