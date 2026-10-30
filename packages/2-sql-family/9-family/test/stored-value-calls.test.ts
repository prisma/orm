import { asNamespaceId } from '@internal/contract/types';
import type { OpFactoryCall } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import type {
  StoredValueReplacement,
  StoredValueRewrite,
} from '../src/core/migrations/enum-value-planning';
import {
  keepRowsEdit,
  type StoredValueCallClasses,
  storedValueOperationIndexes,
  storedValueSubjects,
} from '../src/core/migrations/stored-value-calls';

class FakeCall implements OpFactoryCall {
  readonly factoryName: string;
  readonly operationClass = 'widening' as const;
  readonly label: string;
  constructor(
    readonly text: string,
    readonly companions: readonly OpFactoryCall[] = [],
  ) {
    this.factoryName = text;
    this.label = text;
  }
  renderTypeScript(): string {
    return this.text;
  }
  importRequirements() {
    return [];
  }
  toOp(): never {
    throw new Error('not lowered');
  }
}

class FakeRemoval extends FakeCall {
  constructor(
    readonly column: string,
    readonly value: string | number,
  ) {
    super(`remove(${column}, ${value})`);
  }
}

const classes: StoredValueCallClasses<FakeRemoval> = {
  isRemoval: (call): call is FakeRemoval => call instanceof FakeRemoval,
  replacementOf: (removal, { from, to }: StoredValueReplacement) =>
    new FakeCall(`replace(${removal.column}, ${from}, ${to})`),
};

const app = asNamespaceId('app');
const enumValue = { namespaceId: app, enum: 'Status', member: 'ARCHIVED' };
const statement = {
  kind: 'rename',
  entity: 'enumValue',
  from: enumValue,
  to: { ...enumValue, member: 'RETIRED' },
} as const;

function rewrite(overrides: Partial<StoredValueRewrite>): StoredValueRewrite {
  return {
    enumValue,
    namespaceId: 'app',
    table: 'task',
    column: 'status',
    codecRef: { codecId: 'pg/text@1' },
    many: false,
    from: 'archived',
    to: undefined,
    statement: undefined,
    keepData: undefined,
    swapsValues: false,
    ...overrides,
  };
}

describe('storedValueSubjects', () => {
  it('names the enum value of each removal, with the edit that keeps its data, and leaves out replacements', () => {
    const removal = new FakeRemoval('status', 'archived');
    const swapped = new FakeRemoval('rank', 1);
    const replacement = new FakeCall('replace');
    const subjects = storedValueSubjects(
      new Map<OpFactoryCall, StoredValueRewrite>([
        [removal, rewrite({ keepData: [{ from: 'archived', to: 'retired' }] })],
        [swapped, rewrite({ keepData: [{ from: 1, to: 9 }], swapsValues: true })],
        [replacement, rewrite({ to: 'retired', statement })],
      ]),
      classes,
    );

    expect([...subjects.entries()]).toEqual([
      [
        removal,
        {
          enumValue,
          keepDataEdit: {
            remove: 'remove(status, archived)',
            replaceWith: 'replace(status, archived, retired)',
          },
        },
      ],
      [
        swapped,
        {
          enumValue,
          keepDataEdit: {
            remove: 'remove(rank, 1)',
            replaceWith: 'replace(rank, 1, 9)',
            swapsValues: true,
          },
        },
      ],
    ]);
  });

  it('gives a removal that would merge data no edit', () => {
    const removal = new FakeRemoval('status', 'archived');
    expect(storedValueSubjects(new Map([[removal, rewrite({})]]), classes).get(removal)).toEqual({
      enumValue,
    });
  });
});

describe('keepRowsEdit', () => {
  it('replaces the removal with a replacement by a placeholder stored value', () => {
    expect(
      keepRowsEdit(
        new FakeRemoval('status', 'archived'),
        {
          enumValue: { enum: 'Status', member: 'ARCHIVED' },
          value: 'archived',
          table: 'task',
          column: 'status',
          storedValue: 'archived',
        },
        classes,
      ),
    ).toEqual({
      remove: 'remove(status, archived)',
      replaceWith: 'replace(status, archived, <stored value>)',
    });
  });
});

describe('storedValueOperationIndexes', () => {
  it('finds the operations of the calls that carry out the statement, counting companions', () => {
    const rename = new FakeCall('renameTable', [new FakeCall('companion')]);
    const first = new FakeCall('replace first');
    const other = new FakeCall('other');
    const second = new FakeCall('replace second');
    const calls = new Map<OpFactoryCall, StoredValueRewrite>([
      [first, rewrite({ to: 'retired', statement })],
      [second, rewrite({ to: 'retired', statement })],
    ]);

    expect(storedValueOperationIndexes([rename, first, other, second], calls, statement)).toEqual([
      2, 4,
    ]);
    expect(
      storedValueOperationIndexes([rename, first], calls, { ...statement, to: enumValue }),
    ).toEqual([]);
  });
});
