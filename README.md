# Aplicación de gestión para sastrerías

## Estado de la implementación

La página pública `/` presenta las funciones disponibles: clientes y contornos,
órdenes y producción, agenda, pagos, facturación con identidad fiscal, PDF A4,
ticket de 80 mm, resumen ejecutivo y portal del cliente. El acceso con Google se
mantiene en `/acceso`, con el diseño aprobado para escritorio y móvil. La
actividad mostrada en la presentación del acceso es únicamente un ejemplo visual.
Los enlaces anteriores de error OAuth a `/?authError=...` se redirigen al acceso
conservando el mensaje. La landing no requiere una sesión ni consulta datos del negocio.

El acceso con Google está integrado con el backend NestJS y PostgreSQL. Tras
iniciar sesión se muestra la pantalla de inicio; si no existe un taller asociado,
los indicadores muestran que los datos no están disponibles. Las invitaciones
de administradores permiten asociarse a un taller o crear uno cuando se recibe
autorización. Si una cuenta pertenece a varios talleres, debe seleccionar uno;
puede cambiarlo desde la cabecera. La selección se mantiene durante la sesión
de la aplicación y se solicita de nuevo al recargar la página. Los enlaces de
invitación se comparten manualmente y caducan a las 168 horas.
Los administradores y encargados pueden invitar a clientes mediante enlaces
compartidos manualmente. Cada cliente puede seleccionar una ficha existente
del taller con el mismo correo verificado o crear una nueva. El acceso y el
inicio del portal permiten consultar y seleccionar talleres vinculados. También
se pueden consultar las últimas medidas verificadas por cada taller y guardar
borradores personales privados, incluso incompletos. Los borradores no se
comparten hasta confirmar su envío y no modifican las medidas verificadas.
Para entrar al portal se requiere un vínculo como cliente; el rol de administrador
por sí solo no concede acceso. Una cuenta con ambos perfiles solo consulta sus
propios datos de cliente.
Un borrador completo puede enviarse para revisión; solo se admite un envío
pendiente por ficha y prenda. El personal autorizado puede revisarlo y crear una
nueva versión verificada; el envío original y las versiones anteriores se
conservan y las órdenes existentes no cambian. El portal permite a cada cliente
agendar, consultar, reprogramar y cancelar sus citas; las solicitudes de compra aún
están pendientes. En el taller seleccionado se pueden probar
la búsqueda y creación de clientes; no se
deben introducir datos reales mientras faltan controles de seguridad y revisión
legal. La ficha permite probar versiones verificadas de medidas de **Pantalón**,
camisas, chaquetas y vestidos. Las etiquetas de medidas utilizan **Contorno**
en lugar de **Ancho**, sin modificar ni convertir los valores guardados.
Abre **Prendas** desde el menú lateral en
escritorio o desde **Más** en móvil. En `/prendas` se puede crear y buscar un catálogo
por taller con precio base y plantillas de medidas; también se pueden editar
las entradas y se detectan cambios concurrentes.
El tratamiento de ITBIS es una clasificación elegida por el taller, no una
determinación fiscal. Las órdenes permiten seleccionar un cliente, una prenda
y sus versiones de medidas verificadas. El propietario puede configurar una tasa
de ITBIS para las nuevas órdenes gravadas; si falta, se advierte que el impuesto
y el total quedan sin calcular. Guardar la tasa no modifica órdenes anteriores.
Para completar las órdenes gravadas pendientes, el propietario debe confirmar
**Aplicar ITBIS a órdenes pendientes** en **Configuración fiscal**. El ajuste
actualiza los saldos y borradores vinculados sin cambiar facturas emitidas ni
órdenes que ya tengan el impuesto calculado.
Los propietarios y encargados pueden consultar el resumen y los movimientos
recientes en `/pagos` y exportar el resultado filtrado. La lista y la exportación
incluyen solo cobros y devoluciones vinculados a facturas (`FA-`); las tarjetas
de resumen conservan sus totales generales. **Registrar pago** admite órdenes
y facturas manuales emitidas, y solo ofrece documentos con saldo disponible
para abonar. Al liquidar un documento, se retira del selector; si una devolución
reabre su saldo, vuelve a estar disponible al actualizar. Puedes escribir `4998.00` o `4998,00`,
o pegar el importe mostrado como `RD$4,998.00`. El formulario muestra el saldo acumulado del cliente en
el taller, sumando sus órdenes y facturas manuales emitidas, sin duplicar las
facturas vinculadas. La tarjeta **Pendiente de cobrar** aplica la misma regla
a todos los clientes del taller. Ambos saldos incluyen los importes base de
las órdenes con ITBIS pendiente. El máximo de cada abono es el saldo de la orden
o factura seleccionada, no el saldo total del cliente. El documento debe tener
el total calculado. Inicio usa las métricas financieras y las citas del día
consultables para esos mismos roles. El recibo puede conservar la referencia de una transferencia.
El Resumen ejecutivo está disponible en `/reportes` para propietarios y encargados;
consulta agregados reales de órdenes, clientes, pagos y facturas administrativas
con filtros por fecha, cliente y estado. Los reportes no emplean datos ficticios.
El catálogo no registra existencias ni niveles mínimos, por lo que el indicador
de inventario se presenta explícitamente como no disponible.

### Impresión térmica: Epson TM-T88V (M244A)

- En el detalle de una factura, **Descargar PDF** conserva el formato A4.
  **Imprimir ticket** abre la vista previa térmica en otra pestaña. Para cobros
  y devoluciones, usa **Imprimir recibo** en el movimiento o en su historial.
- En el equipo POS instala el controlador Epson compatible y selecciona la
  TM-T88V y el papel de rollo de **80 mm** (no Carta ni A4). En el navegador
  selecciona **100 %**, sin márgenes, sin encabezados ni pies. El ticket utiliza
  hasta **72 mm** de ancho imprimible, centrado sobre el rollo.
- Activa en el controlador el avance y el corte **al final del documento**.
  La app no envía comandos ESC/POS ni elude el diálogo del navegador; la longitud
  de página y el corte dependen de la configuración del controlador.
- Antes de operar, imprime desde el equipo POS un ticket corto y uno largo.
  Confirma los bordes, la última línea, logo y sello, legibilidad del QR y que el
  corte no interrumpa el contenido. El QR apunta a la vista protegida del
  documento y exige una sesión autorizada; no contiene datos personales.

### Demostración aislada de Reportes

- **Demo local:** `npm run start:reports-demo` y abre `http://127.0.0.1:4200/reportes`.
  También puedes ejecutar `$env:useMockReports = 'true'; npm start` en PowerShell.
- **Modo real:** `$env:useMockReports = 'false'; npm start` (también es el
  valor predeterminado si no se define la variable).
- **Demo estática:** `npm run build:reports-demo`. Publica únicamente
  la carpeta de salida generada por el comando en un host de demostración separado, con
  redirección de `/reportes` a `index.html` para servir la SPA. No requiere
  backend, proxy ni credenciales. `npm run build` sigue siendo el build real.

El selector de escenarios y los datos ficticios solo se activan en la
compilación de demostración. Consulta el [informe técnico de QA](./docs/reports-demo-qa.md)
para los casos de prueba, los comandos y las verificaciones de producción.
El registro no procesa pagos en línea ni emite comprobantes fiscales. La facturación administrativa permite
crear, editar, emitir, anular y descargar facturas administrativas desde
`/facturacion`; no genera NCF/e-CF ni se conecta con la DGII. Las facturas manuales
se crean con ITBIS por defecto. El propietario puede activar **Permitir facturas
sin ITBIS** en **Configuración fiscal**; solo entonces se puede elegir **Factura
sin ITBIS** cuando no corresponda cobrarlo. Desactivar el permiso no cambia
facturas emitidas; los borradores manuales sin ITBIS requieren cambiar a la
modalidad con impuesto antes de emitir. Un documento gravado sin tasa
no se puede emitir. Las facturas desde órdenes conservan el tratamiento, la
tasa y los importes de la orden, incluso si es exenta.
Reportes desglosa las facturas emitidas según los filtros seleccionados.
Los estados de cobro se calculan con los abonos netos de devoluciones:
**Emitida** sin abonos netos, **Pago parcial** con saldo pendiente y **Pagada**
cuando el total queda cubierto. El filtro de Facturación usa estos mismos
estados y se combina con la búsqueda por cliente, número de factura (`FA-`) o
número de orden vinculada (`OT-`). Las órdenes sin factura no se listan. Borrador y Anulada
siguen siendo estados del documento, no del cobro.
Pagos y cobros conserva el desglose de facturación del mes en curso. También
desglosa por ITBIS los saldos pendientes (documentos con saldo positivo) y los
cobros netos de hoy (pagos menos devoluciones, con el conteo de movimientos),
según la fecha de República Dominicana. El ITBIS pendiente de cálculo se
muestra por separado.
En **Configuración fiscal** (también en **Más** en móvil), el propietario puede
actualizar los datos fiscales de la sastrería y guardar la tasa de ITBIS por separado.
El **nombre comercial** es el nombre de la sastrería en la aplicación, las
facturas nuevas y los tickets; al guardarlo se actualiza también en la sesión
actual. La razón social es independiente. Los documentos ya emitidos conservan
los nombres, datos e imágenes históricos.
Si una factura se emitió sin datos fiscales, su detalle indica los campos que
faltaban: reimprimirla no incorpora la configuración actual. Para verificar un
perfil recién guardado, crea y emite una factura nueva. PDF y vista previa del
ticket usan la paleta corporativa (#00A4B4, #005D74 y #61666A); la impresión
térmica se adapta a blanco y negro para conservar legibilidad en la Epson.
El logo y el sello se guardan en PostgreSQL; selecciona archivos PNG, JPG o JPEG
de hasta 60 KB cada uno y pulsa **Guardar perfil** para guardar textos e imágenes
juntos. Al recargar o volver a entrar, se recupera el perfil guardado.
Las facturas toman una copia de los datos e imágenes vigentes al emitirse,
aunque el borrador se haya creado antes. Las facturas ya emitidas no se modifican.
El PDF administrativo utiliza esa copia y no es un comprobante autorizado por DGII.
En una factura emitida, **Descargar PDF** guarda el documento y **Ver e imprimir PDF**
abre el mismo documento en el visor del navegador. Seleccionar una imagen muestra
su vista previa; no confirma el guardado hasta pulsar **Guardar perfil**.
Dejar
la tasa vacía no equivale a 0 % ni cambia las órdenes existentes. La ayuda describe
el estado actual; los términos y la política de privacidad son borradores que
requieren revisión jurídica antes de lanzar el servicio.

En Agenda, propietarios y encargados pueden crear, consultar, reprogramar y cancelar
citas del taller. Los horarios se muestran en la zona de República Dominicana y
solo se comprueban conflictos con citas de la sastrería. Desde la configuración de
Calendar pueden conectar una cuenta Google y elegir un calendario con permiso de escritura.
La sincronización de citas y el cambio
de calendario aún no están disponibles. Desconectar elimina las credenciales
locales, pero conserva los eventos de Google.

Consulta las instrucciones de configuración en el README del backend. Nunca
incluyas credenciales de Google ni contraseñas en archivos versionados.

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.2.19.

### Paginación de listas

Las listas paginadas comparten el [paginador](./src/app/shared/pagination.ts).
El pie adapta la cantidad de botones al ancho de la tabla o tarjeta sin ocultar
la página actual, el rango de registros ni el selector de filas.
Cambiar la cantidad de filas vuelve a la primera página y el selector refleja
el tamaño de la página cargada.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## End-to-end tests

The frontend does not currently have an end-to-end test runner configured. The `ng e2e` command is not available; `ng test --watch=false` runs the configured frontend unit tests.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
