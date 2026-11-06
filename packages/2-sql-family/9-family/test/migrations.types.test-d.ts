/**
 * Type-level tests verifying SqlMigration* types extend core migration types.
 *
 * These tests ensure that the SQL family migration types are properly
 * compatible with the core framework migration types, allowing the CLI
 * to use core types while SQL-specific code uses the extended types.
 */

import type {
  MigrationPlan,
  MigrationPlannerConflict,
  MigrationPlanOperation,
  MigrationRunnerFailure,
  MigrationRunnerPerSpaceSuccessValue,
} from '@internal/framework-components/control';
import { expectTypeOf } from 'vitest';
import type {
  SqlMigrationPlan,
  SqlMigrationPlanOperation,
  SqlMigrationRunnerFailure,
  SqlMigrationRunnerSuccessValue,
  SqlPlannerConflict,
} from '../src/core/migrations/types';

// Note: SqlMigrationOperationClass is the same as core MigrationOperationClass (no SQL-specific extension)

// Test that SqlMigrationPlanOperation has the required core fields
expectTypeOf<SqlMigrationPlanOperation<unknown>['id']>().toExtend<MigrationPlanOperation['id']>();
expectTypeOf<SqlMigrationPlanOperation<unknown>['label']>().toExtend<
  MigrationPlanOperation['label']
>();
expectTypeOf<SqlMigrationPlanOperation<unknown>['operationClass']>().toExtend<
  MigrationPlanOperation['operationClass']
>();

// Test that SqlMigrationPlan extends core MigrationPlan
expectTypeOf<SqlMigrationPlan<unknown>>().toExtend<MigrationPlan>();

// Test that SqlPlannerConflict has the required core fields
expectTypeOf<SqlPlannerConflict['kind']>().toExtend<MigrationPlannerConflict['kind']>();
expectTypeOf<SqlPlannerConflict['summary']>().toExtend<MigrationPlannerConflict['summary']>();

// Test that SqlMigrationRunnerSuccessValue has the required core fields
expectTypeOf<SqlMigrationRunnerSuccessValue['operationsPlanned']>().toExtend<
  MigrationRunnerPerSpaceSuccessValue['operationsPlanned']
>();
expectTypeOf<SqlMigrationRunnerSuccessValue['operationsExecuted']>().toExtend<
  MigrationRunnerPerSpaceSuccessValue['operationsExecuted']
>();

// Test that SqlMigrationRunnerFailure has the required core fields
expectTypeOf<SqlMigrationRunnerFailure['code']>().toExtend<MigrationRunnerFailure['code']>();
expectTypeOf<SqlMigrationRunnerFailure['message']>().toExtend<MigrationRunnerFailure['message']>();
expectTypeOf<SqlMigrationRunnerFailure['meta']>().toEqualTypeOf<MigrationRunnerFailure['meta']>();
expectTypeOf<SqlMigrationRunnerFailure>().toExtend<MigrationRunnerFailure>();
