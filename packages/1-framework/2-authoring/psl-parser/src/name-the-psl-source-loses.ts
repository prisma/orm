/**
 * A name that is lost when a PSL file is read. The parser keeps block members, and the PSL contract sources keep other names, as keys of plain objects, where assigning this key sets the object's prototype instead of adding a key. Code that writes PSL must not write this name anywhere a PSL source reads a name, including inside `@map` and `@@map`.
 */
export const NAME_THE_PSL_SOURCE_LOSES = '__proto__';
