import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

export enum DocumentKind {
  Help = 'help',
  Terms = 'terms',
  Privacy = 'privacy',
}

interface DocumentContent {
  title: string;
  introduction: string;
  sections: { title: string; paragraphs: string[] }[];
}

const documents: Record<DocumentKind, DocumentContent> = {
  [DocumentKind.Help]: {
    title: 'Centro de ayuda',
    introduction: 'Guía de uso. Aquí se documentan solamente las funciones disponibles.',
    sections: [
      {
        title: 'Ingresar con Google',
        paragraphs: [
          'Desde la pantalla de acceso, selecciona «Continuar con Google». Serás dirigido a Google para elegir tu cuenta. La aplicación no solicita ni almacena tu contraseña de Google.',
          'El acceso solicita tu identificador de Google, nombre y correo verificado. No da acceso a tu correo, archivos ni calendario.',
        ],
      },
      {
        title: 'Si no puedes acceder',
        paragraphs: [
          'Si cancelaste la selección de cuenta, vuelve a intentarlo. Si la solicitud venció, inicia un nuevo acceso desde la pantalla principal. No reutilices el enlace de retorno de Google ni lo compartas.',
          'Si el servidor no responde, verifica tu conexión y vuelve a intentarlo. Si Google indica redirect_uri_mismatch o acceso bloqueado, el administrador debe revisar la configuración del cliente y los usuarios de prueba en Google Cloud.',
        ],
      },
      {
        title: 'Cerrar sesión',
        paragraphs: [
          'Después de ingresar, selecciona «Cerrar sesión», especialmente en equipos compartidos. Esto finaliza tu sesión en la aplicación, no la de Google.',
          'La sesión tiene una duración máxima de ocho horas. Para continuar después de su vencimiento debes ingresar de nuevo.',
        ],
      },
      {
        title: 'Clientes',
        paragraphs: [
          'Selecciona una sastrería y entra en «Clientes» desde el menú lateral o desde «Más» en la navegación móvil. Puedes buscar por nombre, teléfono o documento, y registrar un cliente con «Nuevo cliente».',
          'El nombre y teléfono son obligatorios. La identificación es opcional; si la indicas, completa tanto el tipo como el número. La autorización de contacto es opcional. Para localizar otros resultados, ajusta la búsqueda.',
          'En escritorio, selecciona un cliente en el directorio para consultar su ficha; en móvil, abre su ficha desde la lista. Registra las medidas en centímetros y confirma su verificación para guardar una nueva versión; cada prenda conserva su propio historial.',
          'Guarda o descarta las modificaciones antes de cambiar de cliente o salir de la ficha. Antes de recargar o cerrar la página, guarda los cambios: el navegador no los conserva automáticamente.',
          'Esta función está en desarrollo: no introduzcas datos reales de clientes. La edición y eliminación de clientes y la gestión de consentimientos todavía no están disponibles.',
        ],
      },
      {
        title: 'Sastrerías e invitaciones de administradores',
        paragraphs: [
          'Si perteneces a varias sastrerías, selecciona la que deseas utilizar. Puedes cambiarla desde el nombre de la sastrería en la cabecera; al recargar la página tendrás que seleccionarlo nuevamente.',
          'El administrador de plataforma puede crear una sastrería e invitar a su primer administrador, o autorizar a una persona a crear la suya. El administrador de la sastrería también puede invitar a otro administrador desde «Invitaciones».',
          'Copia el enlace generado y envíalo de forma segura: no se envía automáticamente. Caduca a los siete días y solo puede aceptarlo la cuenta de Google del correo indicado. Si la invitación autoriza a crear una sastrería, utiliza «Crear sastrería» después de aceptarla.',
          'Desde «Invitar cliente», un administrador o encargado puede generar un enlace para el correo de Google del cliente. El cliente elige una ficha de esa sastrería con el mismo correo o crea una nueva con su nombre y teléfono. Una cuenta puede vincularse con varias sastrerías.',
          'Las fichas sin correo coincidente no se muestran para vinculación. Si no encuentras tu ficha, consulta a la sastrería antes de crear otra.',
          'Desde «Soy cliente: ir a mi portal» puedes entrar con Google y consultar tus sastrerías vinculadas. En «Mis medidas» selecciona una sastrería para consultar las últimas fichas verificadas o guardar borradores personales, incluso incompletos. Guarda antes de recargar o cerrar la página.',
          'El portal requiere un vínculo como cliente. Ser administrador de una sastrería no da acceso al portal de sus clientes; una cuenta que también sea cliente solo puede consultar sus propios datos vinculados.',
          'Los borradores son privados. Para compartir uno completo, guárdalo, revisa sus valores y confirma el envío. Solo puede haber un envío pendiente por ficha y prenda; el personal autorizado de la sastrería debe revisarlo y confirmar una nueva versión verificada. El envío original y las versiones anteriores se conservan; las órdenes existentes no cambian.',
          'Si se revoca el vínculo con la sastrería, se eliminan sus borradores y ya no puedes consultar sus envíos desde el portal. En «Mis citas» puedes agendar, consultar, reprogramar y cancelar tus propias citas; las solicitudes de compra aún no están disponibles.',
        ],
      },
      {
        title: 'Prendas y servicios',
        paragraphs: [
          'Desde «Prendas» en el menú lateral o «Más» en móvil puedes buscar, crear y editar plantillas para la sastrería. Indica el nombre, categoría, precio base sin impuestos y tratamiento de ITBIS; también puedes seleccionar las plantillas de medidas y escribir instrucciones.',
          'Si otra persona modifica una plantilla mientras la editas, cancela y vuelve a abrirla para revisar los cambios. La sastrería debe confirmar el tratamiento tributario aplicable. El catálogo no emite comprobantes.',
        ],
      },
      {
        title: 'Órdenes',
        paragraphs: [
          'En «Inicio» puedes consultar las órdenes sin entregar y las entregas pendientes del día, según la hora de República Dominicana. Las próximas entregas se ordenan por fecha acordada e incluyen las vencidas.',
          'Desde «Órdenes» puedes crear un encargo seleccionando un cliente, una prenda o servicio y una versión verificada para cada plantilla de medidas requerida. Puedes ajustar el precio y seleccionar la fecha y hora de entrega en horario de República Dominicana.',
          'El propietario puede configurar la tasa de ITBIS para nuevas órdenes gravadas. Si no está configurada, se mostrará una advertencia y la orden se guardará sin calcular el impuesto ni el total. La configuración posterior no modifica órdenes anteriores.',
          'La orden conserva una copia de las medidas seleccionadas. Los propietarios y encargados pueden avanzar o retroceder una etapa a la vez desde su ficha; una orden entregada puede volver a «Lista para entregar». Cada cambio se registra en la actividad con su autor y fecha.',
          'Si se informa de un cambio concurrente o no se puede confirmar una actualización, selecciona «Actualizar orden» antes de continuar. Las órdenes creadas no se pueden editar.',
          'El propietario y los encargados pueden registrar cobros parciales y devoluciones desde la ficha de la orden. El registro no procesa pagos; comprueba el movimiento antes de registrarlo. Una orden sin total calculado no admite cobros.',
        ],
      },
      {
        title: 'Facturación administrativa',
        paragraphs: [
          'Propietarios y encargados pueden abrir «Facturación» para crear un borrador manual o desde una orden. El número interno consecutivo se asigna al crear el borrador y no se reutiliza. Los cobros existentes de una orden se vinculan al mismo ledger, sin duplicarlos.',
          'Puedes editar un borrador antes de emitirlo. Al emitirlo queda inmutable; para corregirlo, anúlalo con un motivo y crea otro documento administrativo. No se permite más de una factura vinculada a la misma orden.',
          'La tasa ITBIS configurada por la sastrería se usa para calcular las líneas gravadas. Si falta, el total queda sin calcular y no se puede emitir la factura hasta configurar la tasa o clasificar los conceptos como exentos, según corresponda.',
          'Solo se pueden registrar cobros y devoluciones en facturas emitidas. Estos registros no procesan pagos en línea ni representan una confirmación bancaria. El perfil comercial/fiscal y el logo se administran por el propietario.',
          'Las facturas y sus PDF son documentos administrativos internos: no son comprobantes fiscales autorizados por DGII, no incluyen NCF/e-CF ni se conectan con DGII. Consulta un profesional tributario sobre el uso adecuado y la clasificación de cada operación.',
        ],
      },
      {
        title: 'Producción',
        paragraphs: [
          'Desde «Producción» puedes consultar las órdenes sin entregar por etapa, en tablero o lista. El filtro «Esta semana» comprende de lunes a domingo según la hora de República Dominicana y excluye las entregas vencidas de semanas anteriores. Se muestran hasta 20 órdenes por etapa, ordenadas por fecha acordada; para localizar otras utiliza la búsqueda de Órdenes.',
          'Puedes filtrar por responsable o por órdenes sin asignar. Las asignaciones históricas que solo conservan un nombre se muestran por separado porque no es posible identificar su cuenta de forma segura.',
          'Selecciona una orden para buscarla por número y abre su ficha para consultar la actividad o cambiar su etapa si eres propietario o encargado. Las tareas individuales aún no están disponibles.',
        ],
      },
      {
        title: 'Agenda',
        paragraphs: [
          'El propietario y los encargados pueden crear, consultar, reprogramar y cancelar citas. Los horarios corresponden a República Dominicana y se comprueban conflictos con citas registradas en la sastrería, no con eventos externos de Google.',
          'En el portal, selecciona «Mis citas» para elegir la sastrería, revisar una semana, agendar una cita con el responsable que prefieras o reprogramar y cancelar una cita propia. Las horas se interpretan en República Dominicana; si el horario ya no está disponible, elige otro.',
          'La lista muestra hasta 100 citas por semana. La conexión con Google Calendar se configura por separado y la sincronización aún no está activa.',
        ],
      },
      {
        title: 'Conectar Google Calendar',
        paragraphs: [
          'Desde «Agenda» el propietario o un encargado puede iniciar una autorización independiente, continuar con Google y seleccionar un calendario con permiso de escritura. El permiso permite listar calendarios y gestionar eventos en los calendarios accesibles por la cuenta autorizada.',
          'La sincronización de citas todavía no está disponible. Por ahora tampoco se puede cambiar el calendario seleccionado, porque el traslado seguro de eventos está pendiente.',
          'Para desconectar, confirma la acción en la pantalla de Calendar. La aplicación elimina las credenciales locales y conserva los eventos existentes en Google. Para revocar también el permiso, utiliza la configuración de seguridad de tu cuenta de Google.',
        ],
      },
      {
        title: 'Funciones en construcción',
        paragraphs: [
          'Los reportes, la sincronización de Google Calendar y las solicitudes de compra del portal del cliente todavía no están habilitados.',
          'La vista de la sastrería en la pantalla de acceso es ilustrativa: no contiene información de tu negocio.',
        ],
      },
    ],
  },
  [DocumentKind.Terms]: {
    title: 'Términos de uso',
    introduction: 'Borrador para revisión jurídica. No es un contrato definitivo ni una autorización para operar comercialmente. Deben completarse los datos del prestador, las condiciones comerciales y los canales de atención antes del lanzamiento.',
    sections: [
      {
        title: 'Objeto y alcance',
        paragraphs: [
          'Esta aplicación permite gestionar sastrerías en República Dominicana. Durante esta etapa se habilitan el acceso con Google y funciones iniciales de clientes solo para pruebas; no deben introducirse datos reales.',
          'El uso de una cuenta Google no acredita que una persona esté autorizada para consultar o administrar datos de una sastrería. Esa autorización debe verificarse por separado.',
        ],
      },
      {
        title: 'Uso responsable',
        paragraphs: [
          'Utiliza únicamente cuentas e información para las que tengas autorización. No intentes acceder a otras sastrerías, evadir controles, introducir contenido malicioso ni utilizar datos personales para fines incompatibles con su recopilación.',
          'La sastrería debe informar a sus clientes sobre el tratamiento de sus datos y recabar la autorización que corresponda antes de introducir medidas corporales, datos de contacto u otra información personal.',
        ],
      },
      {
        title: 'Condiciones comerciales pendientes',
        paragraphs: [
          'Antes de ofrecer suscripciones deberán publicarse la identidad y RNC del prestador, domicilio, contacto, precios en la moneda aplicable, impuestos, renovación, cancelación, reembolsos, soporte y tratamiento de reclamaciones.',
          'Este borrador no limita derechos irrenunciables de consumidores ni sustituye las obligaciones aplicables de la Ley 358-05. Las condiciones definitivas requieren revisión jurídica local.',
        ],
      },
      {
        title: 'Facturación y obligaciones fiscales',
        paragraphs: [
          'El sistema no está certificado como emisor electrónico ni está integrado con DGII. Ninguna pantalla, recibo ilustrativo o número generado constituye por sí mismo un comprobante fiscal válido.',
          'La implementación fiscal deberá considerar el Código Tributario, la Ley 32-23 sobre facturación electrónica y la normativa vigente de DGII, incluyendo los requisitos de autorización, firma, conservación y contingencia que correspondan.',
        ],
      },
      {
        title: 'Disponibilidad y legislación',
        paragraphs: [
          'No se ofrece todavía un acuerdo de nivel de servicio ni una garantía de recuperación de datos. No uses esta etapa de desarrollo como único registro de tu operación.',
          'La versión definitiva deberá adecuarse al derecho dominicano, incluyendo las normas aplicables sobre protección de datos, comercio electrónico, consumidores y delitos de alta tecnología, sin excluir los derechos que la ley proteja.',
        ],
      },
    ],
  },
  [DocumentKind.Privacy]: {
    title: 'Política de privacidad',
    introduction: 'Borrador informativo de la implementación actual. Antes de su publicación definitiva deben identificarse el responsable del tratamiento, domicilio y canal verificable para ejercer derechos, así como los proveedores y plazos de conservación.',
    sections: [
      {
        title: 'Datos utilizados para el acceso',
        paragraphs: [
          'Al ingresar con Google se verifican el identificador de tu cuenta, correo electrónico verificado y nombre. Se almacenan esos datos y las fechas de creación y actualización de tu registro.',
          'La aplicación no almacena tu contraseña de Google. El acceso no conserva tokens de Google ni solicita permisos de Gmail, Drive o Calendar. Si conectas Calendar por separado, se solicita permiso para listar calendarios y gestionar eventos accesibles y se conserva cifrado el token de renovación hasta desconectar.',
        ],
      },
      {
        title: 'Sesiones y cookies',
        paragraphs: [
          'Se utiliza una cookie técnica de sesión HttpOnly y SameSite=Lax. En producción requiere HTTPS y el atributo Secure. El servidor conserva los datos de sesión en PostgreSQL.',
          'La transacción de ingreso vence en cinco minutos; la sesión autenticada dura como máximo ocho horas. Cerrar sesión elimina la sesión del servidor y solicita al navegador borrar su cookie.',
        ],
      },
      {
        title: 'Finalidades y acceso a los datos',
        paragraphs: [
          'Los datos de identidad permiten autenticar al usuario y asociarlo a las sastrerías para los que tenga autorización. La función de prueba puede almacenar datos de contacto, identificación, elección de contacto, borradores personales, envíos y versiones de medidas verificadas. Los borradores son privados; los envíos confirmados y las versiones verificadas están disponibles para el personal autorizado de la sastrería.',
          'Google interviene como proveedor de identidad bajo sus propias condiciones. El alojamiento y otros encargados deben identificarse antes de operar, evaluando las transferencias internacionales y garantías que correspondan.',
        ],
      },
      {
        title: 'Derechos y conservación',
        paragraphs: [
          'La política definitiva debe facilitar el ejercicio de los derechos aplicables de acceso, rectificación, cancelación u oposición conforme a la Ley 172-13 y demás normativa pertinente. El canal de solicitudes todavía no está habilitado.',
          'Cerrar sesión no elimina la cuenta. Aún no están implementados el borrado de cuenta, las solicitudes de derechos ni una política completa de retención. No deben incorporarse datos reales de clientes hasta resolver estos puntos.',
        ],
      },
      {
        title: 'Seguridad y lanzamiento',
        paragraphs: [
          'Las medidas técnicas implementadas reducen riesgos, pero no constituyen una certificación ni una garantía de seguridad absoluta. Antes del lanzamiento son necesarias pruebas, control de accesos por sastrería, procedimientos de incidentes y respaldo y restauración verificados.',
          'Los datos de medidas y demás información de clientes solo deben incorporarse cuando existan una finalidad legítima, información al titular y las autorizaciones y controles que correspondan.',
        ],
      },
    ],
  },
};

@Component({
  selector: 'app-documents',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main>
      <a routerLink="/acceso">← Volver al acceso</a>
      <h1>{{ content().title }}</h1>
      <p class="introduction">{{ content().introduction }}</p>
      @for (section of content().sections; track section.title) {
        <section>
          <h2>{{ section.title }}</h2>
          @for (paragraph of section.paragraphs; track paragraph) {
            <p>{{ paragraph }}</p>
          }
        </section>
      }
      <nav aria-label="Información y ayuda">
        <a routerLink="/ayuda">Ayuda</a>
        <a routerLink="/terminos">Términos</a>
        <a routerLink="/privacidad">Privacidad</a>
      </nav>
    </main>
  `,
  styles: `
    :host { display: block; min-height: 100vh; background: #f5f8f9; color: #16343c; }
    main { max-width: 800px; margin: auto; padding: 32px 20px 64px; }
    h1 { font-size: clamp(26px, 5vw, 36px); margin-block: 32px 20px; }
    h2 { font-size: 21px; margin-top: 32px; }
    p { line-height: 1.7; }
    a { color: #005d74; text-underline-offset: 3px; }
    .introduction { padding: 20px; border-left: 4px solid #005d74; background: #e7f5f6; }
    nav { display: flex; flex-wrap: wrap; gap: 24px; margin-top: 40px; }
  `,
})
export class Documents {
  private readonly route = inject(ActivatedRoute);
  protected readonly content = toSignal(
    this.route.data.pipe(map((data) => documents[data['document'] as DocumentKind])),
    { initialValue: documents[this.route.snapshot.data['document'] as DocumentKind] },
  );
}
