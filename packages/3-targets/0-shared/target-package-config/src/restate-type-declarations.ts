import type { ComponentMetadata } from '@internal/framework-components/components';
import type { TypesImportSpec } from '@internal/framework-components/emission';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';

type ComponentTypes = NonNullable<ComponentMetadata['types']>;
type CodecTypes = NonNullable<ComponentTypes['codecTypes']>;

function restatedCodecTypes(codecTypes: CodecTypes, module: string): CodecTypes {
  const named = (spec: TypesImportSpec): TypesImportSpec => ({ ...spec, package: module });
  return {
    ...codecTypes,
    ...ifDefined('import', codecTypes.import && named(codecTypes.import)),
    ...ifDefined('typeImports', codecTypes.typeImports?.map(named)),
    ...ifDefined(
      'parameterizedOutputTypes',
      codecTypes.parameterizedOutputTypes && named(codecTypes.parameterizedOutputTypes),
    ),
  };
}

function typeImports(types: ComponentTypes): readonly TypesImportSpec[] {
  const { codecTypes, queryOperationTypes } = types;
  return [
    codecTypes?.import,
    ...(codecTypes?.typeImports ?? []),
    codecTypes?.parameterizedOutputTypes,
    queryOperationTypes?.import,
  ].filter((spec) => spec !== undefined);
}

function refuseNamesFromTwoModules(specs: readonly TypesImportSpec[], module: string): void {
  const moduleByName = new Map<string, string>();
  for (const spec of specs) {
    const earlier = moduleByName.get(spec.named);
    if (earlier !== undefined && earlier !== spec.package) {
      throw new Error(
        `Two type declarations import ${spec.named}, from '${earlier}' and from '${spec.package}'; restated to name '${module}', both would import the same type`,
      );
    }
    moduleByName.set(spec.named, spec.package);
  }
}

/**
 * A copy of `descriptor` whose type declarations all name `module`, each keeping its name and alias. A target package's `defineConfig` uses it to state that its target's and adapter's types come from its own `generated-types` module. A descriptor that declares no types is returned as it is. Two declarations of one name from different modules are refused, since both would import the same type.
 */
export function restateTypeDeclarations<Descriptor extends Pick<ComponentMetadata, 'types'>>(
  descriptor: Descriptor,
  module: string,
): Descriptor {
  const { types } = descriptor;
  const specs = types === undefined ? [] : typeImports(types);
  if (types === undefined || specs.length === 0) return descriptor;
  refuseNamesFromTwoModules(specs, module);
  const { codecTypes, queryOperationTypes } = types;
  return blindCast<Descriptor, 'only the module each type declaration names changes'>({
    ...descriptor,
    types: {
      ...types,
      ...ifDefined('codecTypes', codecTypes && restatedCodecTypes(codecTypes, module)),
      ...ifDefined(
        'queryOperationTypes',
        queryOperationTypes && { import: { ...queryOperationTypes.import, package: module } },
      ),
    },
  });
}
