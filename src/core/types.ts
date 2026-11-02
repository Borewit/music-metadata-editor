import type { IAudioMetadata, ICommonTagsResult, IPicture } from 'music-metadata';

/**
 * A tag value that may be set, replaced, or removed.
 *
 * - `undefined` (or an absent property) leaves the existing value untouched.
 * - `null` removes the value.
 * - a string or array of strings sets the value.
 */
export type TextPatch = string | readonly string[] | null;

/**
 * Track or disc number, with an optional total.
 *
 * A missing property is left untouched; `null` removes it.
 */
export type NumberPairPatch = Partial<ICommonTagsResult['track']>;

/**
 * Track or disc number as returned by `music-metadata`.
 */
export type NumberPair = ICommonTagsResult['track'];

/**
 * Embedded picture, extending `music-metadata`'s `IPicture` with the optional
 * dimensions that can be stored in a FLAC PICTURE block.
 */
export interface Picture extends IPicture {
  /** Image width in pixels, when known. */
  width?: number;
  /** Image height in pixels, when known. */
  height?: number;
  /** Bits per pixel, when known. */
  colour_depth?: number;
  indexed_color?: number;
  colourDepth?: number;
  /** Number of colours for indexed images, when known. */
  colours?: number;
}

/**
 * Comment value accepted by a patch.
 *
 * This is structurally compatible with `music-metadata`'s `IComment`, but
 * permits descriptor-only comments, matching reader results.
 */
export type Comment = NonNullable<ICommonTagsResult['comment']>[number];

/**
 * Common tag patch.
 *
 * Fields use the same names as `music-metadata`'s `ICommonTagsResult`, so a
 * caller can round-trip values read by `music-metadata` without a translation
 * table.
 */
interface CustomTagPatch {
  notes?: TextPatch;
  barcode?: TextPatch;
  releasecountry?: TextPatch;
  asin?: TextPatch;
  albumartistsort?: TextPatch;
  artistsort?: TextPatch;
  script?: TextPatch;
  releasestatus?: TextPatch;
  releasetype?: TextPatch;
  acoustid_id?: TextPatch;
  rating?: Readonly<NonNullable<ICommonTagsResult['rating']>> | null;
  title?: TextPatch;
  artist?: TextPatch;
  artists?: TextPatch;
  albumartist?: TextPatch;
  albumartists?: TextPatch;
  album?: TextPatch;
  date?: TextPatch;
  originaldate?: TextPatch;
  originalyear?: number | null;
  releasedate?: TextPatch;
  genre?: TextPatch;
  comment?: Comment | readonly Comment[] | string | null;
  composer?: TextPatch;
  lyricist?: TextPatch;
  writer?: TextPatch;
  conductor?: TextPatch;
  remixer?: TextPatch;
  arranger?: TextPatch;
  engineer?: TextPatch;
  producer?: TextPatch;
  mixer?: TextPatch;
  technician?: TextPatch;
  label?: TextPatch;
  catalognumber?: TextPatch;
  isrc?: TextPatch;
  bpm?: number | string | null;
  copyright?: TextPatch;
  media?: TextPatch;
  mood?: TextPatch;
  grouping?: TextPatch;
  subtitle?: TextPatch;
  website?: TextPatch;
  lyrics?: TextPatch | readonly Comment[] | ICommonTagsResult['lyrics'];
  picture?: readonly Picture[] | null;
  movementIndex?: NumberPairPatch | null;
  track?: NumberPairPatch | null;
  disk?: NumberPairPatch | null;
  /** MusicBrainz recording identifier (the Vorbis `MUSICBRAINZ_TRACKID` field). */
  musicbrainz_recordingid?: TextPatch;
  /** MusicBrainz release-track identifier (the Vorbis `MUSICBRAINZ_RELEASETRACKID` field). */
  musicbrainz_trackid?: TextPatch;
  /** MusicBrainz release identifier. */
  musicbrainz_albumid?: TextPatch;
  /** MusicBrainz artist identifier. */
  musicbrainz_artistid?: TextPatch;
  /** MusicBrainz album-artist identifier. */
  musicbrainz_albumartistid?: TextPatch;
  /** MusicBrainz release-group identifier. */
  musicbrainz_releasegroupid?: TextPatch;
  /** MusicBrainz work identifier. */
  musicbrainz_workid?: TextPatch;
  /** ReplayGain track gain, e.g. `-6.20 dB`. */
  replaygain_track_gain?: TextPatch | ICommonTagsResult['replaygain_track_gain'];
  /** ReplayGain track peak, e.g. `0.988`. */
  replaygain_track_peak?: TextPatch | ICommonTagsResult['replaygain_track_peak'];
  /** ReplayGain album gain, e.g. `-6.20 dB`. */
  replaygain_album_gain?: TextPatch | ICommonTagsResult['replaygain_album_gain'];
  /** ReplayGain album peak, e.g. `0.988`. */
  replaygain_album_peak?: TextPatch | ICommonTagsResult['replaygain_album_peak'];
  /**
   * Format-native fields, applied after the common mapping.
   *
   * For MP3 use frame IDs (TXXX:description for user text), structured native
   * objects for APIC/COMM/USLT/UFID/POPM/TIPL/TMCL, or raw Uint8Array bodies
   * for binary frames. For FLAC use Vorbis Comment field names, e.g.
   * `{ "MY_FIELD": "value" }`. Use `null` to remove a field.
   */
  native?: Readonly<
    Record<
      string,
      | string
      | readonly string[]
      | Uint8Array
      | Readonly<Record<string, unknown>>
      | readonly Readonly<Record<string, unknown>>[]
      | null
    >
  > | null;
}

/**
 * Policy for the FLAC padding block.
 *
 * The default keeps existing padding when possible and adds 8192 bytes when a
 * rewrite is required. Set to `0` to remove padding.
 */
type CommonPatch = { [K in keyof ICommonTagsResult]?: ICommonTagsResult[K] | null };

/** All reader common fields are accepted, plus the editor's patch conveniences. */
export type TagPatch = Omit<CommonPatch, keyof CustomTagPatch> & CustomTagPatch;

export type PaddingOption = number;

export interface WriteOptions {
  /**
   * Discard the existing leading ID3v2.2/2.3/2.4 tag and trailing ID3v1 tag
   * before writing the patch as ID3v2.4. In WAV, replaces the ID3 chunk contents.
   * Unspecified ID3 fields are lost.
   * Other trailing metadata (such as APE) is preserved. MP3 and WAV ID3 chunks only.
   */
  replaceId3?: boolean;
  /** Remove a nonstandard leading ID3 tag when rewriting FLAC metadata. */
  stripFlacId3?: boolean;
  /**
   * Target amount of padding to keep or add, in bytes. Defaults to 8192.
   */
  padding?: PaddingOption;
  /**
   * Write through a temporary file and rename it into place. Defaults to
   * `true`. Only applies to `updateFile`. When false, stage output in memory
   * and overwrite the existing file in place; this is not crash-atomic.
   */
  atomic?: boolean;
  /**
   * Keep a backup of the original file. Defaults to `false`.
   */
  backup?: boolean;
  /**
   * Parse and build the output, but do not write anything. `updateFile`
   * returns the byte count that would be written.
   */
  dryRun?: boolean;
}

/**
 * Result of a FLAC, MP3 or WAV write operation.
 */
export interface WriteResult {
  /** Container format that was written. */
  format: 'flac' | 'mp3' | 'wav';
  /** Total number of bytes in the resulting file. */
  bytesWritten: number;
  /** Padding bytes in the resulting metadata section. */
  paddingBytes: number;
  /** Whether an atomic rename was performed. */
  atomic: boolean;
}

/**
 * Result of reading tags from a file or buffer.
 *
 * `common`, `native`, and `pictures` are the corresponding `music-metadata`
 * structures, so values can be passed between the two packages without a
 * translation table.
 */
export interface ReadResult {
  /** Container format, lower-cased, e.g. `flac` or `mp3`. */
  format: string;
  common: CommonTags;
  native: IAudioMetadata['native'];
  pictures: Picture[];
}

/**
 * Common tags as returned by `music-metadata`.
 */
export type CommonTags = ICommonTagsResult;
