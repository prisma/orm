import type { ColumnDefault } from '@internal/contract/types';

export type PostgresColumnDefault =
  | ColumnDefault
  | { readonly kind: 'sequence'; readonly name: string };
