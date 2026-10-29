import { describe, expect, it } from 'vitest';

import { InvalidFileError, InvalidPatchError } from '../src/core/errors.js';
import { applyVorbisPatch } from '../src/mapping/vorbis.js';
import { parseVorbisComment, serializeVorbisComment } from '../src/flac/vorbis.js';

describe('Vorbis Comment codec', () => {
  it('round-trips vendor and repeated fields', () => {
    const fields = {
      vendor: 'vendor with ünicode',
      comments: [
        { key: 'TITLE', value: 'Title with ünicode' },
        { key: 'ARTIST', value: 'A' },
        { key: 'ARTIST', value: 'B' },
        { key: 'EMPTY', value: '' }
      ]
    };

    const encoded = serializeVorbisComment(fields);
    expect(parseVorbisComment(encoded)).toEqual(fields);
  });

  it('rejects malformed comments', () => {
    const encoded = serializeVorbisComment({
      vendor: 'v',
      comments: [{ key: 'BROKEN', value: 'x' }]
    });
    // Replace the field separator with a normal character.
    const separator = encoded.indexOf(0x3d);
    expect(separator).toBeGreaterThan(0);
    encoded[separator] = 0x5a;
    expect(() => parseVorbisComment(encoded)).toThrow(InvalidFileError);
  });

  it('rejects trailing bytes', () => {
    const encoded = serializeVorbisComment({ vendor: 'v', comments: [{ key: 'TITLE', value: 'x' }] });
    const withTrailing = new Uint8Array(encoded.length + 1);
    withTrailing.set(encoded);
    expect(() => parseVorbisComment(withTrailing)).toThrow(InvalidFileError);
  });
});

describe('Vorbis tag mapping', () => {
  it('applies common tags and preserves unknown fields', () => {
    const fields = {
      vendor: 'v',
      comments: [
        { key: 'TITLE', value: 'Old' },
        { key: 'UNKNOWN', value: 'keep' },
        { key: 'ARTIST', value: 'Old artist' }
      ]
    };

    const updated = applyVorbisPatch(fields, {
      title: 'New',
      artists: ['A', 'B'],
      genre: ['Rock'],
      track: { no: 2, of: 10 },
      native: { CUSTOM: ['one', 'two'] }
    });

    expect(updated.comments).toEqual([
      { key: 'TITLE', value: 'New' },
      { key: 'UNKNOWN', value: 'keep' },
      { key: 'ARTIST', value: 'A' },
      { key: 'ARTIST', value: 'B' },
      { key: 'GENRE', value: 'Rock' },
      { key: 'TRACKNUMBER', value: '2' },
      { key: 'TRACKTOTAL', value: '10' },
      { key: 'CUSTOM', value: 'one' },
      { key: 'CUSTOM', value: 'two' }
    ]);
  });

  it('removes fields with null', () => {
    const fields = {
      vendor: 'v',
      comments: [
        { key: 'TITLE', value: 'Old' },
        { key: 'ARTIST', value: 'A' },
        { key: 'ARTIST', value: 'B' }
      ]
    };

    const updated = applyVorbisPatch(fields, { title: null, artist: null, track: null });
    expect(updated.comments).toEqual([]);
  });

  it('rejects invalid native field names', () => {
    expect(() => applyVorbisPatch({ vendor: 'v', comments: [] }, { native: { 'BAD=NAME': 'x' } })).toThrow(
      InvalidPatchError
    );
    expect(() => applyVorbisPatch({ vendor: 'v', comments: [] }, { native: { 'BAD\nNAME': 'x' } })).toThrow(
      InvalidPatchError
    );
  });

  it('rejects multiple values for single-value fields', () => {
    expect(() => applyVorbisPatch({ vendor: 'v', comments: [] }, { title: ['A', 'B'] })).toThrow(
      InvalidPatchError
    );
  });
});
