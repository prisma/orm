import type { Contract } from '@internal/contract/types';
import type {
  AdapterDescriptor,
  DriverDescriptor,
  ExtensionDescriptor,
  FamilyDescriptor,
  SessionSettings,
  TargetDescriptor,
} from '../shared/framework-components';
import type { GeneratorFunctionField } from '../shared/generator-functions';
import type { DataTypeSupport } from '../shared/written-value';
import type { ContractSerializer } from './contract-serializer';
import type {
  ControlAdapterInstance,
  ControlDriverInstance,
  ControlExtensionInstance,
  ControlFamilyInstance,
  ControlTargetInstance,
} from './control-instances';
import type { ContractSpace } from './control-spaces';
import type { ControlStack } from './control-stack';
import type { EmissionSpi } from './emission-types';

export interface ControlFamilyDescriptor<
  TFamilyId extends string,
  TFamilyInstance extends ControlFamilyInstance<TFamilyId, unknown> = ControlFamilyInstance<
    TFamilyId,
    unknown
  >,
> extends FamilyDescriptor<TFamilyId> {
  readonly emission: EmissionSpi;
  /** The length of a field of a codec and type params, in its data type's normal form, as a generator binding reads {@link GeneratorFunctionField.length}. A family whose fields have no length omits it. */
  readonly fieldLength?: (
    field: Omit<GeneratorFunctionField, 'length'>,
    dataTypes: DataTypeSupport,
  ) => number | undefined;
  readonly pslDiagnostics?: {
    readonly describeUnsupportedAttribute?: unknown;
    readonly describeUnresolvedType?: unknown;
  };
  create<TTargetId extends string>(stack: ControlStack<TFamilyId, TTargetId>): TFamilyInstance;
}

export interface ControlTargetDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TTargetInstance extends ControlTargetInstance<TFamilyId, TTargetId> = ControlTargetInstance<
    TFamilyId,
    TTargetId
  >,
  TContract extends Contract = Contract,
> extends TargetDescriptor<TFamilyId, TTargetId> {
  /**
   * JSON ⇄ class boundary for this target's contract. Every target
   * ships the SPI: framework consumers reach the serializer through
   * `descriptor.contractSerializer` rather than importing a per-target
   * `deserializeContract` helper. The descriptor IS the aggregator.
   */
  readonly contractSerializer: ContractSerializer<TContract>;
  readonly defaultNamespaceId: string;
  create(): TTargetInstance;
}

export interface ControlAdapterDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TAdapterInstance extends ControlAdapterInstance<TFamilyId, TTargetId> = ControlAdapterInstance<
    TFamilyId,
    TTargetId
  >,
> extends AdapterDescriptor<TFamilyId, TTargetId> {
  /**
   * Construct a control adapter instance for this stack.
   *
   * The `stack` argument mirrors `ControlFamilyDescriptor.create(stack)`:
   * adapter implementations may inspect `stack.codecLookup`, extension packs,
   * or other assembled metadata when constructing the instance.
   */
  create(stack: ControlStack<TFamilyId, TTargetId>): TAdapterInstance;
}

export interface ControlDriverDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TDriverInstance extends ControlDriverInstance<TFamilyId, TTargetId> = ControlDriverInstance<
    TFamilyId,
    TTargetId
  >,
  TConnection = string,
> extends DriverDescriptor<TFamilyId, TTargetId> {
  create(connection: TConnection, options?: ControlDriverConnectOptions): Promise<TDriverInstance>;
}

/** How a control driver connects. */
export interface ControlDriverConnectOptions {
  /**
   * Connect only to a database that already exists, and never create one or its file. A driver
   * whose connect could create a database must honour it; Postgres and MongoDB honour it as they
   * are, since connecting never creates a database there.
   */
  readonly existingDatabaseOnly?: boolean;
  /** Give up connecting after this many milliseconds, where the driver connects over a network. */
  readonly connectTimeoutMs?: number;
  /** Session settings the stack's target declares, which the driver ensures on its connection. */
  readonly sessionSettings?: SessionSettings;
}

export interface ControlExtensionDescriptor<
  TFamilyId extends string,
  TTargetId extends string,
  TExtensionInstance extends ControlExtensionInstance<
    TFamilyId,
    TTargetId
  > = ControlExtensionInstance<TFamilyId, TTargetId>,
> extends ExtensionDescriptor<TFamilyId, TTargetId> {
  readonly contractSpace?: ContractSpace;
  create(): TExtensionInstance;
}
