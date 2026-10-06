import type { ContractSourceContext } from '@internal/config/config-types';
import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import type {
  AssembledAuthoringContributions,
  ControlMutationDefaults,
} from '@internal/framework-components/control';
import type { BinderContext } from '@internal/psl-parser';

export interface LspControlStack {
  readonly scalarTypes: readonly string[];
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
  readonly authoringContributions?: AssembledAuthoringContributions;
  readonly controlMutationDefaults?: ControlMutationDefaults;
  readonly pslDiagnostics?: ContractSourceContext['pslDiagnostics'];
}

export function binderContextFromStack(stack: LspControlStack): BinderContext {
  return {
    authoringContributions: stack.authoringContributions ?? {
      field: {},
      type: {},
      entityTypes: {},
      pslBlockDescriptors: stack.pslBlockDescriptors,
      modelAttributes: {},
      attributeSpecs: { model: {}, field: {} },
      dataTypes: {},
    },
    controlMutationDefaults: {
      defaultFunctionRegistry: stack.controlMutationDefaults?.defaultFunctionRegistry ?? new Map(),
    },
    ...(stack.pslDiagnostics === undefined ? {} : { pslDiagnostics: stack.pslDiagnostics }),
  };
}
