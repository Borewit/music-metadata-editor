[![CI](https://github.com/Borewit/music-metadata-editor/actions/workflows/ci.yml/badge.svg)](https://github.com/Borewit/music-metadata-editor/actions/workflows/ci.yml)
[![NPM version](https://img.shields.io/npm/v/music-metadata-editor.svg)](https://npmjs.org/package/music-metadata-editor)
[![npm downloads](https://img.shields.io/npm/dm/music-metadata-editor.svg)](https://npmjs.org/package/music-metadata-editor)
[![CodeQL](https://github.com/Borewit/music-metadata-editor/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/Borewit/music-metadata-editor/actions/workflows/codeql-analysis.yml)

# music-metadata-editor

Write metadata to common audio files from Node.js, designed to sit alongside
[`music-metadata`](https://github.com/Borewit/music-metadata).

> **Status: FLAC, MP3 / ID3v2.4 and WAV / ID3v2.4 writing implemented.**
> Existing ID3v2.2/2.3 tags and ID3 tags with header flags (including extended
> headers, tag-level unsynchronisation and footers) are rejected before writing.

## Features

- Patch-based API: change only the fields you pass.
- `undefined` keeps a value, `null` deletes it, strings/arrays set it.
- Preserves unknown FLAC blocks, untouched ID3v2.4 frames, audio and trailing side tags.
- Preserves an existing ID3v2 prefix on FLAC files.
- Reads and writes native FLAC `PICTURE` blocks.
- Keeps or adds FLAC padding so repeated edits do not grow the file forever.
- Atomic writes by default (temporary file + `fsync` + rename).
- Buffer and file APIs.
- Shares random-access tokenization with `strtok3`.
- Serializes numeric and fixed-size fields with `token-types` tokens, and text
  with `@borewit/text-codec`.
- `readTags` delegates to the required `music-metadata` dependency.


## Install

```bash
npm install music-metadata-editor
```

`music-metadata` is installed as a regular dependency and supplies metadata
reading, normalized types and structural tokens.

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
  core/       errors, types, byte readers, random-access source, format
              detection, patch helpers, atomic file writer
  vorbis/     shared Vorbis Comment codec adapter
  flac/       metadata blocks, shared PICTURE codec exports, rewrite
  id3v2/      ID3v2.4 frame codecs and MP3 metadata rewrite
  mapping/    common tags to Vorbis Comment fields and ID3v2.4 frames
```

Shared FLAC headers, picture decoding, ID3 primitives and Vorbis Comment decoding
live in the supported `music-metadata/tokens` subpaths. Picture encoding and
Vorbis serialization live in this editor and use `strtok3.TokenWriter`.
Container traversal, tag mapping, padding and file writes remain in the editor.

Reading is delegated to `music-metadata`; the editor keeps only the structural
parsing needed to preserve unknown blocks and audio payloads.

The FLAC writer rebuilds only the metadata block chain and streams the audio
payload from the original file. It never loads the whole audio file into memory
for the file API.

## Development

`token-types` is installed from npm at version 6.2.0 or later.
`strtok3` is installed from npm at version 10.7.0 or later.
Serialization uses its `TokenWriter.writeBuffer()` method
for raw bytes; write methods return the number of bytes written.
The reader and shared structural tokens are installed from npm through
`music-metadata` 12.3.4 or later. No sibling checkout is needed:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

## License

MIT. `mutagen` was used as a behavioural reference only; no GPL code is
included.


## MP3 / ID3v2.4

The same `updateFile` and `updateBuffer` APIs create an ID3v2.4 tag on
untagged MPEG audio or update an existing v2.4 tag. New text uses UTF-8.
Common mapping includes pictures, comments, lyrics, ratings, contributor
roles and MusicBrainz identifiers. Display artist and individual artists
use separate frames. Track/disc patches preserve omitted components.

For native writes use frame IDs, with `TXXX:description` for user text.
Strings and string arrays write text frames; structured reader values write
APIC, COMM, USLT, UFID, POPM, TIPL and TMCL frames. A `Uint8Array` supplies
a raw frame body. Native fields apply after common fields.

Untouched frames retain their bodies and flags byte-for-byte. Editing a
flagged frame that requires decoding its identity is rejected. Tag-level
flags, extended headers, footers and older ID3 versions are currently
unsupported. Existing ID3v1, APEv2 and Lyrics3 tails are copied unchanged;
editing those side tags is not implemented. Padding controls tag growth;
file updates still rebuild and atomically replace the file.

### Replacing legacy MP3 tags

To discard old ID3 metadata and write a fresh ID3v2.4 tag:

```js
await updateFile('track.mp3', { title: 'New title', artist: 'Artist' }, { replaceId3: true });
```

`replaceId3` removes the leading ID3v2.2, ID3v2.3 or ID3v2.4 tag and a trailing
ID3v1 tag. All unspecified ID3 fields are discarded; this does not convert old
fields. An empty patch writes an empty ID3v2.4 tag. MPEG audio and other trailing
metadata such as APE tags are preserved. The option is rejected for FLAC.
Normal updates preserve existing fields and still require ID3v2.4 input.

## WAV / ID3v2.4

`updateFile` and `updateBuffer` accept RIFF/WAVE files and write an `id3 ` chunk
containing ID3v2.4. The same common and native ID3 patch fields work as for MP3.

```ts
await updateFile('track.wav', { title: 'New title', picture: null });
```

Existing ID3v2.4 frames not touched by the patch are preserved. Existing
ID3v2.2/2.3 chunks require `{ replaceId3: true }`, which discards their contents
and writes only the supplied patch. Both `id3 ` and `ID3 ` chunk names are
recognized; output uses `id3 `.

Audio and all other RIFF chunks (including their padding) are copied unchanged.
RIFF sizes and ID3 chunk padding are rebuilt. Bytes after the declared RIFF
container are preserved outside it. File updates stream unchanged chunks and
support the usual atomic, backup and dry-run options.

This writer supports standard little-endian RIFF/WAVE, not RF64, RIFX or Wave64.
Malformed chunk boundaries and multiple ID3 chunks are rejected before writing.
Existing LIST/INFO or broadcast metadata is preserved without synchronization
with ID3, so applications that prefer those fields may display different values.

### Common-tag type coverage

`TagPatch` derives its complete field set from music-metadata's
`ICommonTagsResult`, while retaining explicit null deletions, partial number
pairs and the editor's string conveniences. Reader common results can be passed
directly without a type cast. ReplayGain `IRatio` objects use decibels for gain
and linear ratios for peak; year, totals and gain-ratio aliases normalize to the
corresponding date, number-pair and ReplayGain fields.

Every common property has a write representation. Existing standard mappings
are used where available; additional properties use descriptive ID3 TXXX or
Vorbis text fields. Writing a field does not imply that every reader maps its
native representation back to a common property. In particular, music-metadata
has fewer common read mappings for ID3 and Vorbis than its cross-format common
interface. Native metadata remains available for inspecting those fields.

Synchronized ID3 lyrics use SYLT and retain their language, descriptor, content
type and timestamp format. Vorbis timed lyrics use LRC with millisecond
precision; MPEG-frame timestamps are rejected because their conversion requires
an audio timebase. Vorbis comments and lyrics do not carry all ID3-specific
language/descriptor information. Ratings in ID3 are quantized to POPM's byte
scale. These format constraints apply when transferring common metadata.

Regression fixtures account for every common property at compile time, verify
an observable native write for each field in MP3, FLAC and WAV, and check full
payload/structural integrity across growing and shrinking metadata, atomic and
in-place file writes, and rejected patches.

### Continuous integration

GitHub Actions checks types, builds the package and inspects its publish contents,
then runs tests on Node.js 22, 24 and 26 on Linux and Windows. A separate job
produces source-mapped V8 coverage in LCOV and HTML formats, available as the
`coverage` workflow artifact. Run `npm run test-coverage` locally for the same
reports. CodeQL scans JavaScript and TypeScript on master, pull requests and a
weekly schedule. No external coverage or quality service is required.

All runtime dependencies are published npm packages, so CI installs from the
lockfile without sibling checkouts. The npm badges become available when the
editor is published.


### File-write failure guarantees

Atomic file updates stage and flush the complete output before renaming it over
its destination. Failures before replacement leave the destination bytes
unchanged. Input and staging handles are released and temporary-file cleanup is
attempted on failure; filesystem errors can prevent cleanup. A requested backup
must finish before replacement proceeds. A failed backup copy can leave a partial
`.bak` file or overwrite a previous backup; backups are not transactional.

A successful rename commits the update. This does not guarantee recovery from
power loss (the parent directory is not fsynced), preserve every filesystem
attribute, or serialize simultaneous updates. With `atomic: false`, writes go
directly to the destination after memory staging; write, truncate or sync failures
can leave partial output. Use the default atomic mode for destination preservation.
