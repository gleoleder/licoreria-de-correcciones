# Tablas para copiar y pegar en Google Sheets

Crea **5 hojas** en tu Google Sheet con estos nombres EXACTOS (respeta mayúsculas/acentos):

`Categorias` · `Productos` · `Lotes` · `Ventas` · `Movimientos`

## Cómo pegar
1. En cada hoja, haz clic en la celda **A1**.
2. Copia el bloque de la sección correspondiente (incluida la fila de cabecera).
3. Pega con **Ctrl+V**. Google Sheets reparte cada columna automáticamente (los valores van separados por TAB).
4. Si al pegar te queda todo en una sola columna: usa **Datos → Dividir texto en columnas → Separador: Tabulación**.

> Las filas de ejemplo son opcionales — puedes borrarlas. Pero si las dejas, ya están enlazadas entre sí (los `categoria_id` y `producto_id` coinciden).

---

## 1. Hoja `Categorias`
Columnas: **id · nombre · orden**

```
id	nombre	orden
CAT-EJ001	Cervezas	1
CAT-EJ002	Gaseosas	2
CAT-EJ003	Licores	3
```

---

## 2. Hoja `Productos`
Columnas: **id · categoria_id · nombre · presentacion · precio · costo · stock_min · variantes**

> `variantes` es texto JSON. **Cada combinación tamaño+sabor tiene su propio código de barras** (y opcionalmente su precio/costo; si van vacíos usan el precio/costo base del producto). `multiplier` = unidades por escaneo (1 = individual, 12 = caja, etc.).
>
> Formato de cada variante: `{"tamaño":"2L","sabor":"Cola","code":"7790010","multiplier":1,"precio":12,"costo":8}`

```
id	categoria_id	nombre	presentacion	precio	costo	stock_min	variantes
PRD-EJ001	CAT-EJ001	Paceña	unidad	12	8	12	[{"tamaño":"620ml","sabor":"","code":"7790001","multiplier":1,"precio":12,"costo":8},{"tamaño":"330ml","sabor":"","code":"7790002","multiplier":1,"precio":7,"costo":5}]
PRD-EJ002	CAT-EJ002	Coca-Cola	unidad	12	8	6	[{"tamaño":"2L","sabor":"Cola","code":"7790010","multiplier":1,"precio":12,"costo":8},{"tamaño":"2L","sabor":"Zero","code":"7790011","multiplier":1,"precio":12,"costo":8},{"tamaño":"600ml","sabor":"Cola","code":"7790012","multiplier":1,"precio":6,"costo":4}]
PRD-EJ003	CAT-EJ003	Singani Casa Real	unidad	55	38	4	[{"tamaño":"750ml","sabor":"","code":"7790020","multiplier":1,"precio":55,"costo":38}]
```

---

## 3. Hoja `Lotes`
Columnas: **id · producto_id · tamaño · sabor · fecha_compra · costo_u · qty_inicial · qty_restante · vencimiento · notas**

> Fechas en formato **dd/MM/yyyy**. `vencimiento` puede ir vacío.

```
id	producto_id	tamaño	sabor	fecha_compra	costo_u	qty_inicial	qty_restante	vencimiento	notas
LOT-EJ001	PRD-EJ001	620ml		01/06/2026	8	24	24		Compra inicial
LOT-EJ002	PRD-EJ002	2L	Cola	01/06/2026	8	12	12		
LOT-EJ003	PRD-EJ002	600ml	Cola	01/06/2026	4	24	24		
```

> El `tamaño`/`sabor` del lote debe coincidir con una variante declarada en `Productos` (mismo texto). El stock de esa variante = suma de `qty_restante` de sus lotes.

---

## 4. Hoja `Ventas`
Columnas (10): **id · fecha · hora · total · cogs · ganancia · metodo · items · monto_efectivo · monto_qr**

> Esta hoja la llena la app sola al cobrar. **Solo necesitas pegar la fila de cabecera** (la primera). El `id` lo genera el sistema.

```
id	fecha	hora	total	cogs	ganancia	metodo	items	monto_efectivo	monto_qr
```

---

## 5. Hoja `Movimientos`
Columnas: **fecha · producto_id · tamaño · sabor · tipo · qty · costo · usuario**

> También la llena la app (entradas de stock y ventas). **Solo pega la fila de cabecera.**

```
fecha	producto_id	tamaño	sabor	tipo	qty	costo	usuario
```

---

## Después de crear las hojas
1. **Compartir** el Sheet → *Cualquiera con el enlace* → **Lector**.
2. Verifica que el **Apps Script** esté desplegado (Extensiones → Apps Script → pegar `google-apps-script.js` → Implementar).
3. Abre `index.html`, inicia sesión y pulsa **Actualizar** en Inventario.

Si dejaste las filas de ejemplo, deberías ver 3 categorías y 3 productos al cargar.
