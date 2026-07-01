// ═══════════════════════════════════════════════════════
//  POS Licorería v3 — Google Apps Script
//
//  INSTRUCCIONES:
//  1. Abrir el Google Sheet → Extensiones → Apps Script
//  2. Borrar todo y pegar este código completo
//  3. Implementar → Nueva implementación → Aplicación web
//     - Ejecutar como: Yo
//     - Acceso:        Cualquier usuario (incluso anónimo)
//  4. Copiar la URL /exec → pegarla en config.js → APPS_SCRIPT_URL
//
//  CADA VEZ QUE SE MODIFICA:
//  Implementar → Administrar implementaciones → Editar → Nueva versión
//
//  HOJAS REQUERIDAS: Categorias | Productos | Lotes | Ventas | Movimientos
//
//  REGLAS:
//  - Categorias / Productos → upsert por ID (col A)
//  - Lotes  → append al agregar; update solo qty_restante al vender
//  - Ventas → append; editVenta corrige por ID; deleteVenta borra por ID
//  - Movimientos → solo append
// ═══════════════════════════════════════════════════════

function doPost(e) {
  // Lock: evita que dos escrituras simultáneas (p. ej. venta + updateLote)
  // se pisen las filas al hacer appendRow / deleteRow.
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return respError('Servidor ocupado, reintenta: ' + err.toString());
  }
  try {
    var data   = JSON.parse(e.postData.contents);
    var accion = data.accion;

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var hojas = ss.getSheets().map(function(s){ return s.getName(); });
    var req   = ['Categorias','Productos','Lotes','Ventas','Movimientos'];
    for (var i = 0; i < req.length; i++) {
      if (hojas.indexOf(req[i]) === -1) {
        return respError('Hoja no encontrada: "' + req[i] + '" — existentes: ' + hojas.join(', '));
      }
    }

    if (accion === 'saveCategoria')   return saveCategoria(data);
    if (accion === 'deleteCategoria') return deleteCategoria(data);
    if (accion === 'saveProducto')    return saveProducto(data);
    if (accion === 'deleteProducto')  return deleteProducto(data);
    if (accion === 'addLote')         return addLote(data);
    if (accion === 'updateLote')      return updateLote(data);
    if (accion === 'editLote')        return editLote(data);
    if (accion === 'deleteLote')      return deleteLote(data);
    if (accion === 'addVenta')        return addVenta(data);
    if (accion === 'editVenta')       return editVenta(data);
    if (accion === 'deleteVenta')     return deleteVenta(data);
    if (accion === 'addMovimiento')   return addMovimiento(data);

    return ok('accion desconocida: ' + accion);
  } catch (err) {
    return respError(err.toString());
  } finally {
    lock.releaseLock();
  }
}

// ════════════════════════════════════════════════════
//  CATEGORÍAS — upsert por ID (col A)
//  Cols: A=id | B=nombre | C=orden
// ════════════════════════════════════════════════════
function saveCategoria(d) {
  var sheet = sh('Categorias');
  var row   = [d.id, d.nombre, d.orden || 0];
  var n     = findRowById(sheet, d.id);
  if (n > 0) sheet.getRange(n, 1, 1, row.length).setValues([row]);
  else       sheet.appendRow(row);
  return ok('categoria guardada');
}
function deleteCategoria(d) {
  var sheet = sh('Categorias');
  var n = findRowById(sheet, d.id);
  if (n > 0) sheet.deleteRow(n);
  return ok('categoria eliminada');
}

// ════════════════════════════════════════════════════
//  PRODUCTOS — upsert por ID (col A)
//  Cols: A=id | B=categoria_id | C=nombre | D=presentacion
//        E=precio | F=costo | G=stock_min | H=variantes (JSON)
//  variantes: [{tamaño,sabor,code,multiplier,precio,costo}] — cada
//  combinación tamaño+sabor con su propio código de barras.
// ════════════════════════════════════════════════════
function saveProducto(d) {
  var sheet = sh('Productos');
  var row = [
    d.id, d.categoria_id, d.nombre,
    d.presentacion || 'unidad',
    d.precio || 0, d.costo || 0, d.stock_min || 0,
    d.variantes || '[]'
  ];
  var n = findRowById(sheet, d.id);
  if (n > 0) sheet.getRange(n, 1, 1, row.length).setValues([row]);
  else       sheet.appendRow(row);
  return ok('producto guardado');
}
function deleteProducto(d) {
  var sheet = sh('Productos');
  var n = findRowById(sheet, d.id);
  if (n > 0) sheet.deleteRow(n);
  return ok('producto eliminado');
}

// ════════════════════════════════════════════════════
//  LOTES
//  Cols: A=id | B=producto_id | C=tamaño | D=sabor | E=fecha_compra
//        F=costo_u | G=qty_inicial | H=qty_restante | I=vencimiento | J=notas
//        K=costo_total  (costo total real del lote, como se compró)
// ════════════════════════════════════════════════════
function addLote(d) {
  var sheet = sh('Lotes');
  var id = String(d.id || '').trim();
  if (id) {
    var n = findRowById(sheet, id);
    if (n > 0) { sheet.getRange(n, 8).setValue(d.qty_restante || 0); return ok('lote ya existe — qty actualizada'); }
  }
  sheet.appendRow([
    id, d.producto_id || '', d['tamaño'] || '', d.sabor || '',
    fmtIso(d.fecha_compra), d.costo_u || 0,
    d.qty_inicial || 0, d.qty_restante || 0,
    fmtIso(d.vencimiento), d.notas || '', d.costo_total || 0
  ]);
  return ok('lote agregado id=' + id);
}
function updateLote(d) {
  var sheet = sh('Lotes');
  var n = findRowById(sheet, String(d.id));
  if (n > 0) { sheet.getRange(n, 8).setValue(d.qty_restante); return ok('qty_restante actualizado'); }
  return ok('lote id=' + d.id + ' no encontrado');
}
function editLote(d) {
  var sheet = sh('Lotes');
  var n = findRowById(sheet, String(d.id));
  if (n < 0) return respError('Lote "' + d.id + '" no encontrado');
  sheet.getRange(n, 2).setValue(d.producto_id || '');
  sheet.getRange(n, 3).setValue(d['tamaño'] || '');
  sheet.getRange(n, 4).setValue(d.sabor || '');
  sheet.getRange(n, 5).setValue(fmtIso(d.fecha_compra));
  sheet.getRange(n, 6).setValue(d.costo_u || 0);
  sheet.getRange(n, 7).setValue(d.qty_inicial || 0);
  sheet.getRange(n, 8).setValue(d.qty_restante || 0);
  sheet.getRange(n, 9).setValue(fmtIso(d.vencimiento));
  sheet.getRange(n, 10).setValue(d.notas || '');
  sheet.getRange(n, 11).setValue(d.costo_total || 0);
  return ok('lote editado');
}
function deleteLote(d) {
  var sheet = sh('Lotes');
  var n = findRowById(sheet, String(d.id));
  if (n < 0) return respError('Lote "' + d.id + '" no encontrado');
  sheet.deleteRow(n);
  return ok('lote eliminado');
}

// ════════════════════════════════════════════════════
//  VENTAS — append. El ID lo genera el SERVIDOR (§3-bis).
//  Cols: A=id | B=fecha | C=hora | D=total | E=cogs | F=ganancia | G=metodo
//        H=items | I=monto_efectivo | J=monto_qr
// ════════════════════════════════════════════════════
function addVenta(d) {
  var sheet = sh('Ventas');
  var dtVenta = new Date(d.fecha);
  var fecha   = Utilities.formatDate(dtVenta, Session.getScriptTimeZone(), 'dd/MM/yyyy');
  var now     = new Date();
  var hora    = Utilities.formatDate(now, Session.getScriptTimeZone(), 'HH:mm:ss');
  var id      = 'VTA-' + now.getTime().toString(36).toUpperCase()
              + '-' + Math.floor(Math.random() * 1000).toString(36).toUpperCase();
  sheet.appendRow([
    id, fecha, hora, d.total || 0, d.cogs || 0, d.ganancia || 0,
    d.metodo || '', d.items || '[]', d.monto_efectivo || 0, d.monto_qr || 0
  ]);
  return ok('venta registrada id=' + id);
}
function editVenta(d) {
  var sheet = sh('Ventas');
  var n = findRowById(sheet, String(d.id));
  if (n < 0) return respError('Venta "' + d.id + '" no encontrada');
  sheet.getRange(n, 2).setValue(d.fecha    || '');
  sheet.getRange(n, 3).setValue(d.hora     || '');
  sheet.getRange(n, 4).setValue(d.total    || 0);
  sheet.getRange(n, 5).setValue(d.cogs     || 0);
  sheet.getRange(n, 6).setValue(d.ganancia || 0);
  sheet.getRange(n, 7).setValue(d.metodo   || '');
  sheet.getRange(n, 8).setValue(d.items    || '[]');
  if (d.monto_efectivo != null) sheet.getRange(n, 9).setValue(d.monto_efectivo || 0);
  if (d.monto_qr       != null) sheet.getRange(n, 10).setValue(d.monto_qr || 0);
  return ok('venta actualizada');
}
function deleteVenta(d) {
  var sheet = sh('Ventas');
  var n = findRowById(sheet, String(d.id));
  if (n < 0) return respError('Venta "' + d.id + '" no encontrada');
  sheet.deleteRow(n);
  return ok('venta eliminada');
}

// ════════════════════════════════════════════════════
//  MOVIMIENTOS — solo append
//  Cols: A=fecha | B=producto_id | C=tamaño | D=sabor | E=tipo | F=qty | G=costo | H=usuario
// ════════════════════════════════════════════════════
function addMovimiento(d) {
  var sheet = sh('Movimientos');
  sheet.appendRow([
    d.fecha, d.producto_id || '', d['tamaño'] || '', d.sabor || '',
    d.tipo, d.qty, d.costo || 0, d.usuario || ''
  ]);
  return ok('movimiento registrado');
}

// ════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════
function sh(name) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); }

function findRowById(sheet, id) {
  var data = sheet.getDataRange().getValues();
  var target = String(id).trim().toLowerCase();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === target) return i + 1;
  }
  return -1;
}

function fmtIso(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM/yyyy');
}

function ok(msg) {
  return ContentService.createTextOutput(JSON.stringify({ success: true, msg: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}
function respError(msg) {
  return ContentService.createTextOutput(JSON.stringify({ success: false, error: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Prueba desde el editor ────────────────────────────
function testAddVenta() {
  var e = { postData: { contents: JSON.stringify({
    accion: 'addVenta', fecha: new Date().toISOString(),
    total: 50, cogs: 30, ganancia: 20, metodo: 'efectivo', items: '[]'
  })}};
  Logger.log(doPost(e).getContent());
}
