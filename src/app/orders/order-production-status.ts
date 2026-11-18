import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-order-production-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-label="Estado de producción">
      <ol>
        @for (stage of stages(); track stage.value) {
          <li [class.current]="stage.value === current()" [attr.aria-current]="stage.value === current() ? 'step' : null">{{ stage.label }}</li>
        }
      </ol>
      <p class="mobile-status"><strong>{{ currentLabel() }}</strong></p>
      <div class="info">
        <p>Responsable: {{ responsible() || 'Sin asignar' }}</p>
        <p>Entrega acordada: {{ delivery() }} · Hora de República Dominicana</p>
      </div>
    </section>
  `,
  styles: `
    :host { display: block; margin-top: 24px; }
    section { padding: 18px; border: 1px solid #e2e9eb; border-radius: 9px; background: white; }
    ol { display: grid; grid-template-columns: repeat(auto-fit, minmax(125px, 1fr)); gap: 12px; margin: 0; padding: 0; list-style: none; }
    li { padding: 9px 10px; border-radius: 4px; background: #f0f3f4; color: #61666a; font-size: 12px; }
    li.current { background: #005d74; color: white; font-weight: 600; }
    .info { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 20px; margin-top: 12px; }
    .info p { margin: 0; color: #61666a; font-size: 12px; }
    .mobile-status { display: none; }
    @media (max-width: 700px) {
      ol { display: none; }
      .mobile-status { display: block; margin: 0 0 8px; color: #005d74; font-size: 17px; }
      .info { display: block; margin-top: 0; }
      .info p + p { margin-top: 8px; }
    }
  `,
})
export class OrderProductionStatus {
  readonly stages = input.required<readonly { value: string; label: string }[]>();
  readonly current = input.required<string>();
  readonly currentLabel = input.required<string>();
  readonly responsible = input.required<string | null>();
  readonly delivery = input.required<string>();
}
