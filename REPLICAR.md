# POS Licorería — Guía de replicación (modelo reestructurado)

Documento técnico para reconstruir desde cero este sistema de punto de venta (POS) para una licorería. Escrito en español.

> **Esta versión reestructura el modelo de datos desde 0.** No usa IndexedDB: la única fuente de verdad es **Google Sheets**, leída en cada arranque y cacheada solo en memoria (variables JS). Cambios respecto al original:
> - **Categorías editables** (su nombre es editable y se refleja en todo el sistema).
> - **Nombre de producto editable.**
> - Nuevo orden de campos del producto: **categoría → nombre → tamaño → sabor → unidad/caja**.
> - Producto con **sub-variantes**: cada producto base tiene listas de tamaños y sabores anidados.
> - Nueva pestaña de **Estadísticas por fecha**: día / semana / mes, con rango de fechas elegible.

---

## 1. ¿Qué es?

Un **POS web 100 % cliente** (sin backend propio) para una licorería en Bolivia (moneda **Bs**, fechas `dd/MM/yyyy`, locale `es-BO`).

- **Frontend:** HTML + CSS + JavaScript vanilla (sin frameworks, sin build, sin npm).
- **Base de datos en la nube:** un **Google Sheet** que actúa como BD compartida y **única fuente de verdad**.
- **Caché:** solo en memoria (objetos JS); se recarga desde Sheets al iniciar o al pulsar "Actualizar". **Sin IndexedDB.**
- **Lectura de Sheets:** API REST de Google Sheets v4 con **API Key** (solo lectura, sin OAuth).
- **Escritura en Sheets:** un **Google Apps Script** publicado como Web App, recibe `POST` (modo `no-cors`).
- **PWA:** instalable (manifest.json), funciona en móvil y escritorio.

Se sirve abriendo `index.html` (o desde cualquier hosting estático: GitHub Pages, Netlify, etc.).

### Funcionalidades clave
- Caja / venta con escaneo de código de barras (teclado o cámara) y búsqueda por nombre.
- Carrito con multiplicadores (unidad=1, caja=N…), precios especiales por ítem.
- Pago en **efectivo** (con cálculo de cambio) o **QR**.
- Inventario con **lotes FIFO** (cada compra = un lote con su costo; al vender se descuenta el más antiguo).
- Cálculo de **COGS** y **ganancia bruta / margen** real por venta y por producto.
- Vista de ventas del día, edición y borrado de ventas.
- **Pestaña de Estadísticas** por día / semana / mes + rango de fechas elegible.
- Alertas de **stock bajo** y **vencimiento** de lotes (≤ 7 días).
- **Categorías editables** y **productos editables** (nombre, tamaño, sabor, unidad).
- **Dos roles de login:** *empleado* (solo Caja + Productos) y *admin* (todo).

---

## 2. Estructura de archivos

```
licoreria/
├── index.html              # UI: header, vistas (caja, productos, inventario, ventas, estadisticas), modales, login
├── style.css               # Tema oscuro. Variables CSS + responsive móvil
├── config.js               # CONFIGURACIÓN: SHEETS_ID, API_KEY, APPS_SCRIPT_URL (editar aquí)
├── store.js                # Caché EN MEMORIA + helpers de dominio (FIFO, stats). Reemplaza al antiguo db.js
├── sheets.js               # Sincronización con Google Sheets (lectura API + escritura Apps Script)
├── app.js                  # Lógica principal de UI: nav, carrito, productos, inventario, ventas, estadísticas
├── google-apps-script.js   # Código PEGADO en el editor de Apps Script (NO se sirve al navegador)
└── manifest.json           # PWA: nombre, iconos, colores
```

Orden de carga de scripts en `index.html`:
```html
<script src="config.js"></script>
<script src="store.js"></script>
<script src="sheets.js"></script>
<script src="app.js"></script>
```

> **`store.js` no es una base de datos.** Es un objeto global `Store` con arrays en memoria (`Store.categorias`, `Store.productos`, `Store.lotes`, `Store.ventas`) que se rellenan desde Sheets al arrancar. Toda escritura va directo a Sheets vía Apps Script y se refleja optimistamente en estos arrays. Al recargar la página se vuelven a leer de Sheets.

---

## 3. Arquitectura de datos (flujo)

```
   ┌─────────────┐   GET (API Key, lectura)    ┌──────────────────┐
   │  Navegador  │ ──────────────────────────► │  Google Sheets   │
   │  (app.js)   │                             │  (la BD única)   │
   │  Store =    │ ◄────── valores ─────────── │  hojas:          │
   │  caché en   │                             │  Categorias      │
   │  memoria    │                             │  Productos       │
   └─────┬───────┘                             │  Lotes           │
         │                                     │  Ventas          │
         │ POST no-cors (escritura)            │  Movimientos     │
         │ ┌─────────────────────┐             │                  │
         └►│  Apps Script Web App│ ──escribe──►│                  │
           │  (doPost)           │             └──────────────────┘
           └─────────────────────┘
```

**Regla de oro de escritura** (la respeta el Apps Script):
- `Categorias` → **upsert por ID** (edita nombre/orden sin romper referencias).
- `Productos` → **upsert por ID** (el nombre es editable, por eso NO se usa el nombre como clave).
- `Lotes` → **append** al crear; **update solo `qty_remaining`** al vender (busca por ID de lote).
- `Ventas` → **append** al vender; `editVenta` corrige una fila por ID; `deleteVenta` borra por ID.
- `Movimientos` → **solo append**, nunca se modifica (log de auditoría).

> **Cambio clave vs. el sistema anterior:** antes el catálogo se identificaba **por nombre**. Como ahora el nombre y la categoría son editables, **todo se identifica por ID estable** (un UID generado al crear). Así puedes renombrar un producto o una categoría sin perder su historial de ventas, lotes ni movimientos.

Como la escritura es `no-cors`, el navegador **no puede leer la respuesta** del Apps Script, pero el dato **sí se guarda**. El cliente actualiza su caché en memoria optimistamente.

---

## 3-bis. Generación automática de IDs (regla global)

**Ningún ID se escribe a mano nunca.** Todos los identificadores únicos se generan automáticamente. La única decisión es **dónde** nace cada uno, y depende de quién necesita el ID primero:

| Entidad | Lo genera | Cuándo | Por qué |
|---------|-----------|--------|---------|
| Categoría (`CAT-…`) | **Cliente** (`store.js`) | al crear, antes de enviar | la UI debe referenciarla de inmediato (asignar productos a la categoría recién creada) |
| Producto (`PRD-…`) | **Cliente** | al crear, antes de enviar | el carrito y los lotes la referencian al instante, sin esperar respuesta |
| Lote (`LOT-…`) | **Cliente** | al registrar entrada de stock | el FIFO y el update de `qty_restante` necesitan el ID ya |
| Venta (`VTA-…`) | **Apps Script** (servidor) | al cobrar | depende del momento real del cobro; debe ser único entre cajas concurrentes |

> **Por qué la venta es la excepción:** con `no-cors` el cliente no recibe la respuesta del Apps Script. Para categorías/productos/lotes eso no importa porque el cliente ya generó el ID y lo conoce. Pero el ID de venta debe garantizar unicidad global en el momento exacto del cobro (dos cajas vendiendo a la vez), y ese instante real solo lo conoce el servidor. Por eso la venta es el único ID que nace en el Apps Script.

### Generador en el cliente (`store.js`)
Función única, prefijo por tipo. Combina tiempo + aleatorio en base36 para que sea corto, legible y prácticamente sin colisión:

```js
function genId(prefijo) {                      // prefijo: 'CAT' | 'PRD' | 'LOT'
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.floor(Math.random() * 1e6).toString(36).toUpperCase();
  return `${prefijo}-${t}-${r}`;               // ej: PRD-LXYZ12-9F3K
}
// Atajos:
const nuevaCategoriaId = () => genId('CAT');
const nuevoProductoId  = () => genId('PRD');
const nuevoLoteId      = () => genId('LOT');
```

Reglas de uso:
- Al crear una entidad, si **no trae `id`**, el cliente le asigna `genId(...)` **antes** de mandarla a Sheets.
- El Apps Script hace **upsert por `id`**: si llega un `id` que ya existe → actualiza esa fila; si es nuevo → append. Así nunca se duplica aunque se reenvíe.
- **Editar** un nombre/categoría **no cambia el `id`** — solo sobreescribe los otros campos de la fila.

### Generador en el servidor (`google-apps-script.js`)
Solo para la venta:

```js
var now = new Date();
var id  = 'VTA-' + now.getTime().toString(36).toUpperCase()
        + '-' + Math.floor(Math.random() * 1000).toString(36).toUpperCase();
```

---

## 4. La base de datos: Google Sheets (modelo reestructurado)

Crear un Google Sheet con **estas 5 hojas** (los nombres importan). Fila 1 = cabecera.

### Hoja `Categorias` — editable
El nombre de la categoría es libremente editable; nunca se usa como identificador.

| Col | A | B | C |
|-----|---|---|---|
| Campo | **id** | **nombre** | **orden** |
| Ejemplo | `CAT-A1B2` | `Cervezas` | `1` |

- `id` — UID **autogenerado** (`CAT-…`) al crear la categoría. No se escribe a mano. Es la clave por la que todo lo demás la referencia (ver §3-bis).
- `nombre` — texto visible, **editable** (se puede renombrar sin romper nada).
- `orden` — entero para ordenar las categorías en la UI.

### Hoja `Productos` — editable, con variantes (tamaño+sabor con código propio)
Un producto base con una **tabla de variantes** anidada. **Cada combinación tamaño+sabor tiene su propio código de barras** (y opcionalmente su propio precio/costo).

| Col | A | B | C | D | E | F | G | H |
|-----|---|---|---|---|---|---|---|---|
| Campo | **id** | **categoria_id** | **nombre** | **presentacion** | **precio** Bs | **costo** Bs | **stock_min** | **variantes** (JSON) |
| Ejemplo | `PRD-9F3K` | `CAT-A1B2` | `Coca-Cola` | `unidad` | `12` | `8` | `6` | `[{…},{…}]` |

- `id` — UID **autogenerado** (`PRD-…`) del producto. **Nunca cambia**, aunque renombres el producto (ver §3-bis).
- `categoria_id` — referencia a `Categorias.id` (no al nombre).
- `nombre` — **editable**.
- `presentacion` — **unidad** o **caja** (la forma en que se cuenta).
- `precio`, `costo` — **valores base/por defecto**: una variante que no defina su propio precio/costo usa estos.
- `stock_min` — número.
- `variantes` — JSON array. Cada elemento:
  `{"tamaño":"2L","sabor":"Cola","code":"7790010","multiplier":1,"precio":12,"costo":8}`
  - `code` — **código de barras propio de esa variante** (clave: al escanear, resuelve la variante exacta).
  - `multiplier` — unidades por escaneo (1 = individual, 12 = caja…).
  - `precio`/`costo` — opcionales; si van vacíos, se usan los del producto base.

> **Sobre las variantes:** cada tamaño+sabor es una variante con su **propio código**. Al **escanear** el código se añade la variante exacta al carrito sin elegir nada. Al **buscar por nombre**, se elige tamaño → sabor en un modal. El **stock y los lotes FIFO se llevan por combinación** `producto_id + tamaño + sabor` (ver hoja `Lotes`), cada una con su inventario, precio y costo.

### Hoja `Lotes` — FIFO por variante
Cada compra genera una fila. El stock de una variante = suma de `qty_remaining` de sus lotes activos.

| Col | A | B | C | D | E | F | G | H | I | J |
|-----|---|---|---|---|---|---|---|---|---|---|
| Campo | **id** (lot_uid) | **producto_id** | **tamaño** | **sabor** | **fecha_compra** | **costo_u** | **qty_inicial** | **qty_restante** | **vencimiento** | **notas** |

- `producto_id` + `tamaño` + `sabor` identifican la variante exacta.
- `id` (lot_uid) — UID **autogenerado** (`LOT-…`), clave para actualizar `qty_restante` al vender.
- Fechas en `dd/MM/yyyy`.

### Hoja `Ventas` — append
| Col | A | B | C | D | E | F | G | H | I | J |
|-----|---|---|---|---|---|---|---|---|---|---|
| Campo | **id** | **fecha** | **hora** | **total** Bs | **cogs** Bs | **ganancia** Bs | **metodo** | **items** (JSON) | **monto_efectivo** Bs | **monto_qr** Bs |

- `items` — JSON con cada línea: `{producto_id, nombre, tamaño, sabor, qty, units, precio, line_total, item_cogs}`.
- `id` lo **autogenera el Apps Script** (servidor): `VTA-<timestamp base36>-<random base36>` (ver §3-bis).
- `metodo` — `efectivo` · `qr` · `mixto`.
- `monto_efectivo` / `monto_qr` — **desglose del cobro**. En pago simple uno es el total y el otro 0; en **mixto** suman el total. Estadísticas suma estas columnas para mostrar cuánto entró en efectivo y cuánto en QR (un cobro mixto aporta a ambos). Ventas viejas sin estas columnas se infieren desde `metodo`.

### Hoja `Movimientos` — log (solo append)
| Col | A | B | C | D | E | F | G | H |
|-----|---|---|---|---|---|---|---|---|
| Campo | **fecha** | **producto_id** | **tamaño** | **sabor** | **tipo** | **qty** | **costo** | **usuario** |

Tipos: `entrada`, `ajuste_pos`, `ajuste_neg`, `venta`.

---

## 5. Configuración (`config.js`)

Tres valores. **Editar aquí es lo único obligatorio para que arranque.**

```js
var SHEETS_ID       = '...';   // ID del Sheet: .../spreadsheets/d/[ESTO]/edit
var SHEETS_API_KEY  = '...';   // API Key de Google Cloud (Sheets API habilitada, solo lectura)
var APPS_SCRIPT_URL = '...';   // URL del Apps Script desplegado como Web App (/exec)
```

### Cómo obtener cada valor

**SHEETS_ID** → de la URL del Google Sheet.

**SHEETS_API_KEY:**
1. [Google Cloud Console](https://console.cloud.google.com) → crear proyecto.
2. APIs y servicios → **Habilitar "Google Sheets API"**.
3. Credenciales → Crear → **Clave de API** (restringir a Sheets API recomendado).
4. Compartir el Sheet como **Cualquiera con el enlace → Lector** (la API Key solo lee hojas públicas).

**APPS_SCRIPT_URL:**
1. En el Sheet → Extensiones → **Apps Script**.
2. Pegar el contenido completo de `google-apps-script.js`.
3. **Implementar → Nueva implementación → Aplicación web** (Ejecutar como: Yo · Acceso: Cualquier usuario).
4. Copiar la URL `.../exec` → pegar en `APPS_SCRIPT_URL`.

> ⚠️ Tras cada cambio del Apps Script: **Implementar → Administrar implementaciones → Editar → Nueva versión → Implementar.**

---

## 6. Caché en memoria (`store.js`) — reemplaza a IndexedDB

`store.js` NO es una base de datos. Es un objeto global `Store` con arrays en memoria + métodos de dominio. Se llena desde Sheets al arrancar.

```js
const Store = {
  categorias: [],   // [{id, nombre, orden}]
  productos:  [],   // [{id, categoria_id, nombre, presentacion, precio, costo, stock_min, variantes[]}]
                    //   variantes: [{tamaño, sabor, code, multiplier, precio, costo}] — precio/costo opcionales (fallback al base)
  lotes:      [],   // [{id, producto_id, tamaño, sabor, fecha_compra, costo_u, qty_inicial, qty_restante, vencimiento, notas}]
  ventas:     [],   // cargadas por rango cuando se necesitan (ventas/estadísticas)
  // ...helpers abajo
};
```

### Helpers de dominio (replicar)

- `categoriaNombre(id)` → resuelve nombre por id (para mostrar).
- `productosDeCategoria(catId)`.
- `variantStock(prodId, tamaño, sabor)` → suma `qty_restante` de lotes activos de esa variante.
- **`consumeFIFO(prodId, tamaño, sabor, units)`** — descuenta del lote más antiguo primero, devuelve COGS. **Reglas a no perder:**
  - Operar en **centavos enteros** (`Math.floor(costo*100)`) para evitar error de punto flotante.
  - **Truncar** (no redondear) el costo por fracción, para no inflar el COGS.
  - Ordenar lotes por `fecha_compra` ascendente; restar de cada `qty_restante` hasta cubrir `units`.
  - Fallback al `costo` del producto si faltan lotes.
- **`recalcStock(prodId, tamaño, sabor)`** — stock derivado = suma de lotes activos (fuente única de verdad).
- **`calcStats(ventas)`** — deriva ingresos/COGS/ganancia/margen desde los **items** de cada venta (no desde el total). Agrupa top productos **por `producto_id`** (estable aunque se renombre).

> No hay `open()`, `transaction`, ni stores. Donde el sistema viejo leía/escribía IndexedDB, este lee de los arrays de `Store` y escribe a Sheets vía `sheets.js`.

---

## 7. Sincronización con Sheets (`sheets.js`)

Objeto global `Sheets`.

- **Lectura** `readSheet(nombre)`: `GET https://sheets.googleapis.com/v4/spreadsheets/{id}/values/{hoja}?key={apiKey}`. Timeout 15 s con `AbortController`. 403 → avisar de habilitar la Sheets API.
- **Escritura** `_post(payload)`: `fetch` `POST` `mode:'no-cors'` al `APPS_SCRIPT_URL`. No lee respuesta.
- Métodos de escritura (cada uno arma `{accion:'...', ...}`):
  - Categorías: `saveCategoria` (upsert por id), `deleteCategoria`.
  - Productos: `saveProducto` (upsert por id — incluye tamaños/sabores como JSON), `deleteProducto`.
  - Lotes: `addLote`, `updateLote` (solo qty_restante), `editLote`, `deleteLote`.
  - Ventas: `addVenta`, `editVenta`, `deleteVenta`.
  - Movimientos: `addMovimiento`.
- **`loadAll(onProgress)`** — carga inicial:
  1. Lee `Categorias` → `Store.categorias` (ordenadas por `orden`).
  2. Lee `Productos` → `Store.productos` (parsea `tamaños`, `sabores`, `barcodes` desde JSON).
  3. Lee `Lotes` → `Store.lotes` (dedupe por `id`).
  4. Calcula stock por variante con `recalcStock`.
- **`loadVentasRango(desde, hasta)`** — lee `Ventas` y filtra por rango (para vista Ventas y Estadísticas).
- Parseo de fechas: acepta `dd/MM/yyyy` e ISO, devuelve ISO.

---

## 8. Lógica principal (`app.js`)

### Vistas (pestañas) — y a qué rol pertenecen
La columna **Rol** indica quién ve la pestaña (ver §8-bis Roles):

| # | Pestaña | Empleado | Admin | Contenido |
|---|---------|:---:|:---:|-----------|
| 1 | **Caja** | ✅ | ✅ | escaneo/búsqueda, selección de tamaño y sabor al añadir, carrito, pago efectivo/QR, ticket |
| 2 | **Productos** | ✅ | ✅ | CRUD de productos. Modal con el orden: **categoría → nombre → tamaño(s) → sabor(es) → unidad/caja**, precio, costo, stock mín., códigos. Nombre y categoría editables |
| 3 | **Categorías** | ❌ | ✅ | CRUD de categorías: agregar, renombrar, reordenar, borrar |
| 4 | **Inventario** | ❌ | ✅ | tabla por variante (producto · tamaño · sabor · stock · vencimiento), entrada de stock que crea lotes FIFO |
| 5 | **Ventas** | ❌ | ✅ | ventas del día, editar/borrar, resumen efectivo/QR |
| 6 | **Estadísticas** | ❌ | ✅ | ver §9 |

> El **empleado** ve **solo Caja y Productos**. El **admin** ve **todo**.

### Caja / venta (`processSale`) — reglas a preservar
- Validar stock por variante con `variantStock`.
- Por cada ítem: `consumeFIFO(prodId, tamaño, sabor, units)` → COGS; registrar movimiento; armar línea.
- Crear venta, enviarla a Sheets (`addVenta`) con timeout de seguridad; actualizar `qty_restante` de cada lote en Sheets.
- ID de venta lo genera el Apps Script con el momento real del cobro.

### Helpers de dinero (replicar igual)
`toCents`, `fromCents`, `bankersRound` (mostrar), `truncate2`, `calcCostoUnitario(total, cantidad)` con 6 decimales, `fmt(n)` → `"Bs 12.50"`.

### Login
Ver **§8-bis** para el sistema de dos roles (empleado / admin).

---

## 8-bis. Inicio de sesión y roles (empleado / admin)

Dos cuentas con **permisos distintos**:

| Rol | Usuario (ej.) | Ve | No ve |
|-----|---------------|----|-------|
| **Empleado** | `cajero` | **Caja, Productos** | Categorías, Inventario, Ventas, Estadísticas |
| **Admin** | `admin` | **Todo** | — |

### Credenciales (`config.js` o `app.js`)
Cada cuenta define usuario, contraseña y rol:

```js
const CUENTAS = [
  { user: 'admin',  pass: 'CAMBIAR_ADMIN', rol: 'admin',    nombre: 'Administrador' },
  { user: 'cajero', pass: 'CAMBIAR_CAJA',  rol: 'empleado', nombre: 'Cajero' }
];

// Qué pestañas puede ver cada rol:
const PERMISOS = {
  admin:    ['pos', 'productos', 'categorias', 'inventario', 'ventas', 'estadisticas'],
  empleado: ['pos', 'productos']
};
```

### Flujo de login
1. Pantalla de login pide usuario + contraseña.
2. Se busca en `CUENTAS` una coincidencia exacta (`user` y `pass`).
3. Si coincide, se guarda la sesión en `localStorage`:
   ```js
   localStorage.setItem('pos_user',  cuenta.user);
   localStorage.setItem('pos_rol',   cuenta.rol);
   localStorage.setItem('pos_nombre',cuenta.nombre);
   ```
4. Si no coincide → mensaje de error, no entra.

### Aplicar permisos en la UI
Al iniciar (`init()`), tras leer el rol de `localStorage`, **ocultar las pestañas no permitidas** y **bloquear el acceso directo** a una vista prohibida:

```js
function aplicarPermisos() {
  const rol = localStorage.getItem('pos_rol') || 'empleado';
  const permitidas = PERMISOS[rol] || PERMISOS.empleado;

  // Ocultar botones de navegación (header y bottom-nav) que no estén permitidos
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.style.display = permitidas.includes(btn.dataset.view) ? '' : 'none';
  });

  // Si la vista activa/guardada no está permitida, forzar 'pos' (Caja)
  if (!permitidas.includes(vistaActual())) irAVista('pos');

  return permitidas;
}

// Guardia para cualquier cambio de pestaña:
function irAVista(view) {
  const permitidas = PERMISOS[localStorage.getItem('pos_rol') || 'empleado'];
  if (!permitidas.includes(view)) return;   // bloquea acceso directo
  // ...activar la vista
}
```

El chip de usuario en el header muestra `nombre` y un indicador del rol; botón de **Cerrar sesión** borra las claves de `localStorage` y vuelve al login.

> ⚠️ **Esto es control de conveniencia (UX), no de seguridad.** Al ser 100 % cliente, cualquiera que abra las herramientas de desarrollo ve `CUENTAS` y puede mostrar las pestañas ocultas o llamar a las funciones de escritura directamente. Sirve para que un cajero no toque por error lo que no debe — **no impide a un usuario malicioso**. Para seguridad real se necesita un backend que valide el rol en cada operación. Ver §13.

---

## 9. Pestaña de Estadísticas (nueva)

Vista `view-estadisticas`. Permite ver el desempeño **por día, semana o mes**, y elegir un **rango de fechas** arbitrario.

### UI
```
[ Día ] [ Semana ] [ Mes ]        Desde [📅]  Hasta [📅]   [Aplicar]   [PDF]
─────────────────────────────────────────────────────────────────────────
KPIs:  Ingresos Bs · COGS Bs · Ganancia Bs · Margen %  · Nº ventas · Unidades
─────────────────────────────────────────────────────────────────────────
Gráfico / tabla por período (cada día, cada semana o cada mes del rango)
Top productos por ganancia (con tamaño y sabor)
```

### Comportamiento
- **Botones Día / Semana / Mes** = preajuste rápido del rango:
  - **Día:** hoy (Desde=Hasta=hoy). La tabla muestra el detalle del día.
  - **Semana:** lunes→domingo de la semana actual; la tabla agrupa por día.
  - **Mes:** día 1→fin del mes actual; la tabla agrupa por día (o por semana).
- **Desde / Hasta** = rango personalizado elegible; al pulsar **Aplicar** se recalcula.
- La **granularidad de agrupación** sigue al botón activo:
  - Día → filas por día.
  - Semana → filas por semana (clave ISO `yyyy-Www`).
  - Mes → filas por mes (`yyyy-MM`).

### Cálculo
1. `Sheets.loadVentasRango(desde, hasta)` → lista de ventas.
2. `Store.calcStats(ventas)` → KPIs globales del rango (desde los `items`).
3. Agrupar las ventas por período según la granularidad y, en cada bucket, sumar ingresos/COGS/ganancia/unidades.
4. Top productos: agrupar por `producto_id + tamaño + sabor`, ordenar por ganancia.

Helpers de fecha sugeridos:
```js
function startOfWeek(d){ const x=new Date(d); const day=(x.getDay()+6)%7; x.setDate(x.getDate()-day); return x; } // lunes
function isoWeekKey(d){ /* yyyy-Www */ }
function monthKey(d){ return d.toISOString().slice(0,7); } // yyyy-MM
function bucketKey(date, granularidad){ /* 'dia'|'semana'|'mes' → clave de agrupación */ }
```

Export PDF reutiliza `window.print()` con una hoja de estilos `@media print`.

---

## 10. Google Apps Script (`google-apps-script.js`)

Va pegado en el editor de Apps Script del Sheet.

- **`doPost(e)`** — único endpoint. Parsea `e.postData.contents`, valida que existan las 5 hojas, despacha por `data.accion`.
- Acciones: `saveCategoria`, `deleteCategoria`, `saveProducto`, `deleteProducto`, `addLote`, `updateLote`, `editLote`, `deleteLote`, `addVenta`, `editVenta`, `deleteVenta`, `addMovimiento`.
- **Upsert por ID:** `saveCategoria` y `saveProducto` buscan la fila por la columna `id` (col A). Si existe → sobreescriben; si no → append. **Nunca** usan el nombre como clave (porque es editable).
- **`saveProducto`** serializa `tamaños`, `sabores` y `barcodes` como JSON en sus columnas.
- **`addVenta`** genera ID `VTA-<base36>-<rnd>` con el momento real del cobro.
- **`findRowById(sheet, id)`** — busca nº de fila por col A (ID), ignorando cabecera.
- **`ok` / `respError`** — respuestas JSON (no leídas por el cliente vía `no-cors`; útiles para pruebas desde el editor).

---

## 11. Pasos para replicar desde cero

1. Crear el Google Sheet con las 5 hojas y cabeceras de §4.
2. Compartir el Sheet como "Cualquiera con el enlace → Lector".
3. Apps Script: pegar `google-apps-script.js` → desplegar como Web App → copiar URL `/exec`.
4. Google Cloud: proyecto → habilitar Sheets API → crear API Key.
5. Crear los archivos del frontend (`index.html`, `style.css`, `config.js`, `store.js`, `sheets.js`, `app.js`, `manifest.json`).
6. Editar `config.js` con los 3 valores.
7. Configurar las cuentas en `CUENTAS` (admin y empleado) y sus contraseñas (§8-bis).
8. Cargar categorías iniciales en la hoja `Categorias` y algunos productos en `Productos`.
9. Abrir `index.html` (o subir a GitHub Pages / Netlify).
10. Login → "Actualizar" para sincronizar → registrar lotes (entrada de stock) → vender → ver Estadísticas.

---

## 12. Decisiones de diseño a no perder

- **Todos los IDs se autogeneran** (ver §3-bis), nunca se escriben a mano: categoría/producto/lote en el cliente, venta en el servidor.
- **Todo se referencia por ID estable** (categoría, producto), no por nombre → nombre y categoría son editables sin romper historial.
- **Sin IndexedDB:** Sheets es la única fuente de verdad; el cliente solo cachea en memoria y recarga al arrancar.
- **Centavos enteros + truncado** en FIFO/COGS (no floats, no redondear al deducir).
- **Stock y lotes por variante** `producto_id + tamaño + sabor`.
- **Agrupar estadísticas/top por ID**, no por nombre.
- **Upsert por ID** en Categorías/Productos; **append puro** en Ventas/Movimientos (auditoría intacta).
- **ID de venta generado en el servidor** con el momento real del cobro.
- **Escritura `no-cors` + caché optimista en memoria.**

---

## 13. Limitaciones / seguridad

- **API Key y credenciales viven en `config.js` (cliente)** → cualquiera que abra el sitio las ve; el Sheet es de lectura pública y el Apps Script acepta escrituras anónimas. Diseño de conveniencia para un negocio pequeño, **no de seguridad**. Para producción real: backend con auth y no exponer claves.
- **Login y roles son control de UX, no de seguridad** (§8-bis): las cuentas (`CUENTAS`) están en el cliente; ocultar pestañas del empleado no impide a un usuario técnico mostrarlas ni invocar escrituras. Para hacer cumplir el rol de verdad hace falta un backend que valide cada operación.
- Sin control de concurrencia entre varias cajas a la vez (la caché en memoria puede desincronizarse; "Actualizar" resincroniza).
- `no-cors` impide detectar errores de escritura en el cliente.
