import { expect, test } from '@playwright/test'
import { DashboardPage } from './pages/DashboardPage';

const tag = { tag: ['@teams-comparison'] };

test.describe('Teams Comparison tests', () => {
    test.describe.configure({ mode: 'serial' });

    let dashboard: DashboardPage;

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        await page.goto('/orgs/mocked-org?mock=true');

        dashboard = new DashboardPage(page);

        // wait for the data
        await dashboard.expectMetricLabelsVisible();
    });

    test.afterAll(async () => {
        await dashboard?.close();
    });

    test('has teams tab available', tag, async () => {
        // Verify that teams tab is visible for org scope
        await dashboard.expectTeamsTabVisible();
    });

    test('teams comparison empty state', tag, async () => {
        // Click on teams tab (no teams selected yet)
        await dashboard.gotoTeamsTab();

        // Verify empty state message when no teams are selected
        const emptyStateMessage = dashboard.page.getByText('No Team Selected');
        await expect(emptyStateMessage).toBeVisible();

        // Verify the helper text explaining the two modes
        const deepDiveHint = dashboard.page.getByText('1 team → Deep Dive');
        await expect(deepDiveHint).toBeVisible();

        const comparisonHint = dashboard.page.getByText('2+ teams → Comparison');
        await expect(comparisonHint).toBeVisible();
    });

    test('teams comparison functionality with team selection', tag, async () => {
        // Click on teams tab
        await dashboard.gotoTeamsTab();

        // Wait for the team selection combobox to be visible
        const teamsDropdown = dashboard.page.locator('[role="combobox"]').first();
        await expect(teamsDropdown).toBeVisible();

        // Click on the dropdown to open it
        await teamsDropdown.click();

        // Wait for the dropdown to expand and team options to appear
        await expect(dashboard.page.locator('[role="listbox"]')).toBeVisible();

        // Select teams using more specific selectors within the listbox
        const theATeamOption = dashboard.page.locator('[role="listbox"]').getByText('The A Team').first();
        await expect(theATeamOption).toBeVisible();
        await theATeamOption.click();

        await expect(teamsDropdown).toBeVisible();

        const devTeamOption = dashboard.page.locator('[role="listbox"]').getByText('Development Team').first();
        await expect(devTeamOption).toBeVisible();
        await devTeamOption.click();

        // Click outside the dropdown to close it
        await teamsDropdown.click();

        // Verify comparison mode activated (Comparison chip visible)
        const comparisonChip = dashboard.page.getByText('Comparison', { exact: true });
        await expect(comparisonChip).toBeVisible();

        // Verify per-team summary cards are displayed
        const teamACard = dashboard.page.getByText('The A Team', { exact: true }).first();
        await expect(teamACard).toBeVisible();

        const devTeamCard = dashboard.page.getByText('Development Team', { exact: true }).first();
        await expect(devTeamCard).toBeVisible();

        await expect(dashboard.page.getByText('Editor Usage (% of interactions) — by Team')).toBeVisible();
        await expect(dashboard.page.getByText('Model Usage (% of interactions) — by Team')).toBeVisible();
        await expect(dashboard.page.getByText('Team leaderboard', { exact: true })).toBeVisible();
        await expect(dashboard.page.getByText('Adoption heatmap', { exact: true })).toBeVisible();
        await expect(dashboard.page.getByText('Copilot adoption', { exact: true }).first()).toBeVisible();
        await expect(dashboard.page.getByText('Current-membership view:', { exact: true })).toBeVisible();
    });

    test('QA team activity is filtered to its members', tag, async () => {
        await dashboard.page.getByRole('button', { name: /^clear all$/i }).click();
        const dropdown = dashboard.page.locator('[role="combobox"]').first();
        await dropdown.click();
        const responsePromise = dashboard.page.waitForResponse(response =>
            response.url().includes('/api/metrics?') && new URL(response.url()).searchParams.get('githubTeam') === 'qa-team'
        );
        await dashboard.page.locator('[role="listbox"]').getByText('QA Team', { exact: true }).click();
        const response = await responsePromise;
        expect(response.ok()).toBe(true);
        const data = await response.json();
        expect(data.teamMemberCount).toBe(3);
        expect(data.reportData.length).toBeGreaterThan(0);
        expect(data.reportData.some((day: { daily_active_users: number }) => day.daily_active_users > 0)).toBe(true);
        for (const day of data.reportData) {
            expect(day.daily_active_users).toBeLessThanOrEqual(data.teamMemberCount);
        }
    });
});