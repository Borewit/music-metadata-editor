import { UINT32_BE } from 'token-types';

import { TokenWriter, encodeUtf8 } from '../core/bytes.js';
import type { Picture } from '../core/types.js';

/**
 * Picture types defined by the FLAC specification (and ID3v2 APIC).
 */
export const PICTURE_TYPES = [
  'Other',
  "32x32 pixels 'file icon' (PNG only)",
  'Other file icon',
  'Cover (front)',
  'Cover (back)',
  'Leaflet page',
  'Media (e.g. label side of CD)',
  'Lead artist/lead performer/soloist',
  'Artist/performer',
  'Conductor',
  'Band/Orchestra',
  'Composer',
  'Lyricist/text writer',
  'Recording Location',
  'During recording',
  'During performance',
  'Movie/video screen capture',
  'A bright coloured fish',
  'Illustration',
  'Band/artist logotype',
  'Publisher/Studio logotype'
] as const;

export function pictureTypeToNumber(type: string | undefined): number {
  if (type === undefined) {
    return 0;
  }
  const index = PICTURE_TYPES.indexOf(type as (typeof PICTURE_TYPES)[number]);
  return index >= 0 ? index : 0;
}

/**
 * Serialize a FLAC PICTURE block body.
 *
 * Reading PICTURE blocks is handled by `music-metadata`; this module only
 * provides the encoding side used by the writer.
 */
export function serializePicture(picture: Picture): Uint8Array {
  const format = encodeUtf8(normalizeMimeType(picture.format));
  const description = encodeUtf8(picture.description ?? '');
  const writer = new TokenWriter(format.length + description.length + picture.data.length + 64);

  writer.writeToken(UINT32_BE, pictureTypeToNumber(picture.type));
  writer.writeToken(UINT32_BE, format.length);
  writer.writeBytes(format);
  writer.writeToken(UINT32_BE, description.length);
  writer.writeBytes(description);
  writer.writeToken(UINT32_BE, picture.width ?? 0);
  writer.writeToken(UINT32_BE, picture.height ?? 0);
  writer.writeToken(UINT32_BE, picture.colourDepth ?? 0);
  writer.writeToken(UINT32_BE, picture.colours ?? 0);
  writer.writeToken(UINT32_BE, picture.data.length);
  writer.writeBytes(picture.data);

  return writer.toUint8Array();
}

function normalizeMimeType(format: string): string {
  const lower = format.toLowerCase();
  switch (lower) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    default:
      return format;
  }
}
