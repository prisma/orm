import { describe, expect, it, vi } from 'vitest';
import { validateContractOnce } from '../src/validate-once';

function hydrate(input: unknown): { readonly hydratedFrom: unknown } {
  return { hydratedFrom: input };
}

describe('validateContractOnce', () => {
  it('validates an input the first time and returns the cached result after', () => {
    const validate = vi.fn(hydrate);
    const input = { target: 'a' };

    const first = validateContractOnce(input, 'target-a', validate);
    const second = validateContractOnce(input, 'target-a', validate);

    expect(validate).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('returns a validated result as it is', () => {
    const validate = vi.fn(hydrate);
    const validated = validateContractOnce({ target: 'a' }, 'target-a', validate);

    expect(validateContractOnce(validated, 'target-a', validate)).toBe(validated);
    expect(validate).toHaveBeenCalledTimes(1);
  });

  it('validates again for a different validator', () => {
    const validate = vi.fn(hydrate);
    const input = { target: 'a' };

    const forA = validateContractOnce(input, 'target-a', validate);
    const forB = validateContractOnce(input, 'target-b', validate);

    expect(validate).toHaveBeenCalledTimes(2);
    expect(forB).not.toBe(forA);
  });

  it('keeps the records of two versions of one validator apart', () => {
    const validate = vi.fn(hydrate);
    const validated = validateContractOnce({ target: 'a' }, 'target-a@1.0.0', validate);

    expect(validateContractOnce(validated, 'target-a@2.0.0', validate)).not.toBe(validated);
    expect(validate).toHaveBeenCalledTimes(2);
  });

  it('returns a frozen contract and leaves the input as it was', () => {
    const input = { target: 'a' };
    const validated = validateContractOnce(input, 'target-a', hydrate);

    expect({ validated: Object.isFrozen(validated), input: Object.isFrozen(input) }).toEqual({
      validated: true,
      input: false,
    });
  });

  it('records nothing when validation throws', () => {
    const input = { target: 'a' };
    const failing = () => {
      throw new Error('invalid contract');
    };

    expect(() => validateContractOnce(input, 'target-a', failing)).toThrow('invalid contract');

    const validate = vi.fn(hydrate);
    validateContractOnce(input, 'target-a', validate);
    expect(validate).toHaveBeenCalledTimes(1);
  });

  it('validates a value that is not an object every time', () => {
    const validate = vi.fn(hydrate);

    validateContractOnce('not a contract', 'target-a', validate);
    validateContractOnce('not a contract', 'target-a', validate);

    expect(validate).toHaveBeenCalledTimes(2);
  });

  it('shares what was validated between separate copies of the module', async () => {
    vi.resetModules();
    const firstCopy = await import('../src/validate-once');
    vi.resetModules();
    const secondCopy = await import('../src/validate-once');
    expect(secondCopy.validateContractOnce).not.toBe(firstCopy.validateContractOnce);

    const validate = vi.fn(hydrate);
    const validated = firstCopy.validateContractOnce({ target: 'a' }, 'target-a', validate);

    expect(secondCopy.validateContractOnce(validated, 'target-a', validate)).toBe(validated);
    expect(validate).toHaveBeenCalledTimes(1);
  });
});
