import { TestBed } from '@angular/core/testing';
import { Pagination } from './pagination';

describe('Pagination', () => {
  function render(page: number, total: number) {
    const fixture = TestBed.createComponent(Pagination);
    fixture.componentRef.setInput('info', { page, pageSize: 10, total });
    const change = vi.fn();
    fixture.componentInstance.change.subscribe(change);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    return { fixture, element, change };
  }

  it('marks the active page and navigates to a numbered page or an edge', () => {
    const { element, change } = render(13, 248);
    expect(element.querySelector('[aria-current="page"]')?.textContent?.trim()).toBe('13');
    expect(element.querySelector('[role="status"]')?.textContent).toContain('121–130 de 248');
    expect(element.querySelectorAll('.number')).toHaveLength(5);
    element.querySelector<HTMLButtonElement>('[aria-label="Página 15"]')?.click();
    expect(change).toHaveBeenLastCalledWith({ page: 15, pageSize: 10 });
    element.querySelector<HTMLButtonElement>('[aria-label="Última página"]')?.click();
    expect(change).toHaveBeenLastCalledWith({ page: 25, pageSize: 10 });
    element.querySelector<HTMLButtonElement>('[aria-label="Primera página"]')?.click();
    expect(change).toHaveBeenLastCalledWith({ page: 1, pageSize: 10 });
  });

  it('prevents invalid navigation and resets to page one when the row count changes', () => {
    const { element, change, fixture } = render(25, 248);
    const next = element.querySelector<HTMLButtonElement>('[aria-label="Página siguiente"]')!;
    expect(next.getAttribute('aria-disabled')).toBe('true');
    next.click();
    expect(change).not.toHaveBeenCalled();
    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('[aria-label="Página anterior"]')?.click();
    const size = element.querySelector<HTMLSelectElement>('select')!;
    expect(size.disabled).toBe(true);
    expect(change).not.toHaveBeenCalled();
    fixture.componentRef.setInput('busy', false);
    fixture.detectChanges();
    size.value = '50';
    size.dispatchEvent(new Event('change'));
    expect(change).toHaveBeenCalledWith({ page: 1, pageSize: 50 });
  });
});
