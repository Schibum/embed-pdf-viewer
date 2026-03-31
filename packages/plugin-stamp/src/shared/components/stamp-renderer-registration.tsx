import { useRegisterRenderers } from '@embedpdf/plugin-annotation/@framework';
import { stampPreviewRenderers } from './stamp-preview-renderers';

export function StampRendererRegistration() {
  useRegisterRenderers(stampPreviewRenderers);
  return null;
}
