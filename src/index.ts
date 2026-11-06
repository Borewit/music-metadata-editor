import { buildOggUpdate } from './ogg/ogg.js';
import { normalizeCommonPatch } from './mapping/common.js';
import { buildMp4Update } from './mp4/mp4.js';
import { buildWavUpdate } from './wav/wav.js';
import { parseFile, parseBuffer, type IAudioMetadata } from 'music-metadata';

import { concatBytes } from './core/bytes.js';
import { detectFormat, type ContainerFormat } from './core/detect.js';
import { InvalidPatchError, UnsupportedFeatureError, UnsupportedFormatError } from './core/errors.js';
import { openSource, type ByteSource } from './core/source.js';
import type { ReadResult, TagPatch, WriteOptions, WriteResult } from './core/types.js';
import { buildId3Update } from './id3v2/id3v2.js';
import { buildFlacUpdate } from './flac/flac.js';
import { writeChunks, type WriteChunk } from './core/writer.js';

export {
  InvalidFileError,
  InvalidPatchError,
  MetadataEditorError,
  UnsupportedFeatureError,
  UnsupportedFormatError,
  WriteError
} from './core/errors.js';
export { PICTURE_TYPES } from './flac/picture.js';
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
} from './core/types.js';

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
 * Update tags in an audio file.
 *
 * The file is read with random access, the metadata section is rebuilt, and
 * the audio payload is copied in chunks. By default the result is written to a
 * temporary file and atomically renamed into place.
 */
export async function updateFile(filePath: string, patch: TagPatch, options: WriteOptions = {}): Promise<WriteResult> {
  assertPatch(patch);
  patch = normalizeCommonPatch(patch);
  const source = await openSource(filePath);
  try {
    const format = await detectFormat(source);
    assertSupported(format);
    if (format === 'flac' && options.replaceId3) {
      throw new UnsupportedFeatureError('replaceId3 is only supported for MP3 and WAV');
    }

    if (format === 'wav' || format === 'mp4' || format === 'ogg') {
      const update = await buildStreamedUpdate(format, source, patch, options);
      const result = await writeChunks(filePath, update.chunks, {
        atomic: options.atomic ?? true,
        stageToFile: format === 'mp4' || format === 'ogg',
        backup: options.backup ?? false,
        dryRun: options.dryRun ?? false,
        beforeReplace: () => source.close()
      });
      return { format, ...result, paddingBytes: update.paddingBytes };
    }
    const update = await (format === 'flac' ? buildFlacUpdate : buildId3Update)(source, patch, options);
    const result = await writeChunks(
      filePath,
      [update.metadata, { source, offset: update.audioOffset, length: update.audioLength }],
      {
        atomic: options.atomic ?? true,
        backup: options.backup ?? false,
        dryRun: options.dryRun ?? false,
        beforeReplace: () => source.close()
      }
    );

    return {
      format: format === 'flac' ? 'flac' : 'mp3',
      bytesWritten: result.bytesWritten,
      paddingBytes: update.paddingBytes,
      atomic: result.atomic
    };
  } finally {
    await source.close();
  }
}

/**
 * Update tags in an in-memory audio file.
 *
 * Returns a new buffer; the input is not modified.
 */
export async function updateBuffer(data: Uint8Array, patch: TagPatch, options: WriteOptions = {}): Promise<Uint8Array> {
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
      const output = new Uint8Array(update.chunks.reduce((sum, chunk) => sum + chunk.length, 0));
      let offset = 0;
      for (const chunk of update.chunks) {
        const bytes = chunk instanceof Uint8Array ? chunk : await chunk.source.read(chunk.offset, chunk.length);
        output.set(bytes, offset);
        offset += bytes.length;
      }
      return output;
    }
    const update = await (format === 'flac' ? buildFlacUpdate : buildId3Update)(source, patch, options);
    const audio = await source.read(update.audioOffset, update.audioLength);
    return concatBytes(update.metadata, audio);
  } finally {
    await source.close();
  }
}

/**
 * Read tags from a file path or an in-memory buffer.
 *
 * Reading is delegated to the `music-metadata` dependency, so the editor
 * does not maintain a second tag decoder. The returned `common`, `native`, and
 * `pictures` values are the `music-metadata` structures.
 */
export async function readTags(input: string | Uint8Array): Promise<ReadResult> {
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
  input: string | Uint8Array
): Promise<{ metadata: IAudioMetadata; detectedFormat: ContainerFormat }> {
  // Auto-detection stops at a leading ID3v2 tag, so a FLAC buffer with such a
  // prefix would be parsed as MPEG. Detect the FLAC marker after the prefix and
  // tell music-metadata which parser to use.
  const source = await openSource(input);
  try {
    const format = await detectFormat(source);
    const metadata = await (typeof input === 'string'
      ? parseFile(input)
      : format === 'flac'
        ? parseBuffer(input, { mimeType: 'audio/flac' })
        : parseBuffer(input));
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
