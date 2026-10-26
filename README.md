# rip.drumkits.site

Open-source YouTube and SoundCloud downloader. Paste a link, pick a format, and the file is streamed to your browser. The server does not keep a copy. There is no login.

## What it does

- Accepts a YouTube or SoundCloud URL, including playlist and set links.
- Shows the title, uploader, duration, and a thumbnail when one is available.
- For a playlist or set, lists tracks so you can pick one or a few. One selected track is a normal file. Two or more are zipped.
- Offers M4A, MP3, Opus, FLAC, and (on YouTube) MP4 up to 1080p or 720p. FLAC is a lossless re-encode of already-lossy source audio, so it is larger without restoring missing quality.
- Starts a normal browser download. Progress is the browser download UI.
- Does not keep finished files or a download history on the server.

Live streams, YouTube mixes, Watch Later, Liked videos, and channel pages are not listed.

## Limits

- One media item per download, or a zip of selected playlist tracks up to `MAX_ZIP_ITEMS`.
- Playlist listing is capped at `MAX_PLAYLIST_ENTRIES`.
- `yt-dlp` still contacts the provider's own media hosts after the URL is accepted. Those CDN hosts cannot be submitted as the page URL.
- YouTube short links such as `youtu.be/VIDEOID` are turned into a canonical watch URL. SoundCloud `on.soundcloud.com` links are followed for up to five hops, and each hop must stay on an allowed host and resolve to a public address.
- Concurrent streams are capped.
- Output size, duration, and runtime are capped. Merge and convert steps may write short-lived temp files under `DATA_DIR/tmp`, which are deleted when the stream ends.

## Debian prerequisites

Install the system tools, then Node.js 24 or newer.

```bash
sudo apt update
sudo apt install -y ca-certificates curl ffmpeg python3
```

Check the distro Node.js package with `node -v`. If it is older than 24, install Node.js 24 from NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

Install the current yt-dlp binary:

```bash
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod 755 /usr/local/bin/yt-dlp
yt-dlp --version
ffmpeg -version
```

## Install and configure

```bash
sudo mkdir -p /opt/media-downloader
sudo chown "$USER":"$USER" /opt/media-downloader
git clone https://github.com/e9483920423/rip.drumkits.site.git /opt/media-downloader
cd /opt/media-downloader
npm install
cp .env.example .env
```

Edit `.env` before starting. The defaults listen on `127.0.0.1:3000` and use `./data` for short-lived temp files. Set `HOST=0.0.0.0` to reach the site from other devices.

Useful limits:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind address |
| `MAX_CONCURRENT_JOBS` | 1 | Active `yt-dlp` streams |
| `MAX_FILE_SIZE_MB` | 500 | Largest accepted stream |
| `MAX_PLAYLIST_ENTRIES` | 100 | Tracks shown from a playlist |
| `MAX_ZIP_ITEMS` | 20 | Tracks in one zip |
| `MAX_ZIP_SIZE_MB` | 2048 | Largest accepted zip |
| `MAX_DURATION_SECONDS` | 7200 | Longest accepted item |
| `JOB_TIMEOUT_SECONDS` | 1800 | Kill a stuck stream |
| `TEMP_RETENTION_HOURS` | 6 | Delete leftover temp directories |
| `RATE_LIMIT_PER_MINUTE` | 60 | Requests per client address |

`YTDLP_PATH` and `FFMPEG_PATH` are server settings. API clients cannot change them or pass extra yt-dlp arguments.

## Run and test

```bash
npm test
npm start
```

`npm start` loads `.env` when that file exists. Open `http://127.0.0.1:3000`.

The process still starts when `yt-dlp` or FFmpeg is missing. `GET /api/health` reports that, and the page shows a banner. Inspect and download then return 503 until the tools are installed and the process is restarted.

State-changing requests send `X-Media-Request: 1`:

```bash
curl -s http://127.0.0.1:3000/api/health
curl -s -X POST http://127.0.0.1:3000/api/media/info \
  -H 'content-type: application/json' \
  -H 'x-media-request: 1' \
  -d '{"url":"https://www.youtube.com/watch?v=VIDEOID"}'
```

## Update yt-dlp

```bash
sudo yt-dlp -U
```

Restart the service afterward. Provider sites change often; an old yt-dlp is the usual cause of "unavailable" or "format" errors.

## Storage and cleanup

The finished media is not stored. yt-dlp writes merge/convert fragments into `DATA_DIR/tmp/<ticket>/` while the browser download is running, then that directory is deleted. Playlist zips are built in that same temp folder and deleted after the zip is sent. Closing the browser tab aborts yt-dlp and deletes the temp files.

A timer deletes leftover temp directories older than `TEMP_RETENTION_HOURS`, except directories for streams that are still running. Set `CLEANUP_INTERVAL_MINUTES=0` to disable the timer.

## LAN / public bind

Keep `HOST=127.0.0.1` when you only use the machine itself. To listen on every interface:

```env
HOST=0.0.0.0
PORT=3000
```

There is no account or access token. Anyone who can open the site can start a download. Put a reverse proxy in front if you expose it beyond your LAN.

## systemd

Create an unprivileged user and the writable directories before enabling the unit. `ProtectSystem=strict` only allows writes in the paths listed in the unit.

```bash
sudo useradd --system --create-home --home-dir /opt/media-downloader --shell /usr/sbin/nologin mediadl
sudo mkdir -p /opt/media-downloader/data
sudo chown -R mediadl:mediadl /opt/media-downloader
```

Install dependencies as a user who can write the app directory, then give the tree to `mediadl`. Confirm `which node` is `/usr/bin/node`, or change `ExecStart` in `deploy/media-downloader.service`.

```bash
sudo cp deploy/media-downloader.service /etc/systemd/system/media-downloader.service
sudo systemctl daemon-reload
sudo systemctl enable --now media-downloader
sudo systemctl status media-downloader
journalctl -u media-downloader -f
```

The unit restarts after a crash, starts on boot, and does not run as root. Keep settings in `.env`, which systemd loads through `EnvironmentFile`.

## Backups

There is no media library or job database to back up. Temp files under `data/tmp` are disposable.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| Banner says yt-dlp or FFmpeg is missing | `yt-dlp --version` and `ffmpeg -version` as the service user. Set `YTDLP_PATH` and `FFMPEG_PATH` if they are not on `PATH`. Restart. |
| Unsupported URL | Use a video, track, playlist, or set. Channels and YouTube mixes are not listed. |
| Restricted | The source refused the item. |
| Unavailable, or the format is missing | Update yt-dlp. The item may also be blocked, removed, or too long for `MAX_DURATION_SECONDS`. |
| Rate limited | The source asked the server to slow down. Wait and try once. |
| Timed out | Raise `JOB_TIMEOUT_SECONDS`, or the network path to the source is stalled. |
| Out of disk space or permission errors | Free space for temp files. The service user must own `data/`. |
| A download is already running | Wait for the current stream to finish or raise `MAX_CONCURRENT_JOBS`. |

Server logs are JSON lines. They can include a short process snippet for diagnosis. API responses do not include stack traces, filesystem paths, or that snippet.

## License

MIT. See [LICENSE](LICENSE).

You are responsible for what you download and for following YouTube's and SoundCloud's terms.

## Layout

`src/server.js` starts Fastify. Routes live in `src/routes/`. URL checks, yt-dlp, and streaming are split under `src/services/`. The browser UI is plain HTML, CSS, and JavaScript in `public/`. Tests in `tests/` use a fake yt-dlp script and do not call YouTube or SoundCloud.
