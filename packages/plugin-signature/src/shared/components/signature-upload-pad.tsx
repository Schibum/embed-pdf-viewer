import { useRef, useState, useCallback, Fragment } from '@framework';
import {
  SignatureUploadPadProps,
  SignatureFieldDefinition,
  SignatureCreationType,
} from '@embedpdf/plugin-signature';

export function SignatureUploadPad({
  onResult,
  accept = 'image/png,image/jpeg,image/svg+xml',
  width = 400,
  height = 200,
  className,
}: SignatureUploadPadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const processFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        const arrayBuffer = reader.result as ArrayBuffer;
        const blob = new Blob([arrayBuffer], { type: file.type });
        const dataUrl = URL.createObjectURL(blob);

        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(dataUrl);

        const img = new Image();
        img.onload = () => {
          const previewCanvas = document.createElement('canvas');
          previewCanvas.width = img.width;
          previewCanvas.height = img.height;
          const ctx = previewCanvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
          }

          const result: SignatureFieldDefinition & { imageData?: ArrayBuffer } = {
            creationType: SignatureCreationType.Upload,
            imageMimeType: file.type,
            imageSize: { width: img.width, height: img.height },
            previewDataUrl: previewCanvas.toDataURL('image/png'),
            imageData: arrayBuffer,
          };
          onResult(result);
        };
        img.src = dataUrl;
      };
      reader.readAsArrayBuffer(file);
    },
    [onResult, previewUrl],
  );

  const handleFileChange = useCallback(
    (e: Event) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files[0]) {
        processFile(files[0]);
      }
    },
    [processFile],
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const files = e.dataTransfer?.files;
      if (files && files[0]) {
        processFile(files[0]);
      }
    },
    [processFile],
  );

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleClick = useCallback(() => {
    inputRef.current?.click();
  }, []);

  return (
    <Fragment>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleFileChange as any}
        style={{ display: 'none' }}
      />
      <div
        className={className}
        onClick={handleClick}
        onDrop={handleDrop as any}
        onDragOver={handleDragOver as any}
        onDragLeave={handleDragLeave}
        style={{
          width: `${width}px`,
          height: `${height}px`,
          border: `2px dashed ${isDragging ? '#2563eb' : '#ccc'}`,
          borderRadius: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          backgroundColor: isDragging ? '#eff6ff' : 'transparent',
          transition: 'all 0.15s ease',
        }}
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }}
          />
        ) : (
          <span style={{ color: '#999', fontSize: '14px', textAlign: 'center', padding: '20px' }}>
            Click or drag an image here
          </span>
        )}
      </div>
    </Fragment>
  );
}
