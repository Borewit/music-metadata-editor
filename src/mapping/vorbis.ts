import { InvalidPatchError } from '../core/errors.js';
import {
  normalizeComments,
  normalizeNumberPair,
  numberValue,
  textValues
} from '../core/patch.js';
import type { TagPatch } from '../core/types.js';

export interface VorbisComment {
  key: string;
  value: string;
}

export interface VorbisFields {
  vendor: string;
  comments: VorbisComment[];
}

type TextPatchKey =
  | 'title'
  | 'artist'
  | 'artists'
  | 'albumartist'
  | 'albumartists'
  | 'album'
  | 'date'
  | 'originaldate'
  | 'releasedate'
  | 'genre'
  | 'composer'
  | 'lyricist'
  | 'writer'
  | 'conductor'
  | 'remixer'
  | 'arranger'
  | 'engineer'
  | 'producer'
  | 'mixer'
  | 'technician'
  | 'label'
  | 'catalognumber'
  | 'isrc'
  | 'copyright'
  | 'media'
  | 'mood'
  | 'grouping'
  | 'subtitle'
  | 'website'
  | 'lyrics'
  | 'musicbrainz_recordingid'
  | 'musicbrainz_trackid'
  | 'musicbrainz_albumid'
  | 'musicbrainz_artistid'
  | 'musicbrainz_albumartistid'
  | 'musicbrainz_releasegroupid'
  | 'musicbrainz_workid'
  | 'replaygain_track_gain'
  | 'replaygain_track_peak'
  | 'replaygain_album_gain'
  | 'replaygain_album_peak';

interface TextFieldMapping {
  /** Patch property name. */
  patch: TextPatchKey;
  /** Vorbis Comment field name. */
  field: string;
  /** Whether repeated values are allowed. */
  multiple: boolean;
}

const TEXT_FIELDS: readonly TextFieldMapping[] = [
  { patch: 'title', field: 'TITLE', multiple: false },
  { patch: 'artist', field: 'ARTIST', multiple: false },
  { patch: 'artists', field: 'ARTIST', multiple: true },
  { patch: 'albumartist', field: 'ALBUMARTIST', multiple: false },
  { patch: 'albumartists', field: 'ALBUMARTIST', multiple: true },
  { patch: 'album', field: 'ALBUM', multiple: false },
  { patch: 'date', field: 'DATE', multiple: false },
  { patch: 'originaldate', field: 'ORIGINALDATE', multiple: false },
  { patch: 'releasedate', field: 'RELEASEDATE', multiple: false },
  { patch: 'genre', field: 'GENRE', multiple: true },
  { patch: 'composer', field: 'COMPOSER', multiple: true },
  { patch: 'lyricist', field: 'LYRICIST', multiple: true },
  { patch: 'writer', field: 'WRITER', multiple: true },
  { patch: 'conductor', field: 'CONDUCTOR', multiple: true },
  { patch: 'remixer', field: 'REMIXER', multiple: true },
  { patch: 'arranger', field: 'ARRANGER', multiple: true },
  { patch: 'engineer', field: 'ENGINEER', multiple: true },
  { patch: 'producer', field: 'PRODUCER', multiple: true },
  { patch: 'mixer', field: 'MIXER', multiple: true },
  { patch: 'technician', field: 'TECHNICIAN', multiple: true },
  { patch: 'label', field: 'LABEL', multiple: true },
  { patch: 'catalognumber', field: 'CATALOGNUMBER', multiple: true },
  { patch: 'isrc', field: 'ISRC', multiple: true },
  { patch: 'copyright', field: 'COPYRIGHT', multiple: false },
  { patch: 'media', field: 'MEDIA', multiple: false },
  { patch: 'mood', field: 'MOOD', multiple: false },
  { patch: 'grouping', field: 'GROUPING', multiple: false },
  { patch: 'subtitle', field: 'SUBTITLE', multiple: false },
  { patch: 'website', field: 'WEBSITE', multiple: false },
  { patch: 'lyrics', field: 'LYRICS', multiple: false },
  { patch: 'musicbrainz_recordingid', field: 'MUSICBRAINZ_TRACKID', multiple: false },
  { patch: 'musicbrainz_trackid', field: 'MUSICBRAINZ_RELEASETRACKID', multiple: false },
  { patch: 'musicbrainz_albumid', field: 'MUSICBRAINZ_ALBUMID', multiple: false },
  { patch: 'musicbrainz_artistid', field: 'MUSICBRAINZ_ARTISTID', multiple: true },
  { patch: 'musicbrainz_albumartistid', field: 'MUSICBRAINZ_ALBUMARTISTID', multiple: true },
  { patch: 'musicbrainz_releasegroupid', field: 'MUSICBRAINZ_RELEASEGROUPID', multiple: false },
  { patch: 'musicbrainz_workid', field: 'MUSICBRAINZ_WORKID', multiple: false },
  { patch: 'replaygain_track_gain', field: 'REPLAYGAIN_TRACK_GAIN', multiple: false },
  { patch: 'replaygain_track_peak', field: 'REPLAYGAIN_TRACK_PEAK', multiple: false },
  { patch: 'replaygain_album_gain', field: 'REPLAYGAIN_ALBUM_GAIN', multiple: false },
  { patch: 'replaygain_album_peak', field: 'REPLAYGAIN_ALBUM_PEAK', multiple: false }
];

/**
 * Apply a common/native tag patch to a Vorbis Comment block.
 *
 * Existing fields are updated in place, unknown fields are preserved, and
 * repeated values are supported.
 */
export function applyVorbisPatch(fields: VorbisFields, patch: TagPatch): VorbisFields {
  const comments = fields.comments.map(comment => ({ ...comment }));

  for (const mapping of TEXT_FIELDS) {
    const value = patch[mapping.patch];
    if (value === undefined) {
      continue;
    }
    const values = textValues(value);
    if (values === undefined) {
      continue;
    }
    if (values === null) {
      removeField(comments, mapping.field);
      continue;
    }
    if (!mapping.multiple && values.length > 1) {
      throw new InvalidPatchError(`${String(mapping.patch)} accepts a single value`);
    }
    setField(comments, mapping.field, values);
  }

  const commentsPatch = normalizeComments(patch.comment);
  if (commentsPatch !== undefined) {
    if (commentsPatch === null || commentsPatch.length === 0) {
      removeField(comments, 'COMMENT');
    } else {
      setField(
        comments,
        'COMMENT',
        commentsPatch.map(comment => comment.text)
      );
    }
  }

  const bpm = numberValue(patch.bpm);
  if (bpm !== undefined) {
    if (bpm === null) {
      removeField(comments, 'BPM');
    } else {
      setField(comments, 'BPM', [String(bpm)]);
    }
  }

  const originalYear = numberValue(patch.originalyear);
  if (originalYear !== undefined) {
    if (originalYear === null) {
      removeField(comments, 'ORIGINALYEAR');
    } else {
      setField(comments, 'ORIGINALYEAR', [String(Math.trunc(originalYear))]);
    }
  }

  const track = normalizeNumberPair(patch.track, 'track');
  if (track !== undefined) {
    if (track === null) {
      removeField(comments, 'TRACKNUMBER');
      removeField(comments, 'TRACKTOTAL');
      removeField(comments, 'TOTALTRACKS');
    } else {
      if (track.no !== undefined) {
        setField(comments, 'TRACKNUMBER', track.no === null ? null : [String(track.no)]);
      }
      if (track.of !== undefined) {
        setField(comments, 'TRACKTOTAL', track.of === null ? null : [String(track.of)]);
        removeField(comments, 'TOTALTRACKS');
      }
    }
  }

  const disk = normalizeNumberPair(patch.disk, 'disk');
  if (disk !== undefined) {
    if (disk === null) {
      removeField(comments, 'DISCNUMBER');
      removeField(comments, 'DISCTOTAL');
      removeField(comments, 'TOTALDISCS');
    } else {
      if (disk.no !== undefined) {
        setField(comments, 'DISCNUMBER', disk.no === null ? null : [String(disk.no)]);
      }
      if (disk.of !== undefined) {
        setField(comments, 'DISCTOTAL', disk.of === null ? null : [String(disk.of)]);
        removeField(comments, 'TOTALDISCS');
      }
    }
  }

  // Pictures are written as native FLAC PICTURE blocks. Remove the legacy
  // base64 Vorbis field when the caller explicitly updates pictures.
  if (patch.picture !== undefined) {
    removeField(comments, 'METADATA_BLOCK_PICTURE');
  }

  if (patch.native !== undefined) {
    if (patch.native === null) {
      // A null native patch is a no-op: it does not mean "remove all tags".
    } else {
      for (const [key, value] of Object.entries(patch.native)) {
        validateFieldName(key);
        if (value === null) {
          removeField(comments, key);
          continue;
        }
        if (typeof value !== 'string' && !Array.isArray(value)) {
          throw new InvalidPatchError(`native.${key} must be a string, an array of strings, or null`);
        }
        const values = typeof value === 'string' ? [value] : [...value];
        for (const entry of values) {
          if (typeof entry !== 'string') {
            throw new InvalidPatchError(`native.${key} must contain only strings`);
          }
        }
        setField(comments, key, values);
      }
    }
  }

  // Validate the final field set, including values inherited from the input.
  for (const comment of comments) {
    validateFieldName(comment.key);
    if (comment.value.includes('\u0000')) {
      throw new InvalidPatchError(`Vorbis Comment field '${comment.key}' contains a NUL character`);
    }
  }

  return { vendor: fields.vendor, comments };
}

function setField(comments: VorbisComment[], key: string, values: readonly string[] | null): void {
  const upper = key.toUpperCase();
  let firstIndex = -1;
  for (let index = comments.length - 1; index >= 0; index--) {
    const comment = comments[index];
    if (comment !== undefined && comment.key.toUpperCase() === upper) {
      firstIndex = index;
    }
  }

  if (firstIndex >= 0) {
    comments.splice(firstIndex, 1);
  }
  for (let index = comments.length - 1; index >= 0; index--) {
    const comment = comments[index];
    if (comment !== undefined && comment.key.toUpperCase() === upper) {
      comments.splice(index, 1);
    }
  }

  if (values === null || values.length === 0) {
    return;
  }

  const insertAt = firstIndex >= 0 ? Math.min(firstIndex, comments.length) : comments.length;
  const newComments = values.map(value => ({ key, value }));
  comments.splice(insertAt, 0, ...newComments);
}

function removeField(comments: VorbisComment[], key: string): void {
  const upper = key.toUpperCase();
  for (let index = comments.length - 1; index >= 0; index--) {
    const comment = comments[index];
    if (comment !== undefined && comment.key.toUpperCase() === upper) {
      comments.splice(index, 1);
    }
  }
}

function validateFieldName(key: string): void {
  if (key.length === 0) {
    throw new InvalidPatchError('Vorbis Comment field name must not be empty');
  }
  for (const character of key) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code > 0x7d || character === '=') {
      throw new InvalidPatchError(`Invalid Vorbis Comment field name '${key}'`);
    }
  }
}
