import { ormConfigSection } from '@internal/config-loader';
import { positional } from '@prisma/cli-engine';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import {
  executeRefPolicyDelete,
  type RefPolicyChange,
} from '../../../control-api/operations/ref-policies';
import { defineOrmCommand } from '../../define-command';
import { normalizeError } from '../../normalize-error';
import { editPresentations } from './presentation';
import {
  andList,
  DO_NOT_LOOSEN_TO_GET_PAST_A_REFUSAL,
  isForbiddenLevel,
  refPositional,
} from './text';

function closing(ref: string, changes: readonly RefPolicyChange[]): string {
  const removed = andList(changes.map(({ setting }) => setting));
  const forbidding = changes.flatMap(({ setting, before }) =>
    before !== null && isForbiddenLevel(before) ? [setting] : [],
  );
  const planChecks =
    forbidding.length === 0
      ? ''
      : `, and {bin} migration plan --to ${ref} no longer checks plans against ${andList(forbidding)}`;
  return `No database was changed. Deploys to ${ref} no longer compare ${removed} with the database${planChecks}.`;
}

export function createRefPolicyDeleteCommand(
  execute: typeof executeRefPolicyDelete = executeRefPolicyDelete,
) {
  return defineOrmCommand({
    help: {
      summary: 'Remove settings from the policies a ref declares',
      description:
        'Removes the named settings from the policies field of\n' +
        'migrations/app/refs/<ref>.json, so the ref declares nothing about them. A\n' +
        'setting is named change, dataProtection.dataLoss or\n' +
        'dataProtection.accessWidening, or by its flag name: data-loss or\n' +
        'access-widening. It never connects to a database.\n\n' +
        DO_NOT_LOOSEN_TO_GET_PAST_A_REFUSAL,
      examples: [
        'migration ref policy delete staging change',
        'migration ref policy delete staging data-loss access-widening --json',
      ],
    },
    args: {
      positionals: {
        ref: positional.string(refPositional),
        settings: positional.variadic({ brief: 'Settings to remove', placeholder: 'setting' }),
      },
    },
    needs: { config: ormConfigSection },
    handler: async (args, ctx) => {
      const ref = args.positionals.ref;
      const result = await execute(ref, args.positionals.settings, {
        config: ctx.config,
        cwd: ctx.cwd,
      });
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

export const refPolicyDeleteCommand = createRefPolicyDeleteCommand();
