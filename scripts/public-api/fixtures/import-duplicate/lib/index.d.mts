interface ParsedPath {
  readonly root: string;
}
declare function describe(value: import("node:path").ParsedPath): void;
declare function describe(value: ParsedPath): void;
export { ParsedPath, describe };
