import { expectTypeOf, test } from 'vitest';
import type {
  ConvertedColumn,
  ConvertedColumnJson,
} from '../src/core/migrations/unconverted-field';

test('the converted column a step writes is the one its ops.json reads back', () => {
  expectTypeOf<ConvertedColumn['by']>().toEqualTypeOf<(typeof ConvertedColumnJson.infer)['by']>();
});
