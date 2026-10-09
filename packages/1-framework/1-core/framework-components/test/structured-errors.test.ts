import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import type {
  RuntimeAdapterDescriptor,
  RuntimeFamilyDescriptor,
  RuntimeTargetDescriptor,
} from '../src/execution/execution-descriptors';
import { assertRuntimeContractRequirementsSatisfied } from '../src/execution/execution-requirements';
import { hydrateNamespaceEntities } from '../src/ir/entity-kind';
import { validateAuthoringHelperArguments } from '../src/shared/framework-authoring';

function capture(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

const family: RuntimeFamilyDescriptor<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
  create: () => ({ familyId: 'sql' }),
};

const target: RuntimeTargetDescriptor<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  create: () => ({ familyId: 'sql', targetId: 'postgres' }),
};

const adapter: RuntimeAdapterDescriptor<'sql', 'postgres'> = {
  kind: 'adapter',
  id: 'postgres-adapter',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  create: () => ({ familyId: 'sql', targetId: 'postgres' }),
};

describe('structured error codes', () => {
  it('malformed helper argument raises CONTRACT.ARGUMENT_INVALID', () => {
    const error = capture(() =>
      validateAuthoringHelperArguments('field.test', [{ kind: 'string' }], [123]),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.ARGUMENT_INVALID',
      message: 'Authoring helper argument at field.test[0] must be a string',
    });
  });

  it('unknown entries kind raises CONTRACT.ENTITY_KIND_UNKNOWN', () => {
    const error = capture(() =>
      hydrateNamespaceEntities({ bogus: { x: {} } }, new Map(), 'fail', 'myNs'),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.ENTITY_KIND_UNKNOWN',
      message:
        'Unknown entries key "bogus" in namespace "myNs"; no hydration factory registered for this entity kind',
    });
  });

  it('contract target mismatch raises CONTRACT.TARGET_MISMATCH', () => {
    const error = capture(() =>
      assertRuntimeContractRequirementsSatisfied({
        contract: { target: 'mysql' },
        family,
        target,
        adapter,
        extensions: [],
      }),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'CONTRACT.TARGET_MISMATCH',
      message: `Contract target 'mysql' does not match runtime target descriptor 'postgres'.`,
    });
  });

  it('missing required extension pack raises RUNTIME.MISSING_EXTENSION_PACK', () => {
    const error = capture(() =>
      assertRuntimeContractRequirementsSatisfied({
        contract: { target: 'postgres', extensions: { pgvector: {} } },
        family,
        target,
        adapter,
        extensions: [],
      }),
    );
    expect(isStructuredError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'RUNTIME.MISSING_EXTENSION_PACK',
      message: `Contract requires extension pack 'pgvector', but runtime descriptors do not provide a matching component.`,
    });
  });
});
