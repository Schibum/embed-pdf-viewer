import { PluginManifest } from '@embedpdf/core';
import { StampPluginConfig } from './types';

export const STAMP_PLUGIN_ID = 'stamp';

export const manifest: PluginManifest<StampPluginConfig> = {
  id: STAMP_PLUGIN_ID,
  name: 'Stamp Plugin',
  version: '1.0.0',
  provides: ['stamp'],
  requires: ['annotation'],
  optional: [],
  defaultConfig: {},
};
