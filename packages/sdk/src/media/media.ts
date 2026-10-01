import type { Opensend } from '../resend';
import type { Response } from '../interfaces';
import type { IdempotentRequest } from '../common/interfaces/idempotent-request.interface';
import type { PostOptions } from '../common/interfaces';

export interface CreateMediaUploadOptions {
  use: 'ivr' | 'whatsapp' | 'template' | 'email' | 'import';
  filename: string;
  content_type: string;
  size: number;
  from?: string;
  animated?: boolean;
}
export interface MediaUpload {
  id: string;
  upload_url: string;
  expires_at: string;
  provider: 'convex';
}

export class Media {
  constructor(private readonly resend: Opensend) {}
  create(
    payload: CreateMediaUploadOptions,
    options: PostOptions & IdempotentRequest = {}
  ) {
    return this.resend.post<MediaUpload>('/media/uploads', payload, options);
  }
  complete(
    id: string,
    payload: { storage_id?: string } = {},
    options: PostOptions & IdempotentRequest = {}
  ) {
    return this.resend.post<{ id: string }>(
      `/media/uploads/${id}/complete`,
      payload,
      options
    );
  }
  /** Browser Blob/File, Node buffer, or a path streamed from disk. Upload requests carry no API key. */
  async upload(
    file: Blob | Uint8Array | string,
    options: Omit<
      CreateMediaUploadOptions,
      'size' | 'filename' | 'content_type'
    > & {
      filename?: string;
      content_type?: string;
      request?: PostOptions & IdempotentRequest;
    }
  ): Promise<Response<{ id: string }>> {
    let size: number;
    let body: BodyInit;
    let filename = options.filename ?? 'attachment';
    let type = options.content_type ?? 'application/octet-stream';
    let close: (() => void) | undefined;
    if (typeof file === 'string') {
      const { open } = await import('node:fs/promises');
      const { basename } = await import('node:path');
      const handle = await open(file, 'r');
      const stat = await handle.stat();
      if (!stat.isFile()) {
        await handle.close();
        throw new Error('Upload path must be a file');
      }
      size = stat.size;
      filename = options.filename ?? basename(file);
      const stream = handle.createReadStream();
      body = stream as unknown as BodyInit;
      close = () => stream.destroy();
    } else if (file instanceof Blob) {
      size = file.size;
      type = options.content_type ?? (file.type || type);
      if ('name' in file && typeof file.name === 'string')
        filename = options.filename ?? file.name;
      body = file;
    } else {
      size = file.byteLength;
      body = new Blob([new Uint8Array(file)]);
    }
    try {
      const created = await this.create(
        {
          use: options.use,
          from: options.from,
          animated: options.animated,
          filename,
          content_type: type,
          size,
        },
        options.request
      );
      if (created.error) return created;
      const pending = created.data;
      const uploaded = await fetch(pending.upload_url, {
        method: 'POST',
        headers: {
          'Content-Type': type,
          ...(typeof file === 'string'
            ? { 'Content-Length': String(size) }
            : {}),
        },
        body,
        ...(typeof file === 'string' ? { duplex: 'half' } : {}),
      } as RequestInit);
      if (!uploaded.ok)
        return {
          data: null,
          error: {
            name: 'invalid_attachment',
            statusCode: uploaded.status,
            message: 'File upload failed',
          },
          headers: null,
        };
      const { storageId: storage_id } = (await uploaded.json()) as {
        storageId: string;
      };
      return this.complete(
        pending.id,
        { storage_id },
        {
          ...options.request,
          idempotencyKey: options.request?.idempotencyKey
            ? `${options.request.idempotencyKey}:complete`
            : undefined,
        }
      );
    } finally {
      close?.();
    }
  }
}
