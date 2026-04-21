---
'@embedpdf/models': patch
---

Add `PdfAnnotationFlags.LOCKED_CONTENTS` (`1 << 9`) and map it to the `'lockedContents'` `PdfAnnotationFlagName`, extending flag parsing helpers (`flagsToNames`, `namesToFlags`) accordingly.
