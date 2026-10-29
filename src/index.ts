import type { IAudioMetadata } from 'music-metadata';

import { concatBytes } from './core/bytes.js';
import { detectFormat, type ContainerFormat } from './core/detect.js';
import { InvalidPatchError, UnsupportedFeatureError, UnsupportedFormatError } from './core/errors.js';
import { openSource } from './core/source.js';
import type { ReadResult, TagPatch, WriteOptions, WriteResult } from './core/types.js';
import { buildFlacUpdate } from './flac/flac.js';
import { writeChunks } from './core/writer.js';

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
  NumberPair,
  NumberPairPatch,
  Picture,
  ReadResult,
  TagPatch,
  TextPatch,
  WriteOptions,
  WriteResult
} from './core/types.js';

/**
 * Update tags in an audio file.
 *
 * The file is read with random access, the metadata section is rebuilt, and
 * the audio payload is copied in chunks. By default the result is written to a
 * temporary file and atomically renamed into place.
 */
export async function updateFile(
  filePath: string,
  patch: TagPatch,
  options: WriteOptions = {}
): Promise<WriteResult> {
  assertPatch(patch);
  const source = await openSource(filePath);
  try {
    const format = await detectFormat(source);
    assertSupported(format);

    const update = await buildFlacUpdate(source, patch, options);
    const result = await writeChunks(
      filePath,
      [
        update.metadata,
        { source, offset: update.audioOffset, length: update.audioLength }
      ],
      {
        atomic: options.atomic ?? true,
        backup: options.backup ?? false,
        dryRun: options.dryRun ?? false
      }
    );

    return {
      format: 'flac',
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
export async function updateBuffer(
  data: Uint8Array,
  patch: TagPatch,
  options: WriteOptions = {}
): Promise<Uint8Array> {
  assertPatch(patch);
  const source = await openSource(data);
  try {
    const format = await detectFormat(source);
    assertSupported(format);

    const update = await buildFlacUpdate(source, patch, options);
    const audio = await source.read(update.audioOffset, update.audioLength);
    return concatBytes(update.metadata, audio);
  } finally {
    await source.close();
  }
}

/**
 * Read tags from a file path or an in-memory buffer.
 *
 * Reading is delegated to the optional `music-metadata` package, so the editor
 * does not maintain a second tag decoder. The returned `common`, `native`, and
 * `pictures` values are the `music-metadata` structures.
 */
export async function readTags(input: string | Uint8Array): Promise<ReadResult> {
  const metadata = await readWithMusicMetadata(input);
  return {
    format: inferFormat(metadata),
    common: metadata.common,
    native: metadata.native,
    pictures: metadata.common.picture ? [...metadata.common.picture] : []
  };
}

async function readWithMusicMetadata(input: string | Uint8Array): Promise<IAudioMetadata> {
  let musicMetadata: typeof import('music-metadata');
  try {
    musicMetadata = await import('music-metadata');
  } catch (error) {
    throw new UnsupportedFeatureError(
      'readTags requires the optional music-metadata package; install it with `npm install music-metadata`',
      { cause: error }
    );
  }

  if (typeof input === 'string') {
    return musicMetadata.parseFile(input);
  }

  // Auto-detection stops at a leading ID3v2 tag, so a FLAC buffer with such a
  // prefix would be parsed as MPEG. Detect the FLAC marker after the prefix and
  // tell music-metadata which parser to use.
  const source = await openSource(input);
  try {
    const format = await detectFormat(source);
    return format === 'flac'
      ? musicMetadata.parseBuffer(input, { mimeType: 'audio/flac' })
      : musicMetadata.parseBuffer(input);
  } finally {
    await source.close();
  }
}

function inferFormat(metadata: IAudioMetadata): string {
  const container = metadata.format.container?.toLowerCase();
  if (container === undefined) {
    return 'unknown';
  }
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

function assertSupported(format: ContainerFormat): asserts format is 'flac' {
  switch (format) {
    case 'flac':
      return;
    case 'id3':
    case 'mp3':
      throw new UnsupportedFormatError(
        'MP3/ID3v2.4 support is not implemented yet; this release supports FLAC only'
      );
    case 'unknown':
      throw new UnsupportedFormatError(
        'Unsupported audio format; this release supports FLAC only'
      );
  }
}
