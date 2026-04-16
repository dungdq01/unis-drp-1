import { SetMetadata } from '@nestjs/common';

export const FEATURE_FLAG_KEY = 'feature_flag';

/**
 * Decorator that marks a controller or route with the feature flag key it requires.
 * The FeatureFlagGuard reads this metadata via Reflector and checks whether the flag
 * is enabled via FeatureFlagService.
 *
 * Usage:
 *   @FeatureFlag('m00_master_data_enabled')
 *   @Controller('master-data')
 *   export class MasterDataController { ... }
 */
export const FeatureFlag = (flagName: string) =>
  SetMetadata(FEATURE_FLAG_KEY, flagName);
