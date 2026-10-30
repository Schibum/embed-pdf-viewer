import { PdfSegmentObjectType } from "@embedpdf/models";
import { WrappedPdfiumModule } from "@embedpdf/pdfium";
import { MemoryManager } from "./core/memory-manager";

/**
 * Subpath-level erase support (line-wise eraser).
 *
 * PDFium cannot delete part of a path object, so erasing a subpath means:
 * soft-delete the original (`FPDFPageObj_SetIsActive(false)`) and insert a
 * replacement path object that replays only the kept subpaths with the same
 * graphics state. The helpers here read raw segments, group them into
 * subpaths (matching the index contract of `PdfPageObjectInfo.polylines`),
 * and build that replacement object.
 */

interface RawSegment {
  type: PdfSegmentObjectType;
  x: number;
  y: number;
  close: boolean;
}

/** Read a path object's raw segments (object space, beziers unflattened). */
function readRawSegments(pdf: WrappedPdfiumModule, mem: MemoryManager, pathPtr: number): RawSegment[] {
  const segCount = pdf.FPDFPath_CountSegments(pathPtr);
  const xPtr = mem.malloc(4);
  const yPtr = mem.malloc(4);
  const out: RawSegment[] = [];
  for (let i = 0; i < segCount; i++) {
    const segPtr = pdf.FPDFPath_GetPathSegment(pathPtr, i);
    if (!segPtr) continue;
    pdf.FPDFPathSegment_GetPoint(segPtr, xPtr, yPtr);
    out.push({
      type: pdf.FPDFPathSegment_GetType(segPtr) as PdfSegmentObjectType,
      x: pdf.pdfium.getValue(xPtr, "float"),
      y: pdf.pdfium.getValue(yPtr, "float"),
      close: !!pdf.FPDFPathSegment_GetClose(segPtr),
    });
  }
  mem.free(xPtr);
  mem.free(yPtr);
  return out;
}

/**
 * Group raw segments into subpaths. MUST mirror the split rule of the
 * engine's `readPathPolylines` (a new group before each MoveTo, empty
 * leading group dropped) so group index k matches
 * `PdfPageObjectInfo.polylines[k]`.
 */
function groupSubpaths(segments: RawSegment[]): RawSegment[][] {
  const groups: RawSegment[][] = [];
  let current: RawSegment[] = [];
  for (const seg of segments) {
    if (seg.type === PdfSegmentObjectType.MOVETO) {
      if (current.length > 0) groups.push(current);
      current = [seg];
    } else {
      current.push(seg);
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

type Matrix = [number, number, number, number, number, number];

/**
 * Page-space matrix of the object at `idPath`: the composition of every
 * ancestor form XObject's matrix with the leaf's own matrix. The replacement
 * is inserted at page level, so it needs this full matrix even when the
 * original lived inside a nested form.
 */
function readComposedMatrix(
  pdf: WrappedPdfiumModule,
  mem: MemoryManager,
  pagePtr: number,
  idPath: number[],
): Matrix | null {
  const mPtr = mem.malloc(24); // FS_MATRIX: six floats
  const readMatrix = (objPtr: number): Matrix =>
    pdf.FPDFPageObj_GetMatrix(objPtr, mPtr)
      ? [
          pdf.pdfium.getValue(mPtr, "float"),
          pdf.pdfium.getValue(mPtr + 4, "float"),
          pdf.pdfium.getValue(mPtr + 8, "float"),
          pdf.pdfium.getValue(mPtr + 12, "float"),
          pdf.pdfium.getValue(mPtr + 16, "float"),
          pdf.pdfium.getValue(mPtr + 20, "float"),
        ]
      : [1, 0, 0, 1, 0, 0];
  // compose(m1, m2): apply m2 first, then m1
  const compose = (m1: Matrix, m2: Matrix): Matrix => [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];

  let objPtr = pdf.FPDFPage_GetObject(pagePtr, idPath[0]);
  if (!objPtr) {
    mem.free(mPtr);
    return null;
  }
  let acc = readMatrix(objPtr);
  for (let i = 1; i < idPath.length; i++) {
    objPtr = pdf.FPDFFormObj_GetObject(objPtr, idPath[i]);
    if (!objPtr) {
      mem.free(mPtr);
      return null;
    }
    acc = compose(acc, readMatrix(objPtr));
  }
  mem.free(mPtr);
  return acc;
}

/** Copy the paint-relevant graphics state from `srcPtr` onto `dstPtr`. */
function copyPathGraphicsState(
  pdf: WrappedPdfiumModule,
  mem: MemoryManager,
  srcPtr: number,
  dstPtr: number,
): void {
  const a = mem.malloc(4);
  const b = mem.malloc(4);
  const c = mem.malloc(4);
  const d = mem.malloc(4);

  if (pdf.FPDFPath_GetDrawMode(srcPtr, a, b)) {
    pdf.FPDFPath_SetDrawMode(dstPtr, pdf.pdfium.getValue(a, "i32"), pdf.pdfium.getValue(b, "i32") !== 0);
  }
  if (pdf.FPDFPageObj_GetStrokeColor(srcPtr, a, b, c, d)) {
    pdf.FPDFPageObj_SetStrokeColor(
      dstPtr,
      pdf.pdfium.getValue(a, "i32"),
      pdf.pdfium.getValue(b, "i32"),
      pdf.pdfium.getValue(c, "i32"),
      pdf.pdfium.getValue(d, "i32"),
    );
  }
  if (pdf.FPDFPageObj_GetFillColor(srcPtr, a, b, c, d)) {
    pdf.FPDFPageObj_SetFillColor(
      dstPtr,
      pdf.pdfium.getValue(a, "i32"),
      pdf.pdfium.getValue(b, "i32"),
      pdf.pdfium.getValue(c, "i32"),
      pdf.pdfium.getValue(d, "i32"),
    );
  }
  if (pdf.FPDFPageObj_GetStrokeWidth(srcPtr, a)) {
    pdf.FPDFPageObj_SetStrokeWidth(dstPtr, pdf.pdfium.getValue(a, "float"));
  }
  const lineCap = pdf.FPDFPageObj_GetLineCap(srcPtr);
  if (lineCap >= 0) pdf.FPDFPageObj_SetLineCap(dstPtr, lineCap);
  const lineJoin = pdf.FPDFPageObj_GetLineJoin(srcPtr);
  if (lineJoin >= 0) pdf.FPDFPageObj_SetLineJoin(dstPtr, lineJoin);

  const dashCount = pdf.FPDFPageObj_GetDashCount(srcPtr);
  if (dashCount > 0) {
    const dashPtr = mem.malloc(4 * dashCount);
    let phase = 0;
    if (pdf.FPDFPageObj_GetDashPhase(srcPtr, a)) phase = pdf.pdfium.getValue(a, "float");
    if (pdf.FPDFPageObj_GetDashArray(srcPtr, dashPtr, dashCount)) {
      pdf.FPDFPageObj_SetDashArray(dstPtr, dashPtr, dashCount, phase);
    }
    mem.free(dashPtr);
  }

  mem.free(a);
  mem.free(b);
  mem.free(c);
  mem.free(d);
}

/** A page-space (bottom-up) translation for one subpath of a path object. */
export interface SubpathMovePage {
  pdx: number;
  pdy: number;
}

/**
 * Build a page-level replacement path object for `originalPtr` (located at
 * `idPath` on the page): drop the subpaths in `inactiveSubpaths`, translate the
 * subpaths in `subpathMovesPage` (a page-space delta per subpath index), and
 * keep the rest in place. With no inactive and no moved subpaths this is a faithful
 * copy. Returns the new object pointer (not yet inserted), or 0 when nothing is
 * left to keep / the original cannot be read.
 *
 * The caller owns the returned object and must either insert it into a page
 * (`FPDFPage_InsertObject`) or destroy it (`FPDFPageObj_Destroy`).
 */
export function buildSubpathReplacement(
  pdf: WrappedPdfiumModule,
  mem: MemoryManager,
  pagePtr: number,
  originalPtr: number,
  idPath: number[],
  inactiveSubpaths: ReadonlySet<number>,
  subpathMovesPage: ReadonlyMap<number, SubpathMovePage> = new Map(),
): number {
  const groups = groupSubpaths(readRawSegments(pdf, mem, originalPtr));
  // The replacement carries the original's composed page matrix, so segment
  // points stay in OBJECT space. A subpath move arrives in PAGE space, so
  // convert it through the inverse of the matrix's linear part: page = M·obj
  // (x_p = a·x_o + c·y_o + e), so Δobj = M_linear⁻¹·Δpage.
  const matrix = readComposedMatrix(pdf, mem, pagePtr, idPath);
  const toObjectDelta = (mv: SubpathMovePage): { ox: number; oy: number } => {
    if (!matrix) return { ox: mv.pdx, oy: mv.pdy };
    const [a, b, c, d] = matrix;
    const det = a * d - c * b;
    if (Math.abs(det) < 1e-9) return { ox: 0, oy: 0 };
    return { ox: (d * mv.pdx - c * mv.pdy) / det, oy: (-b * mv.pdx + a * mv.pdy) / det };
  };

  const kept: { group: RawSegment[]; ox: number; oy: number }[] = [];
  for (let k = 0; k < groups.length; k++) {
    if (inactiveSubpaths.has(k)) continue;
    const mv = subpathMovesPage.get(k);
    const off = mv ? toObjectDelta(mv) : { ox: 0, oy: 0 };
    kept.push({ group: groups[k], ox: off.ox, oy: off.oy });
  }
  if (kept.length === 0) return 0;

  // CreateNewPath performs the initial MoveTo to the first kept point.
  const f0 = kept[0];
  const newPtr = pdf.FPDFPageObj_CreateNewPath(f0.group[0].x + f0.ox, f0.group[0].y + f0.oy);
  if (!newPtr) return 0;

  for (let g = 0; g < kept.length; g++) {
    const { group, ox, oy } = kept[g];
    const bezier: RawSegment[] = [];
    for (let s = 0; s < group.length; s++) {
      const seg = group[s];
      if (s === 0) {
        // Subpath start (a MoveTo, or the stray first point of a path that
        // begins without one). The very first is consumed by CreateNewPath.
        if (g > 0) pdf.FPDFPath_MoveTo(newPtr, seg.x + ox, seg.y + oy);
      } else if (seg.type === PdfSegmentObjectType.BEZIERTO) {
        bezier.push(seg);
        if (bezier.length === 3) {
          pdf.FPDFPath_BezierTo(
            newPtr,
            bezier[0].x + ox,
            bezier[0].y + oy,
            bezier[1].x + ox,
            bezier[1].y + oy,
            bezier[2].x + ox,
            bezier[2].y + oy,
          );
          bezier.length = 0;
        }
      } else {
        pdf.FPDFPath_LineTo(newPtr, seg.x + ox, seg.y + oy);
        bezier.length = 0;
      }
      if (seg.close) pdf.FPDFPath_Close(newPtr);
    }
  }

  copyPathGraphicsState(pdf, mem, originalPtr, newPtr);

  if (matrix) {
    const mPtr = mem.malloc(24);
    for (let i = 0; i < 6; i++) pdf.pdfium.setValue(mPtr + i * 4, matrix[i], "float");
    pdf.FPDFPageObj_SetMatrix(newPtr, mPtr);
    mem.free(mPtr);
  }

  return newPtr;
}
