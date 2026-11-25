interface Label {
  readonly text: string;
}
declare module "pathe" {
  interface Extra {
    readonly label: Label;
  }
}
export {};
