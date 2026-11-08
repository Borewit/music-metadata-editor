const BASE64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const BASE64_TABLE = new Uint8Array(256);
for (let i = 0; i < 256; i++) BASE64_TABLE[i] = 0xff;
for (let i = 0; i < BASE64_CHARS.length; i++) BASE64_TABLE[BASE64_CHARS.charCodeAt(i)!] = i;

/**
 * Encode a Uint8Array as a base64 string.
 *
 * Works in both Node.js and browsers.
 */
export function encodeBase64(data: Uint8Array): string {
  const encodedLength = Math.ceil(data.length / 3) * 4;
  const result = new Uint8Array(encodedLength);
  let outputIndex = 0;
  let index = 0;
  while (index < data.length) {
    const a = data[index++]!;
    const b = index < data.length ? data[index++]! : 0;
    const c = index < data.length ? data[index++]! : 0;
    const triple = (a << 16) | (b << 8) | c;
    result[outputIndex++] = BASE64_CHARS.charCodeAt((triple >> 18) & 0x3f)!;
    result[outputIndex++] = BASE64_CHARS.charCodeAt((triple >> 12) & 0x3f)!;
    result[outputIndex++] = BASE64_CHARS.charCodeAt((triple >> 6) & 0x3f)!;
    result[outputIndex++] = BASE64_CHARS.charCodeAt(triple & 0x3f)!;
  }
  const padding = data.length % 3;
  if (padding === 1) {
    result[encodedLength - 2] = 0x3d; // '='
    result[encodedLength - 1] = 0x3d; // '='
  } else if (padding === 2) {
    result[encodedLength - 1] = 0x3d; // '='
  }
  const decoder = new TextDecoder();
  return decoder.decode(result);
}

/**
 * Decode a base64 string into a Uint8Array.
 *
 * Works in both Node.js and browsers.
 */
export function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/\s/g, '');
  const length = Math.floor((normalized.length * 3) / 4);
  const result = new Uint8Array(length);
  let resultIndex = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    const charValue = char < 256 ? BASE64_TABLE[char]! : 0xff;
    if (charValue === 0xff) continue; // skip invalid characters
    buffer = (buffer << 6) | charValue;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      result[resultIndex++] = (buffer >> bits) & 0xff;
    }
  }
  return result.subarray(0, resultIndex);
}
