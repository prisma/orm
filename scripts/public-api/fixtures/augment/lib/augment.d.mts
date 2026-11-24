declare module "fixture-augment/registry" {
  interface Registry {
    readonly "fixture/size": number;
    label?: string;
    readonly mode: "write" | "read";
    /** @deprecated Use `label`. */
    name?: string;
    describe(): string;
  }
}
export {};
