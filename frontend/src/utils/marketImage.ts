const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const TARGET_BYTES = 500 * 1024;
const MAX_DIMENSION = 1280;
const MIN_DIMENSION = 360;
const QUALITY_STEPS = [0.88, 0.82, 0.76, 0.7, 0.64, 0.58];
const DIMENSION_SCALE_STEP = 0.86;
const MAX_DIMENSION_ATTEMPTS = 6;

export interface CompressedMarketImage {
  file: File;
  previewUrl: string;
  byteLength: number;
  mimeType: string;
  width: number;
  height: number;
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const src = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(src);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(src);
      reject(new Error('Failed to read image.'));
    };
    image.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Image compression failed.'));
        return;
      }
      resolve(blob);
    }, 'image/webp', quality);
  });
}

function clampDimension(width: number, height: number): { width: number; height: number } {
  const largest = Math.max(width, height);
  if (largest <= MAX_DIMENSION) {
    return { width, height };
  }
  const scale = MAX_DIMENSION / largest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function compressMarketImage(file: File): Promise<CompressedMarketImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please select an image file.');
  }

  if (file.size > 20 * 1024 * 1024) {
    throw new Error('Image is too large to process. Please choose a smaller file.');
  }

  const image = await loadImage(file);
  const initial = clampDimension(image.naturalWidth, image.naturalHeight);

  let width = initial.width;
  let height = initial.height;
  let bestBlob: Blob | null = null;

  for (let attempt = 0; attempt < MAX_DIMENSION_ATTEMPTS; attempt += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Unable to process image on this browser.');
    }

    context.drawImage(image, 0, 0, width, height);

    let attemptBest: Blob | null = null;
    for (const quality of QUALITY_STEPS) {
      const compressed = await canvasToBlob(canvas, quality);
      if (!attemptBest || compressed.size < attemptBest.size) {
        attemptBest = compressed;
      }

      if (compressed.size <= TARGET_BYTES) {
        break;
      }
    }

    if (attemptBest && (!bestBlob || attemptBest.size < bestBlob.size)) {
      bestBlob = attemptBest;
    }

    if (attemptBest && attemptBest.size <= MAX_UPLOAD_BYTES) {
      bestBlob = attemptBest;
      break;
    }

    const nextWidth = Math.max(MIN_DIMENSION, Math.round(width * DIMENSION_SCALE_STEP));
    const nextHeight = Math.max(MIN_DIMENSION, Math.round(height * DIMENSION_SCALE_STEP));
    if (nextWidth === width && nextHeight === height) {
      break;
    }

    width = nextWidth;
    height = nextHeight;
  }

  if (!bestBlob || bestBlob.size > MAX_UPLOAD_BYTES) {
    throw new Error('Unable to compress image below 2MB. Try a simpler image.');
  }

  const output = new File([bestBlob], `market-media-${Date.now()}.webp`, { type: 'image/webp' });
  const previewUrl = URL.createObjectURL(output);

  return {
    file: output,
    previewUrl,
    byteLength: output.size,
    mimeType: output.type,
    width,
    height,
  };
}
