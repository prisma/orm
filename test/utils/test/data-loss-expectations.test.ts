import { describe, expect, it } from 'vitest';
import { expectDataLossMatchesDestructive } from '../src/data-loss-expectations';

const dropA = { label: 'Drop table A', operationClass: 'destructive' };
const dropB = { label: 'Drop table B', operationClass: 'destructive' };
const addIndex = { label: 'Create index', operationClass: 'additive' };
const tableA = { kind: 'model', namespaceId: 'app', model: 'A' };
const tableB = { kind: 'model', namespaceId: 'app', model: 'B' };

describe('expectDataLossMatchesDestructive', () => {
  it('passes when each destructive operation is named', () => {
    expectDataLossMatchesDestructive(
      {
        dataLoss: [
          { operationIndex: 0, subject: tableA },
          { operationIndex: 2, subject: tableB },
        ],
      },
      [dropA, addIndex, dropB],
    );
  });

  it('fails on a destructive operation no entry names, after one that is named', () => {
    expect(() =>
      expectDataLossMatchesDestructive({ dataLoss: [{ operationIndex: 0, subject: tableA }] }, [
        dropA,
        dropB,
      ]),
    ).toThrow();
  });

  it('fails on an entry at an operation that is not destructive', () => {
    expect(() =>
      expectDataLossMatchesDestructive({ dataLoss: [{ operationIndex: 0, subject: tableA }] }, [
        addIndex,
      ]),
    ).toThrow();
  });

  it('passes an unnamed destructive operation whose loss an earlier entry names', () => {
    expectDataLossMatchesDestructive(
      { dataLoss: [{ operationIndex: 0, subject: tableA }] },
      [
        { label: 'Recreate table A', operationClass: 'destructive' },
        { label: 'Drop table A again', operationClass: 'destructive' },
      ],
      { subjectOf: (operation) => (operation.label.endsWith('again') ? tableA : undefined) },
    );
  });

  it('fails an unnamed destructive operation whose loss no earlier entry names', () => {
    expect(() =>
      expectDataLossMatchesDestructive(
        { dataLoss: [{ operationIndex: 0, subject: tableA }] },
        [dropA, dropB],
        { subjectOf: () => tableB },
      ),
    ).toThrow();
  });
});
