import { CliStructuredError } from '@internal/errors/control';
import { structuredError } from '@internal/utils/structured-error';
import { CliStructuredError as EngineStructuredError } from '@prisma/cli-engine/protocol';
import { describe, expect, it } from 'vitest';
import { normalizeError, toEngineDiagnostic } from '../../src/orm/normalize-error';
import { errorSpaceNotFound } from '../../src/utils/cli-errors';

describe('normalizeError', () => {
  describe('a prisma/prisma error carrying fix prose', () => {
    const raised = new CliStructuredError('MIGRATION.SPACE_NOT_FOUND', 'Unknown contract space', {
      why: 'No directory named "billing" exists under the migrations root.',
      fix: 'Run `{bin} migration list` to see every space.',
      where: { path: '/app/migrations' },
      meta: { spaceId: 'billing' },
    });

    it('turns the fix prose into a single next action', () => {
      expect(normalizeError(raised).nextActions).toEqual([
        { kind: 'user-choice', label: 'Run `{bin} migration list` to see every space.' },
      ]);
    });

    it('carries the code, summary and structured fields through unchanged', () => {
      const normalized = normalizeError(raised);

      expect(normalized.toEnvelope()).toEqual({
        ok: false,
        code: 'MIGRATION.SPACE_NOT_FOUND',
        severity: 'error',
        summary: 'Unknown contract space',
        why: 'No directory named "billing" exists under the migrations root.',
        where: { path: '/app/migrations' },
        meta: { spaceId: 'billing' },
        nextActions: [
          { kind: 'user-choice', label: 'Run `{bin} migration list` to see every space.' },
        ],
      });
    });

    it('drops the non-protocol fix field', () => {
      expect(normalizeError(raised).toEnvelope()).not.toHaveProperty('fix');
    });

    it('splits multi-line fix prose into one action per line', () => {
      const multiline = new CliStructuredError(
        'MIGRATION.PATH_UNREACHABLE',
        'Cannot reach target',
        {
          fix: 'Plan the missing edge, then apply it:\n  1. {bin} migration plan\n  2. {bin} db migrate',
        },
      );

      expect(normalizeError(multiline).nextActions).toEqual([
        { kind: 'user-choice', label: 'Plan the missing edge, then apply it:' },
        { kind: 'user-choice', label: '1. {bin} migration plan' },
        { kind: 'user-choice', label: '2. {bin} db migrate' },
      ]);
    });
  });

  describe('an error with no fix', () => {
    it('produces an empty next-action list rather than undefined', () => {
      const raised = new CliStructuredError('CLI.UNEXPECTED', 'Something went wrong');

      expect(normalizeError(raised).nextActions).toEqual([]);
    });
  });

  describe('a CLI factory carrying typed actions', () => {
    const raised = errorSpaceNotFound('billing', ['app']);

    it('keeps the typed actions instead of deriving them from the prose', () => {
      expect(normalizeError(raised).nextActions).toEqual([
        { kind: 'user-choice', label: 'Pick one of: app' },
        {
          kind: 'run-command',
          label: "See every space's migrations",
          command: '{bin} migration list',
        },
      ]);
    });

    it('drops the fix prose the commander shell still renders', () => {
      expect(raised.fix).toBeDefined();
      expect(normalizeError(raised).toEnvelope()).not.toHaveProperty('fix');
    });
  });

  describe('a structuredError() value, which carries no toEnvelope method', () => {
    const raised = structuredError('CONTRACT.VALIDATION_FAILED', 'Contract is not valid', {
      why: 'storage.storageHash is missing',
      fix: 'Run `{bin} contract emit` to regenerate.',
      where: { path: '/app/contract.json' },
      meta: { target: 'postgres' },
    });

    it('keeps every structured field instead of flattening to CLI.UNEXPECTED', () => {
      expect(normalizeError(raised).toEnvelope()).toEqual({
        ok: false,
        code: 'CONTRACT.VALIDATION_FAILED',
        severity: 'error',
        summary: 'Contract is not valid',
        why: 'storage.storageHash is missing',
        where: { path: '/app/contract.json' },
        meta: { target: 'postgres' },
        nextActions: [{ kind: 'user-choice', label: 'Run `{bin} contract emit` to regenerate.' }],
      });
    });
  });

  describe('an error whose code is not a dotted NAMESPACE.SUBCODE', () => {
    it('settles as CLI.UNEXPECTED rather than emitting a code the protocol rejects', () => {
      const raised = Object.assign(new Error('Something broke'), { code: 'UNEXPECTED' });

      expect(normalizeError(raised).toEnvelope()).toEqual({
        ok: false,
        code: 'CLI.UNEXPECTED',
        severity: 'error',
        summary: 'Something broke',
        meta: { code: 'UNEXPECTED' },
        nextActions: [],
      });
    });

    it('keeps a filesystem errno in meta so the cause survives the flattening', () => {
      const raised = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });

      expect(normalizeError(raised).toEnvelope()).toMatchObject({
        code: 'CLI.UNEXPECTED',
        meta: { code: 'ENOENT' },
      });
    });
  });

  describe('an already-conformant engine error', () => {
    const conformant = new EngineStructuredError('CLI.CONSENT_REQUIRED', 'Consent is required', {
      nextActions: [{ kind: 'run-command', label: 'Confirm', command: '{bin} db update' }],
    });

    it('is returned untouched', () => {
      expect(normalizeError(conformant)).toBe(conformant);
    });
  });

  describe('a bare throw', () => {
    it('wraps an Error as CLI.UNEXPECTED with its message', () => {
      const normalized = normalizeError(new Error('connection reset'));

      expect(normalized.toEnvelope()).toEqual({
        ok: false,
        code: 'CLI.UNEXPECTED',
        severity: 'error',
        summary: 'connection reset',
        nextActions: [],
      });
    });

    it('keeps the original as the cause', () => {
      const thrown = new Error('connection reset');

      expect(normalizeError(thrown).cause).toBe(thrown);
    });

    it('wraps a non-Error throw by stringifying it', () => {
      expect(normalizeError('just a string').toEnvelope()).toMatchObject({
        code: 'CLI.UNEXPECTED',
        summary: 'just a string',
      });
    });

    it('describes a throw with no useful message', () => {
      expect(normalizeError(undefined).toEnvelope()).toMatchObject({
        code: 'CLI.UNEXPECTED',
        summary: 'undefined',
      });
    });
  });
});

describe('toEngineDiagnostic', () => {
  it('projects an error onto the protocol diagnostic shape', () => {
    const raised = new CliStructuredError('CONFIG.FILE_NOT_FOUND', 'Config file not found', {
      why: 'No prisma.config.ts in /app',
      fix: "Run '{bin} orm init' to create a config file",
      where: { path: '/app/prisma.config.ts' },
    });

    expect(toEngineDiagnostic(raised)).toEqual({
      code: 'CONFIG.FILE_NOT_FOUND',
      severity: 'error',
      summary: 'Config file not found',
      why: 'No prisma.config.ts in /app',
      where: { path: '/app/prisma.config.ts' },
      nextActions: [{ kind: 'user-choice', label: "Run '{bin} orm init' to create a config file" }],
    });
  });

  it('always carries a next-action list', () => {
    const raised = new CliStructuredError('CLI.UNEXPECTED', 'Boom');

    expect(toEngineDiagnostic(raised).nextActions).toEqual([]);
  });
});
