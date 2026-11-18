import { describe, expectTypeOf, test } from 'vitest';
import type {
  MigrationAccessChange,
  MigrationPlanSubjects,
} from '../src/control/migration-statements';

describe('MigrationPlanSubjects', () => {
  test('lists the access changes under accessChanges', () => {
    expectTypeOf<MigrationPlanSubjects['accessChanges']>().toEqualTypeOf<
      readonly MigrationAccessChange[]
    >();
    expectTypeOf<MigrationPlanSubjects>().not.toHaveProperty('accessWidening');
  });
});
