import { parseBuffer } from 'music-metadata';
import { describe, expect, it } from 'vitest';

import { readTags, updateBuffer } from '../src/index.js';
import { makeFlac } from './helpers/flac.js';

describe('music-metadata read-back', () => {
  it('writes tags that music-metadata maps to common fields', async () => {
    const input = makeFlac();
    const output = await updateBuffer(input, {
      title: 'Parity title',
      artist: 'Display artist',
      artists: ['Artist A', 'Artist B'],
      albumartist: 'Display album artist',
      albumartists: ['Album Artist A', 'Album Artist B'],
      album: 'Parity album',
      date: '2025-06-01',
      originaldate: '1999-01-01',
      genre: ['Jazz', 'Fusion'],
      comment: 'Parity comment',
      composer: ['Composer A', 'Composer B'],
      track: { no: 4, of: 12 },
      disk: { no: 1, of: 2 },
      musicbrainz_recordingid: 'recording-id',
      musicbrainz_trackid: 'release-track-id',
      musicbrainz_albumid: 'album-id',
      musicbrainz_artistid: ['artist-id-1', 'artist-id-2'],
      musicbrainz_albumartistid: ['album-artist-id'],
      musicbrainz_releasegroupid: 'release-group-id',
      musicbrainz_workid: 'work-id'
    });

    const parsed = await parseBuffer(output, { mimeType: 'audio/flac' });
    const common = parsed.common;

    expect(common.title).toBe('Parity title');
    // `artists` is applied after `artist`, so the repeated field wins.
    expect(common.artist).toBe('Artist A');
    expect(common.artists).toEqual(['Artist A', 'Artist B']);
    expect(common.albumartist).toBe('Album Artist A');
    expect(common.albumartists).toEqual(['Album Artist A', 'Album Artist B']);
    expect(common.album).toBe('Parity album');
    expect(common.date).toBe('2025-06-01');
    expect(common.originaldate).toBe('1999-01-01');
    expect(common.genre).toEqual(['Jazz', 'Fusion']);
    expect(common.comment?.map(comment => comment.text)).toEqual(['Parity comment']);
    expect(common.composer).toEqual(['Composer A', 'Composer B']);
    expect(common.track).toEqual({ no: 4, of: 12 });
    expect(common.disk).toEqual({ no: 1, of: 2 });
    expect(common.musicbrainz_recordingid).toBe('recording-id');
    expect(common.musicbrainz_trackid).toBe('release-track-id');
    expect(common.musicbrainz_albumid).toBe('album-id');
    expect(common.musicbrainz_artistid).toEqual(['artist-id-1', 'artist-id-2']);
    expect(common.musicbrainz_albumartistid).toEqual(['album-artist-id']);
    expect(common.musicbrainz_releasegroupid).toBe('release-group-id');
    expect(common.musicbrainz_workid).toBe('work-id');

    const viaEditor = await readTags(output);
    expect(viaEditor.common).toEqual(common);
    expect(viaEditor.native).toEqual(parsed.native);
    expect(viaEditor.pictures).toEqual(parsed.common.picture ?? []);
  });
});
