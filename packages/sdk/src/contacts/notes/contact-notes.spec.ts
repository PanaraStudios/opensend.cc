import { afterEach, expect, it, vi } from 'vitest';
import { Opensend } from '../../resend';
const client = new Opensend('sk_fixture_not_a_real_key', {
  baseUrl: 'https://api.example.test',
});
afterEach(() => vi.unstubAllGlobals());
it('contact notes preserve text and metadata, escape IDs, and send pagination and idempotency', async () => {
  const fetch = vi
    .fn()
    .mockImplementation(async () =>
      Response.json({ id: 'note', object: 'contact_note' }),
    );
  vi.stubGlobal('fetch', fetch);
  await client.contacts.notes.create(
    {
      contactId: 'contact/1',
      body: 'Plain\ntext',
      source: { call_id: 'call' },
    },
    { idempotencyKey: 'note-once' },
  );
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    body: 'Plain\ntext',
    source: { call_id: 'call' },
  });
  expect(
    new Headers(fetch.mock.calls[0][1].headers).get('Idempotency-Key'),
  ).toBe('note-once');
  await client.contacts.notes.list({
    contactId: 'contact/1',
    after: 'note 1',
    limit: 7,
  });
  const url = new URL(fetch.mock.calls[1][0]);
  expect(url.pathname).toBe('/contacts/contact%2F1/notes');
  expect(url.searchParams.get('after')).toBe('note 1');
  expect(url.searchParams.get('limit')).toBe('7');
  await client.contacts.notes.update({
    contactId: 'contact/1',
    noteId: 'note/2',
    body: 'Edited',
  });
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ body: 'Edited' });
  await client.contacts.notes.remove({
    contactId: 'contact/1',
    noteId: 'note/2',
  });
  expect(
    fetch.mock.calls.map(([url, init]) => [
      new URL(url).pathname,
      init?.method ?? 'GET',
    ]),
  ).toEqual([
    ['/contacts/contact%2F1/notes', 'POST'],
    ['/contacts/contact%2F1/notes', 'GET'],
    ['/contacts/contact%2F1/notes/note%2F2', 'PATCH'],
    ['/contacts/contact%2F1/notes/note%2F2', 'DELETE'],
  ]);
  await client.contacts.notes.list({ contactId: 'contact', before: 'newer' });
  expect(new URL(fetch.mock.calls.at(-1)![0]).searchParams.get('before')).toBe(
    'newer',
  );
});
it('propagates scoped API errors for note operations', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(
        {
          name: 'not_found',
          message: 'Contact note not found',
          statusCode: 404,
        },
        { status: 404 },
      ),
    ),
  );
  expect(
    await client.contacts.notes.remove({
      contactId: 'foreign',
      noteId: 'note',
    }),
  ).toMatchObject({
    data: null,
    error: { name: 'not_found', statusCode: 404 },
  });
});
