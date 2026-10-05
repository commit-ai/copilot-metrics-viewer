/**
 * Team-level pull request metrics derived from the GitHub search API.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Copilot Usage Metrics API exposes `pull_requests` only on
 * organization/enterprise reports — there is no team-scoped report endpoint
 * (`MetricsReportRequest.teamSlug` is never used by the URL builders). Merging
 * org-wide PR totals into a team view would silently mislabel org numbers as
 * team numbers, so team PR metrics are derived here instead, from PRs actually
 * authored by (or assigned to) the team's members.
 *
 * COST CONTROL
 * ------------
 * Every week bucket needs three counts, and member logins must be chunked to
 * respect GitHub's 256-character search query limit. Issuing one HTTP request
 * per (week x chunk x count) would be dozens of calls, so all of them are sent
 * as aliased fields inside a SINGLE GraphQL document. This endpoint is only
 * ever invoked on explicit user action.
 */

/** GitHub search caps query strings at 256 characters. */
const MAX_SEARCH_QUERY_LENGTH = 256;

/**
 * Upper bound on author chunks per request, so a very large team cannot
 * generate an unbounded GraphQL document. Results are flagged `truncated`
 * when members are dropped.
 */
const MAX_AUTHOR_CHUNKS = 12;

/** GitHub's special search identity for Copilot-authored or reviewed PRs. */
export const COPILOT_AGENT_AUTHOR = '@copilot';
export const COPILOT_REVIEWER = '@copilot';

/** Search requests are capped at 90 days to keep the GraphQL document bounded. */
export const MAX_RANGE_DAYS = 90;

export interface WeekBucket {
  /** Inclusive first day of the bucket (clipped to the requested range). */
  weekStart: string;
  /** Inclusive last day of the bucket (clipped to the requested range). */
  weekEnd: string;
  /**
   * True when the requested range clipped this ISO week. Partial buckets are
   * still displayed but excluded from the rolling average, so a half-week
   * cannot drag the trend down.
   */
  partial: boolean;
}

export interface WeekPrCounts extends WeekBucket {
  /** PRs authored by team members, plus agent PRs assigned to them. */
  merged: number;
  /** Of `merged`, those Copilot reviewed or the Copilot agent authored. */
  aiTouched: number;
}

export interface TeamPrMetrics {
  weeks: WeekPrCounts[];
  totalMerged: number;
  totalAiTouched: number;
  /** Mean merged PRs per *complete* week. */
  rollingAverage: number;
  /** `totalMerged` divided by team size; null when the team size is unknown. */
  avgMergedPerPerson: number | null;
  memberCount: number;
  /** True when team members were dropped to respect {@link MAX_AUTHOR_CHUNKS}. */
  truncated: boolean;
  /**
   * False when no org could be determined, meaning results are not restricted
   * to the organization's repositories.
   */
  orgScoped: boolean;
}

/** Thrown when GitHub reports the caller is rate limited. */
export class SearchRateLimitError extends Error {
  readonly retryAfterMinutes: number;
  constructor(retryAfterMinutes: number) {
    super(`GitHub search rate limit exceeded. Retry in ${retryAfterMinutes} minute(s).`);
    this.name = 'SearchRateLimitError';
    this.retryAfterMinutes = retryAfterMinutes;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

function toUtcDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function toDayString(date: Date): string {
  return date.toISOString().split('T')[0]!;
}

function addDays(day: string, n: number): string {
  const d = toUtcDate(day);
  d.setUTCDate(d.getUTCDate() + n);
  return toDayString(d);
}

/** Monday of the ISO week containing `day`. */
function isoWeekStart(day: string): string {
  const d = toUtcDate(day);
  // getUTCDay(): 0 = Sunday. Shift so Monday = 0.
  const offset = (d.getUTCDay() + 6) % 7;
  return addDays(day, -offset);
}

/**
 * Split [since, until] into ISO (Monday-start) week buckets clipped to the
 * range. Buckets whose underlying ISO week extends beyond the range are
 * flagged `partial`. Weeks with no activity are still emitted, so the caller
 * renders explicit zeros rather than gaps.
 */
export function buildWeekBuckets(since: string, until: string): WeekBucket[] {
  if (!since || !until || since > until) return [];

  const buckets: WeekBucket[] = [];
  let cursor = isoWeekStart(since);

  while (cursor <= until) {
    const isoEnd = addDays(cursor, 6);
    const weekStart = cursor < since ? since : cursor;
    const weekEnd = isoEnd > until ? until : isoEnd;
    buckets.push({
      weekStart,
      weekEnd,
      partial: weekStart !== cursor || weekEnd !== isoEnd,
    });
    cursor = addDays(cursor, 7);
  }

  return buckets;
}

function isIsoDate(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && toDayString(date) === day;
}

export function validateDateRange(since: string, until: string): void {
  if (!isIsoDate(since) || !isIsoDate(until)) {
    throw new RangeError('Dates must use valid YYYY-MM-DD format.');
  }
  if (since > until) {
    throw new RangeError('The start date must be on or before the end date.');
  }
  const days = (toUtcDate(until).getTime() - toUtcDate(since).getTime()) / 86400000 + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new RangeError(`Date range cannot exceed ${MAX_RANGE_DAYS} days.`);
  }
}

/**
 * Group logins so that each chunk, once rendered into a search query, stays
 * under GitHub's 256-character limit. Chunks are disjoint, so per-chunk counts
 * can be summed without double counting authors.
 */
export function chunkLogins(logins: string[], baseQueryLength: number): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let length = baseQueryLength;

  for (const login of logins) {
    // Include the longest member qualifier and OR separator conservatively.
    const cost = login.length + 9 + (current.length > 0 ? 4 : 0);
    if (current.length > 0 && length + cost > MAX_SEARCH_QUERY_LENGTH) {
      chunks.push(current);
      current = [];
      length = baseQueryLength;
    }
    if (length + login.length + 9 > MAX_SEARCH_QUERY_LENGTH) {
      throw new RangeError(`Team member login "${login}" cannot fit in a GitHub search query.`);
    }
    current.push(login);
    length += login.length + 9 + (current.length > 1 ? 4 : 0);
  }
  if (current.length > 0) chunks.push(current);

  return chunks;
}

/**
 * Mean merged PRs per complete week. Partial weeks are excluded so a clipped
 * first or last week cannot understate the trend. When every bucket is partial
 * (e.g. a 3-day range) all buckets are used rather than returning nothing.
 */
export function rollingAverage(weeks: WeekPrCounts[]): number {
  if (weeks.length === 0) return 0;
  const complete = weeks.filter(w => !w.partial);
  const considered = complete.length > 0 ? complete : weeks;
  const total = considered.reduce((sum, w) => sum + w.merged, 0);
  return total / considered.length;
}

function qualifierList(qualifier: string, values: string[]): string {
  if (values.length === 0) return '';
  return `(${values.map(v => `${qualifier}:${v}`).join(' OR ')})`;
}

/**
 * Build the three search queries for one week bucket and one author chunk.
 *
 * - `merged`   PRs authored by these members
 * - `reviewed` of those, the ones Copilot code review reviewed
 * - `agent`    PRs the Copilot coding agent authored and assigned to a member
 *
 * `merged` and `agent` are disjoint (a PR's author is either a member or the
 * agent, never both), so totals add without inclusion-exclusion.
 */
export function buildBucketQueries(
  bucket: WeekBucket,
  logins: string[],
  org: string | undefined
): { merged: string; reviewed: string; agent: string } {
  const base = [
    'is:pr',
    'is:merged',
    `merged:${bucket.weekStart}..${bucket.weekEnd}`,
    ...(org ? [`org:${org}`] : []),
  ].join(' ');

  const authors = qualifierList('author', logins);
  const assignees = qualifierList('assignee', logins);

  return {
    merged: `${base}${authors ? ` ${authors}` : ''}`,
    reviewed: `${base}${authors ? ` ${authors}` : ''} reviewed-by:${COPILOT_REVIEWER}`,
    agent: `${base}${assignees ? ` ${assignees}` : ''} author:${COPILOT_AGENT_AUTHOR}`,
  };
}

/** Length of the fixed part of a search query, used to size author chunks. */
export function baseQueryLength(bucket: WeekBucket, org: string | undefined): number {
  const { weekStart, weekEnd } = bucket;
  const base = ['is:pr', 'is:merged', `merged:${weekStart}..${weekEnd}`, ...(org ? [`org:${org}`] : [])].join(' ');
  // Reserve grouping and the longer assignee prefix; `reviewed` has the longest fixed suffix.
  return base.length + 1 + 2 + ' reviewed-by:@copilot'.length;
}

/**
 * Assemble one GraphQL document covering every (week x chunk) combination.
 * Aliases encode the bucket index, chunk index and which count they carry.
 */
export function buildGraphQLQuery(buckets: WeekBucket[], chunks: string[][], org: string | undefined): string {
  const fields: string[] = ['rateLimit { remaining resetAt }'];

  buckets.forEach((bucket, b) => {
    chunks.forEach((chunk, c) => {
      const queries = buildBucketQueries(bucket, chunk, org);
      for (const [kind, query] of Object.entries(queries)) {
        // `first: 1` because GitHub requires a page size even though only
        // issueCount is read.
        fields.push(
          `${aliasFor(b, c, kind as QueryKind)}: search(query: ${JSON.stringify(query)}, type: ISSUE, first: 1) { issueCount }`
        );
      }
    });
  });

  return `query {\n  ${fields.join('\n  ')}\n}`;
}

type QueryKind = 'merged' | 'reviewed' | 'agent';

export function aliasFor(bucketIndex: number, chunkIndex: number, kind: QueryKind): string {
  return `b${bucketIndex}c${chunkIndex}${kind}`;
}

interface GraphQLSearchResponse {
  data?: Record<string, { issueCount?: number } | unknown>;
  errors?: { type?: string; message: string }[];
}

/**
 * Fold the aliased GraphQL response back into per-week counts.
 *
 * A PR assigned to two members in different chunks is counted once per chunk;
 * this is rare and documented rather than paid for with an extra query.
 */
export function collectCounts(
  data: Record<string, unknown>,
  buckets: WeekBucket[],
  chunkCount: number
): WeekPrCounts[] {
  const countAt = (b: number, c: number, kind: QueryKind): number => {
    const node = data[aliasFor(b, c, kind)] as { issueCount?: number } | undefined;
    return node?.issueCount ?? 0;
  };

  return buckets.map((bucket, b) => {
    let merged = 0;
    let aiTouched = 0;
    for (let c = 0; c < chunkCount; c++) {
      const agent = countAt(b, c, 'agent');
      merged += countAt(b, c, 'merged') + agent;
      aiTouched += countAt(b, c, 'reviewed') + agent;
    }
    return { ...bucket, merged, aiTouched };
  });
}

/**
 * Minutes until the rate limit resets, from either a `Retry-After` header
 * (seconds), an `x-ratelimit-reset` header (epoch seconds), or a GraphQL
 * `rateLimit.resetAt` timestamp. Always at least 1, so the UI never tells the
 * user to come back in zero minutes.
 */
export function retryAfterMinutes(
  headers: Headers,
  resetAt?: string,
  now: number = Date.now()
): number {
  const retryAfter = headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(1, Math.ceil(seconds / 60));
  }

  const reset = headers.get('x-ratelimit-reset');
  if (reset) {
    const epochSeconds = Number(reset);
    if (Number.isFinite(epochSeconds)) {
      return Math.max(1, Math.ceil((epochSeconds * 1000 - now) / 60000));
    }
  }

  if (resetAt) {
    const resetMs = Date.parse(resetAt);
    if (Number.isFinite(resetMs)) {
      return Math.max(1, Math.ceil((resetMs - now) / 60000));
    }
  }

  return 1;
}

function isRateLimited(status: number, headers: Headers, json: GraphQLSearchResponse): boolean {
  if (status === 429) return true;
  if (status === 403 && (headers.has('retry-after') || headers.get('x-ratelimit-remaining') === '0')) return true;
  return (json.errors ?? []).some(e => e.type === 'RATE_LIMITED');
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

export interface TeamPrSearchRequest {
  logins: string[];
  since: string;
  until: string;
  org?: string;
  githubToken: string;
  apiBaseUrl?: string;
}

/**
 * Fetch weekly merged/AI-touched PR counts for a team in a single GraphQL
 * round trip.
 *
 * @throws {SearchRateLimitError} when GitHub reports the caller is rate limited
 */
export async function fetchTeamPrMetrics(request: TeamPrSearchRequest): Promise<TeamPrMetrics> {
  const { logins, since, until, org, githubToken, apiBaseUrl = 'https://api.github.com' } = request;

  validateDateRange(since, until);
  const buckets = buildWeekBuckets(since, until);
  const memberCount = logins.length;

  if (buckets.length === 0 || memberCount === 0) {
    return emptyMetrics(buckets, memberCount, !!org);
  }

  const allChunks = chunkLogins(logins, baseQueryLength(buckets[0]!, org));
  const truncated = allChunks.length > MAX_AUTHOR_CHUNKS;
  const chunks = truncated ? allChunks.slice(0, MAX_AUTHOR_CHUNKS) : allChunks;

  const response = await fetch(`${apiBaseUrl}/graphql`, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${githubToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: buildGraphQLQuery(buckets, chunks, org) }),
  });

  const json = await response.json().catch(() => ({})) as GraphQLSearchResponse;

  if (isRateLimited(response.status, response.headers, json)) {
    const resetAt = (json.data?.rateLimit as { resetAt?: string } | undefined)?.resetAt;
    throw new SearchRateLimitError(retryAfterMinutes(response.headers, resetAt));
  }

  if (!response.ok || !json.data) {
    const detail = json.errors?.map(e => e.message).join('; ') || `HTTP ${response.status}`;
    throw new Error(`GitHub PR search failed: ${detail}`);
  }
  if (json.errors?.length) {
    throw new Error(`GitHub PR search returned incomplete results: ${json.errors.map(e => e.message).join('; ')}`);
  }

  const weeks = collectCounts(json.data as Record<string, unknown>, buckets, chunks.length);
  const totalMerged = weeks.reduce((sum, w) => sum + w.merged, 0);

  return {
    weeks,
    totalMerged,
    totalAiTouched: weeks.reduce((sum, w) => sum + w.aiTouched, 0),
    rollingAverage: rollingAverage(weeks),
    avgMergedPerPerson: memberCount > 0 ? totalMerged / memberCount : null,
    memberCount,
    truncated,
    orgScoped: !!org,
  };
}

function emptyMetrics(buckets: WeekBucket[], memberCount: number, orgScoped: boolean): TeamPrMetrics {
  return {
    weeks: buckets.map(b => ({ ...b, merged: 0, aiTouched: 0 })),
    totalMerged: 0,
    totalAiTouched: 0,
    rollingAverage: 0,
    avgMergedPerPerson: memberCount > 0 ? 0 : null,
    memberCount,
    truncated: false,
    orgScoped,
  };
}
