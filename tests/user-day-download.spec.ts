import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('raw user-day downloads', () => {
  const fetchMock = vi.fn();
  const records = [
    { user_login: 'octocat', day: '2026-03-01', report_start_day: '2026-03-01', report_end_day: '2026-03-02' },
    { user_login: 'octocat', day: '2026-03-02', report_start_day: '2026-03-01', report_end_day: '2026-03-02' },
  ];
  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal('$fetch', fetchMock);
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { isDataMocked: false } }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('reads the day_totals wrapper used by the organization mock fixture', async () => {
    fetchMock.mockResolvedValue(JSON.stringify({ day_totals: records }));
    const { downloadUserDayRecords } = await import('../server/services/github-copilot-usage-api');
    expect(await downloadUserDayRecords('http://localhost/mock.json')).toEqual(records);
  });

  it('does not shift real report dates', async () => {
    fetchMock.mockResolvedValue(JSON.stringify(records));
    const { downloadUserDayRecords } = await import('../server/services/github-copilot-usage-api');
    expect(await downloadUserDayRecords('https://example.test/report')).toEqual(records);
  });
});
