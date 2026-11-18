import { describe, expect, it } from 'vitest';
import { OrderStatus } from '../orders/order-display';
import { ReportScenario } from './reports-demo.token';
import { reportsDemo } from './reports.mock';

const filters = { from: reportsDemo.from, to: reportsDemo.to, customerId: '', status: '' };
const report = (scenario: ReportScenario, changes = {}) => reportsDemo.report(scenario, { ...filters, ...changes });

describe('Reports demo dataset', () => {
  it('reconciles all daily operations, order states and monthly cash flow for 12,000 orders', () => {
    const result = report(ReportScenario.HighVolume);
    expect(result.summary.activeOrders + result.summary.completedOrders).toBe(12_000);
    expect(result.operationsByDay?.reduce((sum, day) => sum + day.orders, 0)).toBe(12_000);
    expect(result.ordersByStatus.reduce((sum, status) => sum + status.count, 0)).toBe(12_000);
    expect(result.monthly.reduce((sum, month) => sum + month.collectedCents, 0)).toBe(result.summary.collectedCents);
    expect(result.topCustomers).toHaveLength(5);
    expect(reportsDemo.search(ReportScenario.HighVolume, 'demo')).toMatchObject({ hasMore: true });
  });

  it('distinguishes no data, zero and an unavailable invoice balance', () => {
    expect(report(ReportScenario.Empty)).toMatchObject({
      summary: { salesCents: 0, collectedCents: 0, totalCustomers: 0 },
      monthly: [], ordersByStatus: [], topProducts: [], topCustomers: [], operationsByDay: [],
    });
    expect(report(ReportScenario.Minimal).summary).toMatchObject({
      activeOrders: 1, totalCustomers: 1, collectedCents: 0, invoiceOutstandingCents: null,
    });
  });

  it('applies all three filters and shows a refund-only date as negative cash flow', () => {
    const matches = reportsDemo.search(ReportScenario.Complete, 'Luis Rosario');
    expect(matches.customers[0].id).toBe('demo-2');
    const result = report(ReportScenario.Complete, {
      customerId: matches.customers[0].id, status: OrderStatus.Cutting,
      from: '2026-02-03', to: '2026-02-03',
    });
    expect(result.summary.salesCents).toBe(0);
    expect(result.summary.totalCustomers).toBe(1);
    expect(result.summary.collectedCents).toBeLessThan(0);
    expect(result.monthly).toEqual([expect.objectContaining({ month: '2026-02', collectedCents: result.summary.collectedCents })]);
  });
});
