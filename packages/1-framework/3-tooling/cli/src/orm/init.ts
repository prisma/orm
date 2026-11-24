import { docsUrlFor } from '@internal/utils/structured-error';
import { flag } from '@prisma/cli-engine';
import type { Diagnostic, NextAction } from '@prisma/cli-engine/protocol';
import { CliStructuredError, notOk, ok } from '@prisma/cli-engine/protocol';
import { type } from 'arktype';
import { buildCatalogWarnings } from '../commands/init/catalog-warnings';
import { quoteSpec } from '../commands/init/detect-package-manager';
import { errorInitProbeFailed } from '../commands/init/errors';
import {
  buildNextSteps,
  type InitOutput,
  InitOutputSchema,
  type InstallStatus,
  NEXT_STEPS_BEFORE_SCAFFOLD,
} from '../commands/init/output';
import { versionMajor } from '../commands/init/prisma7-detect';
import { type ProbeOutcome, probeServerVersion } from '../commands/init/probe-db';
import {
  KNOWN_TARGET_PACKAGES,
  reportedTargetName,
  TARGET_FLAG_PLACEHOLDER,
  TARGET_SHORT_NAMES,
} from '../commands/init/target-packages';
import { chooseAction } from '../utils/next-actions';
import { defineOrmCommand } from './define-command';
import { buildInitNextActions, initPresentations } from './init-blocks';
import { EMIT_COMMAND, emitFailedFinding, installFailedFinding } from './init-diagnostics';
import { emitScaffoldedContract } from './init-emit';
import {
  InitInstallFailedBeforeWriting,
  type ResolvedInitInputs,
  resolveInitInputs,
} from './init-inputs';
import {
  ENGINE_PACKAGE,
  engineDevDependencySpec,
  installProjectDependencies,
} from './init-packages';
import { createPrisma7SourceCheck } from './init-prisma7-check';
import { requiredPeerSpecifier, requiredPeersForSetup } from './init-required-peers';
import { resolveScaffoldPackageManager, scaffoldProject } from './init-scaffold';
import { createTargetPackagePreparation } from './init-target-package';
import { normalizeError } from './normalize-error';
import { type ImportFromProject, importFromProject } from './project-modules';
import {
  type LookUpRegistryKeywords,
  type LookUpRegistryPeers,
  lookUpRegistryKeywords,
  lookUpRegistryPeers,
} from './registry-keywords';

/** Each of these is a finding on a completed run, not an error. */
const INIT_EXIT_CODES = {
  4: 'dependency install failed',
  5: 'scaffold written and installed; contract emit failed',
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
    case 'invalid-result':
    case 'connection-failed':
    case 'timed-out':
    case 'driver-missing':
    case 'driver-failed':
    case 'version-unreadable':
    case 'unsupported':
      return strictProbe
        ? { warning: undefined, fatal: outcome.message }
        : { warning: outcome.message, fatal: undefined };
  }
}

const [FIRST_TARGET, SECOND_TARGET] = KNOWN_TARGET_PACKAGES;
const PRISMA6_ONLY_LABELS = KNOWN_TARGET_PACKAGES.filter(
  (entry) => entry.provider.writtenBy === 6,
).map((entry) => entry.label);

function causeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface InitCommandDependencies {
  readonly emitScaffoldedContract: typeof emitScaffoldedContract;
  readonly importFromProject: ImportFromProject;
  readonly lookUpRegistryKeywords: LookUpRegistryKeywords;
  readonly lookUpRegistryPeers: LookUpRegistryPeers;
}

export const createInitCommand = (injected: InitCommandDependencies) =>
  defineOrmCommand({
    help: {
      summary: 'Initialize a new Prisma ORM project',
      description:
        'Scaffolds config, schema, and runtime files, installs dependencies,\n' +
        'and emits the contract. Gets you from zero to typed queries in one step.\n' +
        '\n' +
        'Run it interactively for a guided setup, or supply --target and --authoring\n' +
        'for a fully scriptable run (CI, AI coding agents, automation).\n' +
        '\n' +
        'In a Prisma 7 project, pass --from-prisma7-schema (or answer yes when asked)\n' +
        'to use the existing schema.prisma as the contract source.\n' +
        '\n' +
        `In a Prisma 6 ${PRISMA6_ONLY_LABELS.join(' or ')} project, init changes nothing: it prints how to install\n` +
        'Prisma 8 beside Prisma 6 and read schema.prisma through prisma6Schema in\n' +
        'prisma.config.ts, keeping the Prisma 6 CLI as an alias with its own config.\n' +
        'Passing --target and --authoring sets up a starter in the same project instead,\n' +
        'which breaks the Prisma 6 CLI.',
      examples: [
        'orm init',
        `orm init --target ${FIRST_TARGET.shortName} --authoring psl`,
        `orm init --target ${SECOND_TARGET.shortName} --authoring typescript --json`,
        'orm init --skip-install',
        `orm init --target ${FIRST_TARGET.shortName} --keep-previous-facade`,
        'orm init --from-prisma7-schema prisma/schema.prisma --confirm my-app',
      ],
    },
    args: {
      flags: {
        // Not flag.enum: the aliases and capitalizations init has always
        // accepted are matched in the handler, where a rejection can name
        // every allowed value.
        target: flag.string({
          brief: `Database target: ${TARGET_SHORT_NAMES.join(' or ')}, or the name of a target package`,
          placeholder: TARGET_FLAG_PLACEHOLDER,
        }),
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
        skipInstall: flag.boolean({
          brief:
            'Skip dependency installation and contract emission; the target package must already be installed',
        }),
        keepPreviousFacade: flag.boolean({
          brief: 'Keep the previous target package in package.json when switching targets',
        }),
        fromPrisma7Schema: flag.string({
          brief: 'Use an existing Prisma 7 schema.prisma as the contract source',
          placeholder: 'path',
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

      const packageManager = await resolveScaffoldPackageManager({ cwd: ctx.cwd, env: ctx.env });
      let inputs: ResolvedInitInputs;
      try {
        inputs = await resolveInitInputs({
          cwd: ctx.cwd,
          flags: args.flags,
          prompt: ctx.prompt,
          prepareTargetPackage: createTargetPackagePreparation({
            cwd: ctx.cwd,
            env: ctx.env,
            packages: ctx.packages,
            packageManager,
            install: !args.flags.skipInstall,
            importFromProject: injected.importFromProject,
            lookUpRegistryKeywords: injected.lookUpRegistryKeywords,
            signal: ctx.signal,
          }),
          checkPrisma7Source: createPrisma7SourceCheck({
            cwd: ctx.cwd,
            importFromProject: injected.importFromProject,
          }),
          warn,
          packageManager,
          requiredPeersFor: requiredPeersForSetup({
            cwd: ctx.cwd,
            installedElsewhere: new Set([ENGINE_PACKAGE]),
            signal: ctx.signal,
            readPublished: (name, spec, signal) =>
              injected.lookUpRegistryPeers(name, spec, { env: ctx.env, signal }),
          }),
        });
      } catch (error) {
        if (!(error instanceof InitInstallFailedBeforeWriting)) {
          throw error;
        }
        const document: InitOutput = {
          ok: true,
          target: reportedTargetName(error.target),
          package: error.target.packageName,
          authoring: error.authoring,
          schemaPath: error.schemaPath,
          filesWritten: [],
          filesDeleted: [],
          filesRenamed: [],
          packagesInstalled: { status: 'failed', deps: [], devDeps: [], requiredPeers: [] },
          contractEmitted: false,
          prisma7:
            error.authoring === 'prisma7'
              ? {
                  schemaPath: error.schemaPath,
                  configRenamedTo: null,
                  scriptsRewritten: [],
                  packagesMoved: [],
                }
              : null,
          nextSteps: [...NEXT_STEPS_BEFORE_SCAFFOLD],
          warnings,
        };
        return ok(
          ctx.present(
            {
              data: document,
              exitCode: 4,
              diagnostics: [installFailedFinding(error.failure, [])],
            },
            initPresentations({ document, complete: false, nextActions: [] }),
          ),
        );
      }
      for (const warning of inputs.warnings) {
        warn(warning);
      }

      const scaffold = scaffoldProject({ cwd: ctx.cwd, inputs, packageManager });
      for (const warning of scaffold.warnings) {
        warn(warning);
      }
      for (const note of scaffold.notes) {
        ctx.report({ kind: 'message', severity: 'info', text: note });
      }

      // Prisma 7 requires CLI and client at the same version, so when the CLI
      // moves aside as @prisma/prisma7 a client below the 7 line moves with it.
      const movePackages = inputs.sideBySide?.movePackages ?? null;
      const clientMajor =
        movePackages?.clientVersion === undefined
          ? undefined
          : versionMajor(movePackages.clientVersion);
      // A client the project never declared, or one it links through a
      // workspace or catalog, is left alone: only a declared major below 7 moves.
      const moveClient = movePackages !== null && clientMajor !== undefined && clientMajor < 7;
      const peers = inputs.requiredPeers.packages.filter(
        (peer) => peer.outcome !== 'left-at-another-version',
      );
      const ormPeers = peers.filter((peer) => peer.name.startsWith('@prisma/orm-'));
      const otherPeers = peers.filter((peer) => !peer.name.startsWith('@prisma/orm-'));
      const drivers = inputs.contribution.peerPackages.filter(
        (name) => !inputs.requiredPeers.packages.some((peer) => peer.name === name),
      );
      const deps = [
        inputs.requiredPeers.target,
        ...ormPeers.map(requiredPeerSpecifier),
        'dotenv',
        ...drivers,
        ...otherPeers.map((peer) =>
          peer.outcome === 'already-listed' ? peer.name : requiredPeerSpecifier(peer),
        ),
        ...(moveClient ? ['@prisma/client@7'] : []),
      ];
      const depsToInstall = deps.filter((dep) => !inputs.preinstalled.includes(dep));
      // The CLI the scaffolded scripts run is `prisma`, the unified CLI's
      // published name, whose v8 line publishes under the `latest` dist-tag (the
      // standalone shim is no longer published). It is the package that
      // carries the `prisma` binary, which is what the scaffolded scripts
      // invoke. `@prisma/cli-engine` — the config file's
      // definePrismaConfig import — is deliberately absent here: the CLI declares it
      // as an exact peer, so it installs in a second step at the version the
      // just-installed CLI names. Under moduleResolution 'bundler' the
      // scaffolded files reference process.env, which only typechecks with
      // Node's ambient types present; a project that already pins @types/node
      // keeps its own major.
      const cliDevDeps = ['prisma@latest'];
      const devDeps: string[] = [
        ...(scaffold.hasTypesNode ? cliDevDeps : [...cliDevDeps, '@types/node']),
        ...(movePackages !== null ? ['@prisma/prisma7@7'] : []),
      ];

      const packagesMoved = [
        ...(moveClient ? ['@prisma/client@7'] : []),
        ...(movePackages !== null ? ['@prisma/prisma7@7'] : []),
      ];
      const adoptsPrisma7 = inputs.contractSource.kind === 'prisma7-schema';
      const prisma7Steps = adoptsPrisma7 ? { packagesMoved, clientMoved: moveClient } : null;

      const findings: Diagnostic[] = [];
      const extraActions: NextAction[] = [];
      let packagesInstalled: InstallStatus = 'skipped';
      let contractEmitted = false;

      const settle = (exitCode: 0 | 4 | 5) => {
        const installed = packagesInstalled === 'installed';
        const document: InitOutput = {
          ok: true,
          target: reportedTargetName(inputs.target),
          package: inputs.target.packageName,
          authoring: adoptsPrisma7 ? 'prisma7' : inputs.authoring,
          schemaPath: inputs.schemaPath,
          filesWritten: scaffold.filesWritten,
          filesDeleted: scaffold.filesDeleted,
          filesRenamed: scaffold.filesRenamed,
          packagesInstalled: {
            status: packagesInstalled,
            deps: installed ? deps : [...inputs.preinstalled],
            devDeps: installed ? devDeps : [],
            requiredPeers: [...inputs.requiredPeers.packages],
          },
          contractEmitted,
          prisma7: adoptsPrisma7
            ? {
                schemaPath: inputs.schemaPath,
                configRenamedTo: scaffold.filesRenamed[0]?.to ?? null,
                scriptsRewritten: [...scaffold.scriptsRewritten],
                packagesMoved,
              }
            : null,
          nextSteps: buildNextSteps({
            target: reportedTargetName(inputs.target),
            packagesInstalled,
            contractEmitted,
            emitCommand: EMIT_COMMAND,
            schemaPath: inputs.schemaPath,
            prisma7: prisma7Steps,
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
                  chooseAction('This is a bug in Prisma ORM. Please report it with `-v` output.'),
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
                  prisma7: prisma7Steps,
                }),
              ],
            }),
          ),
        );
      };

      if (inputs.install) {
        const installFailure = await installProjectDependencies({
          packages: ctx.packages,
          cwd: ctx.cwd,
          deps: depsToInstall,
          devDeps,
        });
        if (installFailure !== undefined) {
          packagesInstalled = 'failed';
          findings.push(installFailedFinding(installFailure, scaffold.filesWritten));
          return settle(4);
        }
        if (packageManager === 'pnpm') {
          for (const warning of buildCatalogWarnings(ctx.cwd, [...depsToInstall, ...devDeps])) {
            warn(warning);
          }
        }
        const engineSpec = engineDevDependencySpec(ctx.cwd);
        const engineInstall = await ctx.packages.install({
          packages: [engineSpec],
          dev: true,
          cwd: ctx.cwd,
        });
        if (!engineInstall.ok) {
          packagesInstalled = 'failed';
          findings.push(installFailedFinding(engineInstall.failure, scaffold.filesWritten));
          return settle(4);
        }
        devDeps.push(engineSpec);
        packagesInstalled = 'installed';

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
            `Install the project dependencies with your package manager: ${deps.map(quoteSpec).join(', ')} (and ${devDeps.map(quoteSpec).join(', ')} plus @prisma/cli-engine at the version prisma declares as its dependency, as development dependencies)`,
          ),
        );
      }

      // Opt-in, and after the install so the target driver is resolvable from
      // the project's own node_modules.
      if (inputs.probeDb) {
        const outcome = await probeServerVersion({
          databaseUrl: ctx.env['DATABASE_URL'],
          packageName: inputs.target.packageName,
          contribution: inputs.contribution,
        });
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

      return settle(0);
    },
  });

export const initCommand = createInitCommand({
  emitScaffoldedContract,
  importFromProject,
  lookUpRegistryKeywords,
  lookUpRegistryPeers,
});
