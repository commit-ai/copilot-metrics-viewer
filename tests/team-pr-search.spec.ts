/**
 * Unit tests for the team PR search service.
 *
 * Covers the pure logic that is easy to get subtly wrong: ISO week bucketing
 * with partial weeks, author chunking against GitHub's 256-character search
 * limit, alias collection, rolling averages, and rate-limit handling.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildWeekBuckets,
  chunkLogins,
  rollingAverage,
  buildBucketQueries,
  buildGraphQLQuery,
  baseQueryLength,
  aliasFor,
  collectCounts,
  retryAfterMinutes,
  fetchTeamPrMetrics,
  SearchRateLimitError,
  COPILOT_AGENT_AUTHOR,
  COPILOT_REVIEWER,
  type WeekPrCounts,
} from '../server/services/team-pr-search';

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Week bucketing
// ---------------------------------------------------------------------------

describe('buildWeekBuckets', () => {
  it('splits a full ISO week range into complete buckets', () => {
    // 2026-02-02 is a Monday, 2026-02-15 is a Sunday.
    const buckets = buildWeekBuckets('2026-02-02', '2026-02-15');

    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toEqual({ weekStart: '2026-02-02', weekEnd: '2026-02-08', partial: false });
    expect(buckets[1]).toEqual({ weekStart: '2026-02-09', weekEnd: '2026-02-15', partial: false });
  });

  it('flags a clipped leading week as partial', () => {
    // Starts on a Wednesday.
    const buckets = buildWeekBuckets('2026-02-04', '2026-02-15');

    expect(buckets[0]).toEqual({ weekStart: '2026-02-04', weekEnd: '2026-02-08', partial: true });
    expect(buckets[1]!.partial).toBe(false);
  });

  it('flags a clipped trailing week as partial', () => {
    // Ends on a Wednesday.
    const buckets = buildWeekBuckets('2026-02-02', '2026-02-11');

    expect(buckets[0]!.partial).toBe(false);
    expect(buckets[1]).toEqual({ weekStart: '2026-02-09', weekEnd: '2026-02-11', partial: true });
  });

  it('emits a single partial bucket for a sub-week range', () => {
    const buckets = buildWeekBuckets('2026-02-04', '2026-02-06');

    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toEqual({ weekStart: '2026-02-04', weekEnd: '2026-02-06', partial: true });
  });

  it('covers the default 28-day window without gaps or overlaps', () => {
    const buckets = buildWeekBuckets('2026-02-04', '2026-03-03');

    // Buckets must be contiguous — no missing days between them.
    for (let i = 1; i < buckets.length; i++) {
      const previousEnd = new Date(`${buckets[i - 1]!.weekEnd}T00:00:00Z`);
      previousEnd.setUTCDate(previousEnd.getUTCDate() + 1);
      expect(buckets[i]!.weekStart).toBe(previousEnd.toISOString().split('T')[0]);
    }
    expect(buckets[0]!.weekStart).toBe('2026-02-04');
    expect(buckets.at(-1)!.weekEnd).toBe('2026-03-03');
  });

  it('returns nothing for an inverted or empty range', () => {
    expect(buildWeekBuckets('2026-02-10', '2026-02-01')).toEqual([]);
    expect(buildWeekBuckets('', '2026-02-01')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Author chunking
// ---------------------------------------------------------------------------

describe('chunkLogins', () => {
  const bucket = { weekStart: '2026-02-02', weekEnd: '2026-02-08', partial: false };

  it('keeps every generated query under the 256-character search limit', () => {
    const logins = Array.from({ length: 60 }, (_, i) => `developer-number-${i}`);
    const chunks = chunkLogins(logins, baseQueryLength(bucket, 'my-org'));

    for (const chunk of chunks) {
      const queries = buildBucketQueries(bucket, chunk, 'my-org');
      expect(queries.merged.length).toBeLessThanOrEqual(256);
      expect(queries.reviewed.length).toBeLessThanOrEqual(256);
      expect(queries.agent.length).toBeLessThanOrEqual(256);
    }
  });

  it('produces disjoint chunks that preserve every login exactly once', () => {
    const logins = Array.from({ length: 40 }, (_, i) => `dev${i}`);
    const chunks = chunkLogins(logins, baseQueryLength(bucket, 'my-org'));

    expect(chunks.flat().sort()).toEqual([...logins].sort());
    expect(new Set(chunks.flat()).size).toBe(logins.length);
  });

  it('keeps a small team in a single chunk', () => {
    const chunks = chunkLogins(['alice', 'bob', 'carol'], baseQueryLength(bucket, 'my-org'));
    expect(chunks).toHaveLength(1);
  });

  it('returns no chunks for an empty team', () => {
    expect(chunkLogins([], 50)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Query construction
// ---------------------------------------------------------------------------

describe('buildBucketQueries', () => {
  const bucket = { weekStart: '2026-02-02', weekEnd: '2026-02-08', partial: false };

  it('scopes to the org, the merge window and the member authors', () => {
    const { merged } = buildBucketQueries(bucket, ['alice', 'bob'], 'my-org');

    expect(merged).toContain('is:pr');
    expect(merged).toContain('is:merged');
    expect(merged).toContain('merged:2026-02-02..2026-02-08');
    expect(merged).toContain('org:my-org');
    expect(merged).toContain('author:alice');
    expect(merged).toContain('author:bob');
  });

  it('adds the Copilot reviewer qualifier only to the reviewed variant', () => {
    const { merged, reviewed } = buildBucketQueries(bucket, ['alice'], 'my-org');

    expect(reviewed).toContain(`reviewed-by:${COPILOT_REVIEWER}`);
    expect(merged).not.toContain('reviewed-by:');
  });

  it('matches agent PRs by assignee, not author, since the agent is the author', () => {
    const { agent } = buildBucketQueries(bucket, ['alice'], 'my-org');

    expect(agent).toContain('assignee:alice');
    expect(agent).toContain(`author:${COPILOT_AGENT_AUTHOR}`);
    expect(agent).not.toContain('author:alice');
  });

  it('omits the org qualifier when no org is known', () => {
    const { merged } = buildBucketQueries(bucket, ['alice'], undefined);
    expect(merged).not.toContain('org:');
  });
});

describe('buildGraphQLQuery', () => {
  const buckets = buildWeekBuckets('2026-02-02', '2026-02-15');

  it('batches every week and chunk into one document', () => {
    const query = buildGraphQLQuery(buckets, [['alice'], ['bob']], 'my-org');

    // 2 buckets x 2 chunks x 3 counts
    expect(query.match(/search\(/g)).toHaveLength(12);
    expect(query).toContain(aliasFor(0, 0, 'merged'));
    expect(query).toContain(aliasFor(1, 1, 'agent'));
    expect(query).toContain('rateLimit');
  });

  it('escapes query strings so the document stays valid GraphQL', () => {
    const query = buildGraphQLQuery(buckets.slice(0, 1), [['alice']], 'my-org');
    expect(query).toContain('search(query: "is:pr is:merged');
  });
});

// ---------------------------------------------------------------------------
// Response folding
// ---------------------------------------------------------------------------

describe('collectCounts', () => {
  const buckets = buildWeekBuckets('2026-02-02', '2026-02-15');

  it('sums counts across chunks and adds agent PRs to both totals', () => {
    const data = {
      [aliasFor(0, 0, 'merged')]: { issueCount: 5 },
      [aliasFor(0, 0, 'reviewed')]: { issueCount: 2 },
      [aliasFor(0, 0, 'agent')]: { issueCount: 3 },
      [aliasFor(0, 1, 'merged')]: { issueCount: 4 },
      [aliasFor(0, 1, 'reviewed')]: { issueCount: 1 },
      [aliasFor(0, 1, 'agent')]: { issueCount: 0 },
    };

    const weeks = collectCounts(data, buckets, 2);

    // merged: 5 + 3 (agent) + 4 + 0
    expect(weeks[0]!.merged).toBe(12);
    // aiTouched: 2 + 3 (agent) + 1 + 0
    expect(weeks[0]!.aiTouched).toBe(6);
  });

  it('treats missing aliases as zero rather than throwing', () => {
    const weeks = collectCounts({}, buckets, 1);

    expect(weeks).toHaveLength(2);
    expect(weeks[0]!.merged).toBe(0);
    expect(weeks[0]!.aiTouched).toBe(0);
  });

  it('never reports more AI-touched PRs than merged PRs', () => {
    const data = {
      [aliasFor(0, 0, 'merged')]: { issueCount: 3 },
      [aliasFor(0, 0, 'reviewed')]: { issueCount: 3 },
      [aliasFor(0, 0, 'agent')]: { issueCount: 2 },
    };

    const weeks = collectCounts(data, buckets, 1);
    expect(weeks[0]!.aiTouched).toBeLessThanOrEqual(weeks[0]!.merged);
  });

  it('preserves bucket metadata', () => {
    const weeks = collectCounts({}, buckets, 1);
    expect(weeks[0]!.weekStart).toBe(buckets[0]!.weekStart);
    expect(weeks[0]!.partial).toBe(buckets[0]!.partial);
  });
});

// ---------------------------------------------------------------------------
// Rolling average
// ---------------------------------------------------------------------------

describe('rollingAverage', () => {
  const week = (merged: number, partial: boolean): WeekPrCounts => ({
    weekStart: '2026-02-02', weekEnd: '2026-02-08', partial, merged, aiTouched: 0,
  });

  it('ignores partial weeks so a clipped week cannot drag the average down', () => {
    // Without the partial-week guard this would be (10 + 10 + 1) / 3 = 7.
    expect(rollingAverage([week(10, false), week(10, false), week(1, true)])).toBe(10);
  });

  it('counts empty complete weeks as zeros', () => {
    expect(rollingAverage([week(10, false), week(0, false)])).toBe(5);
  });

  it('falls back to partial weeks when no week is complete', () => {
    expect(rollingAverage([week(4, true), week(6, true)])).toBe(5);
  });

  it('returns zero for no data', () => {
    expect(rollingAverage([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

describe('retryAfterMinutes', () => {
  const now = Date.parse('2026-02-10T12:00:00Z');

  it('prefers the Retry-After header, converting seconds to minutes', () => {
    expect(retryAfterMinutes(new Headers({ 'retry-after': '120' }), undefined, now)).toBe(2);
  });

  it('falls back to the x-ratelimit-reset epoch header', () => {
    const reset = String((now + 5 * 60000) / 1000);
    expect(retryAfterMinutes(new Headers({ 'x-ratelimit-reset': reset }), undefined, now)).toBe(5);
  });

  it('falls back to the GraphQL resetAt timestamp', () => {
    expect(retryAfterMinutes(new Headers(), '2026-02-10T12:10:00Z', now)).toBe(10);
  });

  it('never tells the user to come back in zero minutes', () => {
    expect(retryAfterMinutes(new Headers({ 'retry-after': '0' }), undefined, now)).toBe(1);
    expect(retryAfterMinutes(new Headers(), '2026-02-10T11:00:00Z', now)).toBe(1);
    expect(retryAfterMinutes(new Headers(), undefined, now)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// fetchTeamPrMetrics
// ---------------------------------------------------------------------------

describe('fetchTeamPrMetrics', () => {
  const baseRequest = {
    logins: ['alice', 'bob'],
    since: '2026-02-02',
    until: '2026-02-15',
    org: 'my-org',
    githubToken: 'token',
  };

  function mockResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
    return {
      ok: (init.status ?? 200) < 400,
      status: init.status ?? 200,
      headers: new Headers(init.headers ?? {}),
      json: async () => body,
    } as unknown as Response;
  }

  it('issues exactly one HTTP request for the whole range', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse({ data: {} }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchTeamPrMetrics(baseRequest);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('computes totals, rolling average and per-person figures', async () => {
    const data = {
      [aliasFor(0, 0, 'merged')]: { issueCount: 8 },
      [aliasFor(0, 0, 'reviewed')]: { issueCount: 2 },
      [aliasFor(0, 0, 'agent')]: { issueCount: 0 },
      [aliasFor(1, 0, 'merged')]: { issueCount: 4 },
      [aliasFor(1, 0, 'reviewed')]: { issueCount: 1 },
      [aliasFor(1, 0, 'agent')]: { issueCount: 0 },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ data })));

    const result = await fetchTeamPrMetrics(baseRequest);

    expect(result.totalMerged).toBe(12);
    expect(result.totalAiTouched).toBe(3);
    expect(result.rollingAverage).toBe(6);
    expect(result.avgMergedPerPerson).toBe(6); // 12 merged / 2 members
    expect(result.orgScoped).toBe(true);
  });

  it('throws a rate limit error carrying the retry delay on HTTP 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockResponse({}, { status: 429, headers: { 'retry-after': '180' } })
    ));

    await expect(fetchTeamPrMetrics(baseRequest)).rejects.toMatchObject({
      name: 'SearchRateLimitError',
      retryAfterMinutes: 3,
    });
  });

  it('detects a GraphQL RATE_LIMITED error even on HTTP 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockResponse({ errors: [{ type: 'RATE_LIMITED', message: 'rate limited' }] })
    ));

    await expect(fetchTeamPrMetrics(baseRequest)).rejects.toBeInstanceOf(SearchRateLimitError);
  });

  it('surfaces other GraphQL failures as plain errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockResponse({ errors: [{ message: 'Bad credentials' }] }, { status: 401 })
    ));

    await expect(fetchTeamPrMetrics(baseRequest)).rejects.toThrow(/Bad credentials/);
  });

  it('returns zeroed weeks without calling the API for an empty team', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchTeamPrMetrics({ ...baseRequest, logins: [] });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.memberCount).toBe(0);
    expect(result.avgMergedPerPerson).toBeNull();
    expect(result.weeks.every(w => w.merged === 0)).toBe(true);
  });

  it('flags truncation for a team too large to query in full', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse({ data: {} })));

    const logins = Array.from({ length: 400 }, (_, i) => `a-very-long-developer-login-${i}`);
    const result = await fetchTeamPrMetrics({ ...baseRequest, logins });

    expect(result.truncated).toBe(true);
  });
});
