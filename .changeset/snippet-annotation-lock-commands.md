---
'@embedpdf/snippet': patch
---

Align annotation fill-mode toolbar commands with plugin-configured default lock state via `getDefaultAnnotationLock`, and swap unlock vs form-only lock behavior so defaults match the intended modes. Re-export `LockModeType` from the snippet’s public `embedpdf` entry for consumers.
