<script lang="ts">
  import { onMount } from 'svelte';
  import { getRendererRegistry } from '@embedpdf/plugin-annotation/svelte';
  import { stampPreviewRenderers } from './stamp-preview-renderers';

  const registry = getRendererRegistry();

  onMount(() => {
    if (!registry) return;
    return registry.register(stampPreviewRenderers);
  });
</script>
