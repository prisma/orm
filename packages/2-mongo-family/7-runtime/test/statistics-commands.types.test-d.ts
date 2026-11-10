import { expectTypeOf, test } from 'vitest';
import type { MongoStatisticsCommand } from '../src/prepared/types';
import type { statisticsCountFields } from '../src/statistics-count-field';

test('the statistics commands of the prepared handle and of execute are the same kinds', () => {
  expectTypeOf<keyof typeof statisticsCountFields>().toEqualTypeOf<
    MongoStatisticsCommand['kind']
  >();
});
