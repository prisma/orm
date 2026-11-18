import type {
  AdapterDescriptor,
  DriverDescriptor,
  ExtensionDescriptor,
  FamilyDescriptor,
  SessionSettings,
  TargetDescriptor,
} from '../shared/framework-components';
import type {
  RuntimeAdapterInstance,
  RuntimeDriverInstance,
  RuntimeExtensionInstance,
  RuntimeFamilyInstance,
  RuntimeTargetInstance,
} from './execution-instances';
import type { ExecutionStack } from './execution-stack';

export interface RuntimeFamilyDescriptor<
  TFamilyId extends string,
  TFamilyInstance extends RuntimeFamilyInstance<TFamilyId> = RuntimeFamilyInstance<TFamilyId>,
> extends FamilyDescriptor<TFamilyId> {
  create<TTargetId extends string>(options: {
    readonly target: RuntimeTargetDescriptor<TFamilyId, TTargetId>;
    readonly adapter: RuntimeAdapterDescriptor<TFamilyId, TTargetId>;
    readonly driver: RuntimeDriverDescriptor<TFamilyId, TTargetId>;
    readonly extensions: readonly RuntimeExtensionDescriptor<TFamilyId, TTargetId>[];
  }): TFamilyInstance;
}

export interface RuntimeTargetDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TTargetInstance extends RuntimeTargetInstance<TFamilyId, TTargetId> = RuntimeTargetInstance<
    TFamilyId,
    TTargetId
  >,
> extends TargetDescriptor<TFamilyId, TTargetId> {
  create(): TTargetInstance;
}

export interface RuntimeAdapterDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TAdapterInstance extends RuntimeAdapterInstance<TFamilyId, TTargetId> = RuntimeAdapterInstance<
    TFamilyId,
    TTargetId
  >,
> extends AdapterDescriptor<TFamilyId, TTargetId> {
  /**
   * Construct a runtime adapter instance for this execution stack.
   *
   * Mirrors `ControlAdapterDescriptor.create(stack)` so that adapter
   * implementations may inspect stack-assembled metadata (e.g. codecs
   * contributed by extension packs) when constructing the instance.
   */
  create(stack: ExecutionStack<TFamilyId, TTargetId>): TAdapterInstance;
}

export interface RuntimeDriverDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TCreateOptions = void,
  TDriverInstance extends RuntimeDriverInstance<TFamilyId, TTargetId> = RuntimeDriverInstance<
    TFamilyId,
    TTargetId
  >,
> extends DriverDescriptor<TFamilyId, TTargetId> {
  /** Creates an unbound driver. `sessionSettings` are the settings the stack's target declares, which the driver ensures on every connection it hands out. */
  create(options?: TCreateOptions, sessionSettings?: SessionSettings): TDriverInstance;
}

export interface RuntimeExtensionDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TExtensionInstance extends RuntimeExtensionInstance<
    TFamilyId,
    TTargetId
  > = RuntimeExtensionInstance<TFamilyId, TTargetId>,
> extends ExtensionDescriptor<TFamilyId, TTargetId> {
  create(): TExtensionInstance;
}
