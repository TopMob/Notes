/**
 * Архитектурный модуль сжатия изображений:
 * 1. Локальное хранилище (IndexedDB) работает ТОЛЬКО с оригинальными бинарными Blob без потерь качества.
 * 2. Сжатие происходит ПЕРЕД отправкой в сеть (облачная синхронизация / экспорт).
 * 3. Используется формат WebP (качество 0.8) с пропорциональным масштабированием сверхбольших фото (>2560px).
 *    Визуально качество неотличимо от оригинала человеческим глазом, но размер уменьшается на 70-90%.
 * 4. Ни в коем случае НЕ используется base64! Результат — бинарный Blob / ArrayBuffer / FormData.
 */

export interface CompressedImageResult {
  blob: Blob;
  mimeType: string;
  originalSize: number;
  compressedSize: number;
  reductionPercent: number;
  width: number;
  height: number;
}

export interface CompressOptions {
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
}

/**
 * Сжимает переданный бинарный Blob изображения в формат WebP перед отправкой.
 * Возвращает сжатый бинарный Blob (не base64!).
 */
export async function compressImageForUpload(
  blob: Blob,
  options: CompressOptions = {}
): Promise<CompressedImageResult> {
  const { quality = 0.8, maxWidth = 2560, maxHeight = 2560 } = options;
  const originalSize = blob.size;

  // Если это векторное SVG или крошечное изображение (< 25 КБ), оставляем без изменений
  if (blob.type === 'image/svg+xml' || originalSize < 25 * 1024) {
    return {
      blob,
      mimeType: blob.type || 'image/png',
      originalSize,
      compressedSize: originalSize,
      reductionPercent: 0,
      width: 0,
      height: 0,
    };
  }

  try {
    let bitmap: ImageBitmap | HTMLImageElement;
    let width = 0;
    let height = 0;

    if (typeof createImageBitmap !== 'undefined') {
      bitmap = await createImageBitmap(blob);
      width = bitmap.width;
      height = bitmap.height;
    } else {
      // Fallback через HTMLImageElement
      const img = new Image();
      const objectUrl = URL.createObjectURL(blob);
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = objectUrl;
      });
      URL.revokeObjectURL(objectUrl);
      bitmap = img;
      width = img.naturalWidth;
      height = img.naturalHeight;
    }

    // Пропорциональное уменьшение экстремально больших изображений
    if (width > maxWidth || height > maxHeight) {
      const ratio = Math.min(maxWidth / width, maxHeight / height);
      width = Math.max(1, Math.round(width * ratio));
      height = Math.max(1, Math.round(height * ratio));
    }

    let compressedBlob: Blob | null = null;

    // 1. Попытка через OffscreenCanvas (работает без лишних манипуляций в DOM)
    if (typeof OffscreenCanvas !== 'undefined') {
      try {
        const offscreen = new OffscreenCanvas(width, height);
        const ctx = offscreen.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(bitmap, 0, 0, width, height);
          compressedBlob = await offscreen.convertToBlob({
            type: 'image/webp',
            quality,
          });
        }
      } catch {
        // fallback to standard canvas
      }
    }

    // 2. Fallback через HTMLCanvasElement
    if (!compressedBlob && typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, width, height);
        compressedBlob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, 'image/webp', quality);
        });
      }
    }

    if ('close' in bitmap && typeof (bitmap as any).close === 'function') {
      (bitmap as ImageBitmap).close();
    }

    // Если сжатый Blob получен и он легче оригинала
    if (compressedBlob && compressedBlob.size < originalSize) {
      const reductionPercent = Math.round(
        ((originalSize - compressedBlob.size) / originalSize) * 100
      );
      return {
        blob: compressedBlob,
        mimeType: 'image/webp',
        originalSize,
        compressedSize: compressedBlob.size,
        reductionPercent,
        width,
        height,
      };
    }
  } catch (err) {
    console.warn('[ImageCompression] Compression error, using original blob:', err);
  }

  return {
    blob,
    mimeType: blob.type || 'image/png',
    originalSize,
    compressedSize: originalSize,
    reductionPercent: 0,
    width: 0,
    height: 0,
  };
}

/**
 * Создаёт бинарный multipart/form-data payload для отправки в сеть без base64.
 */
export function createBinaryUploadFormData(
  assetId: string,
  compressed: CompressedImageResult
): FormData {
  const formData = new FormData();
  formData.append('id', assetId);
  formData.append('file', compressed.blob, `${assetId}.webp`);
  formData.append('mimeType', compressed.mimeType);
  formData.append('originalSize', String(compressed.originalSize));
  formData.append('compressedSize', String(compressed.compressedSize));
  return formData;
}
