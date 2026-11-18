import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-portal-header',
  imports: [NgOptimizedImage, RouterLink, RouterLinkActive],
  template: `
    <header class="header">
      <div class="header-inner">
        <div class="logo"><img ngSrc="assets/access-logo-desktop.png" width="2172" height="724" alt="Logo institucional" priority /></div>
        <div class="brand" [class.logged-in]="!access()"><span>Portal del cliente</span></div>
        @if (access()) {
          <a class="workshop-access" routerLink="/acceso">← Acceso de la sastrería</a>
        } @else {
          <nav class="desktop-nav" aria-label="Navegación del portal">
            <a routerLink="/portal/inicio" routerLinkActive="active" ariaCurrentWhenActive="page">Inicio</a>
            <a routerLink="/portal/citas" routerLinkActive="active" ariaCurrentWhenActive="page">Mis citas</a>
            <button type="button" (click)="unavailable.emit('Mis órdenes')">Mis órdenes</button>
            <a routerLink="/portal/medidas" routerLinkActive="active" ariaCurrentWhenActive="page">Mis medidas</a>
          </nav>
          <div class="user"><span class="mobile-label">Portal del cliente</span><strong>{{ userName() }}</strong><button type="button" [disabled]="loggingOut()" (click)="signOut.emit()">Cerrar sesión</button></div>
        }
      </div>
    </header>
    @if (!access()) {
      <nav class="mobile-nav" aria-label="Navegación móvil del portal">
        <a routerLink="/portal/inicio" routerLinkActive="active" ariaCurrentWhenActive="page">Inicio</a>
        <a routerLink="/portal/citas" routerLinkActive="active" ariaCurrentWhenActive="page">Citas</a>
        <button type="button" (click)="unavailable.emit('Órdenes')">Órdenes</button>
        <a routerLink="/portal/medidas" routerLinkActive="active" ariaCurrentWhenActive="page">Medidas</a>
      </nav>
    }
  `,
  styleUrl: './portal-header.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortalHeader {
  readonly access = input(false);
  readonly userName = input('');
  readonly loggingOut = input(false);
  readonly signOut = output<void>();
  readonly unavailable = output<string>();
}
