import { useCapability, usePlugin } from '@embedpdf/core/@framework';
import { StampPlugin, StampLibrary, ResolvedStamp } from '@embedpdf/plugin-stamp';
import { useState, useEffect } from '@framework';

export const useStampPlugin = () => usePlugin<StampPlugin>(StampPlugin.id);
export const useStampCapability = () => useCapability<StampPlugin>(StampPlugin.id);

export const useStampLibraries = () => {
  const { provides } = useStampCapability();
  const [libraries, setLibraries] = useState<StampLibrary[]>(provides?.getLibraries() ?? []);

  useEffect(() => {
    if (!provides) return;
    setLibraries(provides.getLibraries());
    return provides.onLibraryChange((libs) => {
      setLibraries(libs);
    });
  }, [provides]);

  return { libraries, provides };
};

export const useStampsByCategory = (category: string) => {
  const { provides } = useStampCapability();
  const [stamps, setStamps] = useState<ResolvedStamp[]>([]);

  useEffect(() => {
    if (!provides) return;
    setStamps(provides.getStampsByCategory(category));
    return provides.onLibraryChange(() => {
      setStamps(provides.getStampsByCategory(category));
    });
  }, [provides, category]);

  return stamps;
};
