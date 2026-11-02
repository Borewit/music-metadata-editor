import { parseVorbisComment as parseShared, type VorbisFields } from 'music-metadata/tokens/vorbis';
import { InvalidFileError } from '../core/errors.js';

export type { VorbisComment, VorbisFields } from 'music-metadata/tokens/vorbis';
export { serializeVorbisComment } from './write.js';

export function parseVorbisComment(data: Uint8Array): VorbisFields {
  return parseShared(data, {
    maxComments: 1_000_000,
    createError: message => new InvalidFileError(message)
  });
}
