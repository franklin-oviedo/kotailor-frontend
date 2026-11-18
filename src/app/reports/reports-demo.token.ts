import { InjectionToken } from '@angular/core';
import type { CustomerResponse, ExecutiveReport, ReportFilters } from './reports';

export enum ReportScenario {
  Complete = 'complete',
  Minimal = 'minimal',
  Empty = 'empty',
  HighVolume = 'high-volume',
}

export interface ReportsDemo {
  from: string;
  to: string;
  report(scenario: ReportScenario, filters: ReportFilters): ExecutiveReport;
  search(scenario: ReportScenario, term: string): CustomerResponse;
}

export const REPORTS_DEMO = new InjectionToken<ReportsDemo>('Isolated reports demo');
