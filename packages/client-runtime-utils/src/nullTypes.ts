/**
 * Module-private symbol used to distinguish between instances of
 * `ObjectEnumValue` created inside and outside this module.
 */
const secret = Symbol()

/**
 * Global symbol used to identify ObjectEnumValue instances across bundle
 * boundaries. `Symbol.for()` returns the same symbol globally, so it works
 * even when multiple copies of this module are loaded (e.g., browser and
 * server bundles in Next.js, or HMR reloads).
 * See: https://github.com/prisma/prisma/issues/29257
 */
const PRISMA_OBJECT_ENUM_VALUE = Symbol.for('prisma.objectEnumValue')

/**
 * Base class for unique values of object-valued enums.
 */
export abstract class ObjectEnumValue {
  readonly [PRISMA_OBJECT_ENUM_VALUE] = true
  #representation: string

  constructor(arg?: symbol) {
    if (arg === secret) {
      this.#representation = `Prisma.${this._getName()}`
    } else {
      this.#representation = `new Prisma.${this._getNamespace()}.${this._getName()}()`
    }
  }

  abstract _getNamespace(): string

  _getName() {
    return this.constructor.name
  }

  toString() {
    return this.#representation
  }
}

/**
 * See helper in @internals package. Can not be used here
 * because importing internal breaks browser build.
 *
 * @param classObject
 * @param name
 */
function setClassName(classObject: Function, name: string) {
  Object.defineProperty(classObject, 'name', {
    value: name,
    configurable: true,
  })
}

class NullTypesEnumValue extends ObjectEnumValue {
  override _getNamespace() {
    return 'NullTypes'
  }
}

export class DbNullClass extends NullTypesEnumValue {
  // Phantom private property to prevent structural type equality
  // eslint-disable-next-line no-unused-private-class-members
  readonly #_brand_DbNull!: void
}
setClassName(DbNullClass, 'DbNull')

export class JsonNullClass extends NullTypesEnumValue {
  // Phantom private property to prevent structural type equality
  // eslint-disable-next-line no-unused-private-class-members
  readonly #_brand_JsonNull!: void
}
setClassName(JsonNullClass, 'JsonNull')

export class AnyNullClass extends NullTypesEnumValue {
  // Phantom private property to prevent structural type equality
  // eslint-disable-next-line no-unused-private-class-members
  readonly #_brand_AnyNull!: void
}
setClassName(AnyNullClass, 'AnyNull')

export const NullTypes = {
  DbNull: DbNullClass,
  JsonNull: JsonNullClass,
  AnyNull: AnyNullClass,
}

export const DbNull = new DbNullClass(secret)
export const JsonNull = new JsonNullClass(secret)
export const AnyNull = new AnyNullClass(secret)

/**
 * Check if a value is an ObjectEnumValue instance. Uses a global symbol
 * instead of instanceof to work across bundle boundaries (e.g., when a
 * Next.js app bundles browser and server code separately, creating duplicate
 * module instances of @prisma/client-runtime-utils).
 * See: https://github.com/prisma/prisma/issues/29257
 */
export function isObjectEnumValue(value: unknown): value is ObjectEnumValue {
  return (
    typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[PRISMA_OBJECT_ENUM_VALUE] === true
  )
}

/**
 * Check if a value is the DBNull singleton instance.
 */
export function isDbNull(value: unknown): value is DbNullClass {
  return value === DbNull
}

/**
 * Check if a value is the JsonNull singleton instance.
 */
export function isJsonNull(value: unknown): value is JsonNullClass {
  return value === JsonNull
}

/**
 * Check if a value is the AnyNull singleton instance.
 */
export function isAnyNull(value: unknown): value is AnyNullClass {
  return value === AnyNull
}
