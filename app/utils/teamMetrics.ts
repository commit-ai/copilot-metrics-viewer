import type { ReportDayTotals } from '../../server/services/github-copilot-usage-api';

export interface TeamMetricSummary {
  /** Lines of code added by Copilot over the range. */
  aiLoc: number;
  /** {@link aiLoc} per team member; null when the team size is unknown. */
  aiLocPerPerson: number | null;
  /**
   * Share of Copilot-added lines from direct Agent/Edit-mode file edits.
   *
   * NOTE: the denominator is Copilot's own output, NOT all code the team
   * wrote — the Copilot API reports no human-authored line counts.
   */
  agentLocSharePct: number | null;
  activeUsers: number;
  activeUsersPct: number | null;
  copilotAdoptionPct: number | null;
  agentAdoptionPct: number | null;
  cliAdoptionPct: number | null;
  vscodeAgentUsers: number;
  vscodeAgentAdoptionPct: number | null;
  acceptanceRatePct: number | null;
  totalInteractions: number;
}

const sumBy = (days: ReportDayTotals[], pick: (day: ReportDayTotals) => number | undefined) =>
  days.reduce((total, day) => total + (pick(day) || 0), 0);

export function safePct(numerator: number, denominator: number): number | null {
  if (!denominator || denominator <= 0) return null;
  return (numerator / denominator) * 100;
}

export function adoptionPct(activeUsers: number, memberCount: number): number | null {
  const pct = safePct(activeUsers, memberCount);
  return pct === null ? null : Math.min(pct, 100);
}

function lastDay(days: ReportDayTotals[]): ReportDayTotals | undefined {
  return [...days].sort((a, b) => a.day.localeCompare(b.day)).at(-1);
}

function rollingUsers(
  days: ReportDayTotals[],
  weeklyKey: keyof ReportDayTotals,
  monthlyKey: keyof ReportDayTotals
): number {
  const last = lastDay(days);
  if (!last) return 0;
  const key = days.length <= 7 ? weeklyKey : monthlyKey;
  return (last[key] as number | undefined) ?? (last[monthlyKey] as number | undefined) ?? 0;
}

/** Direct Agent/Edit-mode file additions; excludes code blocks copied from chat. */
export function agentLoc(days: ReportDayTotals[]): number {
  return days.reduce((total, day) => {
    const agentFeatures = (day.totals_by_feature ?? []).filter(f => f.feature === 'agent_edit');
    return total + agentFeatures.reduce((sum, f) => sum + (f.loc_added_sum || 0), 0);
  }, 0);
}

export function agentLocSharePct(days: ReportDayTotals[]): number | null {
  return safePct(agentLoc(days), sumBy(days, day => day.loc_added_sum));
}

export function summarizeTeam(days: ReportDayTotals[], memberCount: number): TeamMetricSummary {
  const aiLoc = sumBy(days, d => d.loc_added_sum);
  const activeUsers = lastDay(days)?.daily_active_users ?? 0;
  const generations = sumBy(days, day => day.code_generation_activity_count);
  const acceptances = sumBy(days, day => day.code_acceptance_activity_count);
  const copilotUsers = rollingUsers(days, 'weekly_active_users', 'monthly_active_users');
  const agentUsers = rollingUsers(days, 'weekly_active_agent_users', 'monthly_active_agent_users');
  const cliUsers = rollingUsers(days, 'weekly_active_cli_users', 'monthly_active_cli_users');
  const vscodeAgentUsers = rollingUsers(
    days, 'weekly_active_vscode_agent_users', 'monthly_active_vscode_agent_users'
  );

  return {
    aiLoc,
    aiLocPerPerson: memberCount > 0 ? aiLoc / memberCount : null,
    agentLocSharePct: agentLocSharePct(days),
    activeUsers,
    activeUsersPct: adoptionPct(activeUsers, memberCount),
    copilotAdoptionPct: adoptionPct(copilotUsers, memberCount),
    agentAdoptionPct: adoptionPct(agentUsers, memberCount),
    cliAdoptionPct: adoptionPct(cliUsers, memberCount),
    vscodeAgentUsers,
    vscodeAgentAdoptionPct: adoptionPct(vscodeAgentUsers, memberCount),
    acceptanceRatePct: safePct(acceptances, generations),
    totalInteractions: sumBy(days, day => day.user_initiated_interaction_count),
  };
}

export function editorSharePct(days: ReportDayTotals[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const day of days) {
    for (const ide of day.totals_by_ide ?? []) {
      totals[ide.ide] = (totals[ide.ide] ?? 0) + (ide.user_initiated_interaction_count || 0);
    }
  }
  return toShares(totals);
}

export function modelSharePct(days: ReportDayTotals[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const day of days) {
    for (const model of day.totals_by_model_feature ?? []) {
      totals[model.model] = (totals[model.model] ?? 0) + (model.user_initiated_interaction_count || 0);
    }
  }
  return toShares(totals);
}

function toShares(totals: Record<string, number>): Record<string, number> {
  const grandTotal = Object.values(totals).reduce((sum, value) => sum + value, 0);
  if (grandTotal <= 0) return {};
  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, (value / grandTotal) * 100]));
}

export type TrendDirection = 'up' | 'down' | 'flat';
export interface Trend {
  direction: TrendDirection;
  changePct: number | null;
}

export function trendWithinRange(
  days: ReportDayTotals[],
  metric: (summary: TeamMetricSummary) => number | null,
  memberCount: number
): Trend {
  if (days.length < 2) return { direction: 'flat', changePct: null };

  const sorted = [...days].sort((a, b) => a.day.localeCompare(b.day));
  const midpoint = Math.floor(sorted.length / 2);
  const earlier = metric(summarizeTeam(sorted.slice(0, midpoint), memberCount));
  const later = metric(summarizeTeam(sorted.slice(midpoint), memberCount));

  if (earlier === null || later === null) return { direction: 'flat', changePct: null };
  if (earlier === later) return { direction: 'flat', changePct: 0 };
  if (earlier === 0) return { direction: later > 0 ? 'up' : 'flat', changePct: null };

  const changePct = ((later - earlier) / Math.abs(earlier)) * 100;
  return { direction: changePct > 0 ? 'up' : 'down', changePct };
}

export function weeklyAdoption(
  days: ReportDayTotals[],
  metricKey: 'copilot' | 'agent' | 'cli' | 'vscodeAgent',
  memberCount: number
): { weekStart: string; adoptionPct: number | null }[] {
  const weeklyKeys = {
    copilot: 'weekly_active_users',
    agent: 'weekly_active_agent_users',
    cli: 'weekly_active_cli_users',
    vscodeAgent: 'weekly_active_vscode_agent_users',
  } as const;
  const byWeek = new Map<string, ReportDayTotals[]>();

  for (const day of days) {
    const start = weekStartOf(day.day);
    byWeek.set(start, [...(byWeek.get(start) ?? []), day]);
  }

  return [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekStart, weekDays]) => {
      const users = (lastDay(weekDays)?.[weeklyKeys[metricKey]] as number | undefined) ?? 0;
      return { weekStart, adoptionPct: adoptionPct(users, memberCount) };
    });
}

export function weekStartOf(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().split('T')[0]!;
}
