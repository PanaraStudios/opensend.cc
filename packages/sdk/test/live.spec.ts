import { Opensend } from '../src';

/**
 * Read-only calls against a running Opensend install. Skipped unless both
 * OPENSEND_BASE_URL_LIVE and OPENSEND_API_KEY are set; the unit-test setup
 * always sets OPENSEND_BASE_URL, so the live origin has its own variable.
 */
const baseUrl = process.env.OPENSEND_BASE_URL_LIVE;
const key = process.env.OPENSEND_API_KEY;

const live = it.skipIf(!baseUrl || !key);

describe('live install (read-only)', () => {
  const client = () => new Opensend(key, { baseUrl });

  live('lists domains', async () => {
    const { data, error } = await client().domains.list();
    expect(error).toBeNull();
    expect(data?.object).toBe('list');
  });

  live('lists API keys', async () => {
    const { data, error } = await client().apiKeys.list();
    expect(error).toBeNull();
    expect(data?.object).toBe('list');
  });

  live('lists emails', async () => {
    const { data, error } = await client().emails.list({ limit: 1 });
    expect(error).toBeNull();
    expect(data?.object).toBe('list');
  });

  live('returns a Resend-shaped error for a missing email', async () => {
    const { data, error } = await client().emails.get('missing');
    expect(data).toBeNull();
    expect(error?.statusCode).toBeGreaterThanOrEqual(400);
    expect(error?.name).toEqual(expect.any(String));
  });
});
