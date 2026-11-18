import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { EMPTY, Subject, catchError, map, merge, startWith, switchMap, tap } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { OrderStatus, orderDeliveryDate, orderNumber, orderStatusLabel } from '../orders/order-display';
import { Shell } from '../shell/shell';
import { initialPage, Pagination, type PageInfo, type PageRequest } from '../shared/pagination';

interface ProductionOrder {
  id: string;
  number: number;
  customerName: string;
  catalogName: string;
  deliveryLocal: string;
  responsibleName: string | null;
}

interface ProductionStage {
  status: OrderStatus;
  total: number;
  orders: ProductionOrder[];
  pagination?: PageInfo;
}

enum DeliveryFilter {
  All = 'all',
  ThisWeek = 'this_week',
}

enum ResponsibleFilter {
  All = 'all',
  Unassigned = 'unassigned',
  Historical = 'historical',
}

enum ProductionView {
  Board = 'board',
  List = 'list',
}

interface ProductionResponse {
  stages: ProductionStage[];
  responsibles: { id: string; name: string }[];
  hasHistorical: boolean;
}

@Component({
  selector: 'app-production',
  imports: [ReactiveFormsModule, RouterLink, Shell, Pagination],
  templateUrl: './production.html',
  styleUrl: './production.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Production {
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly requests = new Subject<{ stage: OrderStatus; page: PageRequest } | null>();
  protected readonly workshop = this.auth.currentWorkshop();
  protected readonly filters = DeliveryFilter;
  protected readonly responsibleFilters = ResponsibleFilter;
  protected readonly views = ProductionView;
  protected readonly view = signal(ProductionView.Board);
  protected readonly delivery = new FormControl(DeliveryFilter.All, { nonNullable: true });
  protected readonly responsible = new FormControl<string>(ResponsibleFilter.All, { nonNullable: true });
  protected readonly responsibles = signal<ProductionResponse['responsibles']>([]);
  protected readonly hasHistorical = signal(false);
  protected readonly responsibleOptions = computed(() => {
    const members = this.responsibles();
    const counts = new Map<string, number>();
    for (const member of members) counts.set(member.name, (counts.get(member.name) ?? 0) + 1);
    return members.map((member) => ({
      ...member, label: counts.get(member.name)! > 1 ? `${member.name} · ${member.id}` : member.name,
    }));
  });
  protected readonly statuses = [
    OrderStatus.Received, OrderStatus.Cutting, OrderStatus.Sewing, OrderStatus.Fitting, OrderStatus.Ready,
  ];
  protected readonly selected = signal(OrderStatus.Received);
  protected readonly data = signal<ProductionStage[]>([]);
  protected readonly stages = computed(() => this.statuses.map((status) =>
    this.data().find((stage) => stage.status === status) ?? { status, total: 0, orders: [] }));
  protected readonly loading = signal(false);
  protected readonly error = signal(false);
  protected readonly label = orderStatusLabel;
  protected readonly number = orderNumber;
  protected readonly date = orderDeliveryDate;

  constructor() {
    if (!this.workshop) return;
    const url = `/api/workshops/${this.workshop.id}/production`;
    merge(this.delivery.valueChanges.pipe(map(() => null)), this.responsible.valueChanges.pipe(map(() => null)), this.requests).pipe(
      startWith(null),
      tap((request) => { if (!request) this.data.set([]); this.loading.set(true); this.error.set(false); }),
      switchMap((request) => this.http.get<ProductionResponse>(url, {
        params: {
          delivery: this.delivery.value, responsible: this.responsible.value,
          ...(request?.page ?? initialPage), ...(request ? { stage: request.stage } : {}),
        },
      }).pipe(
        map((response) => ({ response, request })),
        catchError(() => {
          this.data.set([]); this.loading.set(false); this.error.set(true);
          return EMPTY;
        }),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(({ response: { stages, responsibles, hasHistorical }, request }) => {
      if (request) this.data.update((previous) => [
        ...previous.filter((stage) => stage.status !== request.stage), ...stages,
      ]);
      else this.data.set(stages);
      this.responsibles.set(responsibles); this.hasHistorical.set(hasHistorical); this.loading.set(false);
    });
  }

  protected missingResponsible(): boolean {
    const value = this.responsible.value;
    return !Object.values(ResponsibleFilter).some((filter) => filter === value)
      && !this.responsibles().some((member) => member.id === value);
  }

  protected load(): void {
    this.requests.next(null);
  }

  protected changePage(stage: OrderStatus, page: PageRequest): void {
    this.requests.next({ stage, page });
  }
}
