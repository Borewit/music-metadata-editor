import { UINT32_LE } from 'token-types';

import { TokenWriter, decodeUtf8, encodeUtf8, readBytes, readUInt32LE } from '../core/bytes.js';
import { InvalidFileError } from '../core/errors.js';
import type { VorbisComment, VorbisFields } from '../mapping/vorbis.js';

const MAX_COMMENT_COUNT = 1_000_000;

/**
 * Parse a Vorbis Comment metadata block body.
 *
 * This is a structural parser used by the writer to preserve unknown fields.
 * Reading metadata for consumers is delegated to `music-metadata`.
 */
export function parseVorbisComment(data: Uint8Array): VorbisFields {
  let offset = 0;

  const vendorLength = readUInt32LE(data, offset);
  offset += 4;
  const vendor = decodeUtf8(readBytes(data, offset, vendorLength));
  offset += vendorLength;

  const count = readUInt32LE(data, offset);
  offset += 4;
  if (count > MAX_COMMENT_COUNT) {
    throw new InvalidFileError(`Vorbis Comment count ${count} exceeds limit ${MAX_COMMENT_COUNT}`);
  }

  const comments: VorbisComment[] = [];
  for (let index = 0; index < count; index++) {
    const length = readUInt32LE(data, offset);
    offset += 4;
    const value = decodeUtf8(readBytes(data, offset, length));
    offset += length;

    const separator = value.indexOf('=');
    if (separator <= 0) {
      throw new InvalidFileError(`Malformed Vorbis Comment at index ${index}: missing field separator`);
    }
    comments.push({
      key: value.slice(0, separator),
      value: value.slice(separator + 1)
    });
  }

  if (offset !== data.length) {
    throw new InvalidFileError(`Vorbis Comment block has ${data.length - offset} trailing byte(s)`);
  }

  return { vendor, comments };
}

/**
 * Serialize a Vorbis Comment metadata block body.
 */
export function serializeVorbisComment(fields: VorbisFields): Uint8Array {
  const vendor = encodeUtf8(fields.vendor);
  const encodedComments = fields.comments.map(comment => ({
    key: comment.key,
    value: encodeUtf8(`${comment.key}=${comment.value}`)
  }));

  let size = 4 + vendor.length + 4;
  for (const comment of encodedComments) {
    size += 4 + comment.value.length;
  }

  const writer = new TokenWriter(size);
  writer.writeToken(UINT32_LE, vendor.length);
  writer.writeBytes(vendor);
  writer.writeToken(UINT32_LE, encodedComments.length);
  for (const comment of encodedComments) {
    writer.writeToken(UINT32_LE, comment.value.length);
    writer.writeBytes(comment.value);
  }
  return writer.toUint8Array();
}
