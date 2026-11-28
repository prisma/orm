import type { ContractEntryInput, ContractEntryNode } from '@internal/cli/init-contribution';
import {
  Prisma7SchemaContractEntry,
  PrismaSchemaContractEntry,
  TypeScriptContractEntry,
} from '../config/contract-entry-nodes';

/** The config's `contract:` entry for `input`. */
export function contractEntry(input: ContractEntryInput): ContractEntryNode {
  if (input.kind === 'prisma7-schema') {
    return new Prisma7SchemaContractEntry(input.path);
  }
  return input.mode === 'typescript'
    ? new TypeScriptContractEntry(input.path)
    : new PrismaSchemaContractEntry(input.path);
}
