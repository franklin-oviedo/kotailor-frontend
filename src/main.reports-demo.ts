import { provideBrowserGlobalErrorListeners } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { App } from './app/app';
import { REPORTS_DEMO } from './app/reports/reports-demo.token';
import { reportsDemo } from './app/reports/reports.mock';

void bootstrapApplication(App, {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter([
      {
        path: 'reportes',
        title: 'Demostración de Reportes',
        loadComponent: () => import('./app/reports/reports').then((module) => module.Reports),
      },
      { path: '**', redirectTo: 'reportes' },
    ]),
    { provide: REPORTS_DEMO, useValue: reportsDemo },
  ],
}).catch(console.error);
