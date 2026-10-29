# music-metadata-editor

Write metadata to common audio files from Node.js, designed to sit alongside
[`music-metadata`](https://github.com/Borewit/music-metadata).

> **Status: M1 (FLAC / Vorbis Comment).**
> FLAC reading and writing is implemented. MP3 / ID3v2.4 is the next milestone
> and is currently rejected with a clear `UnsupportedFormatError`.

## Features

- Patch-based API: change only the fields you pass.
- `undefined` keeps a value, `null` deletes it, strings/arrays set it.
- Preserves unknown FLAC metadata blocks and the complete audio payload.
- Preserves an existing ID3v2 prefix on FLAC files.
- Reads and writes native FLAC `PICTURE` blocks.
- Keeps or adds FLAC padding so repeated edits do not grow the file forever.
- Atomic writes by default (temporary file + `fsync` + rename).
- Buffer and file APIs.
- Shares random-access tokenization with `strtok3`.
- Serializes numeric fields with `token-types` tokens, and text with
  `@borewit/text-codec`.
- `readTags` delegates to [`music-metadata`](https://github.com/Borewit/music-metadata),
  which is an **optional peer dependency**. Writing (`updateFile` /
  `updateBuffer`) works without it.

## Install

```bash
npm install music-metadata-editor
```

To read tags with `readTags`, also install `music-metadata`:

```bash
npm install music-metadata
```

`music-metadata` is an optional peer dependency: `updateFile` and
`updateBuffer` do not need it. Calling `readTags` without it throws
`UnsupportedFeatureError`.

Requires Node.js 22 or later. The package is ESM-only.

## Usage

```ts
import { readTags, updateFile, updateBuffer } from 'music-metadata-editor';

// Read tags through music-metadata. Install it alongside the editor.
const metadata = await readTags('track.flac');
console.log(metadata.common.title);
console.log(metadata.native.vorbis?.find(tag => tag.id === 'TITLE')?.value);
console.log(metadata.pictures);

// Patch a file. Only the supplied fields change.
await updateFile('track.flac', {
  title: 'New title',
  artists: ['Artist A', 'Artist B'],
  album: 'New album',
  genre: ['Jazz'],
  track: { no: 4, of: 12 },
  picture: null // remove embedded pictures
});

// Work entirely in memory.
const output = await updateBuffer(input, { title: 'New title' });
```

### Patch semantics

| Value | Meaning |
| --- | --- |
| property absent / `undefined` | keep the existing value |
| `null` | remove the value |
| `string` | set a single value |
| `string[]` | set repeated values (where supported) |
| `track: { no: 4 }` | set the track number, leave the total untouched |
| `track: null` | remove the track number and total |
| `native: { MY_FIELD: 'x' }` | set a format-native Vorbis Comment field |
| `native: { MY_FIELD: null }` | remove a format-native field |

`artist` and `artists` both map to the Vorbis `ARTIST` field. If both are
provided, `artists` wins because it is applied last. The same applies to
`albumartist` / `albumartists`.

### Write options

```ts
await updateFile('track.flac', patch, {
  padding: 8192, // target padding in bytes; 0 removes padding
  atomic: true,  // default
  backup: false, // write a .bak copy before replacing the file
  dryRun: false  // build the output but do not write
});
```

## Supported tags

The common tag names follow `music-metadata`'s `ICommonTagsResult`, including
title, artist(s), album artist(s), album, date, original date, release date,
genre, comment, composer, lyricist, writer, conductor, remixer, arranger,
engineer, producer, mixer, technician, label, catalogue number, ISRC, BPM,
copyright, media, mood, grouping, subtitle, website, lyrics, track/disc
numbers, pictures, MusicBrainz IDs, and ReplayGain fields.

Anything else can be written through the `native` escape hatch. Native keys are
case-insensitive when writing. `readTags` returns `music-metadata`'s native
structure, keyed by tag type (`vorbis`, `ID3v2.4`, …).

## Architecture

```
src/
  core/       errors, types, byte reader/writer, random-access source,
              format detection, patch helpers, atomic file writer
  flac/       metadata blocks, Vorbis Comment codec, PICTURE codec, rewrite
  mapping/    common tags <-> Vorbis Comment fields
```

Numeric fields are encoded with the matching `token-types` token (for example
`UINT24_BE` for a FLAC block length and `UINT32_LE` for a Vorbis Comment
length). `TokenWriter` in `src/core/bytes.ts` reserves space and calls the
token's `put` method, so read and write paths share the same byte-order
definitions. Variable-length data uses `@borewit/text-codec` for UTF-8 and
`writeBytes` for raw payloads.

Reading is delegated to `music-metadata`; the editor keeps only the structural
FLAC parsing needed to preserve unknown blocks and the audio payload.

The FLAC writer rebuilds only the metadata block chain and streams the audio
payload from the original file. It never loads the whole audio file into memory
for the file API.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

Real-world FLAC fixtures are picked up from
`../music-metadata/test/samples` when that checkout is present. Override the
location with `MUSIC_METADATA_SAMPLES=/path/to/samples npm test`.

## Roadmap

- **M0/M1** — scaffold, core I/O, FLAC / Vorbis Comment. *(this release)*
- **M2** — MP3 / ID3v2.4, including unknown-frame preservation and padding.
- **M3** — MP4 / M4A.
- **M4** — hardening, fuzzing, larger real-world corpus, optional formats.

## License

MIT. `mutagen` was used as a behavioural reference only; no GPL code is
included.
