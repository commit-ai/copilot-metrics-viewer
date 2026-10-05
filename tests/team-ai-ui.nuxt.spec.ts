// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TeamAiLocTrend from '../app/components/TeamAiLocTrend.vue';
import AgentActivityViewer from '../app/components/AgentActivityViewer.vue';
import type { ReportDayTotals } from '../server/services/github-copilot-usage-api';

vi.mock('vue-chartjs', async importOriginal => {
  const actual = await importOriginal<typeof import('vue-chartjs')>();
  const { defineComponent, h } = await import('vue');
  const chart = defineComponent({ name: 'TestChart', props: ['data', 'options'], render: () => h('div') });
  return { ...actual, Line: chart, Bar: chart };
});

function day(date: string, loc: number, agentLoc: number): ReportDayTotals {
  const activity = {
    user_initiated_interaction_count: 0, code_generation_activity_count: 0,
    code_acceptance_activity_count: 0, loc_suggested_to_add_sum: 0,
    loc_suggested_to_delete_sum: 0, loc_added_sum: agentLoc, loc_deleted_sum: 0,
  };
  return {
    ...activity, day: date, organization_id: '1', enterprise_id: '',
    daily_active_users: 0, weekly_active_users: 0, monthly_active_users: 0,
    totals_by_ide: [], totals_by_language_feature: [], totals_by_language_model: [],
    totals_by_model_feature: [], totals_by_feature: [{ ...activity, feature: 'agent_edit' }],
    loc_added_sum: loc,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('team AI UI', () => {
  it('uses direct added LOC, not added plus deleted LOC or agent-chat blocks, in Agent Activity', async () => {
    const record = day('2026-10-04', 100, 25);
    record.loc_deleted_sum = 50;
    record.totals_by_feature[0]!.loc_deleted_sum = 50;
    record.totals_by_feature.push({ ...record.totals_by_feature[0]!, feature: 'chat_panel_agent_mode', loc_added_sum: 15, loc_deleted_sum: 0 });
    record.totals_by_feature.push({ ...record.totals_by_feature[0]!, feature: 'chat_panel_edit_mode', loc_added_sum: 10, loc_deleted_sum: 0 });
    const wrapper = await mountSuspended(AgentActivityViewer, { props: { reportData: [record] } });
    expect(wrapper.get('[data-testid="agent-loc-share"]').text()).toContain('Agent share of Copilot-added LOC');
    expect(wrapper.get('[data-testid="agent-loc-share"]').text()).toContain('25.0%');
    expect(wrapper.get('[data-testid="agent-loc-share"]').text()).toContain('25 of 100 added lines');
    const userModes = wrapper.findAllComponents({ name: 'TestChart' })
      .map(chart => chart.props('data')).find(data => data.labels.includes('Edit'));
    expect(userModes.labels).toEqual(['Agent', 'Edit']);
    expect(userModes.datasets.find((dataset: { label: string }) => dataset.label === 'Added').data).toEqual([15, 10]);
    await wrapper.setProps({ reportData: [day('2026-10-04', 0, 0)] });
    expect(wrapper.get('[data-testid="agent-loc-share"]').text()).toContain('—');
    await wrapper.setProps({ reportData: [] });
    expect(wrapper.get('[data-testid="agent-loc-share"]').text()).toContain('—');
    wrapper.unmount();
  });

  it('charts daily LOC percentages and leaves zero-denominator days as gaps', async () => {
    const wrapper = await mountSuspended(TeamAiLocTrend, {
      props: { teams: [{
        slug: 'qa', teamName: 'QA Team', color: '#123456', memberCount: 3,
        reportData: [day('2026-10-02', 100, 25), day('2026-10-03', 0, 0), day('2026-10-04', 200, 100)],
      }] },
    });
    const data = wrapper.findComponent({ name: 'TestChart' }).props('data');
    expect(data.labels).toEqual(['2026-10-02', '2026-10-03', '2026-10-04']);
    expect(data.datasets[0].data).toEqual([25, null, 50]);
    wrapper.unmount();
  });
});
