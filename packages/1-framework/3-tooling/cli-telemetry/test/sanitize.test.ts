import { describe, expect, it } from 'vitest';
import { sanitizeCommanderResult } from '../src/sanitize';

describe('sanitizeCommanderResult', () => {
  it('extracts the command name and user-supplied long flag names, dropping all values and positionals', () => {
    expect(
      sanitizeCommanderResult({
        commandPath: ['prisma', 'migration', 'new'],
        positionalArgs: ['user-feature', '/Users/alice/secret.toml'],
        options: [
          { attributeName: 'name', longName: '--name', source: 'cli' },
          { attributeName: 'dryRun', longName: '--dry-run', source: 'cli' },
          { attributeName: 'target', longName: '--target', source: 'cli' },
          { attributeName: 'connectionString', longName: '--connection-string', source: 'cli' },
        ],
      }),
    ).toEqual({
      command: 'migration new',
      flags: ['name', 'dry-run', 'target', 'connection-string'],
    });
  });

  it('returns the empty flag list when no options were supplied by the user', () => {
    expect(
      sanitizeCommanderResult({
        commandPath: ['prisma', 'init'],
        positionalArgs: [],
        options: [
          { attributeName: 'install', longName: '--no-install', source: 'default' },
          { attributeName: 'json', longName: '--json', source: null },
        ],
      }),
    ).toEqual({
      command: 'init',
      flags: [],
    });
  });

  it('joins multi-segment command paths into a single space-delimited command field', () => {
    expect(
      sanitizeCommanderResult({
        commandPath: ['prisma', 'contract', 'emit'],
        positionalArgs: [],
        options: [{ attributeName: 'config', longName: '--config', source: 'cli' }],
      }).command,
    ).toBe('contract emit');
  });

  it('strips the root program name (`prisma`) so command starts at the first verb', () => {
    expect(
      sanitizeCommanderResult({
        commandPath: ['prisma', 'help'],
        positionalArgs: [],
        options: [],
      }).command,
    ).toBe('help');
  });

  it('preserves Commander option declaration order while filtering non-cli sources', () => {
    expect(
      sanitizeCommanderResult({
        commandPath: ['prisma', 'migrate'],
        positionalArgs: [],
        options: [
          { attributeName: 'to', longName: '--to', source: 'cli' },
          { attributeName: 'yes', longName: '--yes', source: 'cli' },
          { attributeName: 'json', longName: '--json', source: null },
          { attributeName: 'verbose', longName: '--verbose', source: 'env' },
        ],
      }).flags,
    ).toEqual(['to', 'yes']);
  });

  it('emits negated option names exactly as users type them', () => {
    expect(
      sanitizeCommanderResult({
        commandPath: ['prisma', 'init'],
        positionalArgs: [],
        options: [{ attributeName: 'install', longName: '--no-install', source: 'cli' }],
      }).flags,
    ).toEqual(['no-install']);
  });

  it('never emits Commander camelCase attribute names', () => {
    expect(
      sanitizeCommanderResult({
        commandPath: ['prisma', 'init'],
        positionalArgs: [],
        options: [
          { attributeName: 'schemaPath', longName: '--schema-path', source: 'cli' },
          { attributeName: 'dryRun', longName: '--dry-run', source: 'cli' },
        ],
      }).flags,
    ).toEqual(['schema-path', 'dry-run']);
  });

  it('never reads positional args; the positionalArgs input is intentionally accepted but unused', () => {
    const out = sanitizeCommanderResult({
      commandPath: ['prisma', 'init'],
      positionalArgs: ['SHOULD-NEVER-LEAK', 'NEITHER-SHOULD-THIS'],
      options: [{ attributeName: 'target', longName: '--target', source: 'cli' }],
    });
    const serialised = JSON.stringify(out);
    expect(serialised).not.toContain('SHOULD-NEVER-LEAK');
    expect(serialised).not.toContain('NEITHER-SHOULD-THIS');
  });

  it('never includes flag values in its output', () => {
    const out = sanitizeCommanderResult({
      commandPath: ['prisma', 'migration', 'new'],
      positionalArgs: [],
      options: [{ attributeName: 'name', longName: '--name', source: 'cli' }],
    });
    expect(out.flags).toEqual(['name']);
    expect(JSON.stringify(out)).not.toContain('customer-acme-payments');
  });

  it('drops short-only options because the event contract requires long user-facing names', () => {
    expect(
      sanitizeCommanderResult({
        commandPath: ['prisma', 'custom'],
        positionalArgs: [],
        options: [{ attributeName: 'q', longName: null, source: 'cli' }],
      }).flags,
    ).toEqual([]);
  });

  it('handles an empty commandPath by returning an empty command string', () => {
    expect(
      sanitizeCommanderResult({
        commandPath: [],
        positionalArgs: [],
        options: [],
      }).command,
    ).toBe('');
  });
});
