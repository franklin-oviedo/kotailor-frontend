# Reportes: informe técnico de Demo y QA

## Separación de ambientes

La [entrada de demostración](../src/main.reports-demo.ts) inicia únicamente
`/reportes`, reutiliza el componente real y no registra `HttpClient`, sesión ni
proxy. El selector cambia entre [conjuntos reproducibles](../src/app/reports/reports.mock.ts)
con fechas fijas de 2026. La búsqueda, la agregación y la actualización de
indicadores se ejecutan localmente, sin API ni PostgreSQL. No hay un modo
degradado que sustituya los datos reales por simulados cuando falla la API.

La entrada normal conserva los permisos, la búsqueda y el endpoint real.
Ni el conjunto de datos ni el punto de entrada alternativo se incluyen en el
build normal. No se modificaron el backend, los esquemas ni los datos existentes.

## Evidencia

| Caso | Verificación |
|---|---|
| A · Completo | Seis gráficos renderizados; escalas entre 0 % y 100 %, máximo al 100 %; DOP y porcentaje de facturas pagadas. |
| B · Mínimo | Un cliente y una orden; cobros en cero; saldo de factura nulo y porcentaje sin denominador representados con `—`. |
| C · Vacío | Cero clientes, estados vacíos y ningún gráfico con barras ficticias. |
| D · Volumen alto | 600 clientes y 12 000 órdenes; conciliación de estados y operaciones diarias; renderizado agregado sin desbordamiento en los cinco anchos. |
| E · Cliente y estado | Búsqueda sin tildes, selección de cliente y filtro de estado por teclado; verificación de `aria-pressed` y persistencia del foco. |
| F · Fechas | Filtro de febrero y un día de devolución que produce saldo neto negativo y barra diferenciada. |

- **Regresión:** 84 pruebas frontend aprobadas en 17 archivos. De ellas,
  ocho verifican la interfaz de Reportes y el cálculo de las simulaciones.
  La regresión del modo real utiliza el contrato HTTP, no una base real.
- **Navegador:** Playwright en Microsoft Edge (Chromium). Demo probada a
  320, 375, 768, 1024 y 1440 px, sin desbordamiento horizontal en los estados
  completo y de volumen alto, sin errores de consola ni peticiones API o
  externas. Se verificaron Tab, Enter y foco visible del control de estado.
- **Accesibilidad automatizada:** axe-core, reglas WCAG 2.0 y 2.1 A/AA y de
  buenas prácticas: cero infracciones y cero reglas incompletas en las cinco
  resoluciones con datos completos y en el estado vacío. Esto no reemplaza
  una prueba con lector de pantalla.
- **Problemas corregidos:** competencia entre búsquedas pendientes y selección
  desde el ranking, desbordamiento posible por columnas rígidas, conflicto de
  CSS entre la barra de estado y el texto de carga, y escala que daba una
  longitud mínima artificial a valores pequeños.

## Reproducir

```powershell
npm test -- --watch=false
$env:REPORTS_BROWSER_CHANNEL = 'msedge'
npm run test:reports-browser
npm run build
```

Sin Edge instalado, ejecuta `npx playwright install chromium` y omite
`REPORTS_BROWSER_CHANNEL`. La prueba de navegador levanta y cierra su
servidor estático local; no necesita una sesión ni servicios externos.

## Criterios de liberación

- **Demo:** lista; debe publicarse con el artefacto específico de demo, nunca
  con el mismo origen ni directorio de despliegue que la aplicación real.
- **QA:** listo para validar los seis escenarios de forma determinista.
  El volumen probado mide el cliente y sus agregados locales, no PostgreSQL.
- **Producción:** el build normal compila y preserva el flujo real, pero esta
  validación no certifica el despliegue. El CSS de Reportes supera el
  presupuesto de advertencia de 4 kB, sin impedir la compilación. Antes de liberar:
  1. Verificar el flujo autenticado de Reportes en un entorno con PostgreSQL
     aislado, incluidos roles, filtros y latencia con datos representativos.
  2. Validar manualmente con NVDA o VoiceOver el foco, los nombres de controles
     y la lectura de valores cuando cambian los filtros. Verificar también el
     módulo en el shell real, no solo en el contenedor de demostración.
  3. Confirmar que el despliegue real publica el build normal y que una URL
     o parámetro de consulta no activa la demostración.

Inventario crítico continúa sin una fuente real en el sistema. La demo conserva
ese estado como «No disponible», en vez de implicar que existen registros de stock.
