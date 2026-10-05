/**
 * Cache for team pull request metrics derived from the GitHub search API.
 *
 * Search is rate limited and these lookups only happen on explicit user
 * action, so a completed result is persisted and reused. Falls back to an
 * in-process cache when no database is configured, which keeps repeated
 * clicks in a single session cheap even in direct-API deployments.
 */

import type { TeamPrMetrics } from '../services/team-pr-search';
import { createHash } from 'node:crypto';
import { getPool } from './db';
import { isDbConfigured } from './db-config';
import { baseScope } from './user-day-metrics-storage';

/**
 * How long a cached result stays fresh. PR counts for a closed date range
 * barely move, and the most recent week is the only one that can still
 * change, so an hour keeps the data current without re-spending rate limit.
 */
const TTL_MS = 60 * 60 * 1000;

interface CacheKey {
  scope: string;
  identifier: string;
  teamSlug: string;
  since: string;
  until: string;
  authScope: string;
}

const memoryCache = new Map<string, { data: TeamPrMetrics; expiry: number }>();

export function teamPrCacheScope(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function memoryKey(key: CacheKey): string {
  return [baseScope(key.scope), key.identifier, key.teamSlug, key.since, key.until, key.authScope].join('|');
}

export async function getCachedTeamPrMetrics(key: CacheKey): Promise<TeamPrMetrics | null> {
  if (!isDbConfigured()) {
    const hit = memoryCache.get(memoryKey(key));
    return hit && hit.expiry > Date.now() ? hit.data : null;
  }

  const { rows } = await getPool().query<{ data: TeamPrMetrics }>(
    `SELECT data FROM team_pr_metrics
     WHERE scope = $1 AND identifier = $2 AND team_slug = $3
       AND since_date = $4 AND until_date = $5 AND auth_scope = $6
       AND updated_at > NOW() - INTERVAL '1 hour'`,
    [baseScope(key.scope), key.identifier, key.teamSlug, key.since, key.until, key.authScope]
  );

  return rows[0]?.data ?? null;
}

export async function saveTeamPrMetrics(key: CacheKey, data: TeamPrMetrics): Promise<void> {
  if (!isDbConfigured()) {
    memoryCache.set(memoryKey(key), { data, expiry: Date.now() + TTL_MS });
    return;
  }

  await getPool().query(
    `INSERT INTO team_pr_metrics (scope, identifier, team_slug, since_date, until_date, auth_scope, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (scope, identifier, team_slug, since_date, until_date, auth_scope)
     DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [baseScope(key.scope), key.identifier, key.teamSlug, key.since, key.until, key.authScope, JSON.stringify(data)]
  );
}

/** Test seam — clears the in-process cache. */
export function clearTeamPrMetricsMemoryCache(): void {
  memoryCache.clear();
}
