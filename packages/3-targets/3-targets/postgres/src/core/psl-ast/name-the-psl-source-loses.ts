/**
 * The PSL source keeps names as keys of plain objects, and assigning this key
 * sets the object's prototype instead, so this name is lost when the file is
 * read.
 */
export const NAME_THE_PSL_SOURCE_LOSES = '__proto__';
