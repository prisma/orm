import type { FieldBuilder } from '@internal/mongo/contract-builder';

export function auditField(field: { readonly string: () => FieldBuilder }) {
  return field.string();
}
