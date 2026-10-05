import { convertToMetrics } from '@/model/MetricsToUsageConverter';
import type { MetricsApiResponse } from "@/types/metricsApiResponse";
import { getMetricsDataV2 } from '../../shared/utils/metrics-util-v2';
import { Options } from '@/model/Options';
import { requireTeamMembershipOrAdmin } from '../utils/team-membership';

function sortMetricsByDay<T extends { day: string }>(metrics: T[]): T[] {
    return [...metrics].sort((left, right) => left.day.localeCompare(right.day));
}

export default defineEventHandler(async (event) => {

    const logger = console;

    try {
        // GDPR / issue #398 — gate team-filtered queries by membership for non-admins.
        const query = getQuery(event);
        const options = Options.fromQuery(query);
        await requireTeamMembershipOrAdmin(
            event,
            (options.scope || 'organization') as 'organization' | 'enterprise' | 'team-organization' | 'team-enterprise',
            options.githubOrg,
            options.githubTeam,
        );

        // Always use v2 handler which tries new API first, falls back to legacy
        const { metrics: usageData, reportData, teamMemberCount: resolvedTeamMemberCount } = await getMetricsDataV2(event);

        // metrics is the old API format
        const metricsData = sortMetricsByDay(convertToMetrics(usageData));

        // Team metrics resolve membership while filtering the report and return
        // the count with it. Fall back only for legacy paths that cannot provide it.
        let teamMemberCount = resolvedTeamMemberCount;
        if (options.githubTeam && teamMemberCount === undefined) {
            try {
                // Imported lazily so org-level requests never load the seats
                // module (and its database dependencies).
                const { fetchAllTeamMembers } = await import('./seats');
                const members = await fetchAllTeamMembers(options, event.context.headers);
                teamMemberCount = members.length;
            } catch (err) {
                logger.error('Failed to resolve team member count (non-fatal):', err);
            }
        }

        const result = { metrics: metricsData, usage: usageData, reportData, teamMemberCount } as MetricsApiResponse;
        return result;
    } catch (error: unknown) {
        logger.error('Error fetching metrics data:', error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        const statusCode = (error && typeof error === 'object' && 'statusCode' in error)
            ? (error as { statusCode: number }).statusCode
            : 500;
        throw createError({ statusCode, statusMessage: 'Error fetching metrics data: ' + errorMessage });
    }
})
