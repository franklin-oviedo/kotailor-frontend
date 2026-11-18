import { OrderStatus } from '../orders/order-display';
import { ReportScenario, type ReportsDemo } from './reports-demo.token';
import type { ExecutiveReport, ReportFilters } from './reports';

const year = 2026;
const from = `${year}-01-01`;
const to = `${year}-12-31`;
const statuses = Object.values(OrderStatus);
const services = ['Traje a medida', 'Ajuste de pantalón', 'Camisa de lino', 'Vestido de gala', 'Arreglo de chaqueta'];
const names = ['María Alcántara', 'Luis Rosario', 'Elena Guzmán', 'Rafael Peña', 'Julia de la Cruz', 'Daniel Santos'];
const dateFor = (index: number) => `${year}-${String(index % 12 + 1).padStart(2, '0')}-${String(Math.floor(index / 12) % 28 + 1).padStart(2, '0')}`;
const datasets = {
  [ReportScenario.Complete]: { customers: 24, orders: 120 },
  [ReportScenario.Minimal]: { customers: 1, orders: 1 },
  [ReportScenario.Empty]: { customers: 0, orders: 0 },
  [ReportScenario.HighVolume]: { customers: 600, orders: 12_000 },
};

function fixture(scenario: ReportScenario) {
  const sizes = datasets[scenario];
  const customers = Array.from({ length: sizes.customers }, (_, index) => ({
    id: `demo-${index + 1}`,
    name: `${names[index % names.length]} · Demo ${index + 1}`,
    date: dateFor(index),
  }));
  const orders = Array.from({ length: sizes.orders }, (_, index) => {
    const customer = customers[(index + Math.floor(index / customers.length)) % customers.length];
    const date = dateFor(index + 12);
    const service = services[(index + Math.floor(index / 5)) % services.length];
    const total = 90_000 + (index * 7919) % 1_800_000;
    const invoice = scenario !== ReportScenario.Minimal && index % 4 !== 0;
    const collected = scenario === ReportScenario.Minimal ? 0
      : index % 5 === 0 ? 0 : index % 3 === 0 ? total : Math.floor(total / 2);
    const refund = index % 17 === 1 ? Math.floor(collected / 3) : 0;
    return {
      customer, date, service, total, invoice, collected, refund, hasTax: index % 3 !== 0,
      refundDate: date.replace(/\d{2}$/, (day) => String(Number(day) + 1).padStart(2, '0')),
      status: statuses[(index + Math.floor(index / statuses.length)) % statuses.length],
    };
  });
  return { customers, orders };
}

const cache = new Map<ReportScenario, ReturnType<typeof fixture>>();
function dataset(scenario: ReportScenario) {
  const existing = cache.get(scenario);
  if (existing) return existing;
  const data = fixture(scenario);
  cache.set(scenario, data);
  return data;
}

function aggregate(scenario: ReportScenario, filters: ReportFilters): ExecutiveReport {
  const data = dataset(scenario);
  const inPeriod = (date: string) => date >= filters.from && date <= filters.to;
  const forCustomer = (id: string) => !filters.customerId || filters.customerId === id;
  const customers = data.customers.filter((customer) => forCustomer(customer.id));
  const monthly = new Map<string, ExecutiveReport['monthly'][number]>();
  const monthFor = (date: string) => {
    const month = date.slice(0, 7);
    let row = monthly.get(month);
    if (!row) {
      row = { month, salesCents: 0, invoicedCents: 0, collectedCents: 0, newCustomers: 0 };
      monthly.set(month, row);
    }
    return row;
  };
  const topCustomers = new Map<string, ExecutiveReport['topCustomers'][number]>();
  const topProducts = new Map<string, ExecutiveReport['topProducts'][number]>();
  const statusCounts = new Map<OrderStatus, number>();
  const days = new Map<string, number>();
  const summary: ExecutiveReport['summary'] = {
    salesCents: 0, collectedCents: 0, outstandingCents: 0, invoicedCents: 0,
    invoiceOutstandingCents: 0, invoicesIssued: 0, invoicesPaid: 0, invoicesUnpaid: 0, invoicesPartial: 0,
    invoicedWithTaxCents: 0, invoicedWithoutTaxCents: 0, invoicesWithTax: 0, invoicesWithoutTax: 0,
    activeOrders: 0, productionOrders: 0, completedOrders: 0, totalCustomers: customers.length,
    newCustomers: 0, frequentCustomers: 0, annualIncomeCents: 0,
  };
  for (const customer of customers) {
    if (!inPeriod(customer.date)) continue;
    summary.newCustomers++;
    monthFor(customer.date).newCustomers++;
  }
  const yearStart = `${filters.to.slice(0, 4)}-01-01`;
  for (const order of data.orders) {
    if (!forCustomer(order.customer.id) || (filters.status && order.status !== filters.status)) continue;
    for (const [date, cents] of [[order.date, order.collected], [order.refundDate, -order.refund]] as const) {
      if (!cents) continue;
      if (date >= yearStart && date <= filters.to) summary.annualIncomeCents += cents;
      if (inPeriod(date)) {
        summary.collectedCents += cents;
        monthFor(date).collectedCents += cents;
      }
    }
    if (!inPeriod(order.date)) continue;
    const month = monthFor(order.date);
    const balance = order.total - order.collected + order.refund;
    summary.salesCents += order.total;
    month.salesCents += order.total;
    summary.outstandingCents += balance;
    if (order.invoice) {
      summary.invoicedCents += order.total;
      summary.invoiceOutstandingCents = (summary.invoiceOutstandingCents ?? 0) + balance;
      summary.invoicesIssued++;
      if (!order.hasTax) {
        summary.invoicedWithoutTaxCents += order.total;
        summary.invoicesWithoutTax++;
      } else {
        summary.invoicedWithTaxCents += order.total;
        summary.invoicesWithTax++;
      }
      if (order.collected <= order.refund) summary.invoicesUnpaid++;
      else if (balance > 0) summary.invoicesPartial++;
      else summary.invoicesPaid++;
      month.invoicedCents += order.total;
    }
    if (order.status === OrderStatus.Delivered) summary.completedOrders++;
    else {
      summary.activeOrders++;
      if (order.status !== OrderStatus.Ready) summary.productionOrders++;
    }
    statusCounts.set(order.status, (statusCounts.get(order.status) ?? 0) + 1);
    days.set(order.date, (days.get(order.date) ?? 0) + 1);

    const customer = topCustomers.get(order.customer.id) ??
      { customerId: order.customer.id, name: order.customer.name, orders: 0, salesCents: 0 };
    customer.orders++;
    customer.salesCents += order.total;
    topCustomers.set(customer.customerId, customer);
    const product = topProducts.get(order.service) ?? { name: order.service, orders: 0, salesCents: 0 };
    product.orders++;
    product.salesCents += order.total;
    topProducts.set(product.name, product);
  }
  summary.frequentCustomers = [...topCustomers.values()].filter((item) => item.orders > 1).length;
  if (scenario === ReportScenario.Minimal && !summary.invoicesIssued) summary.invoiceOutstandingCents = null;
  return {
    summary,
    monthly: [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)),
    ordersByStatus: statuses.flatMap((status) => {
      const count = statusCounts.get(status);
      return count ? [{ status, count }] : [];
    }),
    topCustomers: [...topCustomers.values()].sort((a, b) => b.salesCents - a.salesCents || a.name.localeCompare(b.name)).slice(0, 5),
    topProducts: [...topProducts.values()].sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name)).slice(0, 5),
    operationsByDay: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, orders]) => ({ date, orders })),
    inventoryCritical: null,
  };
}

const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es-DO');
export const reportsDemo: ReportsDemo = {
  from, to, report: aggregate,
  search(scenario, term) {
    const matches = dataset(scenario).customers.filter((customer) => normalize(customer.name).includes(normalize(term)));
    return { customers: matches.slice(0, 100).map(({ id, name }) => ({ id, name })), hasMore: matches.length > 100 };
  },
};
