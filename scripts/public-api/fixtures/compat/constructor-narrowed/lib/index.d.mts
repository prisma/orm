export declare class Client {
  constructor(url: string);
  query(text: string): Promise<unknown>;
}
