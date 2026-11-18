export enum InvoiceStatus { Draft = 'draft', Issued = 'issued', Void = 'void' }
export enum InvoiceCollectionState { Partial = 'partial', Paid = 'paid' }
export type InvoiceDisplayStatus = InvoiceStatus | InvoiceCollectionState;

export const invoiceStatusLabels: Record<InvoiceDisplayStatus, string> = {
  [InvoiceStatus.Draft]: 'Borrador',
  [InvoiceStatus.Issued]: 'Emitida',
  [InvoiceStatus.Void]: 'Anulada',
  [InvoiceCollectionState.Partial]: 'Pago parcial',
  [InvoiceCollectionState.Paid]: 'Pagada',
};

export interface InvoiceCollection {
  displayStatus: InvoiceDisplayStatus;
  paidCents: number;
  balanceCents: number | null;
}
