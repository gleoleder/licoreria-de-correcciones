# POS Licorería v3

Punto de venta web para licorería. 100 % cliente, sin backend propio. La base de datos es un **Google Sheet**; se lee con API Key y se escribe con un **Google Apps Script**. Sin IndexedDB: la caché vive solo en memoria.

> Generado desde `REPLICAR.md` (incluido en esta carpeta). Ese documento explica el diseño en detalle.

## Archivos

| Archivo | Qué es |
|---------|--------|
| `index.html` | UI: header, vistas (Caja, Productos, Categorías, Inventario, Ventas, Estadísticas), modales, login |
| `style.css` | Tema oscuro + responsive + estilos de impresión (PDF) |
| `config.js` | **Editar aquí**: SHEETS_ID, API_KEY, APPS_SCRIPT_URL, cuentas/roles |
| `store.js` | Caché en memoria + dominio (IDs, FIFO, estadísticas) |
| `sheets.js` | Lectura (API) y escritura (Apps Script) de Google Sheets |
| `app.js` | Lógica de UI: nav+permisos, carrito, CRUD, ventas, estadísticas, login |
| `google-apps-script.js` | Va **pegado en el editor de Apps Script** (no se sirve al navegador) |
| `manifest.json` | PWA |

## Puesta en marcha (resumen)

1. **Crea un Google Sheet** con 5 hojas (fila 1 = cabecera):
   - `Categorias`: id · nombre · orden
   - `Productos`: id · categoria_id · nombre · tamaños · sabores · presentacion · precio · costo · stock_min · barcodes
   - `Lotes`: id · producto_id · tamaño · sabor · fecha_compra · costo_u · qty_inicial · qty_restante · vencimiento · notas
   - `Ventas`: id · fecha · hora · total · cogs · ganancia · metodo · items
   - `Movimientos`: fecha · producto_id · tamaño · sabor · tipo · qty · costo · usuario
2. **Comparte** el Sheet como *Cualquiera con el enlace → Lector*.
3. **Apps Script**: Extensiones → Apps Script → pega `google-apps-script.js` → Implementar como **Aplicación web** (Ejecutar como: Yo · Acceso: Cualquier usuario) → copia la URL `/exec`.
4. **Google Cloud**: crea proyecto → habilita *Google Sheets API* → crea una *API Key*.
5. **Edita `config.js`**: pega `SHEETS_ID`, `SHEETS_API_KEY`, `APPS_SCRIPT_URL`. Cambia las contraseñas en `CUENTAS`.
6. **Abre `index.html`** (doble clic, Live Server, o súbelo a GitHub Pages / Netlify).
7. Login → en Inventario pulsa **Actualizar** → registra lotes (Entrada de stock) → vende.

## Cuentas y roles

Definidas en `config.js`:

| Rol | Ve |
|-----|----|
| **admin** | Todo |
| **empleado** | Solo Caja y Productos |

> ⚠️ El login y los roles son control de **conveniencia (UX), no de seguridad**: todo corre en el navegador. No protege contra un usuario técnico. Ver §13 de `REPLICAR.md`.

## Notas

- **IDs autogenerados**: categoría/producto/lote en el cliente (`CAT-/PRD-/LOT-`); venta en el servidor (`VTA-`).
- **FIFO** por variante `producto + tamaño + sabor`; COGS en centavos enteros (truncado).
- **Estadísticas**: botones Día/Semana/Mes + rango Desde/Hasta; exporta a PDF con imprimir.
