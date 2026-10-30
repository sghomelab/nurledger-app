import { ComingSoon } from './ComingSoon';

/** Tab 4 — Analytics & Reports (M4). */
export default function InsightsTab() {
  return (
    <ComingSoon
      icon="stats-chart"
      title="Analytics & Reports"
      milestone="Ships in M4"
      bullets={[
        'KPI cards: revenue, COGS, gross profit, net margin, units',
        'Today / Current Period / All Time selector',
        'P&L, Velocity/ABC, stockout-forecast CSV exports',
      ]}
    />
  );
}
