import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';

export function columnDescriptor(
  codecId: string,
  typeParams?: Record<string, unknown>,
): ColumnTypeDescriptor {
  return {
    codecId,
    ...(typeParams ? { typeParams } : {}),
  };
}
