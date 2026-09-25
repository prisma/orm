import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import type { ExtensionPackRef } from '@internal/framework-components/components';
import {
  type ControlExtensionDescriptor,
  type ControlStack,
  createControlStack,
  type PslSourceSettings,
} from '@internal/framework-components/control';
import { printPsl } from '@internal/psl-printer';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import { PG_INT_CODEC_ID, PG_TEXT_CODEC_ID } from '@internal/target-postgres/codec-ids';
import postgres from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { join } from 'pathe';
import postgresAdapter from '../../src/exports/control';

export type PostgresStack = ControlStack<'sql', 'postgres'>;

/** The stack `contract emit` composes for a Postgres config with these extensions. */
export function composePostgresStack(
  extensions: readonly ControlExtensionDescriptor<'sql', 'postgres'>[] = [],
): PostgresStack {
  return createControlStack({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [...extensions],
  });
}

/** A contract printed as PSL text, and the settings the config must set on the PSL source. */
export interface PrintedContract {
  readonly text: string;
  readonly sourceSettings: PslSourceSettings;
}

/**
 * Prints a contract as PSL text the way `contract print` does: through the SQL family instance
 * created from the stack, then the PSL printer with the stack's block descriptors and codecs.
 */
export function printContract(
  contract: Contract<SqlStorage>,
  stack: PostgresStack = composePostgresStack(),
): PrintedContract {
  const { document, sourceSettings } = sql.create(stack).printPslContract(contract);
  return {
    text: printPsl(document, {
      pslBlockDescriptors: stack.authoringContributions.pslBlockDescriptors,
      codecLookup: stack.codecLookup,
    }),
    sourceSettings,
  };
}

export interface ReadPslOptions {
  readonly stack?: PostgresStack;
  /** The extension packs the config gives the PSL source. */
  readonly packRefs?: readonly ExtensionPackRef<'sql', string>[];
  readonly sourceSettings?: PslSourceSettings;
}

/**
 * Reads PSL text through the Prisma 8 PSL contract source with the stack's context, the way
 * `contract emit` does, and throws with the source's diagnostics when it does not load.
 */
export async function readPsl(
  text: string,
  options: ReadPslOptions = {},
): Promise<Contract<SqlStorage>> {
  const stack = options.stack ?? composePostgresStack();
  const directory = mkdtempSync(join(tmpdir(), 'psl-print-'));
  try {
    const path = join(directory, 'contract.prisma');
    writeFileSync(path, text);
    const result = await prismaContract(path, {
      target: postgresPackRef,
      createNamespace: postgresCreateNamespace,
      enumInferenceCodecs: { text: PG_TEXT_CODEC_ID, int: PG_INT_CODEC_ID },
      ...ifDefined('composedExtensionPackRefs', options.packRefs),
      ...ifDefined('defaultControlPolicy', options.sourceSettings?.defaultControlPolicy),
    }).source.load({
      composedExtensions: stack.extensions.map((extension) => extension.id),
      composedExtensionContracts: stack.extensionContracts,
      authoringContributions: stack.authoringContributions,
      codecLookup: stack.codecLookup,
      dataTypeLookup: stack.dataTypeLookup,
      controlMutationDefaults: stack.controlMutationDefaults,
      resolvedInputs: [path],
      capabilities: stack.capabilities,
    });
    if (!result.ok) {
      throw new Error(
        `the PSL did not load: ${JSON.stringify(result.failure.diagnostics)}\n${text}`,
      );
    }
    return blindCast<Contract<SqlStorage>, 'the Postgres PSL source yields a SQL contract'>(
      result.value,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Prints a contract as `contract print` does and reads the text back with the settings the printer names. */
export function printAndReadBack(
  contract: Contract<SqlStorage>,
  options: Omit<ReadPslOptions, 'sourceSettings'> = {},
): Promise<Contract<SqlStorage>> {
  const { text, sourceSettings } = printContract(contract, options.stack);
  return readPsl(text, { ...options, sourceSettings });
}

/** The serialized contract without `capabilities`, which the composed stack reports rather than the source. */
export function serializedWithoutCapabilities(contract: Contract<SqlStorage>): unknown {
  const { capabilities: _, ...authored } = JSON.parse(
    JSON.stringify(new PostgresContractSerializer().serializeContract(contract)),
  );
  return authored;
}
