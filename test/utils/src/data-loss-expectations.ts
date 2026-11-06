import { expect } from 'vitest';

/** A subject as a planner's `dataLoss` names it: a model, a field or a storage name. */
interface LossSubject {
  readonly kind: string;
  readonly namespaceId?: string;
  readonly model?: string;
  readonly field?: string;
  readonly name?: string;
}

function keyOf(subject: LossSubject): string {
  return JSON.stringify([
    subject.kind,
    subject.namespaceId,
    subject.model,
    subject.field,
    subject.name,
  ]);
}

/**
 * Asserts a planner's `dataLoss` against its own classification: an entry points only at a
 * `destructive` operation, and every `destructive` operation has an entry. The one exception is an
 * operation whose loss an earlier entry already names, as a SQLite recreate names a column that a
 * later drop removes again; `subjectOf` says what such an operation loses, and the operation
 * passes only when an earlier entry has that subject.
 */
export function expectDataLossMatchesDestructive<
  TOperation extends { readonly operationClass: string },
>(
  result: {
    readonly dataLoss: readonly {
      readonly operationIndex: number;
      readonly subject: LossSubject;
    }[];
  },
  operations: readonly TOperation[],
  options: { readonly subjectOf?: (operation: TOperation) => LossSubject | undefined } = {},
): void {
  const named = new Set(result.dataLoss.map(({ operationIndex }) => operationIndex));
  const classesNamed = [...named].map((index) => operations[index]?.operationClass);
  expect(classesNamed.every((operationClass) => operationClass === 'destructive')).toBe(true);
  const namedBefore = (index: number, subject: LossSubject) =>
    result.dataLoss.some(
      (entry) => entry.operationIndex < index && keyOf(entry.subject) === keyOf(subject),
    );
  const unnamedDestructive = operations.flatMap((operation, index) => {
    if (operation.operationClass !== 'destructive' || named.has(index)) return [];
    const subject = options.subjectOf?.(operation);
    return subject !== undefined && namedBefore(index, subject) ? [] : [index];
  });
  expect(unnamedDestructive).toEqual([]);
}
