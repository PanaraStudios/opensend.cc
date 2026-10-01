# Convex file storage

Opensend stores files through Convex. The same file records and helpers serve
channel media, email attachments, received mail, exports, and team assets.
Self-hosted Convex uses the `convex-data` volume by default. For durable remote
storage, configure Convex’s built-in S3-compatible backend; Opensend does not
implement a separate S3, R2, or MinIO provider.

## Direct uploads and limits

`POST /media/uploads` returns `{ id, upload_url, expires_at, provider: "convex" }`.
POST the bytes to `upload_url` with their `Content-Type`, read `{ storageId }`
from the upload response, then call `POST /media/uploads/{id}/complete` with
`{ "storage_id": "…" }`. Complete within the returned 15-minute deadline.
Completion checks the actual size and MIME type in Convex’s `_storage` metadata
and checks WebP sticker animation before accepting the file. Upload IDs are
scoped to a team and WhatsApp account. A storage ID is a private upload receipt;
keep it private until completing the upload. Pending records expire automatically;
if a client uploads bytes but never submits the receipt, those unclaimed bytes
are not associated with a record and require operator cleanup. Existing claimed storage IDs cannot
be attached to another upload, and files predating the upload are refused.

`opensend.media.upload(file, options)` handles these steps for browser files,
Node buffers, and file paths streamed from disk. MCP’s `create-media-upload` and
`complete-media-upload` retain their names and arguments.

Convex upload URLs have **no file-size cap** and a **two-minute POST timeout**.
Opensend still enforces limits per use: WhatsApp images 5 MB, video/audio 16 MB,
documents 100 MB, static stickers 100 KB, animated stickers 500 KB; template
samples up to 16 MB, email attachments 30 MB, team images 1 MB, CSV imports
256 KB. Inbound Meta media is fetched and stored as a Blob in a Node action,
with bounded reads and channel limits, preserving the webhook’s `mimeType`.
Action memory and execution time still apply.

Downloads use `ctx.storage.getUrl`, so large downloads bypass HTTP actions.
These URLs grant bearer access and do not expire automatically. Existing signed
download endpoints remain for compatibility. Outbound WhatsApp media is uploaded
to `/{phone}/media` and sent using Meta’s returned media ID.

The existing multipart `POST /whatsapp/media` retains Opensend’s 20 MB request
limit. This is separate from file storage. As checked on 2026-10-01, the upload
guide says HTTP-action requests are limited to 20 MB, while the limits table says
requests have no specific cap and responses are limited to 20 MiB. Direct upload
URLs avoid this discrepancy and the HTTP-action response cap.

Sources: [uploads](https://docs.convex.dev/file-storage/upload-files),
[files stored by actions](https://docs.convex.dev/file-storage/store-files),
[serving files](https://docs.convex.dev/file-storage/serve-files),
[limits](https://docs.convex.dev/production/state/limits).

## Configure the self-hosted backend

The [official self-hosting guide](https://github.com/get-convex/convex-backend/blob/main/self-hosted/advanced/s3_storage.md)
requires buckets for exports, snapshot imports, modules, files, and search, plus
AWS credentials and region. `S3_ENDPOINT_URL` selects an S3-compatible endpoint
such as R2. These are **Convex container environment variables**, not application
variables set with `pnpm backend env set`. They do not replace SES credentials,
which Opensend stores separately in its encrypted SES connection configuration.

Create the five buckets and credentials that can access them. Add the variables
below to your private `.env.docker` (see `.env.docker.example`), and create a
`compose.storage.yaml` override:

```yaml
services:
  convex:
    environment:
      AWS_REGION: ${AWS_REGION:?Set the backend storage region}
      AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID:?Set the backend storage access key}
      AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY:?Set the backend storage secret}
      S3_ENDPOINT_URL: ${S3_ENDPOINT_URL:-}
      S3_STORAGE_EXPORTS_BUCKET: ${S3_STORAGE_EXPORTS_BUCKET:?Set the exports bucket}
      S3_STORAGE_SNAPSHOT_IMPORTS_BUCKET: ${S3_STORAGE_SNAPSHOT_IMPORTS_BUCKET:?Set the imports bucket}
      S3_STORAGE_MODULES_BUCKET: ${S3_STORAGE_MODULES_BUCKET:?Set the modules bucket}
      S3_STORAGE_FILES_BUCKET: ${S3_STORAGE_FILES_BUCKET:?Set the files bucket}
      S3_STORAGE_SEARCH_BUCKET: ${S3_STORAGE_SEARCH_BUCKET:?Set the search bucket}
```

For AWS S3, omit `S3_ENDPOINT_URL` from the override. For R2 use
`https://<account-id>.r2.cloudflarestorage.com` and region `auto`; for other
S3-compatible backends use their endpoint and supported region. Credentials and
buckets must be dedicated to the Convex backend. Browsers continue uploading to
Convex URLs, so no Opensend browser-to-bucket CORS rule is needed.

For a **fresh backend** with those settings, start the stack using the override:

```sh
docker compose --env-file .env.docker -f compose.yaml -f compose.storage.yaml up -d
```

Include the override on subsequent Compose operations, or set `COMPOSE_FILE` to
`compose.yaml:compose.storage.yaml` in your private environment. Instance settings
shows “Convex storage”; the backend configuration determines whether bytes live
on disk or in remote buckets.

## Change an existing backend’s storage

Do not just switch storage variables on an existing volume. Convex’s official
guide requires snapshot export/import into a **fresh backend** when switching
between filesystem and S3 storage. Preserve the original volume and credentials
until the new backend and file downloads have been verified. Pause writes while
exporting and switching traffic.

Export the original deployment **including file bytes**:

```sh
pnpm backend export --include-file-storage --path /safe/path/convex-backup.zip
```

After configuring a fresh backend with the new provider, point the backend CLI at
that deployment and import the snapshot:

```sh
pnpm backend import --replace-all /safe/path/convex-backup.zip
```

`--replace-all` replaces destination data; use it only on the intended fresh
backend. This is an operator procedure, not a script run by Opensend. See also
[Convex exports](https://docs.convex.dev/database/import-export/export) and
[imports](https://docs.convex.dev/database/import-export/import).

Live schema compatibility is retained: existing optional `storageId`/`fileId`
references, the old `object` provider value and key fields, and migration
checkpoint documents remain valid. The custom object-provider code and migration
runner are unused and removed. Legacy records with a Convex `storageId` still
resolve; an object-only record requires operator recovery of its bytes into
Convex before it can be used. Export/import migrates Convex-managed files, not
objects held only by the removed application provider.
