import { Opensend } from '../resend';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fetcher = vi.fn<typeof fetch>();
const client = new Opensend('os_test', { baseUrl: 'https://api.test' });
beforeEach(() => {
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => vi.unstubAllGlobals());
test('uploads directly without leaking credentials and completes with a separate idempotency key', async () => {
  fetcher
    .mockResolvedValueOnce(
      Response.json({
        id: 'file',
        provider: 'convex',
        upload_url: 'https://convex.test/upload',
        expires_at: '2026-10-01',
      })
    )
    .mockResolvedValueOnce(Response.json({ storageId: 'storage' }))
    .mockResolvedValueOnce(Response.json({ id: 'file' }));
  const result = await client.media.upload(
    new Blob(['abc'], { type: 'image/png' }),
    { use: 'whatsapp', request: { idempotencyKey: 'upload-key' } }
  );
  expect(result.data).toEqual({ id: 'file' });
  expect(fetcher.mock.calls[1][0]).toBe('https://convex.test/upload');
  const put = fetcher.mock.calls[1][1]!;
  expect(put.method).toBe('POST');
  expect(new Headers(put.headers).get('authorization')).toBeNull();
  expect(
    new Headers(fetcher.mock.calls[2][1]!.headers).get('idempotency-key')
  ).toBe('upload-key:complete');
});
test('Convex uploads POST and pass storageId to completion', async () => {
  fetcher
    .mockResolvedValueOnce(
      Response.json({
        id: 'local',
        provider: 'convex',
        upload_url: 'https://convex.test/upload',
      })
    )
    .mockResolvedValueOnce(Response.json({ storageId: 'storage' }))
    .mockResolvedValueOnce(Response.json({ id: 'local' }));
  await client.media.upload(new Uint8Array([1, 2, 3]), {
    use: 'email',
    content_type: 'text/plain',
  });
  expect(fetcher.mock.calls[1][1]!.method).toBe('POST');
  expect(JSON.parse(fetcher.mock.calls[2][1]!.body as string)).toEqual({
    storage_id: 'storage',
  });
});
test('Node paths are streamed and a failed POST never completes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'opensend-upload-'));
  try {
    const path = join(directory, 'file.pdf');
    await writeFile(path, 'pdf');
    fetcher
      .mockResolvedValueOnce(
        Response.json({
          id: 'file',
          provider: 'convex',
          upload_url: 'https://convex.test/upload',
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    const result = await client.media.upload(path, {
      use: 'whatsapp',
      content_type: 'application/pdf',
    });
    expect(result.error?.statusCode).toBe(403);
    expect(fetcher.mock.calls).toHaveLength(2);
    expect(fetcher.mock.calls[1][1]!.body).toHaveProperty('pipe');
    expect(
      new Headers(fetcher.mock.calls[1][1]!.headers).get('content-length')
    ).toBe('3');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
