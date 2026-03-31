import { createPluginPackage } from '@embedpdf/core';
import { StampPluginPackage as BaseStampPackage } from '@embedpdf/plugin-stamp';
import StampRendererRegistration from './components/stamp-renderer-registration.vue';

export * from './hooks';
export * from './components';
export * from '@embedpdf/plugin-stamp';

export const StampPluginPackage = createPluginPackage(BaseStampPackage)
  .addUtility(StampRendererRegistration)
  .build();
