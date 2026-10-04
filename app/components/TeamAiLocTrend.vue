<template>
  <v-card class="pa-3">
    <v-card-title class="text-subtitle-1">AI LOC % (agent share) — over time</v-card-title>
    <p class="text-caption text-medium-emphasis mb-3">
      Agent-written lines as a percentage of Copilot-tracked lines, not all code written by the team.
      Days without tracked LOC are gaps.
    </p>
    <div v-if="chartData.labels?.length" style="height:240px">
      <Line :data="chartData" :options="chartOptions" />
    </div>
    <p v-else class="text-medium-emphasis text-center py-4">No LOC data for this range.</p>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Line } from 'vue-chartjs';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, type ChartData, type ChartOptions } from 'chart.js';
import type { ScorecardTeam } from './TeamAiScorecards.vue';
import { summarizeTeam } from '@/utils/teamMetrics';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);
const props = defineProps<{ teams: ScorecardTeam[] }>();
const chartData = computed<ChartData<'line'>>(() => {
  const days = [...new Set(props.teams.flatMap(team => team.reportData.map(day => day.day)))].sort();
  return {
    labels: days,
    datasets: props.teams.map(team => ({
      label: team.teamName,
      borderColor: team.color,
      backgroundColor: team.color,
      data: days.map(day => summarizeTeam(team.reportData.filter(row => row.day === day), team.memberCount).agentLocSharePct),
      spanGaps: false,
      tension: 0.1,
    })),
  };
});
const chartOptions: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  scales: { y: { min: 0, max: 100, ticks: { callback: value => `${value}%` } } },
  plugins: {
    legend: { position: 'bottom' },
    tooltip: { callbacks: { label: context => `${context.dataset.label}: ${context.parsed.y?.toFixed(1)}%` } },
  },
};
</script>
