import { describe, expectTypeOf, it } from 'vitest';
import type { ExecuteDbUpdateOptions } from '../../src/control-api/operations/db-update';
import type {
  PlannedAccessChange,
  PlannedQuestions,
} from '../../src/control-api/statements/plan-questions';
import type { DbUpdateOptions } from '../../src/control-api/types';
import type { MigrationCommandResult } from '../../src/utils/formatters/migrations';

describe('access changes on the control API', () => {
  it('names the consent option acceptAccessChanges', () => {
    expectTypeOf<DbUpdateOptions['acceptAccessChanges']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<DbUpdateOptions>().not.toHaveProperty('acceptAccessWidening');
    expectTypeOf<ExecuteDbUpdateOptions<'sql', 'postgres'>['acceptAccessChanges']>().toEqualTypeOf<
      boolean | undefined
    >();
    expectTypeOf<ExecuteDbUpdateOptions<'sql', 'postgres'>>().not.toHaveProperty(
      'acceptAccessWidening',
    );
  });

  it('lists the access changes a plan asks about under accessChanges', () => {
    expectTypeOf<PlannedQuestions['accessChanges']>().toEqualTypeOf<
      readonly PlannedAccessChange[]
    >();
    expectTypeOf<PlannedQuestions>().not.toHaveProperty('accessWidening');
    expectTypeOf<MigrationCommandResult>().toHaveProperty('accessChanges');
    expectTypeOf<MigrationCommandResult>().not.toHaveProperty('accessWidening');
  });
});
