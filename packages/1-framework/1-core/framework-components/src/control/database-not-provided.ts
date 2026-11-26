/** A version as the database reports it (`15.4`) or as its target's table names it (`17`). Opaque to the framework, which only prints it. */
export type DatabaseVersion = string | number;

/** A capability, as `namespace.flag`, and the first version of the target's table that provides it. */
export interface CapabilityFirstAvailable {
  readonly capability: string;
  readonly firstVersion: DatabaseVersion;
}

/**
 * One way a database does not provide what a contract requires:
 * - `missing-capabilities`: the database's version lacks capabilities a later version provides. `versionToState` is the version of the target's table that describes the database, which the contract can state instead.
 * - `unrecognized-capabilities`: capabilities that no version of the target's table provides and no component declares.
 * - `older-than-supported`: the database is older than the oldest version the target supports.
 * - `version-not-read`: the database's version could not be read; `versionQuery` is the statement that reports it.
 */
export type DatabaseNotProvidedFinding =
  | {
      readonly kind: 'missing-capabilities';
      readonly databaseVersion: DatabaseVersion;
      readonly versionToState: DatabaseVersion;
      readonly capabilities: readonly CapabilityFirstAvailable[];
    }
  | { readonly kind: 'unrecognized-capabilities'; readonly capabilities: readonly string[] }
  | {
      readonly kind: 'older-than-supported';
      readonly databaseVersion: DatabaseVersion;
      readonly oldestSupported: DatabaseVersion;
    }
  | { readonly kind: 'version-not-read'; readonly versionQuery: string };

/** A database that does not provide what a contract requires of it, by its name as the target writes it (`PostgreSQL`). The CLI renders it with {@link databaseNotProvidedText}, and offers no change to the database's schema for it. */
export interface DatabaseNotProvided {
  readonly database: string;
  readonly findings: readonly DatabaseNotProvidedFinding[];
}

function missingByFirstVersion(capabilities: readonly CapabilityFirstAvailable[]) {
  const groups: { firstVersion: DatabaseVersion; capabilities: string[] }[] = [];
  for (const { capability, firstVersion } of capabilities) {
    const group = groups.find((existing) => existing.firstVersion === firstVersion);
    if (group === undefined) groups.push({ firstVersion, capabilities: [capability] });
    else group.capabilities.push(capability);
  }
  return groups;
}

function findingText(database: string, finding: DatabaseNotProvidedFinding): string {
  switch (finding.kind) {
    case 'missing-capabilities': {
      const versions = missingByFirstVersion(finding.capabilities)
        .map((group) => `${database} ${group.firstVersion} (${group.capabilities.join(', ')})`)
        .join(' and ');
      return `Your contract requires database capabilities first available in ${versions}, but this database runs ${database} ${finding.databaseVersion}. Either upgrade the database, or remove the capabilities from your contract: state version ${finding.versionToState}, and take them out of its capabilities list if it lists them.`;
    }
    case 'unrecognized-capabilities':
      return `Your contract requires unrecognized database capabilities (${finding.capabilities.join(', ')}). No supported ${database} version provides them, and neither do your adapter, driver or extensions. Either remove the capabilities from your contract, or install a component that provides them.`;
    case 'older-than-supported':
      return `This release of Prisma requires ${database} ${finding.oldestSupported} or later. This database runs ${database} ${finding.databaseVersion}. Upgrade the database to ${database} ${finding.oldestSupported} or later.`;
    case 'version-not-read':
      return `Prisma could not read this database's ${database} version, so it cannot check that the database provides what your contract requires. Check that the connection reaches a ${database} server, and that ${finding.versionQuery} returns its version there.`;
  }
}

/** What a database does not provide of what a contract requires, and what to do about it, one finding after another. */
export function databaseNotProvidedText(notProvided: DatabaseNotProvided): string {
  return notProvided.findings
    .map((finding) => findingText(notProvided.database, finding))
    .join(' ');
}
