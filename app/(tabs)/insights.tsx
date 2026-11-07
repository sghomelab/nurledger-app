import { useT } from '../../src/hooks/useT';
import type { MsgKey } from '../../src/i18n';
import { wideColumn } from '../../src/lib/layout';
import { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../../src/components/Screen';
import { NumberText } from '../../src/components/NumberText';
import { CsvSheet } from '../../src/components/report/CsvSheet';
import { useInsights } from '../../src/hooks/useInsights';
import { useOutlet } from '../../src/hooks/useAppData';
import {
  buildPlCsv,
  buildSalesHistoryCsv,
  buildStockoutCsv,
  buildVelocityAbcCsv,
  type SalesHistoryCsvRow,
} from '../../src/lib/csv';
import { periodStartMs, paymentMix, type PeriodId } from '../../src/lib/kpi';
import { paymentMethodsFor } from '../../src/lib/payment';
import { EXPENSE_TYPE_LABELS, type ExpenseType } from '../../src/repositories/expenseRepository';
import { formatMoney, parseMoneyToMinor } from '../../src/lib/money';
import { colors, fonts, radius, spacing, typography } from '../../src/theme/tokens';

type PeriodKey = PeriodId;

const PERIODS: Array<{ key: PeriodKey; labelKey: MsgKey }> = [
  { key: 'today', labelKey: 'insights.periodToday' },
  { key: 'period', labelKey: 'insights.periodCurrent' },
  { key: 'all', labelKey: 'insights.periodAll' },
];

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function periodLabel(p: PeriodId): string {
  if (p === 'today') return 'Today';
  if (p === 'period') return 'Current period (this month)';
  return 'All time';
}

/**
 * Tab 4 — Analytics & Reports (M4: FR-400/FR-401/FR-403 + prototype §6).
 *
 * Period selector (Today / Current Period / All Time) → KPI cards (revenue,
 * COGS, gross profit, operating net margin %, discounted items, total units,
 * + transactions / avg basket / UPT), P&L, Velocity/ABC, stockout forecast —
 * each with a CSV export (structure per the prototype bundle), expense entry
 * (feeds the P&L operating costs), and searchable sales history (FR-401).
 */
export default function InsightsTab() {
  const { t } = useT();
  const { outlet } = useOutlet();
  const [period, setPeriodState] = useState<PeriodKey>('today');
  const ins = useInsights(period);

  const [csv, setCsv] = useState<{ fileName: string; text: string } | null>(null);
  const [expenseVisible, setExpenseVisible] = useState(false);
  const router = useRouter();

  const currency = outlet?.currency ?? 'SGD';
  const k = ins.data?.kpis;

  // FR-400 — payment-method split for the selected period (pure; the
  // method labels are locale data from the outlet's locale engine).
  const mix = ins.data ? paymentMix(ins.data.salesByMethod) : [];
  const mixLabel = (id: string) =>
    paymentMethodsFor(outlet?.locale).find((m) => m.id === id)?.label ?? id;
  const mixTotalMinor = mix.reduce((sum, m) => sum + m.amountMinor, 0);

  const setPeriod = useCallback(
    (p: PeriodKey) => {
      setPeriodState(p);
      ins.setPeriod(p);
    },
    [ins],
  );

  const exportPl = useCallback(() => {
    if (!k) return;
    setCsv({ fileName: `financial_pl_${period === 'all' ? 'alltime' : period}.csv`, text: buildPlCsv(k, currency, periodLabel(period)) });
  }, [k, currency, period]);

  const exportAbc = useCallback(() => {
    if (!ins.data) return;
    setCsv({
      fileName: 'velocity_abc_analysis.csv',
      text: buildVelocityAbcCsv(ins.data.abcRows, currency, periodLabel(period)),
    });
  }, [ins.data, currency, period]);

  const exportStockout = useCallback(() => {
    if (!ins.data) return;
    setCsv({
      fileName: 'stockout_forecast.csv',
      text: buildStockoutCsv(ins.data.stockoutRows, periodLabel(period)),
    });
  }, [ins.data, period]);

  const exportHistory = useCallback(() => {
    const rows: SalesHistoryCsvRow[] = ins.salesHistory.map((s) => ({
      createdAt: s.createdAt,
      saleId: s.id,
      cashierName: s.cashierName,
      items: s.itemCount,
      units: s.units,
      subtotalMinor: s.subtotalMinor,
      discountMinor: s.discountMinor,
      taxMinor: s.taxMinor,
      totalMinor: s.totalMinor,
      methods: s.methods,
    }));
    setCsv({ fileName: 'sales_history.csv', text: buildSalesHistoryCsv(rows, currency) });
  }, [ins.salesHistory, currency]);

  return (
    <ScrollView contentContainerStyle={[styles.content, wideColumn]}>
      {/* Period selector (prototype) */}
      <View style={styles.segment}>
        {PERIODS.map((p) => (
          <Pressable key={p.key} style={[styles.segmentBtn, period === p.key && styles.segmentBtnActive]} onPress={() => setPeriod(p.key)}>
            <Text style={[styles.segmentText, period === p.key && styles.segmentTextActive]}>{t(p.labelKey)}</Text>
          </Pressable>
        ))}
      </View>

      {/* KPI cards (prototype §6 + research doc §4) */}
      {k ? (
        <>
          <View style={styles.kpiGrid}>
            <KpiCard label={t('insights.revenueNet')} value={formatMoney(k.netSalesMinor, currency)} />
            <KpiCard label="COGS" value={formatMoney(k.cogsMinor, currency)} />
            <KpiCard label={t('insights.grossProfit')} value={formatMoney(k.grossProfitMinor, currency)} tone={k.grossProfitMinor >= 0 ? 'pos' : 'neg'} />
            <KpiCard label={t('insights.operatingNetMargin')} value={`${k.opNetMarginPct.toFixed(2)}%`} tone={k.opNetMarginPct >= 0 ? 'pos' : 'neg'} />
            <KpiCard label={t('insights.discountedItems')} value={String(k.discountedItems)} />
            <KpiCard label={t('insights.totalUnits')} value={String(k.unitsSold)} />
          </View>
          <View style={styles.subGrid}>
            <SubStat label={t('insights.transactions')} value={String(k.transactions)} />
            <SubStat label={t('insights.avgBasket')} value={formatMoney(k.avgBasketMinor, currency)} />
            <SubStat label={t('insights.unitsTxn')} value={k.upt.toFixed(2)} />
          </View>

          {/* Payment Mix (FR-400 — period-scoped sales by payment method) */}
          <Card style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>{t('insights.paymentMix')}</Text>
            </View>
            {mix.length === 0 ? (
              <Text style={styles.empty}>{t('insights.noSalesInThisPeriod')}</Text>
            ) : (
              <>
                {mix.map((m) => (
                  <View key={m.method} style={styles.mixRow}>
                    <View style={styles.mixTop}>
                      <Text style={styles.mixLabel}>{mixLabel(m.method)}</Text>
                      <View style={styles.mixFigures}>
                        <NumberText style={styles.mixShare}>{m.sharePct.toFixed(1)}%</NumberText>
                        <NumberText style={styles.mixAmount}>{formatMoney(m.amountMinor, currency)}</NumberText>
                      </View>
                    </View>
                    <View style={styles.mixTrack}>
                      <View style={[styles.mixFill, { width: `${m.sharePct}%` }]} />
                    </View>
                  </View>
                ))}
                <View style={styles.divider} />
                <PRow label={t('insights.total')} value={formatMoney(mixTotalMinor, currency)} strong />
              </>
            )}
          </Card>

          {/* Extended KPIs (research doc §4 full list — FR-403) */}
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>{t('insights.extendedKpis')}</Text>
            <View style={styles.kpiMiniGrid}>
              <KpiMini label={t('insights.grossMargin')} value={`${k.grossMarginPct.toFixed(2)}%`} />
              <KpiMini label={t('insights.markUp')} value={`${k.markupPct.toFixed(2)}%`} />
              <KpiMini label={t('insights.invTurnover')} value={`${k.inventoryTurnover.toFixed(2)}×`} />
              <KpiMini label={t('insights.daysOnHand')} value={`${k.daysOnHand.toFixed(0)}d`} />
              <KpiMini label={t('insights.sellThrough')} value={`${k.sellThroughPct.toFixed(1)}%`} />
              <KpiMini label="GMROI" value={`${k.gmroi.toFixed(2)}×`} />
              <KpiMini label={t('insights.shrinkage')} value={`${k.shrinkagePct.toFixed(2)}%`} />
              <KpiMini label={t('insights.stockoutRate')} value={`${k.stockoutRatePct.toFixed(1)}%`} />
              <KpiMini label={t('insights.expiryWaste')} value={`${k.expiryWastePct.toFixed(2)}%`} />
              <KpiMini label={t('insights.fillRate')} value={`${k.fillRatePct.toFixed(1)}%`} />
            </View>
            <Text style={styles.hint}>
              Turnover/GMROI use period-end inventory (at cost) as the average; stockout rate and
              expiry waste are snapshot figures (see docs/FR-COVERAGE M4).
            </Text>
          </Card>

          {/* P&L (prototype structure) */}
          <Card style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>{t('insights.profitLoss')}</Text>
              <Pressable style={styles.exportBtn} onPress={exportPl} hitSlop={8}>
                <Ionicons name="download-outline" size={14} color={colors.primary} />
                <Text style={styles.exportText}>CSV</Text>
              </Pressable>
            </View>
            <PRow label={t('insights.totalGrossSales')} value={formatMoney(k.grossSalesMinor, currency)} />
            <PRow label={t('insights.costOfGoodsSold')} value={formatMoney(k.cogsMinor, currency)} />
            <PRow label={t('insights.grossMargin2')} value={formatMoney(k.plGrossMarginMinor, currency)} strong />
            <Text style={styles.subSection}>{t('insights.operatingCosts')}</Text>
            <PRow label={t('insights.staffPayroll')} value={formatMoney(k.plOpex.payrollMinor, currency)} indent />
            <PRow label={t('insights.maintenance')} value={formatMoney(k.plOpex.maintenanceMinor, currency)} indent />
            <PRow label={t('insights.otherOperational')} value={formatMoney(k.plOpex.otherMinor, currency)} indent />
            <View style={styles.divider} />
            <PRow label={t('insights.operatingNetMargin2')} value={`${k.opNetMarginPct.toFixed(2)}%`} strong />
            <Text style={styles.subSection}>{t('insights.inventoryAssetPosition')}</Text>
            <PRow label={t('insights.atWholesaleCost')} value={formatMoney(k.inventory.atCostMinor, currency)} indent />
            <PRow label={t('insights.atRetailValue')} value={formatMoney(k.inventory.atRetailMinor, currency)} indent />
            <PRow label={t('insights.unrealizedPotentialMargin')} value={formatMoney(k.inventory.atRetailMinor - k.inventory.atCostMinor, currency)} indent />
          </Card>

          {/* Velocity / ABC */}
          <Card style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>{t('insights.velocityAbc')}</Text>
              <Pressable style={styles.exportBtn} onPress={exportAbc} hitSlop={8}>
                <Ionicons name="download-outline" size={14} color={colors.primary} />
                <Text style={styles.exportText}>CSV</Text>
              </Pressable>
            </View>
            <Text style={styles.abcNote}>{t('insights.abcNote')}</Text>
            {ins.data!.abcRows.length === 0 ? (
              <Text style={styles.empty}>{t('insights.noProductsYet')}</Text>
            ) : (
              ins.data!.abcRows.slice(0, 15).map((r) => (
                <View key={r.sku} style={styles.abcRow}>
                  <View style={styles.abcBadges}>
                    <Badge text={r.classification} tone={r.classification === 'A' ? 'pos' : r.classification === 'B' ? 'warn' : 'neutral'} />
                    <Badge text={r.velocityTier} tone="neutral" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.abcName} numberOfLines={1}>{r.name}</Text>
                    <Text style={styles.abcMeta}>
                      {r.sku} · {r.unitsSold} sold · share {r.revenueSharePct.toFixed(1)}%
                    </Text>
                  </View>
                  <NumberText style={styles.abcRevenue}>{formatMoney(r.revenueMinor, currency)}</NumberText>
                </View>
              ))
            )}
          </Card>

          {/* Stockout forecast */}
          <Card style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>{t('insights.stockoutForecast')}</Text>
              <Pressable style={styles.exportBtn} onPress={exportStockout} hitSlop={8}>
                <Ionicons name="download-outline" size={14} color={colors.primary} />
                <Text style={styles.exportText}>CSV</Text>
              </Pressable>
            </View>
            <Text style={styles.hint}>
              {t('insights.stockoutHint', {
                period: t(period === 'today' ? 'insights.periodToday' : period === 'period' ? 'insights.periodCurrent' : 'insights.periodAll').toLowerCase(),
              })}
            </Text>
            {ins.data!.stockoutRows.length === 0 ? (
              <Text style={styles.empty}>{t('insights.noProductsWithSalesIn')}</Text>
            ) : (
              ins.data!.stockoutRows.map((r) => (
                <View key={r.sku} style={styles.stockRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.abcName} numberOfLines={1}>{r.name}</Text>
                    <Text style={styles.abcMeta}>
                      {r.currentStock} on hand · {r.dailyVelocity.toFixed(1)}/day
                    </Text>
                  </View>
                  <NumberText
                    style={[
                      styles.stockDays,
                      (r.daysUntilStockout ?? 99) <= 3 ? { color: colors.danger } : (r.daysUntilStockout ?? 99) <= 7 ? { color: '#B45309' } : undefined,
                    ]}
                  >
                    {r.daysUntilStockout === null ? '—' : `${r.daysUntilStockout}d`}
                  </NumberText>
                </View>
              ))
            )}
          </Card>
        </>
      ) : (
        <Text style={styles.loading}>{t('common.loading')}</Text>
      )}

      {/* Expenses (feed the P&L operating costs) */}
      <Card style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>{t('insights.operatingExpenses')}</Text>
          <Pressable style={styles.exportBtn} onPress={() => setExpenseVisible(true)} hitSlop={8}>
            <Ionicons name="add" size={16} color={colors.primary} />
            <Text style={styles.exportText}>{t('common.add')}</Text>
          </Pressable>
        </View>
        {ins.expenses.length === 0 ? (
          <Text style={styles.empty}>{t('insights.noExpensesInThisPeriod')}</Text>
        ) : (
          ins.expenses.map((e) => (
            <View key={e.id} style={styles.expenseRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.abcName} numberOfLines={1}>{EXPENSE_TYPE_LABELS[e.type]}</Text>
                <Text style={styles.abcMeta}>
                  {new Date(e.createdAt).toLocaleDateString()}
                  {e.description ? ` · ${e.description}` : ''}
                </Text>
              </View>
              <NumberText style={styles.abcRevenue}>{formatMoney(e.amountMinor, currency)}</NumberText>
            </View>
          ))
        )}
      </Card>

      {/* Sales history (FR-401: searchable by date[period]/product/cashier) */}
      <Card style={styles.card}>
        <View style={styles.cardHead}>
          <Text style={styles.cardTitle}>{t('insights.salesHistory')}</Text>
          <Pressable style={styles.exportBtn} onPress={exportHistory} hitSlop={8}>
            <Ionicons name="download-outline" size={14} color={colors.primary} />
            <Text style={styles.exportText}>CSV</Text>
          </Pressable>
        </View>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={14} color={colors.slate400} />
          <TextInput
            style={styles.searchInput}
            value={ins.search}
            onChangeText={(v) => ins.setSearch(v)}
            placeholder={t('insights.searchProductCashierOrSale')}
            placeholderTextColor={colors.slate400}
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>
        {ins.salesHistory.length === 0 ? (
          <Text style={styles.empty}>{t('insights.noSalesInThisPeriod')}</Text>
        ) : (
          ins.salesHistory.map((s) => (
            <Pressable
              key={s.id}
              style={styles.saleRow}
              onPress={() => router.push(`/refund/${s.id}`)}
              accessibilityHint={t('insights.openRefundHint')}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.abcName} numberOfLines={1}>
                  {new Date(s.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  {s.cashierName ? ` · ${s.cashierName}` : ''}
                </Text>
                <Text style={styles.abcMeta} numberOfLines={2}>{s.products ?? '—'}</Text>
              </View>
              <NumberText style={styles.abcRevenue}>{formatMoney(s.totalMinor, currency)}</NumberText>
              <Ionicons name="chevron-forward" size={16} color={colors.slate300} />
            </Pressable>
          ))
        )}
      </Card>

      {/* CSV preview + share */}
      {csv && (
        <CsvSheet visible csv={csv.text} fileName={csv.fileName} onClose={() => setCsv(null)} />
      )}

      {/* Add expense */}
      {expenseVisible && (
        <ExpenseSheet
          currency={currency}
          onSave={async (type, amountMinor, description) => {
            setExpenseVisible(false);
            try {
              await ins.addExpense(type, amountMinor, description);
            } catch (e) {
              Alert.alert(t('insights.expenseFailed'), errMsg(e));
            }
          }}
          onCancel={() => setExpenseVisible(false)}
        />
      )}
    </ScrollView>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  const color = tone === 'pos' ? colors.positive : tone === 'neg' ? colors.danger : colors.slate900;
  return (
    <View style={styles.kpiCard}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <NumberText style={[styles.kpiValue, { color }]}>{value}</NumberText>
    </View>
  );
}

function SubStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.subStat}>
      <Text style={styles.subStatValue}>{value}</Text>
      <Text style={styles.subStatLabel}>{label}</Text>
    </View>
  );
}

function KpiMini({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kpiMini}>
      <Text style={styles.kpiMiniValue}>{value}</Text>
      <Text style={styles.kpiMiniLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function PRow({ label, value, strong, indent }: { label: string; value: string; strong?: boolean; indent?: boolean }) {
  return (
    <View style={[styles.pRow, indent && { paddingLeft: spacing.lg }]}>
      <Text style={[styles.pLabel, strong && { fontFamily: fonts.sansSemiBold, color: colors.slate900 }]}>{label}</Text>
      <NumberText style={[styles.pValue, strong && { fontFamily: fonts.monoSemiBold, color: colors.slate900 }]}>{value}</NumberText>
    </View>
  );
}

function Badge({ text, tone }: { text: string; tone: 'pos' | 'warn' | 'neutral' }) {
  const bg = tone === 'pos' ? colors.positiveSoft : tone === 'warn' ? colors.warningSoft : colors.slate100;
  const fg = tone === 'pos' ? colors.positive : tone === 'warn' ? '#B45309' : colors.slate500;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{text}</Text>
    </View>
  );
}

function ExpenseSheet({
  currency,
  onSave,
  onCancel,
}: {
  currency: string;
  onSave: (type: ExpenseType, amountMinor: number, description: string | null) => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [type, setType] = useState<ExpenseType>('payroll');
  const [text, setText] = useState('');
  const [desc, setDesc] = useState('');
  const value = parseMoneyToMinor(text);
  const valid = value > 0;

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.sheetBackdrop} onPress={onCancel}>
        <Pressable style={styles.sheetBody} onPress={() => {}}>
          <View style={styles.expenseForm}>
            <Text style={styles.cardTitle}>{t('insights.operatingExpense')}</Text>
            <View style={styles.roleRow}>
              {(Object.keys(EXPENSE_TYPE_LABELS) as ExpenseType[]).map((t) => (
                <Pressable key={t} style={[styles.roleChip, type === t && styles.roleChipActive]} onPress={() => setType(t)}>
                  <Text style={[styles.roleChipText, type === t && { color: colors.white }]} numberOfLines={1}>
                    {EXPENSE_TYPE_LABELS[t]}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={text}
              onChangeText={setText}
              keyboardType="decimal-pad"
              placeholder="0.00"
              autoFocus
              style={styles.inlineInput}
            />
            <Text style={styles.hint}>{currency} — major units</Text>
            <TextInput
              value={desc}
              onChangeText={setDesc}
              placeholder={t('insights.descriptionOptional')}
              placeholderTextColor={colors.slate400}
              style={styles.inlineInput}
            />
            <View style={styles.buttons}>
              <Pressable style={styles.cancelBtn} onPress={onCancel}>
                <Text style={styles.cancelText}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable style={[styles.saveBtn, !valid && { opacity: 0.45 }]} disabled={!valid} onPress={() => onSave(type, value, desc.trim() || null)}>
                <Text style={styles.saveText}>{t('insights.saveExpense')}</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.slate50, flexGrow: 1 },
  segment: { flexDirection: 'row', backgroundColor: colors.white, borderRadius: radius.control, borderWidth: 1, borderColor: colors.slate200, padding: 4 },
  segmentBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.chip },
  segmentBtnActive: { backgroundColor: colors.primary },
  segmentText: { fontFamily: fonts.sansSemiBold, fontSize: typography.caption, color: colors.slate500 },
  segmentTextActive: { color: colors.white },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  kpiCard: { width: '47.5%', backgroundColor: colors.white, borderRadius: radius.card, borderWidth: 1, borderColor: colors.slate200, padding: spacing.md, gap: 4 },
  kpiLabel: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate500 },
  kpiValue: { fontFamily: fonts.monoSemiBold, fontSize: 17, color: colors.slate900 },
  subGrid: { flexDirection: 'row', gap: spacing.sm },
  subStat: { flex: 1, backgroundColor: colors.slate100, borderRadius: radius.chip, alignItems: 'center', paddingVertical: spacing.sm },
  subStatValue: { fontFamily: fonts.monoSemiBold, fontSize: typography.body, color: colors.slate900 },
  subStatLabel: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate500, marginTop: 2 },
  mixRow: { gap: 4 },
  mixTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  mixLabel: { fontFamily: fonts.sansSemiBold, fontSize: typography.caption, color: colors.slate900 },
  mixFigures: { flexDirection: 'row', gap: spacing.md },
  mixShare: { fontFamily: fonts.mono, fontSize: typography.micro, color: colors.slate500, width: 44, textAlign: 'right' },
  mixAmount: { fontFamily: fonts.mono, fontSize: typography.caption, color: colors.slate900, width: 84, textAlign: 'right' },
  mixTrack: { height: 6, borderRadius: 3, backgroundColor: colors.slate100, overflow: 'hidden' },
  mixFill: { height: '100%', borderRadius: 3, backgroundColor: colors.primary },
  kpiMiniGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  kpiMini: { width: '30%', alignItems: 'center', gap: 2, backgroundColor: colors.slate50, borderRadius: radius.chip, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  kpiMiniValue: { fontFamily: fonts.monoSemiBold, fontSize: typography.caption + 1, color: colors.slate900 },
  kpiMiniLabel: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate500 },
  card: { gap: spacing.sm },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontFamily: fonts.sansBold, fontSize: typography.heading, color: colors.slate900 },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.primarySoft, borderRadius: radius.chip, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  exportText: { fontFamily: fonts.sansSemiBold, fontSize: typography.micro, color: colors.primary },
  pRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  pLabel: { fontFamily: fonts.sans, fontSize: typography.caption, color: colors.slate500 },
  pValue: { fontFamily: fonts.mono, fontSize: typography.caption, color: colors.slate700 },
  subSection: { fontFamily: fonts.sansSemiBold, fontSize: typography.micro, color: colors.slate400, marginTop: spacing.sm, textTransform: 'uppercase' },
  divider: { height: 1, backgroundColor: colors.slate200, marginVertical: spacing.xs },
  abcNote: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400, marginBottom: spacing.xs },
  abcRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  abcBadges: { flexDirection: 'row', gap: 4 },
  badge: { borderRadius: radius.chip, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontFamily: fonts.sansSemiBold, fontSize: typography.micro },
  abcName: { fontFamily: fonts.sansSemiBold, fontSize: typography.caption, color: colors.slate900 },
  abcMeta: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400, marginTop: 1 },
  abcRevenue: { fontFamily: fonts.mono, fontSize: typography.caption, color: colors.slate900 },
  stockRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  stockDays: { fontFamily: fonts.monoSemiBold, fontSize: typography.body, color: colors.slate900 },
  hint: { fontFamily: fonts.sans, fontSize: typography.micro, color: colors.slate400 },
  empty: { fontFamily: fonts.sans, fontSize: typography.caption, color: colors.slate400, paddingVertical: spacing.sm },
  loading: { fontFamily: fonts.sans, fontSize: typography.body, color: colors.slate400, textAlign: 'center', paddingVertical: spacing.xl },
  expenseRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.slate50, borderWidth: 1, borderColor: colors.slate200, borderRadius: radius.control, paddingHorizontal: spacing.md, height: 40 },
  searchInput: { flex: 1, fontFamily: fonts.sans, fontSize: typography.body, color: colors.slate900, paddingVertical: 0 },
  saleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.slate100 },
  expenseForm: { gap: spacing.md, padding: spacing.lg },
  inlineInput: { fontFamily: fonts.monoSemiBold, fontSize: 22, color: colors.slate900, borderWidth: 1, borderColor: colors.slate300, borderRadius: radius.control, paddingHorizontal: spacing.md, paddingVertical: spacing.md, textAlign: 'right' },
  roleRow: { flexDirection: 'row', gap: spacing.sm },
  roleChip: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.control, borderWidth: 1, borderColor: colors.slate300, backgroundColor: colors.white },
  roleChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  roleChipText: { fontFamily: fonts.sansSemiBold, fontSize: typography.micro, color: colors.slate700 },
  buttons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
  cancelBtn: { flex: 1, height: 48, borderRadius: radius.control, borderWidth: 1, borderColor: colors.slate300, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: fonts.sansSemiBold, fontSize: typography.body, color: colors.slate700 },
  saveBtn: { flex: 1, height: 48, borderRadius: radius.control, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveText: { fontFamily: fonts.sansBold, fontSize: typography.body, color: colors.white },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheetBody: { width: '100%', maxWidth: 640, alignSelf: 'center', backgroundColor: colors.white, borderTopLeftRadius: radius.card + 4, borderTopRightRadius: radius.card + 4, height: '60%' },
});
