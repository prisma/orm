import { ormConfigSection } from '@internal/config-loader';
import { positional } from '@prisma/cli-engine';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import { executeRefPolicyShow } from '../../../control-api/operations/ref-policies';
import { defineOrmCommand } from '../../define-command';
import { normalizeError } from '../../normalize-error';
import { showPresentations } from './presentation';
import { refPositional } from './text';

export function createRefPolicyShowCommand(
  execute: typeof executeRefPolicyShow = executeRefPolicyShow,
) {
  return defineOrmCommand({
    help: {
      summary: 'Show the policies a ref declares',
      description:
        'Prints the change policy and the data protection policy that\n' +
        'migrations/app/refs/<ref>.json declares, each setting with its value or\n' +
        '"not declared". It reads only that file and never connects to a database;\n' +
        'to compare with what a database has, run migration status --to <ref> --db <url>.',
      examples: [
        'migration ref policy show production',
        'migration ref policy show production --json',
      ],
    },
    args: { positionals: { ref: positional.string(refPositional) } },
    needs: { config: ormConfigSection },
    handler: async (args, ctx) => {
      const result = await execute(args.positionals.ref, { config: ctx.config, cwd: ctx.cwd });
      if (!result.ok) return notOk(normalizeError(result.failure));
      return ok(
        ctx.present({ data: result.value.result }, showPresentations(result.value, ctx.cwd)),
      );
    },
  });
}

export const refPolicyShowCommand = createRefPolicyShowCommand();
