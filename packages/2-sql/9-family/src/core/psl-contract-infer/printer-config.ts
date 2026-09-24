import type { ColumnDefault } from '@internal/contract/types';
import type { DefaultMappingOptions } from '../psl-ast/default-mapping';
import type { PslTypeMap } from '../psl-ast/type-map';

export interface EnumInfo {
  readonly typeNames: ReadonlySet<string>;
  readonly definitions: ReadonlyMap<string, readonly string[]>;
}

export interface PslPrinterOptions {
  readonly typeMap: PslTypeMap;
  readonly defaultMapping?: DefaultMappingOptions;
  readonly enumInfo?: EnumInfo;
  readonly parseRawDefault?: (rawDefault: string, nativeType?: string) => ColumnDefault | undefined;
}

export type RelationField = {
  readonly fieldName: string;
  readonly typeName: string;
  /**
   * Namespace qualifier for a cross-space relation (e.g. `"auth"` for a
   * relation into `supabase:auth.AuthUser`). Absent for a same-namespace
   * relation.
   */
  readonly typeNamespaceId?: string | undefined;
  /**
   * Contract-space qualifier for a relation into another stack extension
   * pack's contract space (e.g. `"supabase"`). Absent for a same-space
   * relation.
   */
  readonly typeContractSpaceId?: string | undefined;
  readonly referencedTableName?: string | undefined;
  readonly optional: boolean;
  readonly list: boolean;
  readonly relationName?: string | undefined;
  readonly fkName?: string | undefined;
  readonly fields?: readonly string[] | undefined;
  readonly references?: readonly string[] | undefined;
  readonly onDelete?: string | undefined;
  readonly onUpdate?: string | undefined;
  /** `false` when the FK's source columns have no live backing index; omitted (the default) otherwise. */
  readonly index?: boolean | undefined;
};
