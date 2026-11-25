export declare abstract class Store {
  protected read(key: string): string;
  protected abstract write(key: string, value: string): void;
  protected abstract reset(): void;
  get(key: string): string;
}
