export class AppConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppConfigError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class MissingNamespaceError extends Error {
  constructor(namespace: string, surface: string) {
    super(`${surface} is missing the '${namespace}' namespace`);
    this.name = 'MissingNamespaceError';
  }
}
