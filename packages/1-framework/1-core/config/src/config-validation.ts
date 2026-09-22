/**
 * Top-level config sections. Diagnostics carry the section they concern so
 * commands can fail on the sections they read and ignore the rest.
 */
export type ConfigSection =
  | 'family'
  | 'target'
  | 'adapter'
  | 'driver'
  | 'extensions'
  | 'db'
  | 'contract'
  | 'migrations'
  | 'formatter';

export interface ConfigValidationIssue {
  readonly section: ConfigSection;
  readonly field: string;
  readonly message: string;
}

class IssueCollector {
  readonly issues: ConfigValidationIssue[] = [];

  add(section: ConfigSection, field: string, message?: string): void {
    this.issues.push({
      section,
      field,
      message: message ?? `Config must have a "${field}" field`,
    });
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validateFamily(
  config: Record<string, unknown>,
  issues: IssueCollector,
): string | undefined {
  const family = config['family'];
  if (!family) {
    issues.add('family', 'family');
    return undefined;
  }
  if (!isObject(family)) {
    issues.add('family', 'family', 'Config.family must be an object');
    return undefined;
  }
  if (family['kind'] !== 'family') {
    issues.add('family', 'family.kind', 'Config.family must have kind: "family"');
  }
  if (typeof family['id'] !== 'string') {
    issues.add('family', 'family.id', 'Config.family must have id: string');
  }
  if (typeof family['familyId'] !== 'string') {
    issues.add('family', 'family.familyId', 'Config.family must have familyId: string');
  }
  if (typeof family['version'] !== 'string') {
    issues.add('family', 'family.version', 'Config.family must have version: string');
  }
  if (!family['emission'] || typeof family['emission'] !== 'object') {
    issues.add('family', 'family.emission', 'Config.family must have emission: EmissionSpi');
  }
  if (typeof family['create'] !== 'function') {
    issues.add('family', 'family.create', 'Config.family must have create: function');
  }
  return typeof family['familyId'] === 'string' ? family['familyId'] : undefined;
}

interface DescriptorExpectations {
  readonly section: ConfigSection;
  readonly kind: string;
  readonly label: string;
  readonly familyId: string | undefined;
  readonly targetId: string | undefined;
}

function validateTargetLikeDescriptor(
  descriptor: Record<string, unknown>,
  fieldPrefix: string,
  expectations: DescriptorExpectations,
  issues: IssueCollector,
): void {
  const { section, kind, label, familyId, targetId } = expectations;
  const describe = (suffix: string, requirement: string) =>
    issues.add(section, `${fieldPrefix}.${suffix}`, `${label} must have ${requirement}`);

  if (descriptor['kind'] !== kind) {
    describe('kind', `kind: "${kind}"`);
  }
  if (typeof descriptor['id'] !== 'string') {
    describe('id', 'id: string');
  }
  if (typeof descriptor['familyId'] !== 'string') {
    describe('familyId', 'familyId: string');
  } else if (familyId !== undefined && descriptor['familyId'] !== familyId) {
    issues.add(
      section,
      `${fieldPrefix}.familyId`,
      `Config.${fieldPrefix}.familyId must match Config.family.familyId (expected: ${familyId}, got: ${descriptor['familyId']})`,
    );
  }
  if (typeof descriptor['version'] !== 'string') {
    describe('version', 'version: string');
  }
  if (typeof descriptor['targetId'] !== 'string') {
    describe('targetId', 'targetId: string');
  } else if (targetId !== undefined && descriptor['targetId'] !== targetId) {
    issues.add(
      section,
      `${fieldPrefix}.targetId`,
      `Config.${fieldPrefix}.targetId must match Config.target.targetId (expected: ${targetId}, got: ${descriptor['targetId']})`,
    );
  }
  if (typeof descriptor['create'] !== 'function') {
    describe('create', 'create: function');
  }
}

function validateTarget(
  config: Record<string, unknown>,
  familyId: string | undefined,
  issues: IssueCollector,
): string | undefined {
  const target = config['target'];
  if (!target) {
    issues.add('target', 'target');
    return undefined;
  }
  if (!isObject(target)) {
    issues.add('target', 'target', 'Config.target must be an object');
    return undefined;
  }
  validateTargetLikeDescriptor(
    target,
    'target',
    { section: 'target', kind: 'target', label: 'Config.target', familyId, targetId: undefined },
    issues,
  );
  return typeof target['targetId'] === 'string' ? target['targetId'] : undefined;
}

function validateExtensions(
  config: Record<string, unknown>,
  familyId: string | undefined,
  targetId: string | undefined,
  issues: IssueCollector,
): void {
  if (config['extensionPacks'] !== undefined) {
    issues.add(
      'extensions',
      'extensionPacks',
      'Config.extensionPacks is no longer supported; rename it to Config.extensions',
    );
  }

  if (config['extensions'] === undefined) {
    return;
  }
  if (!Array.isArray(config['extensions'])) {
    issues.add('extensions', 'extensions', 'Config.extensions must be an array');
    return;
  }
  for (const ext of config['extensions']) {
    if (!isObject(ext)) {
      issues.add(
        'extensions',
        'extensions[]',
        'Config.extensions must contain ControlExtensionDescriptor objects',
      );
      continue;
    }
    validateTargetLikeDescriptor(
      ext,
      'extensions[]',
      {
        section: 'extensions',
        kind: 'extension',
        label: 'Config.extensions items',
        familyId,
        targetId,
      },
      issues,
    );
  }
}

function validateContract(config: Record<string, unknown>, issues: IssueCollector): void {
  if (config['contract'] === undefined) {
    return;
  }
  if (!isObject(config['contract'])) {
    issues.add('contract', 'contract', 'Config.contract must be an object');
    return;
  }
  const contract = config['contract'];

  if (!Object.hasOwn(contract, 'source')) {
    issues.add(
      'contract',
      'contract.source',
      'Config.contract.source is required when contract is provided',
    );
    return;
  }

  const source = contract['source'];
  if (!isObject(source)) {
    issues.add('contract', 'contract.source', 'Config.contract.source must be a provider object');
    return;
  }

  // Entries are glob patterns (a wildcard-free entry is the degenerate glob,
  // a literal path); this only checks the array-of-strings shape, not glob
  // syntax.
  const inputs = Object.hasOwn(source, 'inputs') ? source['inputs'] : undefined;
  if (inputs !== undefined) {
    if (!Array.isArray(inputs)) {
      issues.add(
        'contract',
        'contract.source.inputs',
        'Config.contract.source.inputs must be an array of strings when provided',
      );
    } else if (inputs.some((input) => typeof input !== 'string')) {
      issues.add(
        'contract',
        'contract.source.inputs[]',
        'Config.contract.source.inputs must contain only strings',
      );
    }
  }

  const format = Object.hasOwn(source, 'format') ? source['format'] : undefined;
  if (format !== undefined && typeof format !== 'string') {
    issues.add(
      'contract',
      'contract.source.format',
      'Config.contract.source.format must be a string when provided',
    );
  }

  if (!Object.hasOwn(source, 'load') || typeof source['load'] !== 'function') {
    issues.add(
      'contract',
      'contract.source.load',
      'Config.contract.source.load must be a function',
    );
  }

  const output = Object.hasOwn(contract, 'output') ? contract['output'] : undefined;
  if (output !== undefined && typeof output !== 'string') {
    issues.add(
      'contract',
      'contract.output',
      'Config.contract.output must be a string when provided',
    );
  }
}

function validateMigrations(config: Record<string, unknown>, issues: IssueCollector): void {
  if (config['migrations'] === undefined) {
    return;
  }
  if (!isObject(config['migrations'])) {
    issues.add('migrations', 'migrations', 'Config.migrations must be an object');
    return;
  }
  const dir = config['migrations']['dir'];
  if (dir !== undefined && typeof dir !== 'string') {
    issues.add('migrations', 'migrations.dir', 'Config.migrations.dir must be a string');
  }
}

function validateFormatter(config: Record<string, unknown>, issues: IssueCollector): void {
  if (config['formatter'] === undefined) {
    return;
  }
  if (!isObject(config['formatter'])) {
    issues.add('formatter', 'formatter', 'Config.formatter must be an object');
    return;
  }
  const { indent, newline } = config['formatter'];
  const indentIsValid =
    indent === undefined ||
    indent === 'tab' ||
    (typeof indent === 'number' && Number.isInteger(indent) && indent >= 1);
  if (!indentIsValid) {
    issues.add(
      'formatter',
      'formatter.indent',
      'Config.formatter.indent must be an integer >= 1 or "tab"',
    );
  }
  if (newline !== undefined && newline !== 'LF' && newline !== 'CRLF') {
    issues.add('formatter', 'formatter.newline', 'Config.formatter.newline must be "LF" or "CRLF"');
  }
}

/**
 * Validates the config structure and returns every problem found, each tagged
 * with the config section it concerns. Pure validation logic with no file I/O
 * or CLI awareness; it never throws.
 */
export function collectConfigIssues(
  config: Record<string, unknown>,
): readonly ConfigValidationIssue[] {
  const issues = new IssueCollector();

  const familyId = validateFamily(config, issues);
  const targetId = validateTarget(config, familyId, issues);

  const adapter = config['adapter'];
  if (!adapter) {
    issues.add('adapter', 'adapter');
  } else if (!isObject(adapter)) {
    issues.add('adapter', 'adapter', 'Config.adapter must be an object');
  } else {
    validateTargetLikeDescriptor(
      adapter,
      'adapter',
      { section: 'adapter', kind: 'adapter', label: 'Config.adapter', familyId, targetId },
      issues,
    );
  }

  const driver = config['driver'];
  if (driver !== undefined) {
    if (!isObject(driver)) {
      issues.add('driver', 'driver', 'Config.driver must be an object');
    } else {
      validateTargetLikeDescriptor(
        driver,
        'driver',
        { section: 'driver', kind: 'driver', label: 'Config.driver', familyId, targetId },
        issues,
      );
    }
  }

  validateExtensions(config, familyId, targetId, issues);
  validateContract(config, issues);
  validateMigrations(config, issues);
  validateFormatter(config, issues);

  return issues.issues;
}
