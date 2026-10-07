import { buildPaginationQuery, buildPaginationUrl } from './build-pagination-query';

describe('buildPaginationQuery', () => {
  it('returns an empty string when nothing was requested', () => {
    expect(buildPaginationQuery({})).toBe('');
    expect(buildPaginationUrl('/emails', {})).toBe('/emails');
  });

  it('writes limit, after and before in that order', () => {
    expect(buildPaginationQuery({ limit: 0 })).toBe('limit=0');
    expect(buildPaginationQuery({ limit: 20, after: 'next cursor' })).toBe(
      'limit=20&after=next+cursor',
    );
    expect(buildPaginationQuery({ before: 'prev/id' })).toBe('before=prev%2Fid');
    expect(
      buildPaginationUrl('/emails', { limit: 2, after: 'cursor' }),
    ).toBe('/emails?limit=2&after=cursor');
  });
});
