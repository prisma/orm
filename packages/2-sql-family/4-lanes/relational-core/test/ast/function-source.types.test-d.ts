import { test } from 'vitest';
import { FunctionSource } from '../../src/exports/ast';

test('FunctionSource column aliases require a grouped table alias', () => {
  FunctionSource.of('unnest', [], {
    alias: 'u',
    columnAliases: ['element'],
  });

  // @ts-expect-error -- column aliases cannot be supplied without a table alias
  FunctionSource.of('unnest', [], { columnAliases: ['element'] });
});
