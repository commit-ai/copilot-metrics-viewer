import { describe, expect, it } from 'vitest';
import {
  adoptionPct, agentLoc, editorSharePct, modelSharePct, summarizeTeam,
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
    loc_added_sum: 0,
    ...overrides,
  } as ReportDayTotals;
}

describe('team adoption', () => {
  it('caps adoption and returns unknown for an unknown denominator', () => {
    expect(adoptionPct(12, 8)).toBe(100);
    expect(adoptionPct(2, 8)).toBe(25);
    expect(adoptionPct(2, 0)).toBeNull();
  });

  describe('team LOC', () => {
    it('sums lines of code and per-person figures over the range', () => {
      const summary = summarizeTeam([
        day('2024-05-01', { loc_added_sum: 100 }),
        day('2024-05-02', { loc_added_sum: 300 }),
      ], 10);
      expect(summary.aiLoc).toBe(400);
      expect(summary.aiLocPerPerson).toBe(40);
    });

    it('handles an empty range without dividing by zero', () => {
      const summary = summarizeTeam([], 10);
      expect(summary.aiLoc).toBe(0);
      expect(summary.activeUsers).toBe(0);
      expect(summary.acceptanceRatePct).toBeNull();
      expect(summary.agentLocSharePct).toBeNull();
    });

    it('returns null per-person LOC when the member count is unknown', () => {
      expect(summarizeTeam([day('2024-05-01', { loc_added_sum: 100 })], 0).aiLocPerPerson).toBeNull();
    });
  });

  describe('agentLoc', () => {
    it('counts only direct file edits, not copied code blocks from agent chat', () => {
      const days = [
        day('2024-05-01', {
          loc_added_sum: 500,
          totals_by_feature: [
            { feature: 'agent_edit', loc_added_sum: 150 },
            { feature: 'chat_panel_agent_mode', loc_added_sum: 50 },
            { feature: 'code_completion', loc_added_sum: 200 },
            { feature: 'chat_inline', loc_added_sum: 100 },
          ],
        } as Partial<ReportDayTotals>),
      ];
      expect(agentLoc(days)).toBe(150);
      expect(summarizeTeam(days, 5).agentLocSharePct).toBe(30);
    });
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

  describe('LOC trendWithinRange', () => {
    const locOf = (s: { aiLoc: number }) => s.aiLoc;

    it('reports an upward trend when the later half is larger', () => {
      const days = [
        day('2024-05-01', { loc_added_sum: 10 }),
        day('2024-05-02', { loc_added_sum: 20 }),
      ];
      const trend = trendWithinRange(days, locOf, 5);
      expect(trend.direction).toBe('up');
      expect(trend.changePct).toBe(100);
    });

    it('reports a downward trend when the later half is smaller', () => {
      const days = [
        day('2024-05-01', { loc_added_sum: 20 }),
        day('2024-05-02', { loc_added_sum: 5 }),
      ];
      expect(trendWithinRange(days, locOf, 5).direction).toBe('down');
    });

    it('is flat for equal halves and for a single day', () => {
      const equal = [
        day('2024-05-01', { loc_added_sum: 10 }),
        day('2024-05-02', { loc_added_sum: 10 }),
      ];
      expect(trendWithinRange(equal, locOf, 5)).toEqual({ direction: 'flat', changePct: 0 });
      expect(trendWithinRange([day('2024-05-01')], locOf, 5).direction).toBe('flat');
    });

    it('avoids dividing by a zero baseline', () => {
      const days = [
        day('2024-05-01', { loc_added_sum: 0 }),
        day('2024-05-02', { loc_added_sum: 50 }),
      ];
      const trend = trendWithinRange(days, locOf, 5);
      expect(trend.direction).toBe('up');
      expect(trend.changePct).toBeNull();
    });

    it('sorts unordered days before splitting the range', () => {
      const unordered = [
        day('2024-05-02', { loc_added_sum: 40 }),
        day('2024-05-01', { loc_added_sum: 10 }),
      ];
      expect(trendWithinRange(unordered, locOf, 5).direction).toBe('up');
    });
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
