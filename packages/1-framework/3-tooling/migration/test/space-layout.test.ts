import { describe, expect, it } from 'vitest';
import { MigrationToolsError } from '../src/errors';
import {
  APP_SPACE_ID,
  assertValidSpaceId,
  isValidSpaceId,
  spaceMigrationDirectory,
} from '../src/space-layout';

describe('isValidSpaceId', () => {
  it.each([
    ['app', true],
    ['cipherstash', true],
    ['pgvector', true],
    ['my-extension', true],
    ['my_extension', true],
    ['x', true],
    ['x123', true],
  ])('accepts %s', (id, expected) => {
    expect(isValidSpaceId(id)).toBe(expected);
  });

  it.each([
    ['', 'empty'],
    ['Cipherstash', 'starts with uppercase'],
    ['1pgvector', 'starts with digit'],
    ['_leading-underscore', 'starts with underscore'],
    ['-leading-dash', 'starts with dash'],
    ['has space', 'contains a space'],
    ['has.dot', 'contains a dot'],
    ['has/slash', 'contains a slash'],
    ['HAS_UPPER', 'uppercase letters'],
    [`a${'b'.repeat(64)}`, 'longer than 64 chars'],
  ])('rejects %s (%s)', (id, _why) => {
    expect(isValidSpaceId(id)).toBe(false);
  });
});

describe('assertValidSpaceId', () => {
  it('returns void on a valid id', () => {
    expect(() => assertValidSpaceId('cipherstash')).not.toThrow();
  });

  it('throws a MigrationToolsError with code MIGRATION.INVALID_SPACE_ID on an invalid id', () => {
    let captured: unknown;
    try {
      assertValidSpaceId('Bad Space');
    } catch (error) {
      captured = error;
    }
    expect(MigrationToolsError.is(captured)).toBe(true);
    const err = captured as MigrationToolsError;
    expect(err.code).toBe('MIGRATION.INVALID_SPACE_ID');
    expect(err.category).toBe('MIGRATION');
    expect(err.why).toContain('Bad Space');
  });
});

describe('spaceMigrationDirectory', () => {
  it('appends the app space id as a subdirectory (uniform with extensions)', () => {
    // The app no longer has a special-case layout — its migrations
    // live under the same `migrations/<spaceId>/` subtree as any
    // extension space.
    expect(spaceMigrationDirectory('/p/migrations', APP_SPACE_ID)).toBe('/p/migrations/app');
  });

  it('appends the space id as a subdirectory for an extension space', () => {
    expect(spaceMigrationDirectory('/p/migrations', 'cipherstash')).toBe(
      '/p/migrations/cipherstash',
    );
  });

  it('throws on an invalid space id', () => {
    expect(() => spaceMigrationDirectory('/p/migrations', 'Bad Space')).toThrow(
      MigrationToolsError,
    );
  });
});
