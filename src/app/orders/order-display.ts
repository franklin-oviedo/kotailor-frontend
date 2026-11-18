export enum OrderStatus {
  Received = 'received',
  Cutting = 'cutting',
  Sewing = 'sewing',
  Fitting = 'fitting',
  Ready = 'ready',
  Delivered = 'delivered',
}

export function orderStatusLabel(status: OrderStatus): string {
  const labels: Record<OrderStatus, string> = {
    [OrderStatus.Received]: 'Recibida',
    [OrderStatus.Cutting]: 'En corte',
    [OrderStatus.Sewing]: 'En confección',
    [OrderStatus.Fitting]: 'En prueba',
    [OrderStatus.Ready]: 'Lista para entregar',
    [OrderStatus.Delivered]: 'Entregada',
  };
  return labels[status];
}

export function orderNumber(number: number): string {
  return `OT-${String(number).padStart(4, '0')}`;
}

export function orderDeliveryDate(value: string): string {
  const [day, time] = value.split('T');
  const [year, month, date] = day.split('-');
  return `${date}/${month}/${year} · ${time}`;
}
