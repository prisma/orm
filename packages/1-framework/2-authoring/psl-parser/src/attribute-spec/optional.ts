import type { AnyArgType, CtxOf, OptionalArgType, OutOf } from './types';

export function optional<Type extends AnyArgType>(
  type: Type,
  ...rest: [] | [defaultValue: OutOf<Type> | undefined]
): OptionalArgType<OutOf<Type>, CtxOf<Type>, Type> {
  if (rest.length === 0) {
    return { ...type, optional: true, hasDefault: false };
  }
  return { ...type, optional: true, hasDefault: true, defaultValue: rest[0] };
}
