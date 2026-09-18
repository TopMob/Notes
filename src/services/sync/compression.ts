/**
 * АРХИТЕКТУРНЫЙ ИНВАРИАНТ (Local-First):
 * 1. Локальная база данных (IndexedDB, src/db/storage.ts) НИКОГДА не взаимодействует
 *    с компрессией (gzip / base64). Она работает исключительно с сырыми типизированными
 *    JS-объектами (structured clone), обеспечивая 60 FPS рендеринга и сохранение штрихов
 *    без накладных расходов.
 * 2. Gzip/base64-кодирование происходит ИСКЛЮЧИТЕЛЬНО на границе синхронизации с облаком
 *    (src/services/sync/tursoProvider.ts, src/services/sync/supabaseProvider.ts).
 * 3. Для предотвращения блокировки UI-потока при сжатии крупных страниц (сотни/тысячи штрихов)
 *    используется Web Worker (compression.worker.ts) с автоматическим fallback на
 *    основной поток.
 */

import type { Stroke, ShapeObject } from '../../types/canvas';
import type { TextBlock } from '../../types/textblock';

export interface PageElementsBundle {
  strokes: Stroke[];
  shapes: ShapeObject[];
  textBlocks: TextBlock[];
}

let workerInstance: Worker | null = null;
const pendingWorkerRequests = new Map<
  string,
  { resolve: (val: any) => void; reject: (err: any) => void; timeout: any }
>();

function getWorker(): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    return null;
  }
  if (!workerInstance) {
    try {
      workerInstance = new Worker(new URL('./compression.worker.ts', import.meta.url), {
        type: 'module',
      });
      workerInstance.onmessage = (e: MessageEvent) => {
        const { id, success, result, error, fallback } = e.data;
        const req = pendingWorkerRequests.get(id);
        if (req) {
          clearTimeout(req.timeout);
          pendingWorkerRequests.delete(id);
          if (success) {
            req.resolve(result);
          } else {
            console.warn('[CompressionWorker] Worker error, using fallback:', error);
            req.resolve(fallback ?? result);
          }
        }
      };
      workerInstance.onerror = (err) => {
        console.warn('[CompressionWorker] Worker encountered error:', err);
      };
    } catch (e) {
      console.warn('[CompressionWorker] Failed to initialize worker, fallback to main thread:', e);
      workerInstance = null;
    }
  }
  return workerInstance;
}

function runInWorker<T>(action: 'compress' | 'decompress', payload: any): Promise<T> | null {
  const worker = getWorker();
  if (!worker) return null;

  return new Promise<T>((resolve, reject) => {
    const id = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const timeout = setTimeout(() => {
      pendingWorkerRequests.delete(id);
      reject(new Error('Worker timeout (5000ms)'));
    }, 5000);

    pendingWorkerRequests.set(id, { resolve, reject, timeout });
    worker.postMessage({ id, action, payload });
  });
}

/**
 * Сжатие объекта в компактную Gzip base64 строку с префиксом 'gz:'.
 * Сокращает объём данных на 85–95% для массивов точек штрихов.
 */
export async function compressJson(data: any): Promise<string> {
  if (data === null || data === undefined) return '';

  // Пробуем сжать через Web Worker
  try {
    const workerRes = await runInWorker<string>('compress', data);
    if (workerRes !== null && typeof workerRes === 'string') {
      return workerRes;
    }
  } catch {
    // fallback to main thread
  }

  try {
    if (typeof CompressionStream === 'undefined') {
      return JSON.stringify(data);
    }

    const jsonStr = JSON.stringify(data);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const stream = blob.stream().pipeThrough(new CompressionStream('gzip'));
    const response = new Response(stream);
    const arrayBuffer = await response.arrayBuffer();

    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk as any);
    }

    return 'gz:' + btoa(binary);
  } catch (err) {
    console.warn('[Compression] Compression failed, falling back to JSON string:', err);
    return JSON.stringify(data);
  }
}

/**
 * Распаковка данных: прозрачно поддерживает:
 * 1. 'gz:<base64>' — распаковывает через DecompressionStream / Web Worker;
 * 2. Обычные JSON-строки — парсит через JSON.parse;
 * 3. Уже распарсенные объекты (из Supabase jsonb) — возвращает как есть.
 */
export async function decompressJson<T = any>(data: any): Promise<T> {
  if (data === null || data === undefined) return data;

  if (typeof data === 'string' && data.startsWith('gz:')) {
    // Пробуем распаковать через Web Worker
    try {
      const workerRes = await runInWorker<T>('decompress', data);
      if (workerRes !== null && workerRes !== undefined) {
        return workerRes;
      }
    } catch {
      // fallback to main thread
    }

    try {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('DecompressionStream is not supported');
      }

      const base64 = data.slice(3);
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const blob = new Blob([bytes]);
      const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
      const response = new Response(stream);
      const text = await response.text();
      return JSON.parse(text);
    } catch (err) {
      console.error('[Compression] Decompression failed:', err);
      return data as any;
    }
  }

  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return data as any;
    }
  }

  return data;
}

/**
 * Пакетное сжатие всех элементов страницы (штрихи, фигуры, текстовые блоки)
 * в единый поток Gzip. Даёт на 20-30% лучшее сжатие за счёт переиспользования
 * словаря LZ77 и устранения избыточных gzip-заголовков.
 */
export async function compressBatch(elements: {
  strokes?: Stroke[];
  shapes?: ShapeObject[];
  textBlocks?: TextBlock[];
}): Promise<string> {
  const bundle: PageElementsBundle = {
    strokes: elements.strokes || [],
    shapes: elements.shapes || [],
    textBlocks: elements.textBlocks || [],
  };
  return compressJson(bundle);
}

/**
 * Распаковка пакетного бандла страницы.
 */
export async function decompressBatch(data: any): Promise<PageElementsBundle> {
  const decompressed = await decompressJson<PageElementsBundle>(data);
  return {
    strokes: Array.isArray(decompressed?.strokes) ? decompressed.strokes : [],
    shapes: Array.isArray(decompressed?.shapes) ? decompressed.shapes : [],
    textBlocks: Array.isArray(decompressed?.textBlocks) ? decompressed.textBlocks : [],
  };
}
