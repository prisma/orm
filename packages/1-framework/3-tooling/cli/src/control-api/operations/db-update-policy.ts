/** The operation classes `db update` applies. */
export const DB_UPDATE_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
} as const;
