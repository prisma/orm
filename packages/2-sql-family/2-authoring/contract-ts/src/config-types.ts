import { pathToFileURL } from 'node:url';
import type { ContractConfig, ContractSourceProvider } from '@internal/config/config-types';
import type { Contract, ControlPolicy } from '@internal/contract/types';
import { createDataTypeLookup, emptyCodecLookup } from '@internal/framework-components/codec';
import type { TargetPackRef } from '@internal/framework-components/components';
import type { SqlNamespaceBase, SqlNamespaceInput } from '@internal/sql-contract/types';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { ok } from '@internal/utils/result';
import { extname } from 'pathe';
import { buildSqlContractFromDefinition } from './build-contract';
import { contractError } from './contract-errors';
import { applySqlSpecifierControlPolicy, type SqlNamespaceFactory } from './derived-checks';

/**
 * Derives the emit output path from the TS contract input so artefacts land
 * colocated with the source (e.g. `prisma/contract.ts` →
 * `prisma/contract.json`). Mirrors the same default-derivation logic in
 * `@internal/sql-contract-psl/provider`.
 */
function defaultOutputFromContractPath(contractPath: string): string {
  const ext = extname(contractPath);
  if (ext.length === 0) return `${contractPath}.json`;
  return `${contractPath.slice(0, -ext.length)}.json`;
}

/**
 * Stamping a default control policy carries a consequence — derived checks are
 * stripped from tables the policy leaves non-managed — and the strip rebuilds
 * namespaces through the target's factory, so the two travel together.
 */
export interface TypeScriptContractSpecifierOptions {
  readonly defaultControlPolicy: ControlPolicy;
  readonly createNamespace: SqlNamespaceFactory;
}

/** The target a config is for, and the module that target's `defineContract` comes from. */
export interface ConfigTarget {
  readonly target: TargetPackRef<'sql', string>;
  readonly contractBuilderModule: string;
}

export type TypeScriptContractFromPathOptions =
  | (ConfigTarget & {
      readonly defaultControlPolicy?: never;
      readonly createNamespace?: never;
    })
  | (ConfigTarget & TypeScriptContractSpecifierOptions);

type ContractOrigin = Pick<ContractSourceProvider, 'format' | 'inputs'>;

function describeContract({ format, inputs }: ContractOrigin): string {
  const kind = format === 'typescript' ? 'The TypeScript contract' : 'The contract';
  const path = inputs?.[0];
  return path === undefined ? `${kind} passed to defineConfig` : `${kind} "${path}"`;
}

function otherTargetGuidance(
  { format, inputs }: ContractOrigin,
  expected: ConfigTarget,
): { readonly why: string; readonly fix: string } {
  const configured = expected.target.targetId;
  if (format === 'psl') {
    return {
      why: "Its contract config was made with another target's components, so the contract carries that target's id and capabilities.",
      fix: `Make the contract config with ${configured}'s components, or pass the schema's path as \`contract\`.`,
    };
  }
  if (inputs?.[0] === undefined) {
    return {
      why: "The contract carries another target's id and capabilities, so it was built or emitted for that target.",
      fix: `Pass a contract built for ${configured}, such as one made with the defineContract from ${expected.contractBuilderModule}.`,
    };
  }
  return {
    why: "Its defineContract came from another target's contract-builder entry, so the contract carries that target's id and capabilities.",
    fix: `Import defineContract from ${expected.contractBuilderModule}.`,
  };
}

function refuseOtherTarget(origin: ContractOrigin, loaded: object, expected: ConfigTarget): void {
  const actual: unknown = Object(loaded).target;
  const configured = expected.target.targetId;
  if (typeof actual !== 'string' || actual === configured) return;
  throw contractError(
    'CONTRACT.TARGET_MISMATCH',
    `${describeContract(origin)} was built for target "${actual}", but this defineConfig is for target "${configured}".`,
    {
      ...otherTargetGuidance(origin, expected),
      meta: { ...ifDefined('contract', origin.inputs?.[0]), expected: configured, actual },
    },
  );
}

/** A ready contract config whose loaded contract is refused when it was built for another target than the config's. Any other result passes through unchanged. */
export function refuseOtherTargetOnLoad(
  config: ContractConfig,
  expected: ConfigTarget,
): ContractConfig {
  const { source } = config;
  return {
    ...config,
    source: {
      ...source,
      load: async (context) => {
        const result = await source.load(context);
        const loaded: unknown =
          isRecord(result) && result.ok === true ? Object(result).value : undefined;
        if (isRecord(loaded)) refuseOtherTarget(source, loaded, expected);
        return result;
      },
    },
  };
}

function isRecord(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOtherFamilyContract(value: unknown): value is object {
  if (!isRecord(value)) return false;
  const { targetFamily, target } = Object(value);
  return typeof targetFamily === 'string' && targetFamily !== 'sql' && typeof target === 'string';
}

function isSqlContract(value: unknown): value is Contract {
  if (!isRecord(value)) return false;
  const { targetFamily, storage } = Object(value);
  return targetFamily === 'sql' && isRecord(storage) && isRecord(Object(storage).namespaces);
}

export function emptyContract(options: {
  readonly output?: string;
  readonly target: TargetPackRef<'sql', string>;
  readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
  readonly defaultControlPolicy?: ControlPolicy;
}): ContractConfig {
  return {
    source: {
      format: 'typescript',
      load: async () => {
        const built = buildSqlContractFromDefinition(
          {
            warnings: undefined,
            target: options.target,
            createNamespace: options.createNamespace,
            models: [],
          },
          { ...emptyCodecLookup, descriptorFor: () => undefined },
          createDataTypeLookup([]),
        );
        return ok(
          applySqlSpecifierControlPolicy(
            built,
            options.defaultControlPolicy,
            options.createNamespace,
          ),
        );
      },
    },
    ...ifDefined('output', options.output),
  };
}

export function typescriptContract(
  contract: Contract,
  output?: string,
  options?: TypeScriptContractSpecifierOptions,
): ContractConfig {
  return {
    source: {
      format: 'typescript',
      load: async () =>
        ok(
          options === undefined
            ? contract
            : applySqlSpecifierControlPolicy(
                contract,
                options.defaultControlPolicy,
                options.createNamespace,
              ),
        ),
    },
    // The in-memory variant has no input path to anchor on; fall through to
    // the global default in `normalizeContractConfig` when caller doesn't pin it.
    ...ifDefined('output', output),
  };
}

/** A contract loaded from the TypeScript module at `contractPath`, refused when it was built for another target than the config's. */
export function typescriptContractFromPath(
  contractPath: string,
  output: string | undefined,
  options: TypeScriptContractFromPathOptions,
): ContractConfig {
  const policy = options.defaultControlPolicy === undefined ? undefined : options;
  return {
    source: {
      format: 'typescript',
      inputs: [contractPath],
      load: async (context) => {
        const [absolutePath] = context.resolvedInputs;
        if (absolutePath === undefined) {
          throw new InternalError(
            'typescriptContractFromPath: context.resolvedInputs is empty. The CLI config loader should populate it from source.inputs.',
          );
        }
        const mod = await import(pathToFileURL(absolutePath).href);
        if (mod.default === undefined && mod.contract === undefined) {
          throw contractError(
            'CONTRACT.MODULE_EXPORT_MISSING',
            `typescriptContractFromPath: module at "${absolutePath}" has no "default" or "contract" export.`,
            { meta: { path: absolutePath } },
          );
        }
        const exported: unknown = mod.default ?? mod.contract;
        const origin = { format: 'typescript', inputs: [contractPath] } as const;
        if (isOtherFamilyContract(exported)) refuseOtherTarget(origin, exported, options);
        if (!isSqlContract(exported)) {
          throw contractError(
            'CONTRACT.EXPORT_INVALID',
            `The TypeScript contract "${contractPath}" exports a value that is not a SQL contract.`,
            {
              why: 'The value has no SQL target family or no storage namespaces, so it was not built with defineContract.',
              fix: "Export the result of the target package's defineContract as the module's default or contract export.",
              meta: { path: absolutePath, reason: 'not-a-contract' },
            },
          );
        }
        const contract = exported;
        refuseOtherTarget(origin, contract, options);
        return ok(
          policy === undefined
            ? contract
            : applySqlSpecifierControlPolicy(
                contract,
                policy.defaultControlPolicy,
                policy.createNamespace,
              ),
        );
      },
    },
    output: output ?? defaultOutputFromContractPath(contractPath),
  };
}
