import { useCapability, usePlugin } from '@embedpdf/core/svelte';
import { StampPlugin } from '@embedpdf/plugin-stamp';
import type { ResolvedStamp } from '@embedpdf/plugin-stamp';

export const useStampPlugin = () => usePlugin<StampPlugin>(StampPlugin.id);
export const useStampCapability = () => useCapability<StampPlugin>(StampPlugin.id);

export function useStampsByCategory(category: string) {
  const capability = useStampCapability();

  const state = $state({
    stamps: [] as ResolvedStamp[],
  });

  $effect(() => {
    if (!capability.provides) {
      state.stamps = [];
      return;
    }

    state.stamps = capability.provides.getStampsByCategory(category);
    return capability.provides.onLibraryChange(() => {
      state.stamps = capability.provides!.getStampsByCategory(category);
    });
  });

  return state;
}
