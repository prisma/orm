import type {
  AuthoringModelAttributeDescriptor,
  AuthoringModelAttributeDescriptorNamespace,
} from '@internal/framework-components/authoring';
import { isAuthoringModelAttributeDescriptor } from '@internal/framework-components/authoring';
import type { AssembledAuthoringContributions } from '@internal/framework-components/control';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import type { FieldAttributeSpecFactory, ModelAttributeSpecFactory } from './spec-context';

export interface AssembledAttributeSpecs {
  readonly model: Readonly<Record<string, ModelAttributeSpecFactory>>;
  readonly field: Readonly<Record<string, FieldAttributeSpecFactory>>;
}

function* modelAttributeDescriptors(
  namespace: AuthoringModelAttributeDescriptorNamespace,
): Generator<AuthoringModelAttributeDescriptor> {
  for (const value of Object.values(namespace)) {
    if (isAuthoringModelAttributeDescriptor(value)) {
      yield value;
      continue;
    }
    yield* modelAttributeDescriptors(value);
  }
}

export function assembleAttributeSpecs(
  contributions: AssembledAuthoringContributions,
): AssembledAttributeSpecs {
  const entries: [string, unknown][] = Object.entries(contributions.attributeSpecs.model);
  const claimed = new Set(entries.map(([attribute]) => attribute));

  for (const descriptor of modelAttributeDescriptors(contributions.modelAttributes)) {
    if (claimed.has(descriptor.attribute)) {
      throw new InternalError(
        `Duplicate attribute spec registration for "${descriptor.attribute}". ` +
          'Each model attribute name may be registered once across family built-ins and model-attribute descriptors.',
      );
    }
    claimed.add(descriptor.attribute);
    entries.push([descriptor.attribute, descriptor.spec]);
  }

  return Object.freeze(
    blindCast<
      AssembledAttributeSpecs,
      'framework core cannot name AttributeSpec, so contributed spec factories transit the authoring contributions erased as unknown; this is the single point that restores the factory types their contribution surface documents'
    >({
      model: Object.freeze(Object.fromEntries(entries)),
      field: Object.freeze({ ...contributions.attributeSpecs.field }),
    }),
  );
}
