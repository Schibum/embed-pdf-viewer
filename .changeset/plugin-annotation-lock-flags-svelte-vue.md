---
'@embedpdf/plugin-annotation': patch
---

Add PDF `LOCKED_CONTENTS` flag handling and granular lock helpers (`hasNoViewFlag`, `hasHiddenFlag`, `hasReadOnlyFlag`, `hasLockedContentsFlag`). Expose `isAnnotationInteractive`, `isAnnotationStructurallyLocked`, `isAnnotationContentLocked`, and `isAnnotationSelectable` on the plugin API. Update annotation rendering across React/Preact, Svelte, and Vue to skip `noView`/`hidden` annotations and gate interactions using the new predicates. Thread `structurallyLocked` and `contentLocked` through the selection menu context on all three stacks so custom menus can disable structural or content edits without re-reading flag arrays.
