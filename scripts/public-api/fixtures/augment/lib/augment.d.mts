type Kind$1 = "b" | "a";
declare module "fixture-augment/registry" {
  interface Registry {
    readonly "fixture/size": number;
    label?: string;
    readonly mode: "write" | "read";
    readonly kind: Kind$1;
    /** @deprecated Use `label`. */
    name?: string;
    describe(): string;
  }
}
export { Kind$1 as t };
