// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TeamAiLocTrend from '../app/components/TeamAiLocTrend.vue';
import TeamPrWeekly from '../app/components/TeamPrWeekly.vue';
import type { ReportDayTotals } from '../server/services/github-copilot-usage-api';
import type { TeamPrMetrics } from '../server/services/team-pr-search';

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

const metrics: TeamPrMetrics = {
  weeks: [], totalMerged: 10, totalAiTouched: 2, rollingAverage: 5,
  avgMergedPerPerson: 2, memberCount: 5, truncated: false, orgScoped: true,
};

afterEach(() => vi.unstubAllGlobals());

describe('team AI UI', () => {
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

  it('clears PR results when team or range changes and ignores an older in-flight request', async () => {
    let resolve!: (value: TeamPrMetrics) => void;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<TeamPrMetrics>(done => { resolve = done; }));
    vi.stubGlobal('$fetch', fetchMock);
    const wrapper = await mountSuspended(TeamPrWeekly, { props: { params: { githubTeam: 'qa' }, teamName: 'QA Team' } });
    await wrapper.get('button').trigger('click');
    await wrapper.setProps({ params: { githubTeam: 'frontend' }, teamName: 'Frontend Team' });
    resolve(metrics);
    await flushPromises();
    expect(wrapper.text()).not.toContain('Merged per person');
    fetchMock.mockResolvedValueOnce(metrics);
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Merged per person');
    await wrapper.setProps({ params: { githubTeam: 'frontend' } });
    expect(wrapper.text()).toContain('Merged per person');
    await wrapper.setProps({ params: { githubTeam: 'frontend', since: '2026-10-01' } });
    expect(wrapper.text()).not.toContain('Merged per person');
    wrapper.unmount();
  });

  it('displays the retry delay from the endpoint rate-limit response', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ statusCode: 429, data: { data: { retryAfterMinutes: 8 } } }));
    const wrapper = await mountSuspended(TeamPrWeekly, { props: { params: { githubTeam: 'qa' } } });
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('about 8 minutes');
    wrapper.unmount();
  });
});
