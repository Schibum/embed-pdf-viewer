---
'@embedpdf/plugin-annotation': minor
---

Add symmetric annotation import/export API using a unified `AnnotationTransferItem` type. `exportAnnotations()` produces the same format that `importAnnotations()` consumes — zero remapping needed for round-tripping. Stamp appearances are automatically exported as PDF buffers in `ctx.data`. On import, stamps can be created from PNG, JPEG, or PDF buffers via `ctx: { data: ArrayBuffer }` — the engine auto-detects the format from magic bytes. Also adds `deleteAllAnnotations()` convenience method.
