import { describe, expect, it } from 'vitest';
import type { NextAction } from '../src/structured-error';
import {
  docsUrlFor,
  isStructuredError,
  isStructuredErrorCode,
  structuredError,
} from '../src/structured-error';

describe('isStructuredErrorCode', () => {
  it('true for a dotted NAMESPACE.SUBCODE', () => {
    expect(isStructuredErrorCode('MIGRATION.CHECK_HASH_MISMATCH')).toBe(true);
  });

  it('false for a lowercase code with a dot in it', () => {
    expect(isStructuredErrorCode('foo.bar')).toBe(false);
  });

  it('false for a code with no dot', () => {
    expect(isStructuredErrorCode('ECONNREFUSED')).toBe(false);
  });

  it('false for a code with more than one dot', () => {
    expect(isStructuredErrorCode('A.B.C')).toBe(false);
  });
});

describe('isStructuredError', () => {
  it('true for a value created by structuredError', () => {
    expect(isStructuredError(structuredError('CONTRACT.MARKER_MISSING', 'm'))).toBe(true);
  });

  it('true for a bare object of the right shape (no instanceof check — must survive plane/network boundaries)', () => {
    expect(isStructuredError({ code: 'CONTRACT.MARKER_MISSING', message: 'm' })).toBe(true);
  });

  it('false for a plain Error without a code', () => {
    expect(isStructuredError(new Error('x'))).toBe(false);
  });

  it('false for a code that is not dotted', () => {
    expect(isStructuredError({ code: 'notdotted', message: 'm' })).toBe(false);
  });

  it('false when message is missing', () => {
    expect(isStructuredError({ code: 'X.Y' })).toBe(false);
  });

  it('false for null, undefined, and primitives', () => {
    expect(isStructuredError(null)).toBe(false);
    expect(isStructuredError(undefined)).toBe(false);
    expect(isStructuredError(42)).toBe(false);
    expect(isStructuredError('str')).toBe(false);
  });
});

describe('structuredError', () => {
  it('sets code and message', () => {
    const error = structuredError('CONTRACT.MARKER_MISSING', 'Marker missing');
    expect(error.code).toBe('CONTRACT.MARKER_MISSING');
    expect(error.message).toBe('Marker missing');
  });

  it('sets why, fix, where, severity, meta, and docsUrl when passed', () => {
    const error = structuredError('CONTRACT.MARKER_MISSING', 'Marker missing', {
      why: 'No marker row found.',
      fix: 'Run migration verify.',
      where: { path: 'schema.psl', line: 12 },
      severity: 'warn',
      meta: { table: 'users' },
      docsUrl: 'https://example.com/docs',
    });

    expect(error.why).toBe('No marker row found.');
    expect(error.fix).toBe('Run migration verify.');
    expect(error.where).toEqual({ path: 'schema.psl', line: 12 });
    expect(error.severity).toBe('warn');
    expect(error.meta).toEqual({ table: 'users' });
    expect(error.docsUrl).toBe('https://example.com/docs');
  });

  it('omits optional fields when not passed', () => {
    const error = structuredError('CONTRACT.MARKER_MISSING', 'Marker missing');
    expect('why' in error).toBe(false);
    expect('fix' in error).toBe(false);
    expect('nextActions' in error).toBe(false);
    expect('where' in error).toBe(false);
    expect('severity' in error).toBe(false);
    expect('meta' in error).toBe(false);
    expect('docsUrl' in error).toBe(false);
  });

  it('carries nextActions through unmodified, including the {bin} placeholder', () => {
    const nextActions: readonly NextAction[] = [
      {
        kind: 'run-command',
        label: 'Sign the database',
        command: '{bin} db sign --db <url>',
        reason: 'Writes a fresh contract marker.',
      },
    ];
    const error = structuredError('CONTRACT.MARKER_MISSING', 'Marker missing', { nextActions });

    expect(error.nextActions).toEqual(nextActions);
  });

  it('accepts every NextAction kind and carries commands, url, and reason', () => {
    const nextActions: readonly NextAction[] = [
      { kind: 'run-command', label: 'Run one', command: '{bin} db init' },
      {
        kind: 'run-command',
        label: 'Run in order',
        commands: ['{bin} db init', '{bin} db verify'],
      },
      { kind: 'open-url', label: 'Read the docs', url: 'https://example.com/docs' },
      { kind: 'user-choice', label: 'Pick a target', reason: 'Two targets match.' },
      { kind: 'edit-file', label: 'Fill in the placeholder' },
      { kind: 'done', label: 'Nothing further to do' },
    ];
    const error = structuredError('CONTRACT.MARKER_MISSING', 'Marker missing', { nextActions });

    expect(error.nextActions).toEqual(nextActions);
  });

  it('sets cause when passed', () => {
    const cause = new Error('root cause');
    const error = structuredError('CONTRACT.MARKER_MISSING', 'Marker missing', { cause });
    expect(error.cause).toBe(cause);
  });

  it('is throwable and catchable, and still passes isStructuredError', () => {
    try {
      throw structuredError('CONTRACT.MARKER_MISSING', 'Marker missing');
    } catch (caught) {
      expect(isStructuredError(caught)).toBe(true);
    }
  });

  it('is throwable via expect().toThrow()', () => {
    expect(() => {
      throw structuredError('CONTRACT.MARKER_MISSING', 'Marker missing');
    }).toThrow('Marker missing');
  });
});

describe('docsUrlFor', () => {
  it('builds the docs URL from the code fragment', () => {
    expect(docsUrlFor('CONTRACT.MARKER_MISSING')).toBe(
      'https://docs.prisma.io/docs/orm/v8/reference/error-reference#CONTRACT.MARKER_MISSING',
    );
  });
});
