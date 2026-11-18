import { describe, expect, it } from 'vitest';
import { resolverChildCommand } from '../../src/orm/resolver-child-command';

describe('resolverChildCommand', () => {
  it('evaluates the script as a module with the runtime running the CLI', () => {
    expect(
      resolverChildCommand({ node: '24.0.0' }, '/usr/bin/node', 'SCRIPT', 'acme-db/init'),
    ).toEqual({
      command: '/usr/bin/node',
      args: ['--input-type=module', '-e', 'SCRIPT', '--', 'acme-db/init'],
    });
  });

  it('uses deno eval under Deno', () => {
    expect(
      resolverChildCommand(
        { node: '24.0.0', deno: '2.6.10' },
        '/opt/bin/deno',
        'SCRIPT',
        'acme-db/init',
      ),
    ).toEqual({ command: '/opt/bin/deno', args: ['eval', 'SCRIPT', '--', 'acme-db/init'] });
  });

  it('passes a specifier that starts with a dash as an argument, not an option', () => {
    const { args } = resolverChildCommand(
      { node: '24.0.0' },
      '/usr/bin/node',
      'SCRIPT',
      '--version',
    );
    expect(args.slice(-2)).toEqual(['--', '--version']);
  });
});
