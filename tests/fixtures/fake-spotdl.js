import fs from 'node:fs';

const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-V')) {
  console.log('spotdl 4.2.0');
  process.exit(0);
}

const TRACK_A = '4cOdK2wGLETKBW3PvgPWqT';
const TRACK_B = '0VjIjW4KwNqL3esKw4oRpg';
const target = args.at(-1) || '';
const operation = args[0] || '';

function song(id, name, listName) {
  return {
    name,
    artists: ['Fixture'],
    artist: 'Fixture',
    duration: 12,
    song_id: id,
    url: `https://open.spotify.com/track/${id}`,
    cover_url: 'https://i.scdn.co/image/ab67616d0000b273fixture',
    album_name: 'Fixture Album',
    list_name: listName || null,
  };
}

if (operation === 'save') {
  if (/UNAVAIL|missing/i.test(target)) {
    console.error("ERROR: Couldn't get metadata");
    process.exit(1);
  }
  const playlist = /\/(album|playlist)\//i.test(target);
  const songs = playlist
    ? [
      song(TRACK_A, 'Track One', 'Fixture Playlist'),
      song(TRACK_B, 'Track Two', 'Fixture Playlist'),
    ]
    : [song(TRACK_A, 'Fixture Track', null)];
  console.log(JSON.stringify(songs));
  process.exit(0);
}

if (operation === 'download') {
  const formatFlag = args.indexOf('--format');
  const outputFlag = args.indexOf('--output');
  const ext = formatFlag !== -1 ? args[formatFlag + 1] : 'm4a';
  const output = outputFlag !== -1 ? args[outputFlag + 1] : '01.{output-ext}';
  const dest = String(output).replace('{output-ext}', ext);
  const file = Buffer.alloc(32, 0);
  if (ext === 'mp3') file.write('ID3', 0, 'ascii');
  else if (ext === 'opus' || ext === 'ogg') file.write('OggS', 0, 'ascii');
  else if (ext === 'flac') file.write('fLaC', 0, 'ascii');
  else {
    file.writeUInt32BE(24, 0);
    file.write('ftyp', 4, 'ascii');
    file.write('isom', 8, 'ascii');
  }
  fs.writeFileSync(dest, file);
  process.exit(0);
}

console.error('unknown operation');
process.exit(1);
