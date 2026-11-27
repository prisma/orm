import type { ContractEntryInput, ContractEntryNode } from '@internal/cli/init-contribution';
import { POSTGRES_NEWEST_VERSION } from '@internal/target-postgres/server-version-range';
import { type ImportRequirement, jsonToTsSource, TsExpression } from '@internal/ts-render';
import { moduleBase } from '../config/module-base';

export const configModule = `${moduleBase}/config`;

/** The lists a new project's contract spreads into `requiredCapabilities`: the newest PostgreSQL version's and the driver's. */
export const requiredCapabilityLists = [
  `postgres${POSTGRES_NEWEST_VERSION}`,
  'postgresDriver',
] as const;

export function requiredCapabilitiesSource(): string {
  return `[${requiredCapabilityLists.map((list) => `...${list}`).join(', ')}]`;
}

async function requiredCapabilitiesValue() {
  const lists = await import('../contract/contract-capabilities');
  return requiredCapabilityLists.flatMap((list) => lists[list]);
}

function capabilityListImports(): readonly ImportRequirement[] {
  return requiredCapabilityLists.map((symbol) => ({ moduleSpecifier: configModule, symbol }));
}

/** A TypeScript contract's entry: its path, since the contract lists its required capabilities in `defineContract`. */
class TypeScriptContractEntry extends TsExpression implements ContractEntryNode {
  constructor(private readonly path: string) {
    super();
  }

  renderTypeScript(): string {
    return jsonToTsSource(this.path);
  }

  importRequirements(): readonly ImportRequirement[] {
    return [];
  }

  async contractValue(): Promise<string> {
    return this.path;
  }
}

/** A Prisma schema's entry: its path and the capabilities it requires of the newest PostgreSQL version and the driver. */
class PrismaSchemaContractEntry extends TsExpression implements ContractEntryNode {
  constructor(private readonly path: string) {
    super();
  }

  renderTypeScript(): string {
    return `{ path: ${jsonToTsSource(this.path)}, requiredCapabilities: ${requiredCapabilitiesSource()} }`;
  }

  importRequirements(): readonly ImportRequirement[] {
    return capabilityListImports();
  }

  async contractValue(): Promise<unknown> {
    return { path: this.path, requiredCapabilities: await requiredCapabilitiesValue() };
  }
}

/** A Prisma 7 schema's entry: `prisma7Schema` with the path and the capabilities it requires of the newest PostgreSQL version and the driver. */
class Prisma7SchemaContractEntry extends TsExpression implements ContractEntryNode {
  constructor(private readonly path: string) {
    super();
  }

  renderTypeScript(): string {
    return `prisma7Schema(${jsonToTsSource(this.path)}, { requiredCapabilities: ${requiredCapabilitiesSource()} })`;
  }

  importRequirements(): readonly ImportRequirement[] {
    return [{ moduleSpecifier: configModule, symbol: 'prisma7Schema' }, ...capabilityListImports()];
  }

  async contractValue(): Promise<unknown> {
    const [{ prisma7Schema }, requiredCapabilities] = await Promise.all([
      import('../config/prisma7-schema'),
      requiredCapabilitiesValue(),
    ]);
    return prisma7Schema(this.path, { requiredCapabilities });
  }
}

/** The config's `contract:` entry for `input`. */
export function contractEntry(input: ContractEntryInput): ContractEntryNode {
  if (input.kind === 'prisma7-schema') {
    return new Prisma7SchemaContractEntry(input.path);
  }
  return input.mode === 'typescript'
    ? new TypeScriptContractEntry(input.path)
    : new PrismaSchemaContractEntry(input.path);
}
