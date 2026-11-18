import { Routes } from '@angular/router';
import { DocumentKind } from './documents/documents';
import { accessErrorRedirectGuard, authGuard, clientPortalGuard, workshopSelectionGuard } from './auth/auth.guard';
import type { MeasurementDraft } from './portal/measurement-draft';
import type { Customers } from './customers/customers';
import type { CustomerDetail } from './customers/customer-detail';
import type { Agenda } from './agenda/agenda';

export const routes: Routes = [
  {
    path: 'inicio',
    title: 'Inicio',
    canActivate: [workshopSelectionGuard],
    loadComponent: () => import('./home/home').then((module) => module.Home),
  },
  {
    path: 'ordenes',
    title: 'Órdenes',
    canActivate: [workshopSelectionGuard],
    loadComponent: () => import('./orders/orders').then((module) => module.Orders),
  },
  {
    path: 'agenda',
    title: 'Agenda',
    canActivate: [workshopSelectionGuard],
    canDeactivate: [(component: Agenda) => component.canLeave()],
    loadComponent: () => import('./agenda/agenda').then((module) => module.Agenda),
  },
  {
    path: 'pagos',
    title: 'Pagos y cobros',
    canActivate: [workshopSelectionGuard],
    loadComponent: () => import('./payments/payments').then((module) => module.Payments),
  },
  {
    path: 'facturacion',
    title: 'Facturación administrativa',
    canActivate: [workshopSelectionGuard],
    loadComponent: () => import('./invoices/invoices').then((module) => module.Invoices),
  },
  {
    path: 'configuracion-fiscal',
    title: 'Configuración fiscal',
    canActivate: [workshopSelectionGuard],
    data: { fiscalSettings: true },
    loadComponent: () => import('./invoices/invoices').then((module) => module.Invoices),
  },
  {
    path: 'reportes',
    title: 'Resumen ejecutivo',
    canActivate: [workshopSelectionGuard],
    loadComponent: () => import('./reports/reports').then((module) => module.Reports),
  },
  {
    path: 'agenda/calendar',
    title: 'Google Calendar',
    canActivate: [workshopSelectionGuard],
    loadComponent: () => import('./agenda/calendar-settings').then((module) => module.CalendarSettings),
  },
  {
    path: 'produccion',
    title: 'Producción',
    canActivate: [workshopSelectionGuard],
    loadComponent: () => import('./production/production').then((module) => module.Production),
  },
  {
    path: 'prendas',
    title: 'Prendas',
    canActivate: [workshopSelectionGuard],
    loadComponent: () => import('./catalog/catalog').then((module) => module.Catalog),
  },
  {
    path: 'clientes',
    title: 'Clientes',
    canActivate: [workshopSelectionGuard],
    canDeactivate: [(component: Customers) => component.canLeave()],
    loadComponent: () => import('./customers/customers').then((module) => module.Customers),
  },
  {
    path: 'clientes/:customerId',
    title: 'Ficha y medidas',
    canActivate: [workshopSelectionGuard],
    canDeactivate: [(component: CustomerDetail) => component.canLeave()],
    loadComponent: () => import('./customers/customer-detail').then((module) => module.CustomerDetail),
  },
  {
    path: 'seleccionar-taller',
    title: 'Seleccionar sastrería',
    canActivate: [authGuard],
    loadComponent: () => import('./workshops/select-workshop').then((module) => module.SelectWorkshop),
  },
  {
    path: 'invitacion',
    title: 'Invitación',
    loadComponent: () => import('./workshops/invitation').then((module) => module.Invitation),
  },
  {
    path: 'administrar-invitaciones',
    title: 'Invitaciones',
    canActivate: [authGuard],
    loadComponent: () => import('./workshops/manage-invitations').then((module) => module.ManageInvitations),
  },
  {
    path: 'invitar-cliente',
    title: 'Invitar cliente',
    canActivate: [workshopSelectionGuard],
    loadComponent: () => import('./workshops/invite-customer').then((module) => module.InviteCustomer),
  },
  {
    path: 'crear-taller',
    title: 'Crear sastrería',
    canActivate: [authGuard],
    loadComponent: () => import('./workshops/create-workshop').then((module) => module.CreateWorkshop),
  },
  {
    path: 'portal',
    title: 'Acceso de cliente',
    loadComponent: () => import('./portal/portal-access').then((module) => module.PortalAccess),
  },
  {
    path: 'portal/inicio',
    title: 'Inicio de cliente',
    canActivate: [clientPortalGuard],
    loadComponent: () => import('./portal/portal-home').then((module) => module.PortalHome),
  },
  {
    path: 'portal/citas',
    title: 'Mis citas',
    canActivate: [clientPortalGuard],
    loadComponent: () => import('./portal/portal-appointments').then((module) => module.PortalAppointments),
  },
  {
    path: 'portal/medidas',
    title: 'Mis medidas',
    canActivate: [clientPortalGuard],
    loadComponent: () => import('./portal/portal-measurements').then((module) => module.PortalMeasurements),
  },
  {
    path: 'portal/medidas/envios/:workshopId/:submissionId',
    title: 'Medidas enviadas',
    canActivate: [clientPortalGuard],
    loadComponent: () => import('./portal/measurement-submission').then((module) => module.MeasurementSubmission),
  },
  {
    path: 'portal/medidas/:workshopId/:garment',
    title: 'Borrador de medidas',
    canActivate: [clientPortalGuard],
    canDeactivate: [(component: MeasurementDraft) => component.canLeave()],
    loadComponent: () => import('./portal/measurement-draft').then((module) => module.MeasurementDraft),
  },
  {
    path: 'acceso',
    title: 'Acceso',
    loadComponent: () => import('./access/access').then((module) => module.Access),
  },
  {
    path: '',
    pathMatch: 'full',
    title: 'Gestión para sastrerías',
    canActivate: [accessErrorRedirectGuard],
    loadComponent: () => import('./landing/landing').then((module) => module.Landing),
  },
  {
    path: 'ayuda',
    title: 'Ayuda',
    data: { document: DocumentKind.Help },
    loadComponent: () => import('./documents/documents').then((module) => module.Documents),
  },
  {
    path: 'terminos',
    title: 'Términos',
    data: { document: DocumentKind.Terms },
    loadComponent: () => import('./documents/documents').then((module) => module.Documents),
  },
  {
    path: 'privacidad',
    title: 'Privacidad',
    data: { document: DocumentKind.Privacy },
    loadComponent: () => import('./documents/documents').then((module) => module.Documents),
  },
  { path: '**', redirectTo: '' },
];
