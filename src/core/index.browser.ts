import { buildOggUpdate } from '../ogg/ogg.js';
import { normalizeCommonPatch } from '../mapping/common.js';
import { buildMp4Update } from '../mp4/mp4.js';
import { buildWavUpdate } from '../wav/wav.js';
import { parseBlob, parseBuffer as parseMetadataBuffer, type IAudioMetadata } from 'music-metadata';

import { concatBytes } from './bytes.js';
import { detectFormat, type ContainerFormat } from './detect.js';
import { InvalidPatchError, UnsupportedFeatureError, UnsupportedFormatError } from './errors.js';
import { openSource, type ByteSource } from './source.browser.js';
import type { ReadResult, TagPatch, WriteOptions } from './types.js';
import { buildId3Update } from '../id3v2/id3v2.js';
import { buildFlacUpdate } from '../flac/flac.js';
import { writeBuffer, type WriteChunk } from './writer.browser.js';

export {
  InvalidFileError,
  InvalidPatchError,
  MetadataEditorError,
  UnsupportedFeatureError,
  UnsupportedFormatError,
  WriteError
} from './errors.js';
export { PICTURE_TYPES } from '../flac/picture.js';
export type {
  Comment,
  CommonTags,
  LyricsEntry,
  LyricsPatch,
  NumberPair,
  NumberPairPatch,
  Picture,
  ReadResult,
  SynchronizedLyricsText,
  TagPatch,
  TextPatch,
  WriteOptions,
  WriteResult
} from './types.js';

/**
 * Rebuild a container whose metadata and audio are written as ordered chunks.
 */
function buildStreamedUpdate(
  format: 'wav' | 'mp4' | 'ogg',
  source: ByteSource,
  patch: TagPatch,
  options: WriteOptions
): Promise<{ chunks: WriteChunk[]; paddingBytes: number }> {
  switch (format) {
    case 'wav':
      return buildWavUpdate(source, patch, options);
    case 'mp4':
      return buildMp4Update(source, patch, options);
    case 'ogg':
      return buildOggUpdate(source, patch, options);
  }
}

/**
 * Update tags in an in-memory audio file (browser-compatible).
 *
 * Returns a new buffer; the input is not modified.
 * Accepts a Uint8Array or Blob as input.
 */
export async function updateBuffer(
  data: Uint8Array | Blob,
  patch: TagPatch,
  options: WriteOptions = {}
): Promise<Uint8Array> {
  assertPatch(patch);
  patch = normalizeCommonPatch(patch);
  const source = await openSource(data);
  try {
    const format = await detectFormat(source);
    assertSupported(format);
    if (format === 'flac' && options.replaceId3) {
      throw new UnsupportedFeatureError('replaceId3 is only supported for MP3 and WAV');
    }

    if (format === 'wav' || format === 'mp4' || format === 'ogg') {
      const update = await buildStreamedUpdate(format, source, patch, options);
      return writeBuffer(update.chunks);
    }
    const update = await (format === 'flac' ? buildFlacUpdate : buildId3Update)(source, patch, options);
    const audio = await source.read(update.audioOffset, update.audioLength);
    return concatBytes(update.metadata, audio);
  } finally {
    await source.close();
  }
}

/**
 * Read tags from an in-memory buffer or Blob (browser-compatible).
 *
 * Reading is delegated to the `music-metadata` dependency, so the editor
 * does not maintain a second tag decoder. The returned `common`, `native`, and
 * `pictures` values are the `music-metadata` structures.
 */
export async function readTags(input: Uint8Array | Blob): Promise<ReadResult> {
  const { metadata, detectedFormat } = await readWithMusicMetadata(input);
  return {
    // Share the writer's detector: file-type accepts MP4 brands beyond a fixed list.
    format: detectedFormat === 'mp4' ? 'mp4' : inferFormat(metadata),
    common: metadata.common,
    native: metadata.native,
    pictures: metadata.common.picture ? [...metadata.common.picture] : []
  };
}

async function readWithMusicMetadata(
  input: Uint8Array | Blob
): Promise<{ metadata: IAudioMetadata; detectedFormat: ContainerFormat }> {
  // Auto-detection stops at a leading ID3v2 tag, so a FLAC buffer with such a
  // prefix would be parsed as MPEG. Detect the FLAC marker after the prefix and
  // tell music-metadata which parser to use.
  const source = await openSource(input);
  try {
    const format = await detectFormat(source);
    // parseBlob streams via ReadableStreamBYOBReader without buffering the whole
    // file; Uint8Array input is already in memory, so parseBuffer keeps the FLAC
    // mimeType hint that detects FLAC files with a leading ID3 prefix.
    const metadata = input instanceof Blob
      ? await parseBlob(input)
      : await parseMetadataBuffer(input, format === 'flac' ? { mimeType: 'audio/flac' } : undefined);
    return { metadata, detectedFormat: format };
  } finally {
    await source.close();
  }
}

function inferFormat(metadata: IAudioMetadata): string {
  const container = metadata.format.container?.toLowerCase();
  if (container === undefined) {
    return 'unknown';
  }
  if (/^(m4a|m4b|mp4|isom|iso2|mp42)(\/|$)/.test(container)) return 'mp4';
  if (container.includes('flac')) {
    return 'flac';
  }
  if (container === 'mpeg' || container.includes('mpeg') || container === 'mp3') {
    return 'mp3';
  }
  return container;
}

function assertPatch(patch: TagPatch): void {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw new InvalidPatchError('patch must be an object');
  }
}

function assertSupported(format: ContainerFormat): asserts format is 'flac' | 'id3' | 'mp3' | 'wav' | 'mp4' | 'ogg' {
  if (format === 'unknown') {
    throw new UnsupportedFormatError('Unsupported audio format; supported formats are FLAC, Ogg Vorbis/Opus, WAV, MP4 and MP3/ID3v2.4');
  }
}
