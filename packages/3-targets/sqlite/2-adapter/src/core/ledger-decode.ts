const DESIGNATOR_LESS_UTC_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;

export function coerceLedgerAppliedAt(value: Date | string): Date {
  if (value instanceof Date) {
    return value;
  }
  if (DESIGNATOR_LESS_UTC_DATETIME.test(value)) {
    return new Date(`${value.replace(' ', 'T')}Z`);
  }
  return new Date(value);
}

export function operationCountFromStored(operations: unknown): number {
  if (Array.isArray(operations)) {
    return operations.length;
  }
  if (typeof operations === 'string') {
    try {
      const parsed: unknown = JSON.parse(operations);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }
  return 0;
}
