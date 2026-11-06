# AIPic backend — FlyReq Image Studio transplant

This directory vendors the backend of [doudou770/flyreq-image-studio](https://github.com/doudou770/flyreq-image-studio), source commit `9e286d970a67b14465cff35e03a9c5c7712a504c`, copied on September 18, 2026. The original source and the modifications in this directory are distributed under the GNU Affero General Public License, version 3. The full upstream license is preserved in `LICENSE`; retain this notice and provide the corresponding source when distributing or operating modified versions as required by that license.

The original backend's SQLite task queue, task-item results, in-memory API keys, polling/WebSocket endpoints, remote image download/cache, API URL handling, and JSON/SSE response parsing are used directly. The original supporting image/video/logging modules remain present so its imports continue to resolve.

## AIPic adaptations

- Preserve `/api-proxy/*` for existing Responses and custom request modes, forwarding raw multipart uploads and upstream response streams without a heartbeat envelope. The `x-aipic-upstream` header selects the upstream; otherwise `API_PROXY_URL` or the neutral OpenAI API default is used.
- Serve AIPic's Vite `dist` directory directly with Node. Next.js is not needed. The default listen address is `127.0.0.1:8788`.
- Match the original AIPic edit upload contract: reference files use repeated `image[]` multipart fields with one-based filenames. Mask edits retain the original client PNG conversion for the first reference and mask; ordinary reference bytes are preserved.
- Preserve exact frontend pixel sizes such as `3200x2400`; pass compression, moderation, response format, and streaming-preview preferences. Forward editing masks as multipart `mask`; reference-image and mask bytes remain in memory rather than task-request SQLite records.
- Use the generic OpenAI-compatible image path for compatible Grok relays. The specialized xAI path is only used when explicitly requested with `imageApiFlavor: "xai-imagine"` against the native `api.x.ai` hostname.
- Send `stream=true` together with `Accept: text/event-stream` when streaming is enabled. Consume SSE incrementally without a blocking logging clone, distinguish chunk/partial events from final images, and stop as soon as the final image arrives. Record response-header timing, first-chunk timing and event counts without logging image bytes. Gateway errors are shown as concise messages with request IDs.
- Keep the 30-minute deadline active through response-body consumption. One per-image deadline also covers downloading URL results. A partial preview alone is not accepted as a completed generation. Submissions are not automatically repeated after an uncertain failure.
- Preserve the actual pixels returned by the upstream. The original layout-resize behavior is available only through `AIPIC_ENFORCE_IMAGE_LAYOUT=true`.
- Accept request bodies up to 128 MiB to accommodate base64-encoded 4K reference images and masks.

- Recognize GPT Image 2.6 presets and forward supported complexity, extended quality, GIF frame controls and SVG configuration. Store GIF/SVG bytes with their matching extensions and MIME types rather than forcing raster conversion.
- Serve `version.json`, HTML and the service worker with no-store headers so AIPic can detect new builds and refresh after active tasks finish.

## Run

Requires Node.js 22.19 or newer. From the repository root:

```sh
npm install --prefix backend --omit=dev
npm run build:backend
AIPIC_HOST=127.0.0.1 PORT=8788 node backend/server.js
```

The server reads `backend/.env` and root `.env` through the upstream environment loader. It does not load `.env.production` automatically or send server environment values to the browser. API keys for image tasks are supplied in the POST body and held only in memory while the task runs.

`AIPIC_STATIC_DIR` overrides `../dist`. `FLYREQ_TASK_DB`, `FLYREQ_IMAGE_DIR`, and `FLYREQ_VIDEO_DIR` override SQLite and image/video cache paths. Their defaults are `backend/flyreq-tasks.sqlite`, `backend/flyreq-images`, and `backend/flyreq-videos`. Parent database directories are created on startup. Configure `FLYREQ_LOG_DIR`, `FLYREQ_IMAGE_UPSTREAM_LOG_DIR`, and `FLYREQ_VIDEO_UPSTREAM_LOG_DIR` for log storage; set `FLYREQ_IMAGE_UPSTREAM_LOG_ENABLED=false` to disable detailed image-upstream logs.

This standalone backend is required for queued generation. A static-only Cloudflare Pages deployment cannot execute this Node/SQLite server.

## Image task contract

`POST /api/flyreq/tasks` returns HTTP 202 with `{ "taskId": "..." }` immediately after a task is accepted. Required JSON fields:

```json
{
  "apiKey": "<provider key>",
  "baseUrl": "<configured provider URL>",
  "protocol": "openai",
  "mode": "text-to-image",
  "prompt": "CAT",
  "model": "gpt-image-2",
  "parallelCount": 1,
  "outputSize": "4K",
  "customSize": "3200x2400",
  "customSizeAlignMultiple": false,
  "aspectRatio": "auto",
  "images": [],
  "streamImages": true,
  "gptImageQuality": "low",
  "gptImageOutputFormat": "png"
}
```

Optional fields include `gptImageOutputCompression` (0–100), `gptImageModeration` (`auto` or `low`), `responseFormat` (`b64_json` or `url`), and `streamPartialImages` (0–3). Editing uses `mode: "image-to-image"`, `images: [{ "data": "<raw base64>", "mimeType": "image/png" }]`, and optionally `mask` with the same structure. Omit `imageApiFlavor` for generic compatible endpoints.

Poll `GET /api/flyreq/tasks/:taskId`. The queued status is `排队中` (legacy `queued` is also possible), followed by `processing`, then `completed` or `failed`. A completed response contains `result.images`, an array of strings such as `URL:/api/flyreq/images/<taskId>/0/0`; fetch the same-origin path after removing the `URL:` prefix. `warning` may report partial failures in a multi-image task. Errors and expiry are reported in `error`. Result files are retained for 12 hours by the original lifecycle rules; `POST /api/flyreq/tasks/:taskId/ack` reduces retention to two minutes and should only be used after the client has durably saved every result.

The upstream keeps pending keys and attachments in memory. Restarting the backend interrupts unfinished tasks; SQLite preserves terminal results for retrieval within the retention window.
