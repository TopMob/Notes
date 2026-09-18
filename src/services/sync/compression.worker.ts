/**
 * Web Worker для асинхронного сжатия и распаковки данных в фоновом потоке.
 * Гарантирует, что обработка мегабайтных пакетов штрихов не вызывает просадку FPS на холсте.
 */

self.onmessage = async (
  e: MessageEvent<{
    id: string;
    action: 'compress' | 'decompress';
    payload: any;
  }>
) => {
  const { id, action, payload } = e.data;

  try {
    if (action === 'compress') {
      if (payload === null || payload === undefined) {
        self.postMessage({ id, success: true, result: '' });
        return;
      }

      if (typeof CompressionStream === 'undefined') {
        self.postMessage({ id, success: true, result: JSON.stringify(payload) });
        return;
      }

      const jsonStr = JSON.stringify(payload);
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

      self.postMessage({ id, success: true, result: 'gz:' + btoa(binary) });
    } else if (action === 'decompress') {
      if (payload === null || payload === undefined) {
        self.postMessage({ id, success: true, result: payload });
        return;
      }

      if (typeof payload === 'string') {
        if (payload.startsWith('gz:')) {
          if (typeof DecompressionStream === 'undefined') {
            throw new Error('DecompressionStream is not supported');
          }

          const base64 = payload.slice(3);
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }

          const blob = new Blob([bytes]);
          const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
          const response = new Response(stream);
          const text = await response.text();
          self.postMessage({ id, success: true, result: JSON.parse(text) });
          return;
        }

        try {
          self.postMessage({ id, success: true, result: JSON.parse(payload) });
          return;
        } catch {
          self.postMessage({ id, success: true, result: payload });
          return;
        }
      }

      self.postMessage({ id, success: true, result: payload });
    }
  } catch (err: any) {
    self.postMessage({
      id,
      success: false,
      error: err?.message || String(err),
      fallback: typeof payload === 'string' ? payload : JSON.stringify(payload),
    });
  }
};
