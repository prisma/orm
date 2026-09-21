#!/usr/bin/env node

/**
 * Dependency Cruiser configuration for Prisma 8.
 *
 * It derives module groups from architecture.config.json and encodes the same-layer/
 * downward-only semantics. Plane import constraints and cross-domain exceptions are
 * defined declaratively in architecture.config.json rather than hardcoded here.
 */

import config from './architecture.config.json' with { type: 'json' };

const {
  packages: packageConfigs,
  layerOrder,
  planeRules,
  crossDomainExceptions,
  crossDomainRules,
} = config;

const normalizeGlob = (glob) => {
  const DOUBLE_WILDCARD = '__DOUBLE_WILDCARD__';
  const SINGLE_WILDCARD = '__SINGLE_WILDCARD__';
  const hasWildcard = glob.includes('*');
  const lastPathSegment = glob.split('/').pop() ?? '';
  const isFileLikePattern = !hasWildcard && lastPathSegment.includes('.');

  let pattern = glob
    .replace(/\*\*/g, DOUBLE_WILDCARD)
    .replace(/\*/g, SINGLE_WILDCARD)
    .replaceAll(DOUBLE_WILDCARD, '.*')
    .replaceAll(SINGLE_WILDCARD, '[^/]*');

  if (isFileLikePattern) {
    return `^${pattern}$`;
  }
  if (!hasWildcard && !pattern.endsWith('/')) {
    pattern += '/.*';
  }
  return `^${pattern}`;
};

const moduleGroupMap = new Map();

for (const pkgConfig of packageConfigs) {
  const key = `${pkgConfig.domain}-${pkgConfig.layer}-${pkgConfig.plane}`;
  if (!moduleGroupMap.has(key)) {
    moduleGroupMap.set(key, {
      key,
      domain: pkgConfig.domain,
      layer: pkgConfig.layer,
      plane: pkgConfig.plane,
      globs: [],
      patterns: [],
    });
  }
  const group = moduleGroupMap.get(key);
  group.globs.push(pkgConfig.glob);
  group.patterns.push(normalizeGlob(pkgConfig.glob));
}

const moduleGroups = Array.from(moduleGroupMap.values());

const getLayerIndex = (domain, layer) => {
  const order = layerOrder[domain];
  if (!order) return -1;
  return order.indexOf(layer);
};

const describeGroup = (group) => `${group.domain}/${group.layer}/${group.plane}`;
const groupPattern = (group) => group.patterns.join('|');

const matchesGlobPattern = (group, pattern) => {
  // Check if any of the group's globs match the exception pattern
  // We check if the globs are identical or if one is a prefix of the other (with proper glob semantics)
  return group.globs.some((glob) => {
    // Exact match
    if (glob === pattern) {
      return true;
    }

    // Check if the group's glob matches the exception pattern by normalizing both and testing
    // Normalize both patterns to regex and check if they would match the same files
    const normalizedExceptionPattern = normalizeGlob(pattern);
    const normalizedGroupPattern = normalizeGlob(glob);

    // If the normalized patterns are identical, they match
    if (normalizedExceptionPattern === normalizedGroupPattern) {
      return true;
    }

    // Check if one pattern is a prefix of the other
    const exceptionBase = pattern.replace(/\/\*\*$/, '').replace(/\*$/, '');
    const groupBase = glob.replace(/\/\*\*$/, '').replace(/\*$/, '');

    // Group matches exception if group's base path starts with exception's base path, or vice versa
    if (groupBase.startsWith(exceptionBase) || exceptionBase.startsWith(groupBase)) {
      return true;
    }

    return false;
  });
};

const forbidden = [];

const pushRule = (name, comment, sourceGroup, targetGroup) => {
  forbidden.push({
    name,
    comment,
    severity: 'error',
    from: { path: groupPattern(sourceGroup) },
    to: { path: groupPattern(targetGroup) },
  });
};

const createUpwardRules = () => {
  for (const sourceGroup of moduleGroups) {
    for (const targetGroup of moduleGroups) {
      if (sourceGroup.domain !== targetGroup.domain) continue;

      const sourceIndex = getLayerIndex(sourceGroup.domain, sourceGroup.layer);
      const targetIndex = getLayerIndex(targetGroup.domain, targetGroup.layer);
      if (sourceIndex === -1 || targetIndex === -1 || targetIndex <= sourceIndex) continue;

      // SQL contract types are now in shared plane (sql/contract), so authoring can import from shared
      // No exception needed - authoring imports from shared, not targets

      pushRule(
        `upward-${sourceGroup.key}-to-${targetGroup.layer}`,
        `Upward import: ${describeGroup(sourceGroup)} cannot import from ${describeGroup(targetGroup)} (away from core)`,
        sourceGroup,
        targetGroup,
      );
    }
  }
};

const createCrossDomainRules = () => {
  if (!crossDomainRules) {
    // Fallback to old behavior if crossDomainRules not defined
    for (const sourceGroup of moduleGroups) {
      for (const targetGroup of moduleGroups) {
        if (sourceGroup.domain === targetGroup.domain) continue;
        if (targetGroup.domain === 'framework') continue;

        // Check if this import is allowed by an exception
        const isException = crossDomainExceptions?.some((exception) => {
          const sourceMatches = matchesGlobPattern(sourceGroup, exception.from);
          const targetMatches = matchesGlobPattern(targetGroup, exception.to);
          return sourceMatches && targetMatches;
        });

        if (isException) continue;

        pushRule(
          `cross-domain-${sourceGroup.domain}-to-${targetGroup.domain}`,
          `Cross-domain import: ${sourceGroup.domain} cannot import from ${targetGroup.domain}`,
          sourceGroup,
          targetGroup,
        );
      }
    }
    return;
  }

  for (const sourceGroup of moduleGroups) {
    for (const targetGroup of moduleGroups) {
      if (sourceGroup.domain === targetGroup.domain) continue;

      const sourceDomainRule = crossDomainRules[sourceGroup.domain];
      if (!sourceDomainRule) {
        // If domain not in rules, deny all cross-domain imports
        pushRule(
          `cross-domain-${sourceGroup.domain}-to-${targetGroup.domain}`,
          `Cross-domain import: ${sourceGroup.domain} cannot import from ${targetGroup.domain} (domain not in crossDomainRules)`,
          sourceGroup,
          targetGroup,
        );
        continue;
      }

      // Check if target domain is in the allowed list
      const mayImportFrom = sourceDomainRule.mayImportFrom || [];
      const isAllowed = mayImportFrom.includes(targetGroup.domain);

      if (isAllowed) {
        // Check if this import is explicitly denied by an exception (exceptions can override rules)
        const isException = crossDomainExceptions?.some((exception) => {
          const sourceMatches = matchesGlobPattern(sourceGroup, exception.from);
          const targetMatches = matchesGlobPattern(targetGroup, exception.to);
          return sourceMatches && targetMatches;
        });

        // Exceptions allow imports, so if there's an exception, skip the rule
        if (isException) continue;

        // Import is allowed by rule, no rule needed
        continue;
      }

      // Import is not allowed - check if there's an exception that allows it
      const isException = crossDomainExceptions?.some((exception) => {
        const sourceMatches = matchesGlobPattern(sourceGroup, exception.from);
        const targetMatches = matchesGlobPattern(targetGroup, exception.to);
        return sourceMatches && targetMatches;
      });

      if (isException) continue;

      // Import is denied
      pushRule(
        `cross-domain-${sourceGroup.domain}-to-${targetGroup.domain}`,
        `Cross-domain import: ${sourceGroup.domain} cannot import from ${targetGroup.domain}. ${sourceDomainRule.reason || 'Domain rule violation'}`,
        sourceGroup,
        targetGroup,
      );
    }
  }
};

const createPlaneRules = () => {
  if (!planeRules) return;

  for (const [sourcePlaneName, planeRule] of Object.entries(planeRules)) {
    if (!planeRule.forbid || planeRule.forbid.length === 0) continue;

    for (const sourceGroup of moduleGroups) {
      if (sourceGroup.plane !== sourcePlaneName) continue;

      for (const forbiddenPlaneName of planeRule.forbid) {
        for (const targetGroup of moduleGroups) {
          if (targetGroup.plane !== forbiddenPlaneName) continue;

          // Check if this import is allowed by an exception
          const isException = planeRule.exceptions?.some((exception) => {
            const sourceMatches = matchesGlobPattern(sourceGroup, exception.from);
            const targetMatches = matchesGlobPattern(targetGroup, exception.to);
            return sourceMatches && targetMatches;
          });

          if (isException) continue;

          const sourcePlaneLabel =
            sourcePlaneName.charAt(0).toUpperCase() + sourcePlaneName.slice(1);
          const targetPlaneLabel =
            forbiddenPlaneName.charAt(0).toUpperCase() + forbiddenPlaneName.slice(1);

          pushRule(
            `plane-${sourcePlaneName}-to-${forbiddenPlaneName}-${sourceGroup.key}-to-${targetGroup.key}`,
            `${sourcePlaneLabel} → ${targetPlaneLabel}: ${describeGroup(sourceGroup)} cannot import from ${describeGroup(targetGroup)}`,
            sourceGroup,
            targetGroup,
          );
        }
      }
    }
  }
};

const createDriverRules = () => {
  const driverGroups = moduleGroups.filter(
    (group) => group.domain === 'sql' && group.layer === 'drivers',
  );

  for (const driverGroup of driverGroups) {
    for (const sourceGroup of moduleGroups) {
      if (sourceGroup.key === driverGroup.key) continue;
      if (sourceGroup.domain !== 'sql') continue;
      if (sourceGroup.layer === 'adapters') continue;

      pushRule(
        `drivers-only-adapters-${sourceGroup.domain}-${sourceGroup.layer}`,
        `Drivers can only be imported by adapters: ${describeGroup(sourceGroup)} cannot import from ${describeGroup(driverGroup)}`,
        sourceGroup,
        driverGroup,
      );
    }
  }
};

const createTestImportRules = () => {
  forbidden.push({
    name: 'packages-cannot-import-test',
    comment: 'packages/** cannot import from test/** (test suites are not part of source)',
    severity: 'error',
    from: { path: '^packages/' },
    to: { path: '^test/' },
  });
};

const createCliControlSeamRules = () => {
  forbidden.push({
    name: 'cli-commands-no-runtime-migration-tools',
    comment:
      'CLI command modules must reach @internal/migration-tools through src/control-api ' +
      '(TML-3173, consolidate-clis slice 1b). Type-only imports of published migration-tools ' +
      'types are allowed; runtime imports are not.',
    severity: 'error',
    from: { path: '^packages/1-framework/3-tooling/cli/src/commands/' },
    to: {
      path: '^packages/1-framework/3-tooling/migration/',
      dependencyTypesNot: ['type-only'],
    },
  });
};

createUpwardRules();
createCrossDomainRules();
createPlaneRules();
createDriverRules();
createTestImportRules();
createCliControlSeamRules();

export default {
  forbidden,
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: 'specify',
    tsConfig: {
      fileName: 'tsconfig.base.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    includeOnly: '^packages/',
    exclude: {
      path: [
        'node_modules',
        '\\.test\\.',
        '\\.spec\\.',
        '/test/',
        '\\.config\\.',
        'vitest\\.config',
        'tsdown\\.config',
        '\\.d\\.ts$',
        'dist',
        'coverage',
        '^packages/document/',
        '^test/',
      ],
    },
    reporterOptions: {
      dot: {
        collapsePattern: '^packages/[^/]+',
      },
      text: {
        highlightFocused: true,
      },
    },
  },
};
