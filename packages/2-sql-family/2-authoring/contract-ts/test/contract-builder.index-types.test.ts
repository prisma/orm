import type { ExtensionPackRef, TargetPackRef } from '@internal/framework-components/components';
import type { IndexTypeRegistration } from '@internal/sql-contract/index-types';
import { describe, expectTypeOf, it } from 'vitest';
import type {
  ExtractIndexTypesFromPack,
  IndexTypesFromDefinition,
  MergeExtensionIndexTypes,
} from '../src/contract-types';

type DemoIndexTypes = {
  readonly demo: { readonly options: { readonly fillfactor: number } };
};

type AnalyticsIndexTypes = {
  readonly analytics: { readonly options: { readonly bucket: string } };
};

type DemoPack = ExtensionPackRef<'sql', 'postgres'> & {
  readonly indexTypes: IndexTypeRegistration<DemoIndexTypes>;
};

type AnalyticsPack = ExtensionPackRef<'sql', 'postgres'> & {
  readonly indexTypes: IndexTypeRegistration<AnalyticsIndexTypes>;
};

describe('index-type pack threading', () => {
  it("ExtractIndexTypesFromPack pulls the registration's IndexTypes off a pack", () => {
    expectTypeOf<ExtractIndexTypesFromPack<DemoPack>>().toEqualTypeOf<DemoIndexTypes>();
  });

  it('ExtractIndexTypesFromPack returns an empty record for packs without indexTypes', () => {
    type PlainPack = ExtensionPackRef<'sql', 'postgres'>;
    expectTypeOf<ExtractIndexTypesFromPack<PlainPack>>().toEqualTypeOf<Record<never, never>>();
  });

  it('MergeExtensionIndexTypes intersects across multiple packs', () => {
    type ExtractedDemo = ExtractIndexTypesFromPack<DemoPack>;
    type ExtractedAnalytics = ExtractIndexTypesFromPack<AnalyticsPack>;
    expectTypeOf<ExtractedDemo>().toEqualTypeOf<DemoIndexTypes>();
    expectTypeOf<ExtractedAnalytics>().toEqualTypeOf<AnalyticsIndexTypes>();
    type Merged = MergeExtensionIndexTypes<{
      demo: DemoPack;
      analytics: AnalyticsPack;
    }>;
    type DemoOptions = Merged['demo']['options'];
    type AnalyticsOptions = Merged['analytics']['options'];
    expectTypeOf<DemoOptions>().toEqualTypeOf<{ readonly fillfactor: number }>();
    expectTypeOf<AnalyticsOptions>().toEqualTypeOf<{ readonly bucket: string }>();
  });

  it('IndexTypesFromDefinition merges target + extension packs', () => {
    type Definition = {
      readonly target: TargetPackRef<'sql', 'postgres'>;
      readonly extensions: { readonly demo: DemoPack; readonly analytics: AnalyticsPack };
    };
    type Resolved = IndexTypesFromDefinition<Definition>;
    type DemoOptions = Resolved['demo']['options'];
    type AnalyticsOptions = Resolved['analytics']['options'];
    expectTypeOf<DemoOptions>().toEqualTypeOf<{ readonly fillfactor: number }>();
    expectTypeOf<AnalyticsOptions>().toEqualTypeOf<{ readonly bucket: string }>();
  });

  it('IndexTypesFromDefinition is an empty record when no packs contribute', () => {
    type Definition = { readonly target: TargetPackRef<'sql', 'postgres'> };
    type Resolved = IndexTypesFromDefinition<Definition>;
    expectTypeOf<Resolved>().toEqualTypeOf<Record<never, never>>();
  });
});
