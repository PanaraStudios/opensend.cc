import createFetchMock from 'vitest-fetch-mock';
import { Opensend } from '../resend';
const fetchMocker = createFetchMock(vi);
fetchMocker.enableMocks();
describe('WhatsApp resource', () => {
  const client = new Opensend('os_test', {
    baseUrl: 'https://api.opensend.test',
  });
  beforeEach(() => {
    fetchMock.resetMocks();
  });
  afterAll(() => {
    fetchMocker.disableMocks();
  });
  it('sends text, templates and media, mapping replyTo and idempotency', async () => {
    for (const body of [
      { text: { body: 'Hello', preview_url: true } },
      {
        template: { name: 'hello', language: 'en', variables: { '1': 'Ada' } },
      },
      { document: { id: '123', filename: 'file.pdf' } },
    ]) {
      fetchMock.mockResponseOnce(JSON.stringify({ id: 'message' }));
      const result = await client.whatsapp.messages.send(
        { to: '+16505551234', replyTo: 'reply', ...body },
        { idempotencyKey: 'send-key' },
      );
      expect(result).toMatchObject({ data: { id: 'message' }, error: null });
      const [url, init] = fetchMock.mock.calls.at(-1)!;
      expect(url).toBe('https://api.opensend.test/whatsapp/messages');
      expect(JSON.parse(init!.body as string)).toEqual({
        to: '+16505551234',
        reply_to: 'reply',
        ...body,
      });
      expect(new Headers(init!.headers).get('idempotency-key')).toBe(
        'send-key',
      );
    }
  });
  it('uploads binary multipart without a JSON content type', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ id: 'media' }));
    const bytes = new Uint8Array([255, 0, 128]);
    await client.whatsapp.media.upload(
      {
        from: 'phone',
        file: new Blob([bytes], { type: 'image/png' }),
        filename: 'image.png',
      },
      { idempotencyKey: 'media-key' },
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.opensend.test/whatsapp/media');
    expect(new Headers(init!.headers).has('content-type')).toBe(false);
    expect(new Headers(init!.headers).get('idempotency-key')).toBe('media-key');
    const form = init!.body as FormData;
    expect(form.get('from')).toBe('phone');
    expect(
      new Uint8Array(await (form.get('file') as File).arrayBuffer()),
    ).toEqual(bytes);
  });
  it('covers all read endpoints, filters, cursors and encoded ids', async () => {
    const requests: [() => Promise<unknown>, string][] = [
      [
        () => client.whatsapp.messages.get('id/one'),
        '/whatsapp/messages/id%2Fone',
      ],
      [
        () =>
          client.whatsapp.messages.list({
            limit: 1,
            after: 'cursor',
            status: 'sent',
            direction: 'outbound',
            phoneNumberId: 'phone',
          }),
        '/whatsapp/messages?limit=1&after=cursor&status=sent&direction=outbound&phone_number_id=phone',
      ],
      [
        () => client.whatsapp.phoneNumbers.list({ before: 'cursor' }),
        '/whatsapp/phone-numbers?before=cursor',
      ],
      [
        () => client.whatsapp.phoneNumbers.get('phone'),
        '/whatsapp/phone-numbers/phone',
      ],
      [() => client.whatsapp.conversations.list(), '/whatsapp/conversations'],
      [
        () =>
          client.whatsapp.conversations.messages('conversation', { limit: 2 }),
        '/whatsapp/conversations/conversation/messages?limit=2',
      ],
    ];
    for (const [call, path] of requests) {
      fetchMock.mockResponseOnce(
        JSON.stringify({ object: 'list', has_more: false, data: [] }),
      );
      await call();
      expect(fetchMock.mock.calls.at(-1)![0]).toBe(
        `https://api.opensend.test${path}`,
      );
    }
  });
  it('preserves API errors', async () => {
    const error = {
      statusCode: 422,
      name: 'validation_error',
      message: 'Window closed',
    };
    fetchMock.mockResponseOnce(JSON.stringify(error), { status: 422 });
    expect(
      await client.whatsapp.messages.send({ to: '16505551234', text: 'Hello' }),
    ).toMatchObject({ data: null, error });
  });
});
