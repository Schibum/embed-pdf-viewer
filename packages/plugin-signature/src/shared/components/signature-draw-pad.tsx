import { useEffect, useRef, useState, useCallback, Fragment } from '@framework';
import {
  SignatureDrawPadProps,
  SignatureFieldDefinition,
  SignatureCreationType,
} from '@embedpdf/plugin-signature';

export function SignatureDrawPad({
  onResult,
  strokeColor = '#000000',
  strokeWidth = 2,
  width = 400,
  height = 200,
  className,
}: SignatureDrawPadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Array<{ points: Array<{ x: number; y: number }> }>>([]);
  const isDrawingRef = useRef(false);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  const getCanvasPos = useCallback(
    (e: PointerEvent): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (canvas.width / dpr / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / dpr / rect.height),
      };
    },
    [dpr],
  );

  const redraw = useCallback(
    (currentStrokes: Array<{ points: Array<{ x: number; y: number }> }>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (const stroke of currentStrokes) {
        if (stroke.points.length === 0) continue;
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        ctx.stroke();
      }
      ctx.restore();
    },
    [dpr, strokeColor, strokeWidth],
  );

  const emitResult = useCallback(
    (currentStrokes: Array<{ points: Array<{ x: number; y: number }> }>) => {
      if (currentStrokes.length === 0 || currentStrokes.every((s) => s.points.length < 2)) {
        onResult(null);
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas) return;

      const result: SignatureFieldDefinition = {
        creationType: SignatureCreationType.Draw,
        inkData: {
          inkList: currentStrokes.filter((s) => s.points.length >= 2),
          strokeWidth,
          strokeColor,
          size: { width, height },
        },
        previewDataUrl: canvas.toDataURL('image/png'),
      };

      onResult(result);
    },
    [onResult, strokeWidth, strokeColor, width, height],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    redraw(strokes);
  }, [width, height, dpr]);

  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      isDrawingRef.current = true;
      const pos = getCanvasPos(e);
      const newStrokes = [...strokes, { points: [pos] }];
      setStrokes(newStrokes);
      redraw(newStrokes);
      (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
    },
    [strokes, getCanvasPos, redraw],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!isDrawingRef.current) return;
      const pos = getCanvasPos(e);
      const newStrokes = [...strokes];
      const last = newStrokes[newStrokes.length - 1];
      if (last) {
        last.points.push(pos);
        setStrokes(newStrokes);
        redraw(newStrokes);
      }
    },
    [strokes, getCanvasPos, redraw],
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      isDrawingRef.current = false;
      (e.target as HTMLElement)?.releasePointerCapture?.(e.pointerId);
      emitResult(strokes);
    },
    [strokes, emitResult],
  );

  const handleClear = useCallback(() => {
    setStrokes([]);
    redraw([]);
    onResult(null);
  }, [redraw, onResult]);

  return (
    <Fragment>
      <canvas
        ref={canvasRef}
        className={className}
        style={{
          touchAction: 'none',
          border: '1px solid #ccc',
          borderRadius: '4px',
          cursor: 'crosshair',
          width: `${width}px`,
          height: `${height}px`,
        }}
        onPointerDown={handlePointerDown as any}
        onPointerMove={handlePointerMove as any}
        onPointerUp={handlePointerUp as any}
      />
      <button
        type="button"
        onClick={handleClear}
        style={{ marginTop: '8px', fontSize: '12px', cursor: 'pointer' }}
      >
        Clear
      </button>
    </Fragment>
  );
}
