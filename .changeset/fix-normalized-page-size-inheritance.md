---
'@embedpdf/pdfium': patch
---

Fix `EPDF_GetPageSizeByIndexNormalized` returning incorrect dimensions for PDFs with inherited MediaBox/CropBox.

The function read `/MediaBox` and `/CropBox` directly from the page dictionary via `dict->GetRectFor()`, which does not resolve PDF page tree attribute inheritance. Pages that inherit these attributes from a parent `/Pages` node would silently fall back to the default 612x792 (US Letter) size.

Replaced the direct dictionary lookups with a `GetInheritedRect` helper that walks the `/Parent` chain, mirroring the inheritance logic used by `CPDF_Page::GetPageAttr`. The function remains lightweight (no `CPDF_Page` construction) while correctly resolving inherited attributes.
