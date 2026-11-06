# music-metadata-editor

[![NPM version](https://img.shields.io/npm/v/music-metadata-editor.svg)](https://npmjs.org/package/music-metadata-editor)
[![npm downloads](https://img.shields.io/npm/dm/music-metadata-editor.svg)](https://npmjs.org/package/music-metadata-editor)
[![CI](https://github.com/Borewit/music-metadata-editor/actions/workflows/ci.yml/badge.svg)](https://github.com/Borewit/music-metadata-editor/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Borewit/music-metadata-editor/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/Borewit/music-metadata-editor/actions/workflows/codeql-analysis.yml)

**Edit audio tags and cover art from Node.js without re-encoding the audio.**

Fix an album title, organize a music library, embed artwork, or update MusicBrainz
and ReplayGain metadata with the same API across FLAC, MP3, WAV and MP4 files.

- **Change only what you need.** Unspecified tags and audio data are preserved.
- **Use familiar tag names.** Write `title`, `artists`, `album`, `track` and more across formats.
- **Add or remove artwork.** Work with embedded pictures alongside text and numeric tags.
- **Choose files or buffers.** Update a file on disk or get a new buffer in memory.
- **Write safely by default.** File updates use atomic replacement, with optional backups and dry runs.

[Quick start](#quick-start) · [Supported formats](#supported-formats) · [Supported tags](#supported-tags) ·
[Write options](#write-options) · [Format notes](#format-notes)

## How it works

Pass a **patch** containing the tags you want to change. The editor detects the
file format, merges the patch with existing metadata, and rebuilds the metadata
while copying the encoded audio unchanged. Omit a field to keep it; use `null` to
delete it.

`updateFile` writes the result to a temporary file and atomically replaces the
original by default. `updateBuffer` returns a new `Uint8Array` and leaves its input
untouched. `readTags` returns common tags, native tags and embedded pictures.

## Supported formats

These formats support both file and buffer updates:

| Audio container | Extensions | Tags written |
| --- | --- | --- |
| **FLAC** | `.flac` | Vorbis Comments and native FLAC pictures |
| **MP3** | `.mp3` | ID3v2.4; also creates tags on untagged MPEG audio |
| **WAV** | `.wav` | ID3v2.4 in a RIFF/WAVE `id3 ` chunk |
| **MP4 / M4A / M4B** | `.mp4`, `.m4a`, `.m4b` | iTunes-style metadata, including AAC and ALAC audio |

Existing ID3v2.2/2.3 tags require explicit replacement. MP4 writing supports
non-fragmented, self-contained files with iTunes metadata. See
[format notes](#format-notes) for compatibility details.

## Quick start

Requires **Node.js 22 or later**. The package is **ESM-only**.

```sh
npm install music-metadata-editor
```

### Edit a file

```js
import { readTags, updateFile } from 'music-metadata-editor';

await updateFile('track.flac', {
  title: 'New title',
  artists: ['Artist A', 'Artist B'],
  album: 'New album',
  genre: ['Jazz'],
  track: { no: 4, of: 12 }
});

const metadata = await readTags('track.flac');
console.log(metadata.common.title); // New title
console.log(metadata.common.track); // { no: 4, of: 12 }
```

Use the same calls with a supported `.mp3`, `.wav`, `.m4a` or `.mp4` file.

### Add or remove cover art

```js
import { readFile } from 'node:fs/promises';
import { updateFile } from 'music-metadata-editor';

await updateFile('track.m4a', {
  picture: [{ format: 'image/jpeg', data: await readFile('cover.jpg') }]
});

// Remove all embedded pictures.
await updateFile('track.m4a', { picture: null });
```

MP4 artwork accepts JPEG and PNG. Passing a `picture` array replaces the existing
pictures; to keep them, omit the field.

### Work with a buffer

```js
import { readFile, writeFile } from 'node:fs/promises';
import { updateBuffer } from 'music-metadata-editor';

const input = await readFile('track.mp3');
const output = await updateBuffer(input, { title: 'New title' });
await writeFile('updated.mp3', output);
```

## Supported tags

Common tag names work across formats. FLAC, MP3 and WAV provide a write
representation for every common field in `TagPatch`; the table below highlights
the main groups. MP4 supports the fields listed in its column and rejects other
common fields with an explicit error.

| Group | FLAC, MP3 and WAV examples | MP4 fields |
| --- | --- | --- |
| Titles and artists | `title`, `artist`, `artists`, `albumartist`, `albumartists`, `album` | Same |
| Dates | `date`, `year`, `originaldate`, `originalyear`, `releasedate` | Same |
| Track and disc | `track`, `disk`, `totaltracks`, `totaldiscs` | Same |
| Classification | `genre`, `bpm`, `mood`, `grouping`, `media`, `key`, `compilation`, `gapless` | Same |
| Credits | `composer`, `lyricist`, `writer`, `conductor`, `remixer`, `arranger`, `engineer`, `producer`, `mixer`, `technician`, `performer` | All listed except `writer`, `arranger`, `technician` |
| Release details | `label`, `catalognumber`, `barcode`, `isrc`, `asin`, `releasestatus`, `releasetype`, `releasecountry` | Same |
| Text and artwork | `comment`, `lyrics`, `picture`, `copyright`, `description`, `longDescription`, `work`, `subtitle`, `discsubtitle`, `language`, `script`, `encodedby` | Same; lyrics/comments retain text only, artwork is JPEG/PNG |
| Sorting | `titlesort`, `artistsort`, `albumartistsort`, `albumsort`, `composersort` | Same |
| MusicBrainz | Recording, release-track, album, artist, album-artist, release-group, work and disc IDs | Same; use the `musicbrainz_` fields listed below |
| ReplayGain | Track/album gain and peak | Same; use the `replaygain_` fields listed below |
| Further common fields | Ratings, websites, movements, podcast information and other `TagPatch` fields | Use native items where applicable; no common-field mapping |

MusicBrainz fields: `musicbrainz_recordingid`, `musicbrainz_trackid`,
`musicbrainz_albumid`, `musicbrainz_artistid`, `musicbrainz_albumartistid`,
`musicbrainz_releasegroupid`, `musicbrainz_workid`, `musicbrainz_discid`.
Recording and release-track IDs are separate fields.

ReplayGain fields: `replaygain_track_gain`, `replaygain_track_peak`,
`replaygain_album_gain`, `replaygain_album_peak`. Gains accept text such as
`'-6.20 dB'`; peaks accept text such as `'0.988'`. Reader ratio objects are also
accepted: gain uses `dB`, peak uses `ratio`.

Writing a common field does not guarantee that every reader exposes it as a
common tag. Some fields use descriptive native text tags; inspect `metadata.native`
when a reader has no corresponding common mapping. Format differences also affect
lyrics, picture attributes and ratings; see [format notes](#format-notes).

### Patch semantics

| Patch value | Effect |
| --- | --- |
| Absent or `undefined` | Keep the existing value |
| `null` | Delete the value |
| A string, number or boolean | Set the value, according to the field's type |
| A string array | Set repeated values where supported |
| `track: { no: 4 }` | Change the track number and keep its total |
| `track: null` | Remove the track number and total |
| `picture: [...]` | Replace the embedded pictures |

Use `disk` for disc numbers. In FLAC, `artists` takes precedence over `artist`
when both are supplied; the same applies to `albumartists` and `albumartist`.
MP4 uses the same precedence. MP3/WAV store display artists and individual artists
in separate fields. A full `date` takes precedence over the `year` alias.

### Native tags

Use `native` for custom fields or direct access to a format's tags. Native values
apply after common fields, so they can override a common mapping.

| Format | Example |
| --- | --- |
| FLAC / Vorbis Comments | `native: { MY_FIELD: 'Value' }` |
| MP3 or WAV / ID3v2.4 | `native: { 'TXXX:MY_FIELD': 'Value' }` |
| MP4 / iTunes | `native: { '----:com.apple.iTunes:MY_FIELD': 'Value' }` |

Set a native value to `null` to delete it. Vorbis names and MP4 freeform keys are
matched without case sensitivity; MP4 four-character item names are case-sensitive.

ID3 native fields accept frame IDs, structured values for APIC/COMM/USLT/UFID/POPM/TIPL/TMCL,
and raw `Uint8Array` frame bodies. MP4 accepts four-character item names or
`----:mean:name` keys. MP4 strings write UTF-8 data; a `Uint8Array` supplies the
complete item body, including matching `mean` and `name` children for freeform tags.

### Lyrics

`lyrics` accepts a string, one lyrics entry, an array of entries, or `null`.
Entries use the same shape as `music-metadata` results, so `common.lyrics` can
be passed back directly. A lyrics patch replaces all lyrics in the edited
format; it does not merge with existing entries.

```js
await updateFile('track.mp3', {
  lyrics: [
    { language: 'zho', descriptor: '原文', text: '第一行\n第二行' },
    { language: 'eng', descriptor: 'Translation', text: 'First line\nSecond line' }
  ]
});
```

| Input | MP3/WAV | FLAC | MP4 |
| --- | --- | --- | --- |
| `'text'` | `USLT`, language `eng` | one `LYRICS` value | one `©lyr` value |
| Text entry | `USLT` with language and descriptor | text in `LYRICS` | text in `©lyr` |
| Entry with `syncText` | `SYLT` | LRC in `LYRICS` | joined line text |
| Entry with `text` and `syncText` | both `USLT` and `SYLT` | LRC; `text` is not duplicated | text; timing is dropped |

Clearing is consistent: `lyrics: ''`, `lyrics: []` and `lyrics: null` remove
lyrics. An explicit entry with empty text, such as `{ text: '' }`, writes an
empty value. Text-only input replaces text lyrics and removes `SYLT`;
synchronized-only input removes `USLT`. Use an entry with both properties when
both representations should be kept.

FLAC LRC output uses `[mm:ss.mmm]` and requires `timeStampFormat: 2` with a
millisecond timestamp on every line. Reading that value through `music-metadata`
and writing it back normalizes timestamp precision, so byte-identical LRC is not
guaranteed. Use `native: { LYRICS: '...' }` to retain exact LRC text. FLAC does
not store the language, descriptor, content type or timestamp format; MP4 stores
text only. Synchronized-only MP4 input keeps the line text but loses timing.

## Write options

```js
import { updateFile } from 'music-metadata-editor';

const result = await updateFile('track.flac', { title: 'New title' }, {
  backup: true, // keep the original as track.flac.bak
  dryRun: false // true builds the update without writing
});

console.log(result.format, result.bytesWritten, result.paddingBytes, result.atomic);
```

| Option | Default | Effect |
| --- | --- | --- |
| `atomic` | `true` | Stage output and rename it over the original; file API only |
| `backup` | `false` | Copy the original to `<path>.bak` before replacement; file API only |
| `dryRun` | `false` | Build the update and return the expected byte count without writing; file API only |
| `padding` | `8192` | Control metadata padding for FLAC, MP3 and WAV; `0` removes padding. MP4 rejects this option |
| `replaceId3` | `false` | Discard existing ID3 metadata and write a fresh ID3v2.4 tag; MP3 and WAV only |
| `stripFlacId3` | `false` | Remove a nonstandard leading ID3 tag from FLAC; otherwise preserve it |

Atomic updates require write access to the destination directory and space for a
second copy. With `atomic: false`, MP3, FLAC and WAV stage output in memory and
overwrite the original. MP4 stages on disk before copying over the original, so
it still requires directory write access and temporary disk space.

Failures before atomic replacement leave the destination unchanged. A failed
non-atomic overwrite can leave partial output. Backups are not transactional:
a failed backup can leave a partial `.bak` or overwrite an earlier backup.
Atomic replacement does not guarantee recovery from power loss, preserve every
filesystem attribute, or serialize simultaneous updates.

## Format notes

### FLAC

Writes Vorbis Comments and native `PICTURE` blocks, preserves unknown metadata
blocks and encoded audio, and keeps or adds padding. A leading ID3 prefix is
preserved unless `stripFlacId3` is enabled. A native `METADATA_BLOCK_PICTURE`
takes precedence over the common `picture` mapping: base64 picture values are
written as replacement `PICTURE` blocks, and `null` or an empty array removes
them. The corresponding Vorbis artwork comment is removed to avoid duplicates.

### MP3 / ID3v2.4

Creates tags on untagged MPEG audio and patches existing ID3v2.4 tags. Untouched
frames retain their bodies and flags. ID3v1, APEv2 and Lyrics3 tails are preserved;
editing those trailing tags is not implemented.

ID3v2.2/2.3 tags, tag-level flags, extended headers, unsynchronisation and footers
are rejected during normal updates. Editing a flagged frame whose identity
requires decoding is also rejected. To discard existing ID3 metadata explicitly:

```js
import { updateFile } from 'music-metadata-editor';

await updateFile('track.mp3', { title: 'New title' }, { replaceId3: true });
```

This removes the existing leading ID3 tag and trailing ID3v1 tag, then writes
only the supplied patch as ID3v2.4. Other trailing metadata is preserved.
Unspecified ID3 fields are lost; this option does not convert legacy fields.

### WAV / ID3v2.4

Supports standard little-endian RIFF/WAVE and stores ID3v2.4 in an `id3 ` chunk.
Existing `ID3 ` chunks are also recognized. Legacy ID3 chunks require
`replaceId3: true`, which discards their contents and writes only the patch.

Audio, other RIFF chunks and bytes after the declared RIFF container are preserved.
Existing LIST/INFO and broadcast metadata are preserved without synchronization
with ID3, so applications may display different values. RF64, RIFX, Wave64,
malformed chunk boundaries and multiple ID3 chunks are not supported.

### MP4 / M4A / M4B

Supports iTunes-style metadata in non-fragmented, self-contained files. It
preserves untouched items and media samples and updates chunk offsets when
metadata grows or shrinks. Fragmented files, external media references,
non-iTunes layouts and multiple or track-level metadata containers are rejected.
MP4 padding is not implemented; omit `padding`.

Artwork accepts JPEG/PNG. Comments and lyrics store text without ID3-specific
language, descriptors or timing information. Unsupported common fields fail
explicitly rather than being silently omitted.

### Moving metadata between formats

ID3 synchronized lyrics retain language, descriptor, content type and timestamp
format. Vorbis timed lyrics use LRC with millisecond precision; MPEG-frame
timestamps are rejected because conversion requires an audio timebase. Moving
lyrics from MP3/WAV to FLAC or MP4 drops ID3-only attributes. Moving synchronized
lyrics to MP4 keeps the line text but drops timing. See [Lyrics](#lyrics) for the
accepted shapes and clearing semantics. ID3 ratings are quantized to POPM's byte
scale, and MP4 artwork cannot retain all picture attributes.

## Architecture

The editor owns format detection, metadata patches, container traversal, padding
and file replacement. It rebuilds metadata while preserving audio data; default
atomic file writes copy source ranges in bounded chunks.

Dependencies are installed automatically with the package:

| Dependency | Role |
| --- | --- |
| [`music-metadata`](https://github.com/Borewit/music-metadata) | Reads tags and supplies common types and shared structural tokens |
| `file-type` | Detects the audio container |
| `strtok3` | Provides random-access tokenization and `TokenWriter` serialization |
| `token-types` | Reads and writes numeric and fixed-size binary fields |
| `@borewit/text-codec` | Encodes text |

`readTags` delegates decoding to `music-metadata` and returns its `common`,
`native` and picture structures. `TagPatch` derives common fields from its
`ICommonTagsResult` type and adds null deletions, partial number pairs and text
conveniences. Shared FLAC, ID3 and Vorbis primitives come from the
`music-metadata/tokens` subpaths; picture encoding and Vorbis serialization live
in this editor. No separate reader installation or sibling checkout is needed.

```text
src/
  core/       detection, byte sources, patches, types, errors and file writes
  flac/       FLAC metadata and pictures
  id3v2/      ID3v2.4 frames and MP3 rewriting
  wav/        RIFF/WAVE chunks and embedded ID3 updates
  mp4/        iTunes metadata and chunk-offset relocation
  vorbis/     Vorbis Comment serialization
  mapping/    common fields to native tags
```

## Development

```sh
npm ci
npm run typecheck
npm test
npm run build
```

## License

MIT. Mutagen was used as a behavioral reference; no GPL code is included.

### Mixed tag families and deletion

A `null` field removes it from the format being edited, not from every tag
family in the file. Readers merge families, so a preserved side tag can supply
an older value after deletion. Default writes preserve those side tags byte for
byte, including MP3 ID3v1, APEv2 and Lyrics3 trailers and leading FLAC ID3.

For FLAC, use `stripFlacId3: true` together with the patch to physically remove
the leading ID3 tag and prevent its values from resurfacing. For MP3,
`replaceId3: true` removes leading ID3v2 and trailing ID3v1 and rebuilds ID3v2.4
from the submitted patch; omitted fields are lost. It preserves APEv2 and
Lyrics3. ID3v1 has removal support through replacement only; writing/updating
ID3v1, and updating/removing/writing APEv2 or Lyrics3, are outside the editor's
scope. Consequently MP3 replacement cannot guarantee global deletion when those
preserved families contain competing values. Remove those families with another
tool before using this editor when global deletion is required.
