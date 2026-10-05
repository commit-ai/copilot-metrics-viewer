import { describe, expect, it } from 'vitest';
import {
  adoptionPct, editorSharePct, modelSharePct, summarizeTeam,
  trendWithinRange, weekStartOf, weeklyAdoption,
} from '../app/utils/teamMetrics';
import type { ReportDayTotals } from '../server/services/github-copilot-usage-api';

function day(date: string, overrides: Partial<ReportDayTotals> = {}): ReportDayTotals {
  return {
    day: date,
    daily_active_users: 0,
    weekly_active_users: 0,
    monthly_active_users: 0,
    user_initiated_interaction_count: 0,
    code_generation_activity_count: 0,
    code_acceptance_activity_count: 0,
    ...overrides,
  } as ReportDayTotals;
}

describe('team adoption', () => {
  it('caps adoption and returns unknown for an unknown denominator', () => {
    expect(adoptionPct(12, 8)).toBe(100);
    expect(adoptionPct(2, 8)).toBe(25);
    expect(adoptionPct(2, 0)).toBeNull();
  });

  it('uses the latest rolling window and current-member denominator', () => {
    const days = [
      day('2024-05-01'),
      day('2024-05-02', {
        daily_active_users: 5,
        weekly_active_users: 8,
        weekly_active_agent_users: 4,
        weekly_active_cli_users: 2,
        weekly_active_vscode_agent_users: 3,
      } as Partial<ReportDayTotals>),
    ];
    const summary = summarizeTeam(days, 10);
    expect(summary.activeUsersPct).toBe(50);
    expect(summary.copilotAdoptionPct).toBe(80);
    expect(summary.agentAdoptionPct).toBe(40);
    expect(summary.cliAdoptionPct).toBe(20);
    expect(summary.vscodeAgentAdoptionPct).toBe(30);
    expect(summarizeTeam(days, 0).agentAdoptionPct).toBeNull();
  });

  it('uses the monthly window when more than seven report days are present', () => {
    const days = Array.from({ length: 10 }, (_, i) =>
      day(`2024-05-${String(i + 1).padStart(2, '0')}`)
    );
    days[9] = day('2024-05-10', {
      weekly_active_agent_users: 1,
      monthly_active_agent_users: 6,
    } as Partial<ReportDayTotals>);
    expect(summarizeTeam(days, 12).agentAdoptionPct).toBe(50);
  });

  it('normalizes editor and model interactions to each team share', () => {
    const days = [day('2024-05-01', {
      totals_by_ide: [
        { ide: 'vscode', user_initiated_interaction_count: 30 },
        { ide: 'jetbrains', user_initiated_interaction_count: 10 },
      ],
      totals_by_model_feature: [
        { model: 'gpt-4o', user_initiated_interaction_count: 15 },
        { model: 'claude', user_initiated_interaction_count: 5 },
      ],
    } as Partial<ReportDayTotals>)];
    expect(editorSharePct(days)).toEqual({ vscode: 75, jetbrains: 25 });
    expect(modelSharePct(days)).toEqual({ 'gpt-4o': 75, claude: 25 });
    expect(editorSharePct([day('2024-05-01')])).toEqual({});
  });
});

describe('team trends and weekly adoption', () => {
  const adoption = (summary: ReturnType<typeof summarizeTeam>) => summary.copilotAdoptionPct;

  it('compares the later and earlier halves and handles a zero baseline', () => {
    const rising = [
      day('2024-05-01', { weekly_active_users: 1 } as Partial<ReportDayTotals>),
      day('2024-05-02', { weekly_active_users: 2 } as Partial<ReportDayTotals>),
    ];
    expect(trendWithinRange(rising, adoption, 4)).toEqual({ direction: 'up', changePct: 100 });
    expect(trendWithinRange([
      day('2024-05-01'),
      day('2024-05-02', { weekly_active_users: 2 } as Partial<ReportDayTotals>),
    ], adoption, 4)).toEqual({ direction: 'up', changePct: null });
  });

  it('reports declining and flat trends', () => {
    const declining = trendWithinRange([
      day('2024-05-01', { weekly_active_users: 3 } as Partial<ReportDayTotals>),
      day('2024-05-02', { weekly_active_users: 1 } as Partial<ReportDayTotals>),
    ], adoption, 4);
    expect(declining.direction).toBe('down');
    expect(declining.changePct).toBeCloseTo(-200 / 3, 5);
    expect(trendWithinRange([
      day('2024-05-01', { weekly_active_users: 2 } as Partial<ReportDayTotals>),
      day('2024-05-02', { weekly_active_users: 2 } as Partial<ReportDayTotals>),
    ], adoption, 4)).toEqual({ direction: 'flat', changePct: 0 });
  });

  it('buckets adoption by Monday-start week and leaves unknown denominators blank', () => {
    expect(weekStartOf('2024-05-05')).toBe('2024-04-29');
    expect(weeklyAdoption([
      day('2024-04-29', { weekly_active_agent_users: 1 } as Partial<ReportDayTotals>),
      day('2024-05-05', { weekly_active_agent_users: 4 } as Partial<ReportDayTotals>),
      day('2024-05-06', { weekly_active_agent_users: 6 } as Partial<ReportDayTotals>),
    ], 'agent', 10)).toEqual([
      { weekStart: '2024-04-29', adoptionPct: 40 },
      { weekStart: '2024-05-06', adoptionPct: 60 },
    ]);
    expect(weeklyAdoption([day('2024-05-01')], 'cli', 0)).toEqual([
      { weekStart: '2024-04-29', adoptionPct: null },
    ]);
  });
});
