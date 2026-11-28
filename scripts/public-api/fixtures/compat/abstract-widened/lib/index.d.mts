export declare abstract class Store {
  protected read(key: string): string;
  protected abstract write(key: string, value: string | number): void;
  get(key: string): string;
}
