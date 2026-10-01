# S3-compatible file storage

Opensend can keep new files in Cloudflare R2, MinIO, or Amazon S3. Leave
`OBJECT_STORAGE_BUCKET` unset to keep using local Convex storage. Existing files
remain readable from their original provider. The optional migration copies them
to the bucket.

The dashboard uploads directly to a signed bucket PUT URL, then verifies the
file. Downloads use short-lived signed GET URLs. WhatsApp sends use one-hour
signed links refreshed on each attempt. Incoming Meta media streams through two
5 MiB multipart buffers. Email attachments, received MIME and parts, exports,
and team avatars use the same file abstraction.

## Configure R2

1. Create a private bucket in the R2 dashboard, such as `opensend-files`.
2. Create an R2 API token with **Object Read & Write**, restricted to that bucket.
   Save its S3 Access Key ID and Secret Access Key, rather than the management API
   token value.
3. Add these settings to `.env.docker` for a source checkout, or `.env` for a script
   installation:

```dotenv
OBJECT_STORAGE_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
OBJECT_STORAGE_REGION=auto
OBJECT_STORAGE_BUCKET=opensend-files
OBJECT_STORAGE_ACCESS_KEY_ID=YOUR_R2_ACCESS_KEY_ID
OBJECT_STORAGE_SECRET_ACCESS_KEY=YOUR_R2_SECRET_ACCESS_KEY
```

Compose passes these optional variables to the migrate service, which installs
them in Convex. They are independent of SES and the Convex backend's own storage
settings. Run your normal installation update after changing the environment.
Instance Meta and SES settings show only the provider, bucket, and endpoint host.

See [R2 tokens](https://developers.cloudflare.com/r2/api/tokens/) and
[the AWS SDK v3 example](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/).

## Browser CORS

In the bucket CORS settings, allow the exact dashboard origin. For R2, paste:

```json
[
  {
    "AllowedOrigins": ["https://mail.example.com"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Use a separate exact origin for local development, including its port. Uploads
send the declared Content-Type and signed Content-Length. Never send your
Opensend API key to the bucket. A signed URL authorizes its transfer; keep it
private. Completion checks size and type, then copies to a final key so a replay
of the PUT cannot overwrite the accepted file. Temporary uploads expire after
15 minutes; unused completed uploads expire after 30 days. A cron retries failed
deletions.

See [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/) and
[presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

`OBJECT_STORAGE_PUBLIC_BASE_URL=https://assets.example.com` is optional and applies
only to deliberately public team assets. Private media and email attachments
continue using signed S3 URLs. R2 signatures cannot be moved to a custom CDN
hostname. Leave this setting unset unless you have configured public asset delivery.

## MinIO and S3

For MinIO, create a bucket and a service account restricted to it. Set the
endpoint to its externally reachable S3 API origin, such as
`https://objects.example.com`, and the region to `us-east-1`. The endpoint must be
reachable from both browsers and Convex. Opensend uses path-style requests.
Apply the CORS rule through S3 `PutBucketCors`, or convert it to XML for
[`mc cors set`](https://docs.min.io/aistor/reference/cli/mc-cors/mc-cors-set/).

For Amazon S3, leave the endpoint unset and set the bucket's actual AWS region.
Use separate bucket-scoped credentials. Object permissions are `s3:GetObject`,
`s3:PutObject`, `s3:DeleteObject`, `s3:AbortMultipartUpload`, and
`s3:ListMultipartUploadParts`; bucket permissions are `s3:ListBucket` and
`s3:ListBucketMultipartUploads`. Set CORS in the console or use
`aws s3api put-bucket-cors` with `{"CORSRules": [...]}`. Enable a lifecycle rule
to abort abandoned multipart uploads after one day.

The SDK disables optional checksum negotiation for compatibility and aborts
failed multipart uploads. Official references:
[R2 compatibility](https://developers.cloudflare.com/r2/api/s3/api/),
[AWS Upload](https://github.com/aws/aws-sdk-js-v3/blob/main/lib/lib-storage/README.md),
[CopyObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html),
[HeadObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html),
[GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html),
and [CORS](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutBucketCors.html).

## REST, SDK, and MCP

Create an upload with `POST /media/uploads`:

```json
{
  "use": "whatsapp",
  "from": "YOUR_PHONE_NUMBER_ID",
  "filename": "document.pdf",
  "content_type": "application/pdf",
  "size": 22020096
}
```

The response contains `id`, `upload_url`, `expires_at`, and `provider`. PUT the
binary file for `object`; POST for `convex`. Then POST `{}` to
`/media/uploads/{id}/complete`. For local storage, include `storage_id` from the
upload response's `storageId`. Both endpoints require `media:write`. Sending still
requires the destination channel's write scope. Team/account ownership is checked
again on completion and send.

Send WhatsApp media as `{ "document": { "id": "COMPLETED_UPLOAD_ID" } }` or an
email attachment as `{ "attachments": [{ "id": "COMPLETED_EMAIL_UPLOAD_ID" }] }`.
Set `use` to `email`, `template`, or `import` for those purposes. CSV imports accept
`file_id` instead of a multipart `file`; the 500-row limit remains and uploaded CSV
files are limited to 256 KiB.

```ts
const uploaded = await opensend.media.upload("./document.pdf", {
  use: "whatsapp",
  from: "YOUR_PHONE_NUMBER_ID",
  content_type: "application/pdf",
})
if (uploaded.error) throw new Error(uploaded.error.message)
await opensend.whatsapp.messages.send({
  from: "YOUR_PHONE_NUMBER_ID",
  to: "+16505551234",
  document: { id: uploaded.data.id },
})
```

`upload` accepts a browser Blob/File, Node buffer, or path streamed from disk.
MCP exposes `create-media-upload` and `complete-media-upload` for clients that
perform the transfer themselves. Legacy multipart `/whatsapp/media` remains
available within the 20 MB HTTP limit, including multipart overhead.

Limits: WhatsApp images 5 MiB; supported audio/video 16 MiB; documents 100 MiB;
static stickers 100 KiB; animated stickers 500 KiB (declare `animated: true`).
Completion checks sticker animation headers. Template samples are limited to
16 MiB, avatars to 1 MiB, and email attachments to 40 MiB combined after base64
encoding. Local dashboard uploads have an additional 20 MiB cap.

## Optional migration

Back up your database and volume, configure the bucket, then run the admin CLI
against the intended self-hosted deployment:

```sh
pnpm backend run storage/migration:start '{}'
pnpm backend run storage/migration:status '{}'
```

The worker pages through ten parent rows at a time, copies and verifies each file,
then atomically rewrites its reference. It covers channel media, sent/received
email, raw MIME, exports, local direct uploads, and component avatars. Shared files
reuse a mapped object within their team. Checkpoints and a worker lease make
repeated starts safe. Fix any reported failure and run `start` again to resume;
already rewritten references are skipped. It performs no deployment.

Old application blobs stay linked to their new stored-file record until normal
retention deletes the file. Component avatars are deleted after the replacement
commits. Keep your backup for restoring the pre-migration state. Message payloads,
IDs, and aggregate keys are unchanged.

## Runtime limits and e2e

[Convex limits](https://docs.convex.dev/production/state/limits) allow ten minutes
and 512 MiB per Node action; [HTTP actions](https://docs.convex.dev/functions/http-actions)
limit bodies to 20 MB. Direct transfers bypass those HTTP bodies. Legacy small
multipart/base64 uploads stage a local file before a Node action copies it, keeping
file bytes out of action arguments. Inbound streams retain DNS pinning, public-host
validation, byte limits, and timeouts.

The e2e runner adds `compose.e2e.yaml`, builds a pinned MinIO CE release from
official source, configures CORS, and tests browser uploads of an image and a
21 MiB document plus REST upload/complete/send. Fake Graph fetches signed links
and records byte counts. Only run `pnpm test:e2e` at integration; it creates a
separate Docker project and volume.
