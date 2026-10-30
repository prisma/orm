import type { ControlPolicy } from '@internal/contract/types';
import { freezeNode } from '@internal/framework-components/ir';
import { SqlNode } from '@internal/sql-contract/types';

export interface PostgresExtensionInput {
  readonly name: string;
  readonly control?: ControlPolicy;
}

/**
 * A Postgres extension the database must have installed (`CREATE EXTENSION … WITH SCHEMA …`), filed under `entries.extension` of the namespace whose schema holds the extension's objects.
 */
export class PostgresExtension extends SqlNode {
  static is(node: unknown): node is PostgresExtension {
    return typeof node === 'object' && node !== null && 'kind' in node && node.kind === 'extension';
  }

  override readonly kind = 'extension' as const;
  readonly name: string;
  declare readonly control?: ControlPolicy;

  constructor(input: PostgresExtensionInput) {
    super();
    this.name = input.name;
    if (input.control !== undefined) this.control = input.control;
    freezeNode(this);
  }
}
