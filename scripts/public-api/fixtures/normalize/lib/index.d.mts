type Literal = "b" | "a" | "c";
declare const nested: { readonly kind: "z" | "y"; readonly pair: readonly ["d" | "c", 2 | 1]; readonly map: Map<"n" | "m", string | boolean>; readonly fn: (value: "q" | "p") => "s" | "r"; };
type Conditional<T> = T extends "k" | "j" ? "v" | "u" : never;
type Both = { a: 1 } & ("y" | "x");
declare const fromImport: import("node:path").ParsedPath;
declare function generic(value: null | import("node:path").ParsedPath): typeof import("node:path").sep;
declare const parsed: import("node:path").PlatformPath["parse"];
interface Holder {
  readonly value: "two" | "one";
  method(arg: "b" | "a"): void;
}
export { Both, Conditional, Holder, Literal, fromImport, generic, nested, parsed };
