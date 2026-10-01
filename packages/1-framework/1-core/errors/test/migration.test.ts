import { describe, expect, it } from 'vitest';
import {
  errorDataTransformContractMismatch,
  errorMigrationFileMissing,
  errorMigrationInvalidDefaultExport,
  errorMigrationOperationOptionRemoved,
  errorMigrationPlanNotArray,
  errorMigrationTargetMismatch,
  errorUnfilledPlaceholder,
  placeholder,
} from '../src/migration';

describe('Migration Errors', () => {
  it('errorUnfilledPlaceholder names the slot and carries structured metadata', () => {
    const error = errorUnfilledPlaceholder('backfill-product-status:check.source');
    expect(error).toMatchObject({
      code: 'MIGRATION.UNFILLED_PLACEHOLDER',
      message: 'Unfilled migration placeholder',
      why: 'The migration contains a placeholder that has not been filled in: backfill-product-status:check.source',
      meta: { slot: 'backfill-product-status:check.source' },
    });
    expect(error.toEnvelope().code).toBe('MIGRATION.UNFILLED_PLACEHOLDER');
  });

  it('placeholder throws a CliStructuredError that names the slot', () => {
    expect(() => placeholder('foo')).toThrow(
      expect.objectContaining({
        code: 'MIGRATION.UNFILLED_PLACEHOLDER',
        meta: { slot: 'foo' },
      }),
    );
    // `placeholder(slot)` constructs and throws `errorUnfilledPlaceholder(slot)`,
    // so envelope-mapping coverage is preserved by re-asserting the same builder
    // here (matches the construction-side assertion above without re-invoking
    // the throwing call twice).
    expect(errorUnfilledPlaceholder('foo').toEnvelope().code).toBe(
      'MIGRATION.UNFILLED_PLACEHOLDER',
    );
  });

  it('errorMigrationFileMissing names the dir and points at scaffolding commands', () => {
    const error = errorMigrationFileMissing('/tmp/migrations/20260101_x');
    expect(error).toMatchObject({
      code: 'MIGRATION.FILE_MISSING',
      message: 'migration.ts not found',
      why: 'No migration.ts file was found at "/tmp/migrations/20260101_x"',
      meta: { dir: '/tmp/migrations/20260101_x' },
    });
    expect(error.fix).toContain('{bin} migration new');
    expect(error.toEnvelope().code).toBe('MIGRATION.FILE_MISSING');
  });

  it('errorMigrationInvalidDefaultExport carries the dir and optional export description', () => {
    const error = errorMigrationInvalidDefaultExport(
      '/tmp/pkg',
      'an exported constant "undefined"',
    );
    expect(error).toMatchObject({
      code: 'MIGRATION.INVALID_DEFAULT_EXPORT',
      message: 'migration.ts default export is not a valid migration',
      meta: { dir: '/tmp/pkg', actualExport: 'an exported constant "undefined"' },
    });
    expect(error.why).toContain('an exported constant "undefined"');
    expect(error.fix).toContain('export default class extends Migration');
    expect(error.toEnvelope().code).toBe('MIGRATION.INVALID_DEFAULT_EXPORT');
  });

  it('errorMigrationInvalidDefaultExport omits actualExport from meta when not provided', () => {
    const error = errorMigrationInvalidDefaultExport('/tmp/pkg');
    expect(error.meta).toEqual({ dir: '/tmp/pkg' });
  });

  it('errorMigrationPlanNotArray names the dir and describes the actual value', () => {
    const error = errorMigrationPlanNotArray('/tmp/pkg', 'a string');
    expect(error).toMatchObject({
      code: 'MIGRATION.PLAN_NOT_ARRAY',
      message: 'Migration.operations must be an array of operations',
      meta: { dir: '/tmp/pkg', actualValue: 'a string' },
    });
    expect(error.why).toContain('a string');
    expect(error.fix).toContain('operations');
    expect(error.toEnvelope().code).toBe('MIGRATION.PLAN_NOT_ARRAY');
  });

  it('errorMigrationPlanNotArray omits actualValue from meta when not provided', () => {
    const error = errorMigrationPlanNotArray('/tmp/pkg');
    expect(error.meta).toEqual({ dir: '/tmp/pkg' });
  });

  it('errorDataTransformContractMismatch carries name + expected + actual hashes', () => {
    const error = errorDataTransformContractMismatch({
      dataTransformName: 'backfill-user-name',
      expected: 'aaa',
      actual: 'bbb',
    });
    expect(error).toMatchObject({
      code: 'MIGRATION.DATA_TRANSFORM_CONTRACT_MISMATCH',
      message: 'dataTransform query plan built against wrong contract',
      meta: {
        dataTransformName: 'backfill-user-name',
        expected: 'aaa',
        actual: 'bbb',
      },
    });
    expect(error.why).toContain('backfill-user-name');
    expect(error.why).toContain('aaa');
    expect(error.why).toContain('bbb');
    expect(error.fix).toContain('createExecutionContext');
    expect(error.toEnvelope().code).toBe('MIGRATION.DATA_TRANSFORM_CONTRACT_MISMATCH');
  });

  it('errorMigrationOperationOptionRemoved names the operation and the option, and says how to rewrite the call', () => {
    const error = errorMigrationOperationOptionRemoved({
      operation: 'setThing',
      option: 'thingText',
      subject: 'item "a"',
      rewrite: 'Pass the item as a value.',
      upgradeEntry: 'thing-values',
    });
    expect({
      code: error.code,
      message: error.message,
      why: error.why,
      fix: error.fix,
      meta: error.meta,
    }).toEqual({
      code: 'MIGRATION.OPERATION_OPTION_REMOVED',
      message:
        '`setThing` in migration.ts passes `thingText`, which this version no longer reads, for item "a"',
      why: 'An earlier version wrote this migration.ts. `node migration.ts` does not check its types, so the file runs, and this version would leave out what the option carries.',
      fix: 'Pass the item as a value. Or, if the migration is not applied, delete its package and run `migration plan` again. The upgrade entry `thing-values` shows the new shape: https://github.com/prisma/orm/tree/main/skills/prisma-8/upgrading',
      meta: { operation: 'setThing', option: 'thingText', upgradeEntry: 'thing-values' },
    });
  });

  it('errorMigrationTargetMismatch names both target ids', () => {
    const error = errorMigrationTargetMismatch({
      migrationTargetId: 'postgres',
      configTargetId: 'mongo',
    });
    expect(error).toMatchObject({
      code: 'MIGRATION.TARGET_MISMATCH',
      message: 'Migration target does not match config target',
      meta: {
        migrationTargetId: 'postgres',
        configTargetId: 'mongo',
      },
    });
    expect(error.why).toContain('"postgres"');
    expect(error.why).toContain('"mongo"');
    expect(error.fix).toContain('--config');
    expect(error.toEnvelope().code).toBe('MIGRATION.TARGET_MISMATCH');
  });
});
