import type { ArgType, BlockInterpretCtx, OptionalArgType } from './types';

export function optional<T, Ctx extends BlockInterpretCtx>(
  type: ArgType<T, Ctx>,
  ...rest: [defaultValue: T] | []
): OptionalArgType<T, Ctx> {
  if (rest.length === 0) {
    return { ...type, optional: true, hasDefault: false };
  }
  return { ...type, optional: true, hasDefault: true, defaultValue: rest[0] };
}
