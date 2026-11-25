type Kind$1 = "b" | "a";
interface Extra$1 {
  readonly more: string;
}
declare module "fixture-augment/registry" {
  interface Registry extends Extra$1 {
    readonly "fixture/size": number;
    label?: string;
    readonly mode: "write" | "read";
    readonly kind: Kind$1;
    readonly spaced: "a  b";
    /** @deprecated Use `label`. */
    name?: string;
    describe(): string;
  }
}
export { Kind$1 as t, Extra$1 as u };
