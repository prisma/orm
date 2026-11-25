import { ormConfigSection } from '@internal/config-loader';
import { flag, positional } from '@prisma/cli-engine';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import {
  executeRefPolicySet,
  type RefPolicyChange,
} from '../../../control-api/operations/ref-policies';
import { defineOrmCommand } from '../../define-command';
import { normalizeError } from '../../normalize-error';
import { editPresentations } from './presentation';
import { DO_NOT_LOOSEN_TO_GET_PAST_A_REFUSAL, planCheckSentence, refPositional } from './text';

function closing(ref: string, changes: readonly RefPolicyChange[]): string {
  return `No database was changed. A database takes on these policies only when its owner applies them in a deploy to ${ref}; until then, deploys to ${ref} refuse while the database's policies differ.${planCheckSentence(ref, changes)}`;
}

export function createRefPolicySetCommand(
  execute: typeof executeRefPolicySet = executeRefPolicySet,
) {
  return defineOrmCommand({
    help: {
      summary: 'Declare policies for a ref',
      description:
        'Writes the policies field of migrations/app/refs/<ref>.json, changing only\n' +
        'the settings named. --change replaces the declared list, so --change\n' +
        'reconcile alone permits only db update. A level is forbidden, with-consent\n' +
        'or permitted. It never connects to a database: a database takes on the\n' +
        'policies only in a deploy its owner gives consent to.\n\n' +
        DO_NOT_LOOSEN_TO_GET_PAST_A_REFUSAL,
      examples: [
        'migration ref policy set production --change migrate',
        'migration ref policy set production --data-loss forbidden',
        'migration ref policy set staging --change migrate --change reconcile --json',
      ],
    },
    args: {
      positionals: { ref: positional.string(refPositional) },
      flags: {
        change: flag.repeated({
          brief:
            'A way the database may change: migrate or reconcile; repeat for both. Replaces the declared list',
          placeholder: 'strategy',
        }),
        dataLoss: flag.string({
          brief: 'Whether a change may lose data: forbidden, with-consent or permitted',
          placeholder: 'level',
        }),
        accessWidening: flag.string({
          brief:
            'Whether a change may widen who can read or write data: forbidden, with-consent or permitted',
          placeholder: 'level',
        }),
      },
    },
    needs: { config: ormConfigSection },
    handler: async (args, ctx) => {
      const ref = args.positionals.ref;
      const result = await execute(
        ref,
        {
          change: args.flags.change,
          dataLoss: args.flags.dataLoss,
          accessWidening: args.flags.accessWidening,
        },
        { config: ctx.config, cwd: ctx.cwd },
      );
      if (!result.ok) return notOk(normalizeError(result.failure));
      return ok(
        ctx.present(
          { data: result.value.result },
          editPresentations(result.value, ctx.cwd, (changes) => closing(ref, changes)),
        ),
      );
    },
  });
}

export const refPolicySetCommand = createRefPolicySetCommand();
