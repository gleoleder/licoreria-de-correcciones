# Cómo importar los CSV a Google Sheets

Hay un CSV por cada hoja. Impórtalos **uno por uno**, cada uno a su propia hoja.

## Pasos (para cada archivo)
1. En tu Google Sheet, crea/abre la hoja con el nombre exacto:
   `Categorias` · `Productos` · `Lotes` · `Ventas` · `Movimientos`
2. **Archivo → Importar → Subir** → elige el CSV correspondiente.
3. En las opciones de importación:
   - **Ubicación de importación:** *Reemplazar la hoja actual* (o *Insertar nueva hoja* y renómbrala).
   - **Tipo de separador:** *Detectar automáticamente* (o *Coma*).
   - **Convertir texto a números/fechas:** **DESACTÍVALO** ⚠️ (ver nota abajo).
4. Importar.

## ⚠️ Nota importante sobre los JSON (hoja Productos)
Las columnas `tamaños`, `sabores` y `barcodes` contienen texto JSON como:
`["620ml","330ml"]` o `[{"code":"7790001","multiplier":1,...}]`

- En el CSV van **entre comillas y con las comillas internas dobladas** (`""`). Eso es correcto para CSV; Google lo desarma solo al importar y en la celda verás el JSON limpio.
- Si activas *"Convertir texto a números"*, Google podría estropear estos campos. **Déjalo desactivado.**
- Los códigos de barras (`7790001`, etc.) son texto: si Google los convierte a número no pasa nada grave, pero por prolijidad deja la conversión desactivada.

## Hojas Ventas y Movimientos
Solo traen la **fila de cabecera** (la app las llena sola). Aun así conviene importarlas para que las columnas queden con los nombres correctos.

## Después de importar
1. **Compartir** el Sheet → *Cualquiera con el enlace* → **Lector**.
2. Verifica el **Apps Script** desplegado.
3. Abre `index.html`, inicia sesión y pulsa **Actualizar** en Inventario.

Deberías ver 3 categorías y 3 productos. Si quieres empezar vacío, borra las filas de ejemplo de `Categorias`, `Productos` y `Lotes` (deja las cabeceras).
