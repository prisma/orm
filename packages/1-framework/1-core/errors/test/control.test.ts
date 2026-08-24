import type { NextAction } from '@internal/utils/structured-error';
import { docsUrlFor } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import {
  CliStructuredError,
  errorConfigEvaluationFailed,
  errorConfigFileNotFound,
  errorConfigValidation,
  errorConfigVersionMarkerMissing,
  errorContractConfigMissing,
  errorContractMissingExtensions,
  errorContractValidationFailed,
  errorDatabaseConnectionRequired,
  errorDriverRequired,
  errorEnumCodecNotInPackStack,
  errorFamilyReadMarkerSqlRequired,
  errorFileNotFound,
  errorInvalidOutputFormat,
  errorJsonFormatNotSupported,
  errorMigrationCliInvalidConfigArg,
  errorMigrationCliUnknownFlag,
  errorMigrationPlanningFailed,
  errorOutputFormatMutex,
  errorQueryRunnerFactoryRequired,
  errorTargetMigrationNotSupported,
  errorUnexpected,
} from '../src/control';

describe('CliStructuredError', () => {
  it('creates error with all properties', () => {
    const error = new CliStructuredError('CONFIG.FILE_NOT_FOUND', 'Test error', {
      severity: 'error',
      why: 'This is why',
      fix: 'This is how to fix',
      where: { path: '/path/to/file.ts', line: 42 },
      meta: { key: 'value' },
      docsUrl: 'https://example.com/docs',
    });

    expect(error.code).toBe('CONFIG.FILE_NOT_FOUND');
    expect(error.message).toBe('Test error');
    expect(error.severity).toBe('error');
    expect(error.why).toBe('This is why');
    expect(error.fix).toBe('This is how to fix');
    expect(error.where).toEqual({ path: '/path/to/file.ts', line: 42 });
    expect(error.meta).toEqual({ key: 'value' });
    expect(error.docsUrl).toBe('https://example.com/docs');
  });

  it('creates error with defaults', () => {
    const error = new CliStructuredError('CONFIG.FILE_NOT_FOUND', 'Test error');

    expect(error.code).toBe('CONFIG.FILE_NOT_FOUND');
    expect(error.message).toBe('Test error');
    expect(error.severity).toBe('error');
    expect(error.why).toBeUndefined();
    expect(error.fix).toBeUndefined();
    expect(error.where).toBeUndefined();
    expect(error.meta).toBeUndefined();
    expect(error.docsUrl).toBeUndefined();
  });

  it('converts to envelope carrying the dotted code as-is', () => {
    const error = new CliStructuredError('CONFIG.FILE_NOT_FOUND', 'Test error');
    const envelope = error.toEnvelope();

    expect(envelope.code).toBe('CONFIG.FILE_NOT_FOUND');
    expect(envelope.summary).toBe('Test error');
  });

  it('converts to envelope for a different namespace', () => {
    const error = new CliStructuredError('CONTRACT.MARKER_MISSING', 'Test error');
    const envelope = error.toEnvelope();

    expect(envelope.code).toBe('CONTRACT.MARKER_MISSING');
    expect(envelope.summary).toBe('Test error');
  });

  it('sets cause when provided', () => {
    const cause = new Error('underlying failure');
    const error = new CliStructuredError('CONFIG.FILE_NOT_FOUND', 'Test error', { cause });

    expect(error.cause).toBe(cause);
  });

  it('omits cause as an own property when not provided', () => {
    const error = new CliStructuredError('CONFIG.FILE_NOT_FOUND', 'Test error');

    expect(Object.hasOwn(error, 'cause')).toBe(false);
  });

  it('envelope carries no cause key', () => {
    const error = new CliStructuredError('CONFIG.FILE_NOT_FOUND', 'Test error', {
      cause: new Error('underlying failure'),
    });

    expect(Object.keys(error.toEnvelope())).not.toContain('cause');
  });

  it('normalizes fix when fix equals why', () => {
    const error = new CliStructuredError('CONFIG.FILE_NOT_FOUND', 'Test error', {
      why: 'Same message',
      fix: 'Same message',
    });
    const envelope = error.toEnvelope();

    expect(error.fix).toBeUndefined();
    expect(envelope.fix).toBeUndefined();
  });

  describe('nextActions', () => {
    const nextActions: readonly NextAction[] = [
      { kind: 'run-command', label: 'Create the config', command: '{bin} orm init' },
    ];

    it('carries nextActions onto the error and the envelope, {bin} left unsubstituted', () => {
      const error = new CliStructuredError('CONFIG.FILE_NOT_FOUND', 'Test error', { nextActions });

      expect(error.nextActions).toEqual(nextActions);
      expect(error.toEnvelope().nextActions).toEqual(nextActions);
    });

    it('leaves nextActions off the raised error but normalizes the envelope to []', () => {
      const error = new CliStructuredError('CONFIG.FILE_NOT_FOUND', 'Test error');
      const envelope = error.toEnvelope();

      expect(error.nextActions).toBeUndefined();
      expect(Object.keys(envelope)).toContain('nextActions');
      expect(envelope.nextActions).toEqual([]);
    });

    it('keeps fix alongside nextActions — both survive the transition', () => {
      const error = new CliStructuredError('CONFIG.FILE_NOT_FOUND', 'Test error', {
        why: 'No config file',
        fix: "Run '{bin} orm init' to create a config file",
        nextActions,
      });
      const envelope = error.toEnvelope();

      expect(envelope.fix).toBe("Run '{bin} orm init' to create a config file");
      expect(envelope.nextActions).toEqual(nextActions);
    });
  });

  describe('is() type guard', () => {
    it('returns true for CliStructuredError instances', () => {
      const error = new CliStructuredError('CONFIG.FILE_NOT_FOUND', 'Test error');
      expect(CliStructuredError.is(error)).toBe(true);
    });

    it('returns true for CliStructuredError from any namespace', () => {
      const error = new CliStructuredError('CONTRACT.VERIFY_FAILED', 'Test error');
      expect(CliStructuredError.is(error)).toBe(true);
    });

    it('returns false for non-Error values', () => {
      expect(CliStructuredError.is(null)).toBe(false);
      expect(CliStructuredError.is(undefined)).toBe(false);
      expect(CliStructuredError.is('string')).toBe(false);
      expect(CliStructuredError.is(123)).toBe(false);
      expect(CliStructuredError.is({})).toBe(false);
    });

    it('returns false for plain Error', () => {
      const error = new Error('Plain error');
      expect(CliStructuredError.is(error)).toBe(false);
    });

    it('returns false for Error with wrong name', () => {
      const error = new Error('Test error') as unknown as Record<string, unknown>;
      error['code'] = 'CONFIG.FILE_NOT_FOUND';
      error['toEnvelope'] = () => ({});
      expect(CliStructuredError.is(error)).toBe(false);
    });

    it('returns false for Error with missing code', () => {
      const error = new Error('Test error') as unknown as Record<string, unknown>;
      error['name'] = 'CliStructuredError';
      error['toEnvelope'] = () => ({});
      expect(CliStructuredError.is(error)).toBe(false);
    });

    it('returns false for Error without toEnvelope method', () => {
      const error = new Error('Test error') as unknown as Record<string, unknown>;
      error['name'] = 'CliStructuredError';
      error['code'] = 'CONFIG.FILE_NOT_FOUND';
      expect(CliStructuredError.is(error)).toBe(false);
    });
  });
});

describe('Config Errors', () => {
  it('errorConfigFileNotFound without path omits where', () => {
    const error = errorConfigFileNotFound();
    expect(error.code).toBe('CONFIG.FILE_NOT_FOUND');
    expect(error.where).toBeUndefined();
  });

  it('errorConfigFileNotFound creates correct error', () => {
    const error = errorConfigFileNotFound('/path/to/config.ts');
    expect(error.code).toBe('CONFIG.FILE_NOT_FOUND');
    expect(error.message).toBe('Config file not found');
    expect(error.where?.path).toBe('/path/to/config.ts');
  });

  it('errorConfigFileNotFound links the canonical error-reference anchor for its code', () => {
    const error = errorConfigFileNotFound();
    expect(error.docsUrl).toBe(docsUrlFor('CONFIG.FILE_NOT_FOUND'));
  });

  it('errorConfigFileNotFound with custom why', () => {
    const error = errorConfigFileNotFound('/path/to/config.ts', { why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorConfigFileNotFound without configPath', () => {
    const error = errorConfigFileNotFound();
    expect(error.code).toBe('CONFIG.FILE_NOT_FOUND');
    expect(error.where).toBeUndefined();
  });

  it('errorContractConfigMissing creates correct error', () => {
    const error = errorContractConfigMissing();
    expect(error.code).toBe('CONFIG.CONTRACT_MISSING');
    expect(error.message).toBe('Contract configuration missing');
  });

  it('errorContractConfigMissing with custom why', () => {
    const error = errorContractConfigMissing({ why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorContractValidationFailed creates correct error', () => {
    const error = errorContractValidationFailed('Missing required field');
    expect(error.code).toBe('CONTRACT.VALIDATION_FAILED');
    expect(error.message).toBe('Contract validation failed');
    expect(error.why).toBe('Missing required field');
  });

  it('errorContractValidationFailed with where', () => {
    const error = errorContractValidationFailed('Invalid type', {
      where: { path: '/path/to/contract.ts', line: 10 },
    });
    expect(error.where).toEqual({ path: '/path/to/contract.ts', line: 10 });
  });

  it('errorFileNotFound creates correct error', () => {
    const error = errorFileNotFound('/path/to/file.ts');
    expect(error.code).toBe('CLI.FILE_NOT_FOUND');
    expect(error.message).toBe('File not found');
    expect(error.where?.path).toBe('/path/to/file.ts');
  });

  it('errorFileNotFound with custom why', () => {
    const error = errorFileNotFound('/path/to/file.ts', { why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorFileNotFound with custom fix and docsUrl', () => {
    const error = errorFileNotFound('/path/to/file.ts', {
      fix: 'Custom fix',
      docsUrl: 'https://example.com/docs',
    });
    expect(error.fix).toBe('Custom fix');
    expect(error.docsUrl).toBe('https://example.com/docs');
  });

  it('errorDatabaseConnectionRequired creates correct error', () => {
    const error = errorDatabaseConnectionRequired();
    expect(error.code).toBe('CONFIG.DB_CONNECTION_REQUIRED');
    expect(error.message).toBe('Database connection is required');
    expect(error.fix).toContain('Provide `--db <url>`');
  });

  it('errorDatabaseConnectionRequired with custom why', () => {
    const error = errorDatabaseConnectionRequired({ why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorDatabaseConnectionRequired with commandName shows fully copyable command', () => {
    const error = errorDatabaseConnectionRequired({ commandName: 'db init' });
    expect(error.fix).toContain('Run `{bin} db init --db <url>`');
  });

  it('errorDatabaseConnectionRequired with retryCommand preserves command flags', () => {
    const error = errorDatabaseConnectionRequired({
      retryCommand: '{bin} db verify --schema-only --strict --db <url>',
    });
    expect(error.fix).toContain('Run `{bin} db verify --schema-only --strict --db <url>`');
  });

  it('errorQueryRunnerFactoryRequired creates correct error', () => {
    const error = errorQueryRunnerFactoryRequired();
    expect(error.code).toBe('CONFIG.QUERY_RUNNER_FACTORY_REQUIRED');
    expect(error.message).toBe('Query runner factory is required');
  });

  it('errorQueryRunnerFactoryRequired with custom why', () => {
    const error = errorQueryRunnerFactoryRequired({ why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorFamilyReadMarkerSqlRequired creates correct error', () => {
    const error = errorFamilyReadMarkerSqlRequired();
    expect(error.code).toBe('CONFIG.FAMILY_READ_MARKER_REQUIRED');
    expect(error.message).toBe('Family readMarker() is required');
  });

  it('errorFamilyReadMarkerSqlRequired with custom why', () => {
    const error = errorFamilyReadMarkerSqlRequired({ why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorDriverRequired creates correct error', () => {
    const error = errorDriverRequired();
    expect(error.code).toBe('CONFIG.DRIVER_REQUIRED');
    expect(error.message).toBe('Driver is required for DB-connected commands');
  });

  it('errorDriverRequired with custom why', () => {
    const error = errorDriverRequired({ why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorMigrationPlanningFailed creates correct error', () => {
    const conflicts = [
      { kind: 'conflict-1', summary: 'Summary 1', why: 'Fix 1' },
      { kind: 'conflict-2', summary: 'Summary 2', why: 'Fix 2' },
    ];
    const error = errorMigrationPlanningFailed({ conflicts });
    expect(error.code).toBe('MIGRATION.PLANNING_FAILED');
    expect(error.message).toBe('Migration planning failed');
    expect(error.why).toContain('Summary 1');
    expect(error.why).toContain('Summary 2');
    expect(error.fix).toContain('Fix 1');
    expect(error.fix).toContain('Fix 2');
    expect(error.meta?.['conflicts']).toEqual(conflicts);
  });

  it('errorMigrationPlanningFailed with custom why', () => {
    const conflicts = [{ kind: 'conflict-1', summary: 'Summary 1' }];
    const error = errorMigrationPlanningFailed({ conflicts, why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorMigrationPlanningFailed with no conflict fixes', () => {
    const conflicts = [{ kind: 'conflict-1', summary: 'Summary 1' }];
    const error = errorMigrationPlanningFailed({ conflicts });
    expect(error.fix).toContain('db verify --schema-only');
  });

  it('errorTargetMigrationNotSupported creates correct error', () => {
    const error = errorTargetMigrationNotSupported();
    expect(error.code).toBe('MIGRATION.TARGET_UNSUPPORTED');
    expect(error.message).toBe('Target does not support migrations');
  });

  it('errorTargetMigrationNotSupported with custom why', () => {
    const error = errorTargetMigrationNotSupported({ why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorJsonFormatNotSupported creates correct error', () => {
    const error = errorJsonFormatNotSupported({
      command: 'db verify',
      format: 'unknown',
      supportedFormats: ['compact', 'detailed'],
    });
    expect(error.code).toBe('CLI.JSON_FORMAT_UNSUPPORTED');
    expect(error.message).toBe('Unsupported JSON format');
    expect(error.why).toContain('db verify');
    expect(error.why).toContain('unknown');
    expect(error.fix).toContain('compact or detailed');
    expect(error.meta?.['command']).toBe('db verify');
    expect(error.meta?.['format']).toBe('unknown');
    expect(error.meta?.['supportedFormats']).toEqual(['compact', 'detailed']);
  });

  it('errorContractMissingExtensions with single pack', () => {
    const error = errorContractMissingExtensions({
      missingExtensions: ['pgvector'],
      providedComponentIds: ['postgres', 'postgres-adapter'],
    });
    expect(error.code).toBe('CONFIG.MISSING_EXTENSION_PACKS');
    expect(error.message).toBe('Missing extension packs in config');
    expect(error.why).toContain("'pgvector'");
    expect(error.why).toContain('extension pack');
    expect(error.meta?.['missingExtensions']).toEqual(['pgvector']);
    expect(error.meta?.['providedComponentIds']).toEqual(['postgres', 'postgres-adapter']);
  });

  it('errorContractMissingExtensions with multiple packs', () => {
    const error = errorContractMissingExtensions({
      missingExtensions: ['pgvector', 'uuid-ossp'],
      providedComponentIds: ['postgres'],
    });
    expect(error.code).toBe('CONFIG.MISSING_EXTENSION_PACKS');
    expect(error.why).toContain("'pgvector'");
    expect(error.why).toContain("'uuid-ossp'");
    expect(error.meta?.['missingExtensions']).toEqual(['pgvector', 'uuid-ossp']);
  });

  it('errorConfigValidation creates correct error', () => {
    const error = errorConfigValidation('family');
    expect(error.code).toBe('CONFIG.VALIDATION_FAILED');
    expect(error.message).toBe('Config validation error');
    expect(error.why).toBe('Config must have a "family" field');
  });

  it('errorConfigValidation with custom why', () => {
    const error = errorConfigValidation('family', { why: 'Custom reason' });
    expect(error.why).toBe('Custom reason');
  });

  it('errorConfigValidation records field and section in meta', () => {
    const error = errorConfigValidation('target.familyId', { section: 'target' });
    expect(error.meta).toEqual({ field: 'target.familyId', section: 'target' });
  });

  it('errorConfigValidation without section keeps only the field in meta', () => {
    const error = errorConfigValidation('family');
    expect(error.meta).toEqual({ field: 'family' });
  });

  it('errorConfigEvaluationFailed creates correct error', () => {
    const error = errorConfigEvaluationFailed('/project/prisma.config.ts', {
      why: 'ParseError: Unexpected token',
    });
    expect(error.code).toBe('CONFIG.EVALUATION_FAILED');
    expect(error.message).toBe('Config file could not be evaluated');
    expect(error.why).toBe('ParseError: Unexpected token');
    expect(error.where?.path).toBe('/project/prisma.config.ts');
    expect(error.docsUrl).toBe(docsUrlFor('CONFIG.EVALUATION_FAILED'));
  });

  it('errorConfigEvaluationFailed without path omits where and forwards cause', () => {
    const cause = new Error('boom');
    const error = errorConfigEvaluationFailed(undefined, { why: 'boom', cause });
    expect(error.where).toBeUndefined();
    expect(error.cause).toBe(cause);
  });

  it('errorConfigVersionMarkerMissing creates correct error', () => {
    const error = errorConfigVersionMarkerMissing('/project/prisma.config.ts');
    expect(error.code).toBe('CONFIG.VERSION_MARKER_MISSING');
    expect(error.message).toBe('Config is not a defineConfig result');
    expect(error.fix).toContain('defineConfig');
    expect(error.where?.path).toBe('/project/prisma.config.ts');
    expect(error.docsUrl).toBe(docsUrlFor('CONFIG.VERSION_MARKER_MISSING'));
  });

  it('errorConfigVersionMarkerMissing without path omits where', () => {
    const error = errorConfigVersionMarkerMissing();
    expect(error.where).toBeUndefined();
  });

  it('errorMigrationCliInvalidConfigArg creates correct error for missing path', () => {
    const error = errorMigrationCliInvalidConfigArg();
    expect(error.code).toBe('CLI.CONFIG_ARG_MISSING_PATH');
    expect(error.message).toBe('--config flag requires a path argument');
    expect(error.why).toContain('without a following path argument');
    expect(error.fix).toContain('--config <path>');
    expect(error.meta).toEqual({});
  });

  it('errorMigrationCliInvalidConfigArg surfaces the swallowed flag in why/meta', () => {
    const error = errorMigrationCliInvalidConfigArg({ nextToken: '--dry-run' });
    expect(error.code).toBe('CLI.CONFIG_ARG_MISSING_PATH');
    expect(error.why).toContain('--dry-run');
    expect(error.meta).toEqual({ nextToken: '--dry-run' });
  });

  it('errorMigrationCliUnknownFlag produces a CLI.UNKNOWN_FLAG envelope', () => {
    const error = errorMigrationCliUnknownFlag({
      flag: '--frobnicate',
      knownFlags: ['--dry-run', '--config', '--help'],
    });
    const envelope = error.toEnvelope();
    expect(error.code).toBe('CLI.UNKNOWN_FLAG');
    expect(error.message).toBe('Unknown migration CLI flag');
    expect(envelope.code).toBe('CLI.UNKNOWN_FLAG');
    expect(error.why).toContain('--frobnicate');
  });

  it('errorMigrationCliUnknownFlag round-trips flag and knownFlags through meta', () => {
    const error = errorMigrationCliUnknownFlag({
      flag: '--frobnicate',
      knownFlags: ['--dry-run', '--config', '--help'],
    });
    expect(error.meta).toEqual({
      flag: '--frobnicate',
      knownFlags: ['--dry-run', '--config', '--help'],
    });
  });

  it('errorMigrationCliUnknownFlag fix text names every known flag and points to --help', () => {
    const error = errorMigrationCliUnknownFlag({
      flag: '--frobnicate',
      knownFlags: ['--dry-run', '--config', '--help'],
    });
    expect(error.fix).toContain('--dry-run');
    expect(error.fix).toContain('--config');
    expect(error.fix).toContain('--help');
  });

  it('errorInvalidOutputFormat produces CLI.INVALID_OUTPUT_FORMAT', () => {
    const error = errorInvalidOutputFormat('yaml');
    const envelope = error.toEnvelope();
    expect(error.code).toBe('CLI.INVALID_OUTPUT_FORMAT');
    expect(envelope.code).toBe('CLI.INVALID_OUTPUT_FORMAT');
    expect(error.message).toContain('yaml');
    expect(error.message).toContain('pretty, json');
  });

  it('errorOutputFormatMutex produces CLI.OUTPUT_FORMAT_CONFLICT', () => {
    const error = errorOutputFormatMutex();
    const envelope = error.toEnvelope();
    expect(error.code).toBe('CLI.OUTPUT_FORMAT_CONFLICT');
    expect(envelope.code).toBe('CLI.OUTPUT_FORMAT_CONFLICT');
    expect(error.message).toMatch(/--format pretty.*--json/i);
  });

  it('errorEnumCodecNotInPackStack produces CONTRACT.ENUM_CODEC_NOT_IN_PACK_STACK', () => {
    const error = errorEnumCodecNotInPackStack({ codecId: 'mongo/string@1' });
    const envelope = error.toEnvelope();
    expect(error.code).toBe('CONTRACT.ENUM_CODEC_NOT_IN_PACK_STACK');
    expect(envelope.code).toBe('CONTRACT.ENUM_CODEC_NOT_IN_PACK_STACK');
    expect(error.message).toContain('mongo/string@1');
    expect(error.meta).toEqual({ codecId: 'mongo/string@1' });
  });
});

describe('Generic Error', () => {
  it('errorUnexpected creates correct error', () => {
    const error = errorUnexpected('Unexpected error occurred');
    expect(error.code).toBe('CLI.UNEXPECTED');
    expect(error.message).toBe('Unexpected error');
    expect(error.why).toBe('Unexpected error occurred');
  });

  it('errorUnexpected with custom why and fix', () => {
    const error = errorUnexpected('Unexpected error occurred', {
      why: 'Custom why',
      fix: 'Custom fix',
    });
    expect(error.why).toBe('Custom why');
    expect(error.fix).toBe('Custom fix');
  });

  it('errorUnexpected forwards cause', () => {
    const cause = new Error('underlying failure');
    const error = errorUnexpected('Unexpected error occurred', { cause });
    expect(error.cause).toBe(cause);
  });

  it('errorUnexpected without cause leaves no own cause property', () => {
    const error = errorUnexpected('Unexpected error occurred');
    expect(Object.hasOwn(error, 'cause')).toBe(false);
  });
});
