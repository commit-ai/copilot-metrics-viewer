<template>
  <v-card variant="outlined">
    <v-card-title class="d-flex align-center flex-wrap ga-2">
      <span class="text-subtitle-1">Team leaderboard</span>
      <v-spacer />
      <v-select
        v-model="selectedMetric"
        :items="metricOptions"
        item-title="label"
        item-value="key"
        density="compact"
        variant="outlined"
        hide-details
        style="max-width: 360px;"
      />
    </v-card-title>
    <v-card-text>
      <v-table density="compact">
        <thead>
          <tr>
            <th class="text-left">Rank</th>
            <th class="text-left">Team</th>
            <th class="text-right">{{ activeMetric.label }}</th>
            <th class="text-right">
              <v-tooltip location="top" open-delay="200">
                <template #activator="{ props: tip }">
                  <span v-bind="tip" style="cursor: help;">Trend</span>
                </template>
                <span>Second half of the selected range compared with the first half.</span>
              </v-tooltip>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rankedRows" :key="row.slug">
            <td>{{ row.rank }}</td>
            <td>
              <div class="d-flex align-center">
                <div class="team-swatch mr-2" :style="{ backgroundColor: row.color }" />
                {{ row.teamName }}
              </div>
            </td>
            <td class="text-right font-weight-medium">{{ row.display }}</td>
            <td class="text-right">
              <span :class="trendClass(row.trend.direction)">
                {{ trendArrow(row.trend.direction) }}
                <template v-if="row.trend.changePct !== null">
                  {{ Math.abs(row.trend.changePct).toFixed(0) }}%
                </template>
              </span>
            </td>
          </tr>
          <tr v-if="rankedRows.length === 0">
            <td colspan="4" class="text-center text-medium-emphasis">No team data for this range.</td>
          </tr>
        </tbody>
      </v-table>
    </v-card-text>
  </v-card>
</template>

<script lang="ts">
import { defineComponent, computed, ref, type PropType } from 'vue';
import type { ReportDayTotals } from '../../server/services/github-copilot-usage-api';
import { summarizeTeam, trendWithinRange, type TeamMetricSummary, type TrendDirection } from '@/utils/teamMetrics';

export interface LeaderboardTeam {
  slug: string;
  teamName: string;
  reportData: ReportDayTotals[];
  memberCount: number;
  color: string;
}

type MetricKey =
  | 'agentLocSharePct' | 'copilotAdoptionPct' | 'agentAdoptionPct'
  | 'cliAdoptionPct' | 'activeUsersPct' | 'acceptanceRatePct';

interface MetricOption {
  key: MetricKey;
  label: string;
  format: 'pct' | 'int';
}

const METRIC_OPTIONS: MetricOption[] = [
  { key: 'agentLocSharePct', label: 'Agent share of Copilot-added LOC', format: 'pct' },
  { key: 'copilotAdoptionPct', label: 'Copilot adoption %', format: 'pct' },
  { key: 'agentAdoptionPct', label: 'Agent adoption %', format: 'pct' },
  { key: 'cliAdoptionPct', label: 'CLI adoption %', format: 'pct' },
  { key: 'activeUsersPct', label: 'Active users %', format: 'pct' },
  { key: 'acceptanceRatePct', label: 'Acceptance rate %', format: 'pct' },
];

export default defineComponent({
  name: 'TeamLeaderboard',
  props: {
    teams: { type: Array as PropType<LeaderboardTeam[]>, required: true },
  },
  setup(props) {
    const selectedMetric = ref<MetricKey>('agentLocSharePct');
    const activeMetric = computed(
      () => METRIC_OPTIONS.find(option => option.key === selectedMetric.value) ?? METRIC_OPTIONS[0]!
    );

    const pick = (summary: TeamMetricSummary) => summary[activeMetric.value.key] as number | null;

    const rankedRows = computed(() => {
      const rows = props.teams.map(team => {
        const value = pick(summarizeTeam(team.reportData, team.memberCount));
        return {
          slug: team.slug,
          teamName: team.teamName,
          color: team.color,
          value,
          display: formatValue(value, activeMetric.value.format),
          trend: trendWithinRange(team.reportData, pick, team.memberCount),
        };
      });

      // Teams with an unknown value (no member count) sort last and are not ranked against.
      rows.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
      return rows.map((row, index) => ({ ...row, rank: row.value === null ? '—' : index + 1 }));
    });

    function formatValue(value: number | null, format: 'pct' | 'int') {
      if (value === null) return '—';
      return format === 'pct' ? `${value.toFixed(1)}%` : Math.round(value).toLocaleString();
    }

    const trendArrow = (direction: TrendDirection) =>
      direction === 'up' ? '▲' : direction === 'down' ? '▼' : '–';
    const trendClass = (direction: TrendDirection) =>
      direction === 'up' ? 'trend-up' : direction === 'down' ? 'trend-down' : 'text-medium-emphasis';

    return {
      selectedMetric,
      metricOptions: METRIC_OPTIONS,
      activeMetric,
      rankedRows,
      trendArrow,
      trendClass,
    };
  },
});
</script>

<style scoped>
.team-swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  flex-shrink: 0;
}
.trend-up {
  color: rgb(var(--v-theme-success));
}
.trend-down {
  color: rgb(var(--v-theme-error));
}
</style>
