/**
 * Generic Result type for representing success or failure outcomes.
 *
 * This is the standard way to return "expected failures" as values rather than
 * throwing exceptions. See docs/Error Handling.md for the full taxonomy.
 *
 * Naming rationale:
 * - `Ok<T>` / `NotOk<F>` mirror the `ok: true/false` discriminator
 * - `NotOk` avoids collision with domain types like "Failure" or "Error"
 * - `failure` property distinguishes from JS Error semantics
 */

import { blindCast } from './casts';
import { InternalError } from './internal-error';

/**
 * Represents a successful result containing a value.
 */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
  assertOk(): T;
  assertNotOk(): never;
}

/**
 * Represents an unsuccessful result containing failure details.
 */
export interface NotOk<F> {
  readonly ok: false;
  readonly failure: F;
  assertOk(): never;
  assertNotOk(): F;
}

/**
 * A discriminated union representing either success (Ok) or failure (NotOk).
 *
 * @typeParam T - The success value type
 * @typeParam F - The failure details type
 */
export type Result<T, F> = Ok<T> | NotOk<F>;

/**
 * Result class that implements both Ok and NotOk variants.
 */
class ResultImpl<T, F> {
  readonly ok: boolean;
  private readonly _value?: T;
  private readonly _failure?: F;

  private constructor(ok: boolean, valueOrFailure: T | F) {
    this.ok = ok;
    if (ok) {
      this._value = valueOrFailure as T;
    } else {
      this._failure = valueOrFailure as F;
    }
    Object.freeze(this);
  }

  get value(): T {
    if (!this.ok) {
      throw new InternalError('Cannot access value on NotOk result');
    }
    // biome-ignore lint/style/noNonNullAssertion: must be present if ok is true
    return this._value!;
  }

  get failure(): F {
    if (this.ok) {
      throw new InternalError('Cannot access failure on Ok result');
    }
    // biome-ignore lint/style/noNonNullAssertion: must be present if ok is false
    return this._failure!;
  }

  /**
   * Creates a successful result.
   */
  static ok<T, F = never>(value: T): Ok<T> {
    return blindCast<
      Ok<T>,
      'ResultImpl is the single implementation of the Result discriminated union; TypeScript cannot express discriminated return types for a single class. ok=true guarantees this is an Ok<T> at runtime.'
    >(new ResultImpl<T, F>(true, value));
  }

  /**
   * Creates an unsuccessful result.
   */
  static notOk<T = never, F = unknown>(failure: F): NotOk<F> {
    return blindCast<
      NotOk<F>,
      'ResultImpl is the single implementation of the Result discriminated union; TypeScript cannot express discriminated return types for a single class. ok=false guarantees this is a NotOk<F> at runtime.'
    >(new ResultImpl<T, F>(false, failure));
  }

  /**
   * Asserts that this result is Ok and returns the value.
   * Throws if the result is NotOk.
   */
  assertOk(this: Result<T, F>): T {
    if (!this.ok) {
      throw new InternalError('Expected Ok result but got NotOk');
    }
    return this.value;
  }

  /**
   * Asserts that this result is NotOk and returns the failure.
   * Throws if the result is Ok.
   */
  assertNotOk(this: Result<T, F>): F {
    if (this.ok) {
      throw new InternalError('Expected NotOk result but got Ok');
    }
    return this.failure;
  }
}

/**
 * Creates a successful result.
 */
export function ok<T>(value: T): Ok<T> {
  return ResultImpl.ok(value);
}

/**
 * Creates an unsuccessful result.
 */
export function notOk<F>(failure: F): NotOk<F> {
  return ResultImpl.notOk(failure);
}

/**
 * Singleton for void success results.
 * Use this for validation checks that don't produce a value.
 */
const OK_VOID: Ok<void> = ResultImpl.ok<void>(undefined);

/**
 * Returns a successful void result.
 * Use this for validation checks that don't produce a value.
 */
export function okVoid(): Ok<void> {
  return OK_VOID;
}

export function or<T, U, E>(
  left: Result<T, readonly E[]>,
  right: Result<U, readonly E[]>,
): Result<T | U, readonly E[]> {
  if (left.ok) return left;
  if (right.ok) return right;
  if (left.failure.length === 0 || right.failure.length === 0) return notOk([]);
  return notOk([...left.failure, ...right.failure]);
}

export function and<T, U, E>(
  left: Result<T, readonly E[]>,
  right: Result<U, readonly E[]>,
): Result<void, readonly E[]> {
  if (left.ok) return right.ok ? okVoid() : notOk(right.failure);
  if (right.ok) return notOk(left.failure);
  return notOk([...left.failure, ...right.failure]);
}
