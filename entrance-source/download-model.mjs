export async function downloadModel(url, {signal, onProgress = () => {}, fetchImpl = fetch} = {}) {
  const response = await fetchImpl(url, {signal});
  if (!response.ok) throw Error(`World download failed: ${response.status}`);
  // Content-Length describes compressed bytes when HTTP compression is enabled;
  // the server supplies the decoded length for an honest progress indicator.
  const total = Number(response.headers.get('X-Uncompressed-Length') || response.headers.get('Content-Length'));
  if (!response.body?.getReader) return response.arrayBuffer();
  const reader = response.body.getReader(), chunks = [];
  let received = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      chunks.push(value); received += value.byteLength;
      onProgress(total > 0 ? Math.min(100, Math.round(received / total * 100)) : null);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}
