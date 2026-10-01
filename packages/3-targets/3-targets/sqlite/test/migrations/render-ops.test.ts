import type { OpFactoryCall } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { renderOps } from '../../src/core/migrations/render-ops';

describe('renderOps with a call that produces several ops', () => {
  function op(id: string) {
    return {
      id,
      label: `${id} op`,
      operationClass: 'widening',
      target: { id: 'sqlite' },
      precheck: [],
      execute: [],
      postcheck: [],
    };
  }

  it('renders every op toOps returns, in order, and passes the lowerer through', async () => {
    const lowerer = {
      lower: () => {
        throw new Error('unused');
      },
    };
    const received: unknown[] = [];
    const call = {
      factoryName: 'renameTable',
      operationClass: 'widening',
      label: 'rename',
      renderTypeScript: () => '',
      importRequirements: () => [],
      toOp: () => op('unused'),
      toOps: (passed: unknown) => {
        received.push(passed);
        return [op('renameTable.a'), Promise.resolve(op('renameConstraint.a_pkey'))];
      },
    } as unknown as OpFactoryCall;

    const result = await Promise.all(renderOps([call], lowerer as never));

    expect(result.map((rendered) => rendered.id)).toEqual([
      'renameTable.a',
      'renameConstraint.a_pkey',
    ]);
    expect(received).toEqual([lowerer]);
  });

  it('checks the target of every op toOps returns', () => {
    const call = {
      factoryName: 'renameTable',
      toOp: () => op('unused'),
      toOps: () => [
        op('renameTable.a'),
        { ...op('renameConstraint.a_pkey'), target: { id: 'other' } },
      ],
    } as unknown as OpFactoryCall;

    expect(() => renderOps([call])).toThrow(/target\.id="other"/);
  });
});
