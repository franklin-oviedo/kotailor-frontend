import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

export interface PageRequest { page: number; pageSize: number }
export interface PageInfo extends PageRequest { total: number }
export const initialPage: PageRequest = { page: 1, pageSize: 10 };

@Component({
  selector: 'app-pagination',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (info(); as data) {
      <nav [attr.aria-label]="label()" [attr.aria-busy]="busy()">
        <div class="summary" role="status" aria-atomic="true">
          <span>Mostrando <strong>{{ first() }}–{{ last() }}</strong> de <strong>{{ data.total }}</strong> registros</span>
          <span>Página {{ data.page }} de {{ pages() }}</span>
        </div>
        <div class="actions">
          <button class="edge" type="button" aria-label="Primera página" title="Primera página" [attr.aria-disabled]="busy() || data.page === 1" (click)="go(1)">
            <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M4 3v10m8-9-4 4 4 4"/></svg>
          </button>
          <button type="button" aria-label="Página anterior" title="Página anterior" [attr.aria-disabled]="busy() || data.page === 1" (click)="go(data.page - 1)">
            <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M13 8H3m4-4L3 8l4 4"/></svg>
          </button>
          @for (page of visiblePages(); track page) {
            <button type="button" class="number" [class.outer]="page < compactStart() || page >= compactStart() + 3"
              [attr.aria-label]="'Página ' + page"
              [attr.aria-current]="page === data.page ? 'page' : null"
              [attr.aria-disabled]="busy() || page === data.page" (click)="go(page)">{{ page }}</button>
          }
          <button type="button" aria-label="Página siguiente" title="Página siguiente" [attr.aria-disabled]="busy() || data.page >= pages()" (click)="go(data.page + 1)">
            <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3 8h10m-4-4 4 4-4 4"/></svg>
          </button>
          <button class="edge" type="button" aria-label="Última página" title="Última página" [attr.aria-disabled]="busy() || data.page >= pages()" (click)="go(pages())">
            <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M12 3v10M4 4l4 4-4 4"/></svg>
          </button>
        </div>
        <label class="page-size">
          <span aria-hidden="true">Filas</span>
          <select #size aria-label="Filas por página" [disabled]="busy()" (change)="changeSize($event, +size.value)">
            @for (option of sizes; track option) {
              <option [value]="option" [selected]="option === data.pageSize">{{ option }}</option>
            }
          </select>
        </label>
      </nav>
    }
  `,
  styleUrl: './pagination.scss',
})
export class Pagination {
  readonly info = input.required<PageInfo | null>();
  readonly label = input('Paginación');
  readonly busy = input(false);
  readonly change = output<PageRequest>();
  protected readonly sizes = [10, 25, 50, 100];
  protected readonly pages = computed(() => {
    const data = this.info();
    return data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  });
  protected readonly visiblePages = computed(() => {
    const start = this.windowStart(5);
    return Array.from({ length: Math.min(5, this.pages()) }, (_, index) => start + index);
  });
  protected readonly compactStart = computed(() => this.windowStart(3));
  protected readonly first = computed(() => {
    const data = this.info();
    return data?.total ? (data.page - 1) * data.pageSize + 1 : 0;
  });
  protected readonly last = computed(() => {
    const data = this.info();
    return data ? Math.min(data.total, data.page * data.pageSize) : 0;
  });
  protected changeSize(event: Event, pageSize: number): void {
    // Keep the native change from reaching the host's Angular output listener.
    event.stopPropagation();
    if (!this.busy()) this.change.emit({ page: 1, pageSize });
  }
  protected go(page: number): void {
    const data = this.info();
    if (data && !this.busy() && page !== data.page && page >= 1 && page <= this.pages()) {
      this.change.emit({ page, pageSize: data.pageSize });
    }
  }
  private windowStart(length: number): number {
    return Math.max(1, Math.min((this.info()?.page ?? 1) - Math.floor(length / 2), this.pages() - length + 1));
  }
}
