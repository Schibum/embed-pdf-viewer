/**
 * Cloudy border path generator for PDF annotations.
 *
 * Framework-agnostic utility that generates SVG path `d` strings for cloudy
 * (scalloped) borders on Rectangle, Ellipse, and Polygon shapes.
 *
 * Ported from Apache PDFBox's CloudyBorder.java implementation.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ANGLE_180 = Math.PI;
const ANGLE_90 = Math.PI / 2;
const ANGLE_34 = (34 * Math.PI) / 180;
const ANGLE_30 = (30 * Math.PI) / 180;
const ANGLE_12 = (12 * Math.PI) / 180;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Point {
  x: number;
  y: number;
}

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Rect differences (inset from annotation Rect to drawn shape). */
export interface RectDifferences {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CloudyPathResult {
  /** SVG path `d` attribute string */
  path: string;
  /** Bounding box of the generated cloudy border (in annotation-local coords) */
  bbox: BBox;
}

// ---------------------------------------------------------------------------
// SVG path builder
// ---------------------------------------------------------------------------

class PathBuilder {
  private parts: string[] = [];
  private bbox: BBox = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  private started = false;

  moveTo(x: number, y: number): void {
    const sy = -y;
    this.updateBBox(x, sy);
    this.parts.push(`M ${r(x)} ${r(sy)}`);
    this.started = true;
  }

  curveTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
    const sy1 = -y1;
    const sy2 = -y2;
    const sy3 = -y3;
    this.updateBBox(x1, sy1);
    this.updateBBox(x2, sy2);
    this.updateBBox(x3, sy3);
    this.parts.push(`C ${r(x1)} ${r(sy1)}, ${r(x2)} ${r(sy2)}, ${r(x3)} ${r(sy3)}`);
  }

  close(): void {
    if (this.started) {
      this.parts.push('Z');
    }
  }

  build(lineWidth: number): CloudyPathResult {
    const d = lineWidth > 0 ? lineWidth / 2 : 0;
    return {
      path: this.parts.join(' '),
      bbox: {
        minX: this.bbox.minX - d,
        minY: this.bbox.minY - d,
        maxX: this.bbox.maxX + d,
        maxY: this.bbox.maxY + d,
      },
    };
  }

  private updateBBox(x: number, y: number): void {
    if (x < this.bbox.minX) this.bbox.minX = x;
    if (y < this.bbox.minY) this.bbox.minY = y;
    if (x > this.bbox.maxX) this.bbox.maxX = x;
    if (y > this.bbox.maxY) this.bbox.maxY = y;
  }
}

function r(n: number): string {
  return Number(n.toFixed(4)).toString();
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function distance(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function cosine(dx: number, hypot: number): number {
  return hypot === 0 ? 0 : dx / hypot;
}

function sine(dy: number, hypot: number): number {
  return hypot === 0 ? 0 : dy / hypot;
}

/**
 * Returns the signed area of a polygon (shoelace formula).
 * Positive = counter-clockwise, negative = clockwise.
 */
function polygonDirection(pts: Point[]): number {
  let a = 0;
  const len = pts.length;
  for (let i = 0; i < len; i++) {
    const j = (i + 1) % len;
    a += pts[i].x * pts[j].y - pts[i].y * pts[j].x;
  }
  return a;
}

function ensurePositiveWinding(pts: Point[]): void {
  if (polygonDirection(pts) < 0) {
    pts.reverse();
  }
}

function removeZeroLengthSegments(polygon: Point[]): Point[] {
  if (polygon.length <= 2) return polygon;
  const tolerance = 0.5;
  const result: Point[] = [polygon[0]];
  for (let i = 1; i < polygon.length; i++) {
    const prev = result[result.length - 1];
    const cur = polygon[i];
    if (Math.abs(cur.x - prev.x) >= tolerance || Math.abs(cur.y - prev.y) >= tolerance) {
      result.push(cur);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Arc segment generation (Bézier approximation of elliptical arc)
// ---------------------------------------------------------------------------

function arcSegment(
  startAng: number,
  endAng: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  out: PathBuilder,
  addMoveTo: boolean,
): void {
  const cosA = Math.cos(startAng);
  const sinA = Math.sin(startAng);
  const cosB = Math.cos(endAng);
  const sinB = Math.sin(endAng);
  const denom = Math.sin((endAng - startAng) / 2);

  if (denom === 0) {
    if (addMoveTo) {
      out.moveTo(cx + rx * cosA, cy + ry * sinA);
    }
    return;
  }

  const bcp = ((4 / 3) * (1 - Math.cos((endAng - startAng) / 2))) / denom;
  const p1x = cx + rx * (cosA - bcp * sinA);
  const p1y = cy + ry * (sinA + bcp * cosA);
  const p2x = cx + rx * (cosB + bcp * sinB);
  const p2y = cy + ry * (sinB - bcp * cosB);
  const p3x = cx + rx * cosB;
  const p3y = cy + ry * sinB;

  if (addMoveTo) {
    out.moveTo(cx + rx * cosA, cy + ry * sinA);
  }

  out.curveTo(p1x, p1y, p2x, p2y, p3x, p3y);
}

function arcSegmentToArray(
  startAng: number,
  endAng: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): Point[] {
  const cosA = Math.cos(startAng);
  const sinA = Math.sin(startAng);
  const cosB = Math.cos(endAng);
  const sinB = Math.sin(endAng);
  const denom = Math.sin((endAng - startAng) / 2);

  if (denom === 0) return [];

  const bcp = ((4 / 3) * (1 - Math.cos((endAng - startAng) / 2))) / denom;
  return [
    { x: cx + rx * (cosA - bcp * sinA), y: cy + ry * (sinA + bcp * cosA) },
    { x: cx + rx * (cosB + bcp * sinB), y: cy + ry * (sinB - bcp * cosB) },
    { x: cx + rx * cosB, y: cy + ry * sinB },
  ];
}

function getArc(
  startAng: number,
  endAng: number,
  rx: number,
  ry: number,
  cx: number,
  cy: number,
  out: PathBuilder,
  addMoveTo: boolean,
): void {
  const angleIncr = ANGLE_90;
  let angleTodo = endAng - startAng;
  while (angleTodo < 0) angleTodo += 2 * Math.PI;
  const sweep = angleTodo;
  let angleDone = 0;

  if (addMoveTo) {
    out.moveTo(cx + rx * Math.cos(startAng), cy + ry * Math.sin(startAng));
  }

  while (angleTodo > angleIncr) {
    arcSegment(startAng + angleDone, startAng + angleDone + angleIncr, cx, cy, rx, ry, out, false);
    angleDone += angleIncr;
    angleTodo -= angleIncr;
  }

  if (angleTodo > 0) {
    arcSegment(startAng + angleDone, startAng + sweep, cx, cy, rx, ry, out, false);
  }
}

// ---------------------------------------------------------------------------
// Curl generation
// ---------------------------------------------------------------------------

function addCornerCurl(
  anglePrev: number,
  angleCur: number,
  radius: number,
  cx: number,
  cy: number,
  alpha: number,
  alphaPrev: number,
  out: PathBuilder,
  addMoveTo: boolean,
): void {
  let a = anglePrev + ANGLE_180 + alphaPrev;
  const b = anglePrev + ANGLE_180 + alphaPrev - (22 * Math.PI) / 180;
  arcSegment(a, b, cx, cy, radius, radius, out, addMoveTo);

  a = b;
  const bEnd = angleCur - alpha;
  getArc(a, bEnd, radius, radius, cx, cy, out, false);
}

function addFirstIntermediateCurl(
  angleCur: number,
  r: number,
  alpha: number,
  cx: number,
  cy: number,
  out: PathBuilder,
): void {
  const a = angleCur + ANGLE_180;
  arcSegment(a + alpha, a + alpha - ANGLE_30, cx, cy, r, r, out, false);
  arcSegment(a + alpha - ANGLE_30, a + ANGLE_90, cx, cy, r, r, out, false);
  arcSegment(a + ANGLE_90, a + ANGLE_180 - ANGLE_34, cx, cy, r, r, out, false);
}

function getIntermediateCurlTemplate(angleCur: number, r: number): Point[] {
  const pts: Point[] = [];
  const a = angleCur + ANGLE_180;

  pts.push(...arcSegmentToArray(a + ANGLE_34, a + ANGLE_12, 0, 0, r, r));
  pts.push(...arcSegmentToArray(a + ANGLE_12, a + ANGLE_90, 0, 0, r, r));
  pts.push(...arcSegmentToArray(a + ANGLE_90, a + ANGLE_180 - ANGLE_34, 0, 0, r, r));

  return pts;
}

function outputCurlTemplate(template: Point[], x: number, y: number, out: PathBuilder): void {
  for (let i = 0; i + 2 < template.length; i += 3) {
    const a = template[i];
    const b = template[i + 1];
    const c = template[i + 2];
    out.curveTo(a.x + x, a.y + y, b.x + x, b.y + y, c.x + x, c.y + y);
  }
}

// ---------------------------------------------------------------------------
// Core polygon algorithm
// ---------------------------------------------------------------------------

function computeParamsPolygon(
  advInterm: number,
  advCorner: number,
  k: number,
  r: number,
  length: number,
): { n: number; alpha: number; dx: number } {
  if (length === 0) return { n: -1, alpha: ANGLE_34, dx: 0 };

  const n = Math.ceil((length - 2 * advCorner) / advInterm);
  const e = length - (2 * advCorner + n * advInterm);
  const dx = e / 2;
  const arg = (k * r + dx) / r;
  const alpha = arg < -1 || arg > 1 ? 0 : Math.acos(arg);

  return { n, alpha, dx };
}

function cloudyPolygonImpl(
  vertices: Point[],
  isEllipse: boolean,
  intensity: number,
  lineWidth: number,
  out: PathBuilder,
): void {
  let polygon = removeZeroLengthSegments(vertices);
  ensurePositiveWinding(polygon);
  const numPoints = polygon.length;

  if (numPoints < 2) return;

  if (intensity <= 0) {
    out.moveTo(polygon[0].x, polygon[0].y);
    for (let i = 1; i < numPoints; i++) {
      out.curveTo(
        polygon[i].x,
        polygon[i].y,
        polygon[i].x,
        polygon[i].y,
        polygon[i].x,
        polygon[i].y,
      );
    }
    return;
  }

  let cloudRadius = isEllipse
    ? getEllipseCloudRadius(intensity, lineWidth)
    : getPolygonCloudRadius(intensity, lineWidth);

  if (cloudRadius < 0.5) cloudRadius = 0.5;

  const k = Math.cos(ANGLE_34);
  const advIntermDefault = 2 * k * cloudRadius;
  const advCornerDefault = k * cloudRadius;

  let anglePrev = 0;

  // Find adjusted angle for first corner curl
  const lastPt = polygon[numPoints - 2];
  const firstPt = polygon[0];
  const p0 = computeParamsPolygon(
    advIntermDefault,
    advCornerDefault,
    k,
    cloudRadius,
    distance(lastPt, firstPt),
  );
  let alphaPrev = p0.n === 0 ? p0.alpha : ANGLE_34;

  let outputStarted = false;

  for (let j = 0; j + 1 < numPoints; j++) {
    const pt = polygon[j];
    const ptNext = polygon[j + 1];
    const len = distance(pt, ptNext);
    if (len === 0) {
      alphaPrev = ANGLE_34;
      continue;
    }

    const params = computeParamsPolygon(advIntermDefault, advCornerDefault, k, cloudRadius, len);
    if (params.n < 0) {
      if (!outputStarted) {
        out.moveTo(pt.x, pt.y);
        outputStarted = true;
      }
      continue;
    }

    const alpha = params.alpha;
    const dx = params.dx;

    let angleCur = Math.atan2(ptNext.y - pt.y, ptNext.x - pt.x);
    if (j === 0) {
      const ptPrev = polygon[numPoints - 2];
      anglePrev = Math.atan2(pt.y - ptPrev.y, pt.x - ptPrev.x);
    }

    const cos = cosine(ptNext.x - pt.x, len);
    const sin = sine(ptNext.y - pt.y, len);
    let x = pt.x;
    let y = pt.y;

    addCornerCurl(
      anglePrev,
      angleCur,
      cloudRadius,
      pt.x,
      pt.y,
      alpha,
      alphaPrev,
      out,
      !outputStarted,
    );
    outputStarted = true;

    const adv = 2 * k * cloudRadius + 2 * dx;
    x += adv * cos;
    y += adv * sin;

    let numInterm = params.n;
    if (params.n >= 1) {
      addFirstIntermediateCurl(angleCur, cloudRadius, alpha, x, y, out);
      x += advIntermDefault * cos;
      y += advIntermDefault * sin;
      numInterm = params.n - 1;
    }

    const template = getIntermediateCurlTemplate(angleCur, cloudRadius);
    for (let i = 0; i < numInterm; i++) {
      outputCurlTemplate(template, x, y, out);
      x += advIntermDefault * cos;
      y += advIntermDefault * sin;
    }

    anglePrev = angleCur;
    alphaPrev = params.n === 0 ? alpha : ANGLE_34;
  }
}

// ---------------------------------------------------------------------------
// Ellipse flattening
// ---------------------------------------------------------------------------

function flattenEllipse(left: number, bottom: number, right: number, top: number): Point[] {
  const cx = (left + right) / 2;
  const cy = (bottom + top) / 2;
  const rx = (right - left) / 2;
  const ry = (top - bottom) / 2;

  if (rx <= 0 || ry <= 0) return [];

  const numSegments = Math.max(32, Math.ceil(Math.max(rx, ry) * 2));
  const points: Point[] = [];

  for (let i = 0; i <= numSegments; i++) {
    const angle = (2 * Math.PI * i) / numSegments;
    points.push({
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
    });
  }

  return points;
}

// ---------------------------------------------------------------------------
// Cloud radius formulas (deduced from Acrobat Reader by PDFBox)
// ---------------------------------------------------------------------------

function getEllipseCloudRadius(intensity: number, lineWidth: number): number {
  return 4.75 * intensity + 0.5 * lineWidth;
}

function getPolygonCloudRadius(intensity: number, lineWidth: number): number {
  return 4 * intensity + 0.5 * lineWidth;
}

// ---------------------------------------------------------------------------
// Cloudy ellipse
// ---------------------------------------------------------------------------

function cloudyEllipseImpl(
  left: number,
  bottom: number,
  right: number,
  top: number,
  intensity: number,
  lineWidth: number,
  out: PathBuilder,
): void {
  if (intensity <= 0) {
    const rx = Math.abs(right - left) / 2;
    const ry = Math.abs(top - bottom) / 2;
    const cx = (left + right) / 2;
    const cy = (bottom + top) / 2;
    getArc(0, 2 * Math.PI, rx, ry, cx, cy, out, true);
    return;
  }

  const width = right - left;
  const height = top - bottom;
  let cloudRadius = getEllipseCloudRadius(intensity, lineWidth);

  const threshold1 = 0.5 * cloudRadius;
  if (width < threshold1 && height < threshold1) {
    const rx = Math.abs(right - left) / 2;
    const ry = Math.abs(top - bottom) / 2;
    const cx = (left + right) / 2;
    const cy = (bottom + top) / 2;
    getArc(0, 2 * Math.PI, rx, ry, cx, cy, out, true);
    return;
  }

  const threshold2 = 5;
  if ((width < threshold2 && height > 20) || (width > 20 && height < threshold2)) {
    cloudyPolygonImpl(
      [
        { x: left, y: bottom },
        { x: right, y: bottom },
        { x: right, y: top },
        { x: left, y: top },
        { x: left, y: bottom },
      ],
      true,
      intensity,
      lineWidth,
      out,
    );
    return;
  }

  // Shrink ellipse so cloud tails touch the original outline
  const radiusAdj = Math.sin(ANGLE_12) * cloudRadius - 1.5;
  let adjLeft = left;
  let adjRight = right;
  let adjBottom = bottom;
  let adjTop = top;

  if (width > 2 * radiusAdj) {
    adjLeft += radiusAdj;
    adjRight -= radiusAdj;
  } else {
    const mid = (left + right) / 2;
    adjLeft = mid - 0.1;
    adjRight = mid + 0.1;
  }

  if (height > 2 * radiusAdj) {
    adjBottom += radiusAdj;
    adjTop -= radiusAdj;
  } else {
    const mid = (top + bottom) / 2;
    adjTop = mid + 0.1;
    adjBottom = mid - 0.1;
  }

  const flatPolygon = flattenEllipse(adjLeft, adjBottom, adjRight, adjTop);
  const numFlatPts = flatPolygon.length;
  if (numFlatPts < 2) return;

  let totLen = 0;
  for (let i = 1; i < numFlatPts; i++) {
    totLen += distance(flatPolygon[i - 1], flatPolygon[i]);
  }

  const k = Math.cos(ANGLE_34);
  let curlAdvance = 2 * k * cloudRadius;
  let n = Math.ceil(totLen / curlAdvance);
  if (n < 2) {
    const rx = Math.abs(right - left) / 2;
    const ry = Math.abs(top - bottom) / 2;
    const cx = (left + right) / 2;
    const cy = (bottom + top) / 2;
    getArc(0, 2 * Math.PI, rx, ry, cx, cy, out, true);
    return;
  }

  curlAdvance = totLen / n;
  cloudRadius = curlAdvance / (2 * k);

  if (cloudRadius < 0.5) {
    cloudRadius = 0.5;
    curlAdvance = 2 * k * cloudRadius;
  } else if (cloudRadius < 3.0) {
    const rx = Math.abs(right - left) / 2;
    const ry = Math.abs(top - bottom) / 2;
    const cx = (left + right) / 2;
    const cy = (bottom + top) / 2;
    getArc(0, 2 * Math.PI, rx, ry, cx, cy, out, true);
    return;
  }

  // Construct center points along the flattened perimeter
  const centerPoints: Point[] = [];
  let lengthRemain = 0;
  const comparisonToler = lineWidth * 0.1;

  for (let i = 0; i + 1 < numFlatPts; i++) {
    const p1 = flatPolygon[i];
    const p2 = flatPolygon[i + 1];
    const segDx = p2.x - p1.x;
    const segDy = p2.y - p1.y;
    const segLen = distance(p1, p2);
    if (segLen === 0) continue;

    let lengthTodo = segLen + lengthRemain;
    if (lengthTodo >= curlAdvance - comparisonToler || i === numFlatPts - 2) {
      const cos = cosine(segDx, segLen);
      const sin = sine(segDy, segLen);
      let d = curlAdvance - lengthRemain;
      while (lengthTodo >= curlAdvance - comparisonToler) {
        centerPoints.push({ x: p1.x + d * cos, y: p1.y + d * sin });
        lengthTodo -= curlAdvance;
        d += curlAdvance;
      }
      lengthRemain = Math.max(0, lengthTodo);
    } else {
      lengthRemain += segLen;
    }
  }

  // Place curls at each center point
  const cpLen = centerPoints.length;
  let epAnglePrev = 0;
  let epAlphaPrev = 0;

  for (let i = 0; i < cpLen; i++) {
    const idxNext = (i + 1) % cpLen;
    const pt = centerPoints[i];
    const ptNext = centerPoints[idxNext];

    if (i === 0) {
      const ptPrev = centerPoints[cpLen - 1];
      epAnglePrev = Math.atan2(pt.y - ptPrev.y, pt.x - ptPrev.x);
      epAlphaPrev = computeParamsEllipse(ptPrev, pt, cloudRadius, curlAdvance);
    }

    const angleCur = Math.atan2(ptNext.y - pt.y, ptNext.x - pt.x);
    const alpha = computeParamsEllipse(pt, ptNext, cloudRadius, curlAdvance);

    addCornerCurl(epAnglePrev, angleCur, cloudRadius, pt.x, pt.y, alpha, epAlphaPrev, out, i === 0);

    epAnglePrev = angleCur;
    epAlphaPrev = alpha;
  }
}

function computeParamsEllipse(pt: Point, ptNext: Point, r: number, curlAdv: number): number {
  const len = distance(pt, ptNext);
  if (len === 0) return ANGLE_34;
  const e = len - curlAdv;
  const arg = (curlAdv / 2 + e / 2) / r;
  return arg < -1 || arg > 1 ? 0 : Math.acos(arg);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates a cloudy border SVG path for a rectangle (Square annotation).
 *
 * @param rect - The annotation rect `{ x, y, width, height }` (top-left origin)
 * @param rd - Rectangle differences (inset), or undefined
 * @param intensity - Cloudy border intensity (typically 1 or 2)
 * @param lineWidth - Stroke width of the annotation border
 */
export function generateCloudyRectanglePath(
  rect: { x: number; y: number; width: number; height: number },
  rd: RectDifferences | undefined,
  intensity: number,
  lineWidth: number,
): CloudyPathResult {
  const out = new PathBuilder();

  let left = 0;
  let top = 0;
  let right = rect.width;
  let bottom = rect.height;

  if (rd) {
    left += rd.left;
    top += rd.top;
    right -= rd.right;
    bottom -= rd.bottom;
  } else {
    left += lineWidth / 2;
    top += lineWidth / 2;
    right -= lineWidth / 2;
    bottom -= lineWidth / 2;
  }

  const polygon: Point[] = [
    { x: left, y: -top },
    { x: right, y: -top },
    { x: right, y: -bottom },
    { x: left, y: -bottom },
    { x: left, y: -top },
  ];

  cloudyPolygonImpl(polygon, false, intensity, lineWidth, out);
  out.close();

  return out.build(lineWidth);
}

/**
 * Generates a cloudy border SVG path for an ellipse (Circle annotation).
 *
 * @param rect - The annotation rect `{ x, y, width, height }` (top-left origin)
 * @param rd - Rectangle differences (inset), or undefined
 * @param intensity - Cloudy border intensity (typically 1 or 2)
 * @param lineWidth - Stroke width of the annotation border
 */
export function generateCloudyEllipsePath(
  rect: { x: number; y: number; width: number; height: number },
  rd: RectDifferences | undefined,
  intensity: number,
  lineWidth: number,
): CloudyPathResult {
  const out = new PathBuilder();

  let left = 0;
  let top = 0;
  let right = rect.width;
  let bottom = rect.height;

  if (rd) {
    left += rd.left;
    top += rd.top;
    right -= rd.right;
    bottom -= rd.bottom;
  }

  cloudyEllipseImpl(left, -bottom, right, -top, intensity, lineWidth, out);
  out.close();

  return out.build(lineWidth);
}

/**
 * Generates a cloudy border SVG path for a polygon.
 *
 * @param vertices - The polygon vertices in annotation-local coordinates
 * @param rectOrigin - The annotation rect origin `{ x, y }` for coordinate translation
 * @param intensity - Cloudy border intensity (typically 1 or 2)
 * @param lineWidth - Stroke width of the annotation border
 */
export function generateCloudyPolygonPath(
  vertices: ReadonlyArray<{ x: number; y: number }>,
  rectOrigin: { x: number; y: number },
  intensity: number,
  lineWidth: number,
): CloudyPathResult {
  const out = new PathBuilder();

  if (vertices.length < 3) {
    return out.build(lineWidth);
  }

  const localPts: Point[] = vertices.map((v) => ({
    x: v.x - rectOrigin.x,
    y: -(v.y - rectOrigin.y),
  }));
  const first = localPts[0];
  const last = localPts[localPts.length - 1];
  if (first.x !== last.x || first.y !== last.y) {
    localPts.push({ x: first.x, y: first.y });
  }

  cloudyPolygonImpl(localPts, false, intensity, lineWidth, out);
  out.close();

  return out.build(lineWidth);
}
