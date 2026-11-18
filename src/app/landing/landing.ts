import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-landing',
  imports: [NgOptimizedImage, RouterLink],
  templateUrl: './landing.html',
  styleUrl: './landing.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Landing {
  protected readonly currentYear = new Date().getFullYear();

  protected readonly features = [
    {
      title: 'Clientes y medidas',
      description:
        'Organiza las fichas de tus clientes, sus contornos por prenda y el historial de medidas verificadas.',
    },
    {
      title: 'Órdenes y producción',
      description:
        'Acompaña cada encargo por sus etapas, coordina las entregas y consulta la bitácora de cambios.',
    },
    {
      title: 'Agenda conectada',
      description:
        'Gestiona citas y conecta Google Calendar con una autorización independiente del inicio de sesión.',
    },
    {
      title: 'Pagos y cobros',
      description:
        'Registra abonos, pagos parciales y devoluciones. Consulta el saldo de cada documento y el acumulado del cliente.',
    },
    {
      title: 'Facturas con tu identidad',
      description:
        'Incluye nombre comercial, razón social, RNC, dirección, contacto, logo y sello. Configura el ITBIS de tu sastrería.',
    },
    {
      title: 'Resumen ejecutivo',
      description:
        'Consulta ingresos, saldos pendientes y producción con filtros por fecha, cliente y estado.',
    },
  ];
  protected readonly steps = [
    {
      title: 'Recibe tu invitación',
      description:
        'Un administrador autoriza el acceso de tu sastrería. Los encargados pueden invitar a sus clientes.',
    },
    {
      title: 'Accede con Google',
      description:
        'Utiliza tu cuenta autorizada, sin crear otra contraseña. Selecciona tu sastrería si perteneces a más de una.',
    },
    {
      title: 'Organiza tu operación',
      description:
        'Configura tu identidad fiscal y comienza a gestionar clientes, medidas, encargos, citas y cobros.',
    },
  ];
  protected readonly questions = [
    {
      title: '¿Puedo crear una cuenta sin invitación?',
      answer:
        'El acceso a las sastrerías requiere una invitación o autorización de un administrador. Los clientes reciben su enlace de vinculación de la sastrería que los atiende.',
    },
    {
      title: '¿Google Calendar es obligatorio?',
      answer:
        'No. El acceso utiliza únicamente Google para verificar tu identidad. Conectar un calendario es opcional y requiere una autorización adicional desde la agenda.',
    },
    {
      title: '¿Las facturas son comprobantes fiscales de la DGII?',
      answer:
        'No. Son documentos administrativos internos: no generan NCF/e-CF ni sustituyen un comprobante fiscal autorizado. La configuración de ITBIS debe revisarse con tu asesor tributario.',
    },
    {
      title: '¿Qué pasa si cambio los datos de mi sastrería?',
      answer:
        'Las nuevas emisiones utilizan la configuración fiscal vigente. Las facturas ya emitidas conservan los datos, el logo y el sello que se guardaron al emitirlas.',
    },
  ];
}
