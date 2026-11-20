/**
 * Used for preserving class names for minified class instances
 * Useful for error objects and other classes where public name
 * actually matters
 *
 * @param classObject
 * @param name
 */
export function setClassName(classObject: Function, name: string) {
  Object.defineProperty(classObject, 'name', {
    value: name,
    configurable: true,
  })
}
