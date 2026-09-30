import {
  dateTemporalColumn,
  int4Column,
  timestampTemporalColumn,
  timeTemporalColumn,
  timetzColumn,
} from '@internal/adapter-postgres/column-types';
import { defineContract } from '@internal/postgres/contract-builder';
import { Temporal } from 'temporal-polyfill';

export const contract = defineContract({}, ({ field, model }) => ({
  models: {
    T: model('T', {
      fields: {
        id: field.column(int4Column).id(),
        instant: field.dateTime().default(Temporal.Instant.from('2024-01-01T00:00:00.5Z')),
        local: field
          .column(timestampTemporalColumn)
          .default(Temporal.PlainDateTime.from('2024-01-01T12:34:56.5')),
        day: field.column(dateTemporalColumn).default(Temporal.PlainDate.from('-000043-03-15')),
        clock: field.column(timeTemporalColumn()).default(Temporal.PlainTime.from('12:34')),
        zoned: field.column(timetzColumn()).default('12:34:56+02:00'),
        big: field.bigint().default(9007199254740993n),
        bytes: field.bytes().default(new Uint8Array([1, 2, 3])),
      },
    }).sql({ table: 't' }),
  },
}));
