import { webhookHeaders } from '../../../lib/webhooks/signing';
import { Opensend, Resend } from '../src';

/** Opensend's own differences from the `resend` package it ports. */

const withEnv = (env: Record<string, string | undefined>, run: () => void) => {
  const original = process.env;
  process.env = { ...original, ...env };
  try {
    run();
  } finally {
    process.env = original;
  }
};

describe('Opensend client', () => {
  it('requires a base URL, since there is no hosted API', () => {
    withEnv({ OPENSEND_BASE_URL: undefined }, () => {
      expect(() => new Opensend('os_test')).toThrow(/Missing base URL/);
    });
  });

  it('reads OPENSEND_API_KEY and ignores RESEND_API_KEY', () => {
    withEnv({ OPENSEND_API_KEY: undefined, RESEND_API_KEY: 're_x' }, () => {
      expect(() => new Opensend()).toThrow(/Missing API key/);
    });
    withEnv({ OPENSEND_API_KEY: 'os_env' }, () => {
      expect(new Opensend().key).toBe('os_env');
    });
  });

  it('ignores RESEND_BASE_URL so a leftover Resend setting is never used', () => {
    withEnv(
      { OPENSEND_BASE_URL: undefined, RESEND_BASE_URL: 'https://api.resend.com' },
      () => {
        expect(() => new Opensend('os_test')).toThrow(/Missing base URL/);
      },
    );
  });

  it('drops trailing slashes from the base URL', () => {
    const client = new Opensend('os_test', {
      baseUrl: 'https://api.example.com//',
    });
    expect(client.baseUrl).toBe('https://api.example.com');
  });

  it('identifies itself as opensend-node', () => {
    expect(new Opensend('os_test').userAgent).toMatch(/^opensend-node:\d/);
  });

  it('exports Resend as the same class for drop-in migration', () => {
    expect(Resend).toBe(Opensend);
    expect(new Resend('os_test')).toBeInstanceOf(Opensend);
  });
});

describe('webhooks.verify with Opensend-signed deliveries', () => {
  const secret = `whsec_${Buffer.from('opensend-test-secret-32-bytes!!!').toString('base64')}`;
  const previousSecret = `whsec_${Buffer.from('previous-test-secret-32-bytes!!').toString('base64')}`;
  const body = JSON.stringify({
    type: 'email.delivered',
    created_at: '2026-09-29T12:00:00.000Z',
    data: { email_id: 'email_123' },
  });
  const client = new Opensend('os_test');

  const verify = async (
    signingSecret: string,
    options: { previousSecret?: string; body?: string } = {},
  ) => {
    const headers = await webhookHeaders({
      id: 'msg_123',
      timestamp: Math.floor(Date.now() / 1000),
      body,
      secret: signingSecret,
      previousSecret: options.previousSecret,
    });
    return () =>
      client.webhooks.verify({
        payload: options.body ?? body,
        headers: {
          id: headers['svix-id'],
          timestamp: headers['svix-timestamp'],
          signature: headers['svix-signature'],
        },
        webhookSecret: secret,
      });
  };

  it('accepts a delivery signed by the app', async () => {
    expect((await verify(secret))()).toEqual(JSON.parse(body));
  });

  it('accepts a delivery signed during secret rotation', async () => {
    // After a rotation the app signs with both; either secret verifies.
    expect((await verify(secret, { previousSecret }))()).toEqual(
      JSON.parse(body),
    );
  });

  it('rejects a delivery signed with another secret', async () => {
    expect(await verify(previousSecret)).toThrow();
  });

  it('rejects a tampered body', async () => {
    expect(
      await verify(secret, { body: body.replace('delivered', 'bounced') }),
    ).toThrow();
  });
});
