import { useCapability, usePlugin } from '@embedpdf/core/vue';
import { StampPlugin, ResolvedStamp } from '@embedpdf/plugin-stamp';
import { ref, watch } from 'vue';

export const useStampPlugin = () => usePlugin<StampPlugin>(StampPlugin.id);
export const useStampCapability = () => useCapability<StampPlugin>(StampPlugin.id);

export const useStampsByCategory = (category: string) => {
  const { provides } = useStampCapability();
  const stamps = ref<ResolvedStamp[]>([]);

  watch(
    () => provides.value,
    (capability) => {
      if (!capability) {
        stamps.value = [];
        return;
      }

      stamps.value = capability.getStampsByCategory(category);
      const unsubscribe = capability.onLibraryChange(() => {
        stamps.value = capability.getStampsByCategory(category);
      });

      return unsubscribe;
    },
    { immediate: true },
  );

  return stamps;
};
