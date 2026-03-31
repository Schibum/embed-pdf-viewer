<script setup lang="ts">
import { useRegisterRenderers } from '@embedpdf/plugin-annotation/vue';
import { stampPreviewRenderers } from './stamp-preview-renderers';

useRegisterRenderers(stampPreviewRenderers);
</script>

<template>
  <slot />
</template>
