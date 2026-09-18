/**
 * Утилиты нативного Gzip-сжатия и распаковки данных для синхронизации с облаком.
 * Использует веб-стандарты CompressionStream / DecompressionStream.
 */

/**
 * Сжатие объекта в компактную Gzip base64 строку с префиксом 'gz:'.
 * Сокращает объём данных на 85–95% для массивов точек штрихов.
 */
export async function compressJson(data: any): Promise<string> {
  if (data === null || data === undefined) return '';

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
 * 1. 'gz:<base64>' — распаковывает через DecompressionStream;
 * 2. Обычные JSON-строки — парсит через JSON.parse;
 * 3. Уже распарсенные объекты (из Supabase jsonb) — возвращает как есть.
 */
export async function decompressJson<T = any>(data: any): Promise<T> {
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    if (data.startsWith('gz:')) {
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

    try {
      return JSON.parse(data);
    } catch {
      return data as any;
    }
  }

  return data;
}
