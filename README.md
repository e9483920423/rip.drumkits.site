# rip.drumkits.site

Open-source media downloader. Paste a link, pick a format, and the file is streamed to your browser. The server does not keep a copy. There is no login.

## Accepted sites

```
┌──────────────┬──────────────────────────────────────────────┐
│ YouTube      │ Videos and playlists                         │
│ SoundCloud   │ Tracks and sets                              │
│ Spotify      │ Tracks, albums, and playlists (via spotDL)   │
│ Bandcamp     │ Tracks and albums                            │
│ Vimeo        │ Creator videos and showcases                 │
│ Twitch       │ VODs and clips                               │
│ Bilibili     │ Videos and some collections                  │
│ Reddit       │ Video posts                                  │
│ X            │ Publicly accessible video posts              │
│ Facebook     │ Supported video pages                        │
│ Flickr       │ Videos hosted with photos                    │
│ PeerTube     │ Listed federated instances                   │
│ Dailymotion  │ Hosted videos                                │
│ TED          │ Talks and playlists                          │
└──────────────┴──────────────────────────────────────────────┘
```

[yt-dlp](https://github.com/yt-dlp/yt-dlp) ships well over a thousand site-specific extractors. This app still only allowlists the hosts above, so random URLs are rejected. Live streams, logins, cookies, and DRM bypass are not supported.

Spotify links are resolved with [spotDL](https://github.com/spotDL/spotify-downloader), which matches Spotify metadata to YouTube audio. It does not rip Spotify's own streams.

PeerTube is federated. The allowlist currently includes `peertube.tv`, `framatube.org`, `video.blender.org`, `tilvids.com`, and `tube.tchncs.de`.

Bandcamp artist pages on `*.bandcamp.com` are accepted. Custom artist domains that only proxy Bandcamp are not.

## What it does

- Shows the title, uploader, duration, and a thumbnail when one is available.
- For a playlist, set, album, or showcase, lists tracks so you can pick one or a few. One selected track is a normal file. Two or more are zipped.
- Offers M4A, MP3, Opus, FLAC, and (on video sites) MP4 up to 1080p or 720p. SoundCloud, Spotify, and Bandcamp are audio-only. FLAC is a lossless re-encode of already-lossy source audio, so it is larger without restoring missing quality.
- Starts a normal browser download. Progress is the browser download UI.
- Does not keep finished files or a download history on the server.

Live streams, YouTube mixes, Watch Later, Liked videos, channel pages, Twitch live channels, and Spotify artist/show/episode pages are not listed.

## Install dependencies

You need **Node.js 24+**, **yt-dlp**, **FFmpeg**, **Python 3.10+**, and **spotDL**. Deno is optional but recommended so spotDL can fetch some YouTube matches.

### Windows

Install the runtimes and tools with WinGet, then spotDL with pip. Use PowerShell.

```powershell
winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
winget install --id Gyan.FFmpeg -e --accept-package-agreements --accept-source-agreements
winget install --id yt-dlp.yt-dlp -e --accept-package-agreements --accept-source-agreements
winget install --id Python.Python.3.13 -e --accept-package-agreements --accept-source-agreements
winget install --id DenoLand.Deno -e --accept-package-agreements --accept-source-agreements
```

`OpenJS.NodeJS.LTS` is currently Node.js 24. After installing, close and reopen the terminal so `node`, `python`, `yt-dlp`, `ffmpeg`, and `deno` are on `PATH`.

```powershell
node -v
python --version
yt-dlp --version
ffmpeg -version
```

Install spotDL into your user site-packages:

```powershell
python -m pip install --user --upgrade pip
python -m pip install --user --upgrade spotdl
```

pip will print a Scripts folder that is often not on `PATH`, for example:

`%LOCALAPPDATA%\Packages\PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0\LocalCache\local-packages\Python313\Scripts`

Add that folder to your user PATH, then reopen the terminal:

```powershell
spotdl --version
```

If `spotdl` is still not found, set `SPOTDL_PATH` in `.env` to the full path of `spotdl.exe`.

Optional, for YouTube matches that need Deno inside spotDL's own folder:

```powershell
spotdl --download-deno
```

### Linux / Debian

```bash
sudo apt update
sudo apt install -y ca-certificates curl ffmpeg python3 pipx
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

Install spotDL:

```bash
pipx ensurepath
pipx install spotdl
spotdl --version
```

Optional Deno for some YouTube matches:

```bash
spotdl --download-deno
```

Or install Deno system-wide from https://deno.land.

## Install and configure the app

```bash
sudo mkdir -p /opt/media-downloader
sudo chown "$USER":"$USER" /opt/media-downloader
git clone https://github.com/e9483920423/rip.drumkits.site.git /opt/media-downloader
cd /opt/media-downloader
npm install
cp .env.example .env
```

On Windows, clone into a folder you own, then run `npm install` and `copy .env.example .env` from that folder.

Edit `.env` before starting. The defaults listen on `127.0.0.1:3000` and use `./data` for short-lived temp files. Set `HOST=0.0.0.0` to reach the site from other devices.

Useful limits:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind address |
| `MAX_CONCURRENT_JOBS` | 1 | Active downloads |
| `MAX_FILE_SIZE_MB` | 500 | Largest accepted stream |
| `MAX_PLAYLIST_ENTRIES` | 100 | Tracks shown from a playlist |
| `MAX_ZIP_ITEMS` | 20 | Tracks in one zip |
| `MAX_ZIP_SIZE_MB` | 2048 | Largest accepted zip |
| `MAX_DURATION_SECONDS` | 7200 | Longest accepted item |
| `JOB_TIMEOUT_SECONDS` | 1800 | Kill a stuck stream |
| `TEMP_RETENTION_HOURS` | 6 | Delete leftover temp directories |
| `RATE_LIMIT_PER_MINUTE` | 60 | General API requests per client address |
| `RATE_LIMIT_INSPECT_PER_MINUTE` | 30 | Inspect requests per client address |
| `RATE_LIMIT_DOWNLOAD_PER_MINUTE` | 10 | Download requests per client address |
| `MIN_FREE_DISK_MB` | 512 | Refuse a download if temp disk is below this |
| `ACCESS_TOKEN` | unset | Optional shared secret when `HOST` is not loopback |

`YTDLP_PATH`, `FFMPEG_PATH`, and `SPOTDL_PATH` are server settings. API clients cannot change them or pass extra yt-dlp or spotDL arguments.

## Limits

- One media item per download, or a zip of selected playlist tracks up to `MAX_ZIP_ITEMS`.
- Playlist listing is capped at `MAX_PLAYLIST_ENTRIES`.
- `yt-dlp` and `spotdl` still contact the provider's own media hosts after the URL is accepted. Those CDN hosts cannot be submitted as the page URL.
- YouTube short links such as `youtu.be/VIDEOID` are turned into a canonical watch URL. SoundCloud `on.soundcloud.com`, Spotify `spotify.link`, Bilibili `b23.tv`, Dailymotion `dai.ly`, Flickr `flic.kr`, Reddit `v.redd.it`, and Facebook `fb.watch` links are followed for up to five hops, and each hop must stay on an allowed host and resolve to a public address.
- Concurrent streams are capped.
- Output size, duration, and runtime are capped. Merge and convert steps may write short-lived temp files under `DATA_DIR/tmp`, which are deleted when the stream ends.

## Run and test

```bash
npm test
npm start
```

`npm start` loads `.env` when that file exists. Open `http://127.0.0.1:3000`.

The process still starts when `yt-dlp`, FFmpeg, or spotDL is missing. `GET /api/health` reports that, and the page shows a banner. YouTube, SoundCloud, and the other yt-dlp sites need yt-dlp and FFmpeg. Spotify needs spotDL and FFmpeg. Inspect and download return 503 for a source until its tools are installed and the process is restarted.

State-changing requests send `X-Media-Request: 1`:

```bash
curl -s http://127.0.0.1:3000/api/health
curl -s -X POST http://127.0.0.1:3000/api/media/info \
  -H 'content-type: application/json' \
  -H 'x-media-request: 1' \
  -H 'x-access-token: YOUR_TOKEN' \
  -d '{"url":"https://www.youtube.com/watch?v=VIDEOID"}'
```

## Update yt-dlp

Windows:

```powershell
winget upgrade --id yt-dlp.yt-dlp
```

Debian:

```bash
sudo yt-dlp -U
```

Restart the service afterward. Provider sites change often; an old yt-dlp is the usual cause of "unavailable" or "format" errors.

Update spotDL with `python -m pip install --user --upgrade spotdl` on Windows, or `pipx upgrade spotdl` on Debian.

## Storage and cleanup

The finished media is not stored. yt-dlp and spotDL write merge/convert fragments into `DATA_DIR/tmp/<ticket>/` while the browser download is running, then that directory is deleted. Playlist zips are built in that same temp folder and deleted after the zip is sent. Closing the browser tab aborts the process and deletes the temp files.

A timer deletes leftover temp directories older than `TEMP_RETENTION_HOURS`, except directories for streams that are still running. Set `CLEANUP_INTERVAL_MINUTES=0` to disable the timer.

## LAN / public bind

Keep `HOST=127.0.0.1` when you only use the machine itself. To listen on every interface:

```env
HOST=0.0.0.0
PORT=3000
```

Anyone who can open the site can start a download unless you set `ACCESS_TOKEN` (16–128 characters). Loopback binds never require it. On `HOST=0.0.0.0` (or another non-loopback address), inspect and download POSTs must send `X-Access-Token` or `Authorization: Bearer`. Health and the one-time download GET stay public; the GET URL is the capability. The page shows a token field when `/api/health` reports `auth.required`. Put a reverse proxy in front if you expose it beyond your LAN.

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

The unit restarts after a crash, starts on boot, and does not run as root. It also caps memory at 2G, tasks at 128, and CPU at 200%. Keep settings in `.env`, which systemd loads through `EnvironmentFile`.

## Backups

There is no media library or job database to back up. Temp files under `data/tmp` are disposable.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| Banner says yt-dlp, FFmpeg, or spotDL is missing | `yt-dlp --version`, `ffmpeg -version`, and `spotdl --version` as the service user. Set `YTDLP_PATH`, `FFMPEG_PATH`, and `SPOTDL_PATH` if they are not on `PATH`. Restart. |
| Unsupported URL | Use a video, track, playlist, set, album, showcase, VOD, or clip from an allowlisted site. Channels, live streams, YouTube mixes, and Spotify artist/show pages are not listed. |
| Restricted | The source refused the item. Public pages only; this app does not log in or send cookies. |
| Unavailable, or the format is missing | Update yt-dlp. The item may also be blocked, removed, or too long for `MAX_DURATION_SECONDS`. |
| Rate limited | The source asked the server to slow down, or this server's inspect/download limit was hit. Wait and try once. |
| Timed out | Raise `JOB_TIMEOUT_SECONDS`, or the network path to the source is stalled. |
| Out of disk space or permission errors | Free space for temp files (`MIN_FREE_DISK_MB`). The service user must own `data/`. |
| 401 / access token | Set `ACCESS_TOKEN` in `.env` and send it from the token field, or leave `HOST` on loopback. |
| A download is already running | Wait for the current stream to finish or raise `MAX_CONCURRENT_JOBS`. |

Server logs are JSON lines. They can include a short process snippet for diagnosis. API responses do not include stack traces, filesystem paths, or that snippet.

## License

MIT. See [LICENSE](LICENSE).

You are responsible for what you download and for following each site's terms.

## Layout

`src/server.js` starts Fastify. Routes live in `src/routes/`. URL checks, yt-dlp, spotDL, and streaming are split under `src/services/`. The browser UI is plain HTML, CSS, and JavaScript in `public/`. Tests in `tests/` use fake yt-dlp and spotDL scripts and do not call live providers.
