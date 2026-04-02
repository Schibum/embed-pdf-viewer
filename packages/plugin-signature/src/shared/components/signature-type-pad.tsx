import { useEffect, useRef, useState, useCallback, Fragment } from '@framework';
import {
  SignatureTypePadProps,
  SignatureFieldDefinition,
  SignatureCreationType,
} from '@embedpdf/plugin-signature';

const DEFAULT_FONTS = [
  { name: 'Dancing Script', family: "'Dancing Script', cursive" },
  { name: 'Great Vibes', family: "'Great Vibes', cursive" },
  { name: 'Alex Brush', family: "'Alex Brush', cursive" },
];

export function SignatureTypePad({
  onResult,
  fonts = DEFAULT_FONTS,
  defaultFont,
  fontSize = 48,
  color = '#000000',
  width = 400,
  height = 200,
  className,
}: SignatureTypePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [text, setText] = useState('');
  const [selectedFont, setSelectedFont] = useState(defaultFont ?? fonts[0]?.family ?? 'cursive');
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  const renderText = useCallback(
    (currentText: string, font: string) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (!currentText.trim()) {
        onResult(null);
        return;
      }

      ctx.scale(dpr, dpr);
      ctx.fillStyle = color;
      ctx.font = `${fontSize}px ${font}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(currentText, width / 2, height / 2, width - 20);

      canvas.toBlob((blob) => {
        if (!blob) return;
        blob.arrayBuffer().then((imageData) => {
          const result: SignatureFieldDefinition & { imageData?: ArrayBuffer } = {
            creationType: SignatureCreationType.Type,
            label: currentText,
            imageMimeType: 'image/png',
            imageSize: { width, height },
            previewDataUrl: canvas.toDataURL('image/png'),
            imageData,
          };
          onResult(result);
        });
      }, 'image/png');
    },
    [onResult, color, fontSize, width, height, dpr],
  );

  useEffect(() => {
    renderText(text, selectedFont);
  }, [text, selectedFont, renderText]);

  const handleTextChange = useCallback((e: Event) => {
    setText((e.target as HTMLInputElement).value);
  }, []);

  const handleFontChange = useCallback((e: Event) => {
    setSelectedFont((e.target as HTMLSelectElement).value);
  }, []);

  return (
    <Fragment>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
        <input
          type="text"
          value={text}
          onInput={handleTextChange as any}
          placeholder="Type your signature..."
          style={{
            flex: 1,
            padding: '6px 10px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            fontSize: '14px',
          }}
        />
        <select
          value={selectedFont}
          onChange={handleFontChange as any}
          style={{
            padding: '6px 10px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            fontSize: '14px',
          }}
        >
          {fonts.map((f) => (
            <option key={f.family} value={f.family}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
      <canvas
        ref={canvasRef}
        className={className}
        style={{
          border: '1px solid #ccc',
          borderRadius: '4px',
          width: `${width}px`,
          height: `${height}px`,
        }}
      />
    </Fragment>
  );
}
