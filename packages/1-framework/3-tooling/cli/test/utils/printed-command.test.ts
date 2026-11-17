import { describe, expect, it } from 'vitest';
import { BIN_COMMANDS } from '../../src/orm/cli';
import { dbFlag } from '../../src/orm/flags';
import { cliCommand, selfEmitCommand } from '../../src/utils/printed-command';

describe('selfEmitCommand', () => {
  it('names the migration.ts relative to where the CLI ran, with the --config it was given', () => {
    expect(
      selfEmitCommand(
        { cwd: '/work', configPath: 'my app/prisma.config.ts', dbGiven: true },
        '/work/my app/migrations/app/20261013T1200_age/migration.ts',
      ),
    ).toBe(
      "node 'my app/migrations/app/20261013T1200_age/migration.ts' --config 'my app/prisma.config.ts'",
    );
  });
});

describe('cliCommand', () => {
  it('repeats --db <url> for exactly the commands whose flags include --db', () => {
    const withDb = { cwd: '/work', configPath: undefined, dbGiven: true };
    const commands = Object.entries(BIN_COMMANDS);
    expect(
      commands
        .filter(([name]) => cliCommand(withDb, name).endsWith(' --db <url>'))
        .map(([name]) => name),
    ).toEqual(
      commands
        .filter(([, command]) => Object.values(command.args?.flags ?? {}).includes(dbFlag))
        .map(([name]) => name),
    );
  });
});
