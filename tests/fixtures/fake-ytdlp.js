import fs from 'node:fs';

const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-version')) {
  console.log('fake-ytdlp 1.0.0');
  process.exit(0);
}

const target = args.at(-1) || '';
if (target.includes('UNAVAILABCD')) {
  console.error('ERROR: Video unavailable');
  process.exit(1);
}

if (args.includes('--dump-single-json')) {
  if (args.includes('--flat-playlist') || target.includes('playlist?list=') || target.includes('/sets/')) {
    console.log(JSON.stringify({
      _type: 'playlist',
      id: 'PLfakelist1234567890123456789012',
      title: 'Fixture Playlist',
      uploader: 'Fixture',
      extractor_key: 'YoutubeTab',
      playlist_count: 2,
      entries: [
        { id: 'dQw4w9WgXcQ', title: 'Track One', duration: 12, ie_key: 'Youtube' },
        { id: 'jNQXAC9IVRw', title: 'Track Two', duration: 8, ie_key: 'Youtube' },
      ],
    }));
    process.exit(0);
  }
  console.log(JSON.stringify({
    _type: 'video',
    id: 'dQw4w9WgXcQ',
    title: 'Fixture Track',
    uploader: 'Fixture',
    duration: 12,
    filesize_approx: 1000,
    extractor_key: 'Youtube',
    is_live: false,
  }));
  process.exit(0);
}

const outputFlag = args.indexOf('-o');
if (outputFlag === -1 || !args[outputFlag + 1]) {
  console.error('missing output template');
  process.exit(1);
}

const audioFlag = args.indexOf('--audio-format');
const mergeFlag = args.indexOf('--merge-output-format');
let ext = 'm4a';
if (audioFlag !== -1) ext = args[audioFlag + 1];
else if (mergeFlag !== -1) ext = args[mergeFlag + 1];

const file = Buffer.alloc(32, 0);
if (ext === 'mp3') file.write('ID3', 0, 'ascii');
else if (ext === 'opus' || ext === 'ogg') file.write('OggS', 0, 'ascii');
else if (ext === 'flac') file.write('fLaC', 0, 'ascii');
else {
  file.writeUInt32BE(24, 0);
  file.write('ftyp', 4, 'ascii');
  file.write('isom', 8, 'ascii');
}

const output = args[outputFlag + 1];
if (output === '-') {
  process.stdout.write(file);
  process.exit(0);
}

fs.writeFileSync(output.replace('%(ext)s', ext), file);
process.exit(0);
