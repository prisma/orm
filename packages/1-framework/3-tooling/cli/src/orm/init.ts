import { ifDefined } from '@internal/utils/defined';
import { docsUrlFor } from '@internal/utils/structured-error';
import type { PackageManagerId } from '@prisma/cli-engine';
import { flag } from '@prisma/cli-engine';
import type { Diagnostic, NextAction } from '@prisma/cli-engine/protocol';
import { CliStructuredError, notOk, ok } from '@prisma/cli-engine/protocol';
import { type } from 'arktype';
import { buildCatalogWarnings } from '../commands/init/catalog-warnings';
import { errorInitProbeFailed } from '../commands/init/errors';
import {
  buildNextSteps,
  type InitOutput,
  InitOutputSchema,
  type InstallStatus,
} from '../commands/init/output';
import { type ProbeOutcome, probeServerVersion } from '../commands/init/probe-db';
import { resolveProjectSkillInstallCommands } from '../commands/init/skill-sources';
import { targetPackageName } from '../commands/init/templates/code-templates';
import { MIN_SERVER_VERSION } from '../commands/init/templates/env';
import { chooseAction } from '../utils/next-actions';
import { defineOrmCommand } from './define-command';
import { buildInitNextActions, initPresentations } from './init-blocks';
import {
  EMIT_COMMAND,
  emitFailedFinding,
  installFailedFinding,
  skillInstallFailedFinding,
} from './init-diagnostics';
import { emitScaffoldedContract } from './init-emit';
import { resolveInitInputs } from './init-inputs';
import {
  engineDevDependencySpec,
  installAgentSkills,
  installProjectDependencies,
} from './init-packages';
import { resolveScaffoldPackageManager, scaffoldProject } from './init-scaffold';
import { normalizeError } from './normalize-error';

/** The scaffold is on disk from here on, so each of these is a finding. */
const INIT_EXIT_CODES = {
  4: 'scaffold written; dependency install failed',
  5: 'scaffold written and installed; contract emit failed',
  6: 'scaffold complete; agent-skill install failed',
} as const;

function probeWarning(
  outcome: ProbeOutcome,
  strictProbe: boolean,
): {
  readonly warning: string | undefined;
  readonly fatal: string | undefined;
} {
  switch (outcome.kind) {
    case 'ok':
      return { warning: undefined, fatal: undefined };
    // The probe ran and found an old server, which is the probe doing its job
    // rather than failing at it, so --strict-probe does not escalate it.
    case 'below-minimum':
      return { warning: outcome.message, fatal: undefined };
    case 'no-database-url':
    case 'connection-failed':
    case 'driver-missing':
      return strictProbe
        ? { warning: undefined, fatal: outcome.message }
        : { warning: outcome.message, fatal: undefined };
  }
}

function causeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface InitCommandDependencies {
  readonly emitScaffoldedContract: typeof emitScaffoldedContract;
}

export const createInitCommand = (injected: InitCommandDependencies) =>
  defineOrmCommand({
    help: {
      summary: 'Initialize a new Prisma Next project',
      description:
        'Scaffolds config, schema, and runtime files, installs dependencies,\n' +
        'and emits the contract. Gets you from zero to typed queries in one step.\n' +
        '\n' +
        'Run it interactively for a guided setup, or supply --target and --authoring\n' +
        'for a fully scriptable run (CI, AI coding agents, automation).',
      examples: [
        'orm init',
        // biome-ignore lint/plugin/no-family-vocabulary: names a target on purpose — user-facing help showing what to pass to --target
        'orm init --target postgres --authoring psl',
        // biome-ignore lint/plugin/no-family-vocabulary: names a target on purpose — user-facing help showing what to pass to --target
        'orm init --target mongodb --authoring typescript --json',
        'orm init --skip-install',
        'orm init --skip-skills',
        // biome-ignore lint/plugin/no-family-vocabulary: names a target on purpose — user-facing help showing what to pass to --target
        'orm init --target postgres --keep-previous-facade',
      ],
    },
    args: {
      flags: {
        // Not flag.enum: the aliases and capitalizations init has always
        // accepted (postgresql, mongodb, ts, any case) are matched in the
        // handler, where a rejection can name every allowed value.
        // biome-ignore lint/plugin/no-family-vocabulary: names the targets on purpose — user-facing flag help listing the accepted values
        target: flag.string({ brief: 'Database target: postgres or mongodb', placeholder: 'db' }),
        authoring: flag.string({
          brief: 'Schema authoring style: psl or typescript',
          placeholder: 'style',
        }),
        schemaPath: flag.string({
          brief: 'Where to write the starter schema',
          placeholder: 'path',
        }),
        writeEnv: flag.boolean({
          brief: 'Write a .env file from .env.example (gitignored)',
        }),
        probeDb: flag.boolean({
          brief: 'Connect to DATABASE_URL once and check the server version',
        }),
        strictProbe: flag.boolean({ brief: 'Treat a failed --probe-db as fatal' }),
        skipInstall: flag.boolean({ brief: 'Skip dependency installation and contract emission' }),
        skipSkills: flag.boolean({ brief: 'Skip the Prisma Next agent-skill install' }),
        keepPreviousFacade: flag.boolean({
          brief: 'Keep the previous target package in package.json when switching targets',
        }),
      },
    },
    exitCodes: INIT_EXIT_CODES,
    installsPackages: true,
    handler: async (args, ctx) => {
      const warnings: string[] = [];
      const warn = (text: string): void => {
        warnings.push(text);
        ctx.report({ kind: 'message', severity: 'warn', text });
      };

      const inputs = await resolveInitInputs({
        cwd: ctx.cwd,
        flags: args.flags,
        prompt: ctx.prompt,
      });

      const packageManager = await resolveScaffoldPackageManager({ cwd: ctx.cwd, env: ctx.env });
      const scaffold = scaffoldProject({ cwd: ctx.cwd, inputs, packageManager });
      for (const warning of scaffold.warnings) {
        warn(warning);
      }
      for (const note of scaffold.notes) {
        ctx.report({ kind: 'message', severity: 'info', text: note });
      }

      const deps = [targetPackageName(inputs.target, scaffold.resolveImportSpecifier), 'dotenv'];
      // The CLI the scaffolded scripts run is the unified `@prisma/cli`, whose
      // v8 line publishes under the `next` dist-tag (the `prisma-next` shim is
      // no longer published). `@prisma/cli-engine` — the config file's
      // defineConfig import — is deliberately absent here: the CLI declares it
      // as an exact peer, so it installs in a second step at the version the
      // just-installed CLI names. Under moduleResolution 'bundler' the
      // scaffolded files reference process.env, which only typechecks with
      // Node's ambient types present; a project that already pins @types/node
      // keeps its own major.
      const cliDevDeps = ['@prisma/cli@next'];
      const devDeps: string[] = scaffold.hasTypesNode ? cliDevDeps : [...cliDevDeps, '@types/node'];

      const findings: Diagnostic[] = [];
      const extraActions: NextAction[] = [];
      let installedManager: PackageManagerId | undefined;
      let packagesInstalled: InstallStatus = 'skipped';
      let contractEmitted = false;
      let skillRegistered = false;

      const settle = (exitCode: 0 | 4 | 5 | 6) => {
        const installed = packagesInstalled === 'installed';
        const document: InitOutput = {
          ok: true,
          target: inputs.target === 'mongo' ? 'mongodb' : 'postgres',
          authoring: inputs.authoring,
          schemaPath: inputs.schemaPath,
          filesWritten: scaffold.filesWritten,
          filesDeleted: scaffold.filesDeleted,
          packagesInstalled: {
            status: packagesInstalled,
            deps: installed ? deps : [],
            devDeps: installed ? devDeps : [],
          },
          contractEmitted,
          nextSteps: buildNextSteps({
            target: inputs.target === 'mongo' ? 'mongodb' : 'postgres',
            packagesInstalled,
            contractEmitted,
            emitCommand: EMIT_COMMAND,
            schemaPath: inputs.schemaPath,
            skillRegistered,
          }),
          warnings,
        };
        const validated = InitOutputSchema(document);
        if (validated instanceof type.errors) {
          return notOk(
            new CliStructuredError(
              'CLI.INIT_INVALID_OUTPUT_DOCUMENT',
              'Init produced an invalid output document',
              {
                why: `The success document failed schema validation: ${String(validated)}`,
                nextActions: [
                  chooseAction('This is a bug in Prisma Next. Please report it with `-v` output.'),
                ],
                docsUrl: docsUrlFor('CLI.INIT_INVALID_OUTPUT_DOCUMENT'),
              },
            ),
          );
        }
        return ok(
          ctx.present(
            { data: document, exitCode, diagnostics: findings },
            initPresentations({
              document,
              complete: exitCode === 0,
              nextActions: [
                ...extraActions,
                ...buildInitNextActions({
                  contractEmitted,
                  schemaPath: inputs.schemaPath,
                  skillRegistered,
                }),
              ],
            }),
          ),
        );
      };

      if (inputs.install) {
        const outcome = await installProjectDependencies({
          packages: ctx.packages,
          cwd: ctx.cwd,
          deps,
          devDeps,
          catalogWarnings:
            packageManager === 'pnpm' ? buildCatalogWarnings(ctx.cwd, [...deps, ...devDeps]) : [],
        });
        for (const warning of outcome.warnings) {
          warn(warning);
        }
        if (outcome.failure !== undefined) {
          packagesInstalled = 'failed';
          findings.push(installFailedFinding(outcome.failure, scaffold.filesWritten));
          return settle(4);
        }
        const engineSpec = engineDevDependencySpec(ctx.cwd);
        const engineInstall = await ctx.packages.install({
          packages: [engineSpec],
          dev: true,
          cwd: ctx.cwd,
          ...ifDefined('manager', outcome.manager),
        });
        if (!engineInstall.ok) {
          packagesInstalled = 'failed';
          findings.push(installFailedFinding(engineInstall.failure, scaffold.filesWritten));
          return settle(4);
        }
        devDeps.push(engineSpec);
        packagesInstalled = 'installed';
        installedManager = outcome.manager;

        const emitStep = 'Emit the contract';
        ctx.report({ kind: 'step-started', step: emitStep });
        try {
          await injected.emitScaffoldedContract({ cwd: ctx.cwd });
          contractEmitted = true;
          ctx.report({ kind: 'step-finished', step: emitStep, outcome: 'ok' });
        } catch (error) {
          ctx.report({ kind: 'step-finished', step: emitStep, outcome: 'failed' });
          findings.push(emitFailedFinding(causeMessage(error), scaffold.filesWritten));
          return settle(5);
        }
      } else {
        extraActions.push(
          chooseAction(
            `Install the project dependencies with your package manager: ${deps.join(', ')} (and ${devDeps.join(', ')} plus @prisma/cli-engine at the version @prisma/cli declares as its peer, as development dependencies)`,
          ),
        );
      }

      // Opt-in, and after the install so the target driver is resolvable from
      // the project's own node_modules.
      if (inputs.probeDb) {
        const outcome = await probeServerVersion(
          {
            baseDir: ctx.cwd,
            target: inputs.target,
            databaseUrl: ctx.env['DATABASE_URL'],
            minVersion: MIN_SERVER_VERSION[inputs.target],
          },
          {},
        );
        const probe = probeWarning(outcome, inputs.strictProbe);
        if (probe.warning !== undefined) {
          warn(probe.warning);
        }
        if (probe.fatal !== undefined) {
          return notOk(
            normalizeError(
              errorInitProbeFailed({ cause: probe.fatal, filesWritten: scaffold.filesWritten }),
            ),
          );
        }
      }

      // The skills install through the same manager the dependencies did, and
      // needs no scaffold, so the commands stand alone: whether it is skipped or
      // fails, what the user is told to run is the install itself — never `init`
      // again, which would re-scaffold over the schema they have since written.
      const skillCommands = resolveProjectSkillInstallCommands(
        installedManager ?? packageManager,
        ctx.env,
      );

      if (inputs.installProjectSkill) {
        const failure = await installAgentSkills({
          packages: ctx.packages,
          cwd: ctx.cwd,
          env: ctx.env,
          manager: installedManager,
        });
        if (failure !== undefined) {
          findings.push(skillInstallFailedFinding(failure, scaffold.filesWritten, skillCommands));
          return settle(6);
        }
        skillRegistered = true;
      } else {
        warn(
          `Skipped the Prisma Next agent-skill install (--skip-skills). To install them later, run: ${skillCommands.map((command) => `\`${command}\``).join(' && ')}`,
        );
      }

      return settle(0);
    },
  });

export const initCommand = createInitCommand({ emitScaffoldedContract });
