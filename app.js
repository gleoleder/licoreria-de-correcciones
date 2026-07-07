// ═══════════════════════════════════════════════════════
//  POS Licorería v3 — Lógica principal de UI
// ═══════════════════════════════════════════════════════

// ── Estado global ─────────────────────────────────────
let cart      = [];           // [{producto, variante, qty, customPrice}]  variante = {tamaño,sabor,code,multiplier,precio,costo}
let payMethod = 'efectivo';
let statGran  = 'dia';        // granularidad de estadísticas
let ventaFechaManual = false;
const EXPIRY_WARN_DAYS = 7;

// ── Helpers de dinero ─────────────────────────────────
const toCents   = bs => Math.round(Number(bs) * 100);
const fromCents = c  => c / 100;
function bankersRound(v) {
  const n = Number(v); if (!isFinite(n)) return 0;
  // +(…).toFixed(6) absorbe el error binario (1.005*100 = 100.49999…)
  const c = +(n * 100).toFixed(6), f = Math.floor(c), diff = c - f;
  let r;
  if (diff > 0.5) r = f + 1; else if (diff < 0.5) r = f;
  else r = (f % 2 === 0) ? f : f + 1;
  return r / 100;
}
const truncate2 = v => Math.floor(v * 100) / 100;
const fmt   = n => `Bs ${bankersRound(Number(n)).toFixed(2)}`;
const fmtN  = n => bankersRound(Number(n)).toFixed(2);
function calcCostoUnitario(total, cant) {
  if (!cant || cant <= 0) return 0;
  return Math.round((total / cant) * 1e6) / 1e6;
}

// ── Desglose de pago efectivo / QR (incluye mixto) ────
// Usa monto_efectivo / monto_qr si vienen; si no (ventas viejas),
// los deriva del método para no perder compatibilidad.
function desglosePago(v) {
  const hasBreakdown = (v.monto_efectivo != null && v.monto_efectivo !== '') ||
                       (v.monto_qr != null && v.monto_qr !== '');
  if (hasBreakdown) {
    return { efectivo: Number(v.monto_efectivo) || 0, qr: Number(v.monto_qr) || 0 };
  }
  if (v.metodo === 'qr')    return { efectivo: 0, qr: v.total || 0 };
  return { efectivo: v.total || 0, qr: 0 };  // efectivo por defecto
}

// ── Fechas ────────────────────────────────────────────
// yyyy-MM-dd en hora LOCAL (toISOString() es UTC: en Bolivia, UTC−4,
// una venta de las 20:00+ caería en el día siguiente).
function fechaLocalISO(d = new Date()) {
  d = new Date(d);
  if (isNaN(d)) return '';
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('es-BO') : '—';
function daysToExpiry(iso) {
  if (!iso) return null;
  const d = new Date(iso); if (isNaN(d)) return null;
  return Math.ceil((d - new Date()) / 86400000);
}
// Lotes con stock que están vencidos o por vencer (≤ EXPIRY_WARN_DAYS).
// Devuelve [{lote, prod, dias}] ordenado por días (los más urgentes primero).
function lotesPorVencer() {
  const out = [];
  for (const l of Store.lotes) {
    if ((l.qty_restante || 0) <= 0) continue;       // sin stock, no importa
    if (!l.vencimiento) continue;                    // sin fecha, no se controla
    const dias = daysToExpiry(l.vencimiento);
    if (dias == null || dias > EXPIRY_WARN_DAYS) continue;
    out.push({ lote: l, prod: Store.getProducto(l.producto_id), dias });
  }
  return out.sort((a, b) => a.dias - b.dias);
}
// Texto legible de "en cuántos días" / "vencido"
function textoVence(dias) {
  if (dias < 0)  return `vencido hace ${-dias}d`;
  if (dias === 0) return 'vence HOY';
  if (dias === 1) return 'vence mañana';
  return `vence en ${dias}d`;
}
function startOfWeek(d){ const x=new Date(d); const day=(x.getDay()+6)%7; x.setHours(0,0,0,0); x.setDate(x.getDate()-day); return x; }
function isoWeekKey(d){
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (x.getUTCDay()+6)%7; x.setUTCDate(x.getUTCDate()-day+3);
  const firstThu = new Date(Date.UTC(x.getUTCFullYear(),0,4));
  const week = 1 + Math.round(((x - firstThu)/86400000 - 3 + ((firstThu.getUTCDay()+6)%7))/7);
  return `${x.getUTCFullYear()}-W${String(week).padStart(2,'0')}`;
}
function monthKey(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
function bucketKey(date, gran){
  const d = new Date(date);
  if (gran === 'mes')    return monthKey(d);
  if (gran === 'semana') return isoWeekKey(d);
  return fechaLocalISO(d); // dia: yyyy-MM-dd local
}

// ── UI helpers ────────────────────────────────────────
function $(id) { return document.getElementById(id); }
// Escapa texto del usuario antes de meterlo en innerHTML / atributos
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
function openModal(id)  { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }
function showOverlay(msg='Procesando…') { $('processMsg').textContent = msg; $('processOverlay').classList.add('on'); }
function hideOverlay() { $('processOverlay').classList.remove('on'); }
let _toastTid = null;
function toast(msg, type='') {
  const t = $('toast'); t.textContent = msg; t.className = 'toast on ' + type;
  clearTimeout(_toastTid); _toastTid = setTimeout(() => t.className = 'toast', 2600);
}
// Confirmación reutilizable. Devuelve una Promise<boolean>.
//   await confirmar({ titulo, mensaje, ok, peligro })
let _confResolver = null;
function confirmar({ titulo = 'Confirmar', mensaje = '', ok = 'Confirmar', peligro = false } = {}) {
  $('confTitulo').textContent = titulo;
  $('confMensaje').textContent = mensaje;
  const btnSi = $('confSi');
  btnSi.textContent = ok;
  btnSi.className = 'btn ' + (peligro ? 'btn-peligro' : 'btn-primary');
  openModal('modalConfirm');
  setTimeout(() => btnSi.focus(), 50);
  return new Promise(res => { _confResolver = res; });
}
function _confCerrar(valor) {
  closeModal('modalConfirm');
  if (_confResolver) { _confResolver(valor); _confResolver = null; }
}

function setStatus(state, msg) {
  const el = $('sheetsStatus'); el.textContent = msg; el.className = 'sheets-status ' + state;
}
function tickClock() {
  const el = $('clock'); if (!el) return;
  el.textContent = new Date().toLocaleTimeString('es-BO', { hour:'2-digit', minute:'2-digit' });
}

// ═══════════════════════════════════════════════════════
//  NAVEGACIÓN + PERMISOS (§8-bis)
// ═══════════════════════════════════════════════════════
function vistaActual() {
  const v = document.querySelector('.view.active');
  return v ? v.id.replace('view-', '') : 'pos';
}
function permisosActuales() {
  const rol = localStorage.getItem('pos_rol') || 'empleado';
  return (typeof PERMISOS !== 'undefined' && PERMISOS[rol]) || ['pos','productos'];
}
function irAVista(view) {
  if (!permisosActuales().includes(view)) return;
  document.querySelectorAll('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + view));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'productos')    renderProducts();
  if (view === 'categorias')   renderCategorias();
  if (view === 'inventario')   renderInventory();
  if (view === 'ventas')       renderSales($('ventasFecha').value);
  if (view === 'estadisticas') aplicarStats();
}
function aplicarPermisos() {
  const permitidas = permisosActuales();
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.style.display = permitidas.includes(btn.dataset.view) ? '' : 'none';
  });
  if (!permitidas.includes(vistaActual())) irAVista('pos');
}
function initNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => irAVista(btn.dataset.view));
  });
}

// ═══════════════════════════════════════════════════════
//  CARRITO
// ═══════════════════════════════════════════════════════
// item.variante = { tamaño, sabor, code, multiplier, precio, costo } resuelto por Store.variantInfo
function unitPrice(item) { return item.customPrice ?? item.variante.precio; }
function lineUnits(item) { return item.qty * (item.variante?.multiplier || 1); }
function lineTotal(item) { return truncate2(unitPrice(item) * lineUnits(item)); }
function cartTotal()    { return cart.reduce((s,i)=> s + lineTotal(i), 0); }

function addToCart(producto, tamaño, sabor) {
  const v = Store.variantInfo(producto, tamaño, sabor);
  const ex = cart.find(i => i.producto.id === producto.id && i.variante.tamaño === v.tamaño && i.variante.sabor === v.sabor);
  if (ex) ex.qty++;
  else cart.push({ producto, variante: v, qty: 1, customPrice: null });
  renderCart();
}
function setQty(idx, val) {
  const q = Math.max(1, parseInt(val) || 1);
  cart[idx].qty = q; renderCart();
}
function removeFromCart(idx) { cart.splice(idx,1); renderCart(); }

// ── Precio especial por ítem (editable en caja) ───────
// Costo de adquisición por unidad de la variante:
//   - el promedio ponderado de los lotes activos (lo realmente pagado), si hay
//   - si no, el costo configurado de la variante
function costoUnidadVariante(it) {
  const avg = Store.variantAvgCost(it.producto.id, it.variante.tamaño, it.variante.sabor);
  return avg > 0 ? avg : (it.variante.costo || 0);
}
let _discCostoU = 0;
function openDiscount(idx) {
  const it = cart[idx]; if (!it) return;
  const variante = [it.variante.tamaño, it.variante.sabor].filter(Boolean).join(' · ');
  _discCostoU = costoUnidadVariante(it);
  $('discIdx').value = idx;
  $('discProdName').textContent = `${it.producto.nombre}${variante?` (${variante})`:''}`;
  $('discPrecioOrig').textContent = fmt(it.variante.precio);
  $('discCosto').textContent = _discCostoU > 0 ? fmt(_discCostoU) : '—';
  $('discInput').value = unitPrice(it);
  _discUpdateMargen();
  openModal('modalDiscount');
  setTimeout(() => { $('discInput').focus(); $('discInput').select(); }, 50);
}
// Muestra ganancia y margen con el precio tecleado, comparando contra el costo /u
function _discUpdateMargen() {
  const el = $('discMargen');
  const precio = parseFloat($('discInput').value);
  if (isNaN(precio)) { el.textContent = '—'; el.className = 'disc-margen'; return; }
  const gan = precio - _discCostoU;
  const margen = precio > 0 ? (gan / precio) * 100 : 0;
  let cls = 'g', txt = `Ganancia/u: ${fmt(gan)} · Margen: ${margen.toFixed(0)}%`;
  if (gan < 0)        { cls = 'r'; txt = `⚠ PIERDES ${fmt(-gan)}/u (por debajo del costo)`; }
  else if (margen < 15) cls = 'a';
  el.textContent = txt;
  el.className = 'disc-margen m-' + cls;
}
function aplicarDiscount() {
  const idx = parseInt($('discIdx').value);
  const it = cart[idx]; if (!it) return;
  const nuevo = parseFloat($('discInput').value);
  if (isNaN(nuevo) || nuevo < 0) { toast('Precio inválido', 'error'); return; }
  // Si coincide con el precio base, se considera "sin especial"
  it.customPrice = (Math.abs(nuevo - it.variante.precio) < 0.005) ? null : nuevo;
  closeModal('modalDiscount'); renderCart();
}
function quitarDiscount() {
  const idx = parseInt($('discIdx').value);
  if (cart[idx]) cart[idx].customPrice = null;
  closeModal('modalDiscount'); renderCart();
}

function renderCart() {
  const box = $('cartList');
  if (!cart.length) {
    box.innerHTML = `<div class="cart-empty">Carrito vacío</div>`;
  } else {
    box.innerHTML = cart.map((it, i) => {
      const variante = esc([it.variante.tamaño, it.variante.sabor].filter(Boolean).join(' · '));
      const mult = it.variante.multiplier > 1 ? `×${it.variante.multiplier} · ` : '';
      // Stock disponible de la variante vs. unidades pedidas en esta línea
      const stock = Store.variantStock(it.producto.id, it.variante.tamaño, it.variante.sabor);
      const pedidas = lineUnits(it);
      const stockCls = stock <= 0 ? 'r' : (pedidas > stock ? 'a' : 'g');
      const stockBadge = `<span class="ci-stock m-${stockCls}" title="Stock disponible de esta variante">stock ${stock}</span>`;
      return `<div class="cart-item">
        <div class="ci-main">
          <div class="ci-name">${esc(it.producto.nombre)}${variante ? ` <span class="ci-var">${variante}</span>` : ''} ${stockBadge}</div>
          <div class="ci-sub ci-price" onclick="openDiscount(${i})" title="Tocar para cambiar el precio">
            ${mult}${fmt(unitPrice(it))} ${it.customPrice!=null?'<span class="ci-disc">★ especial</span>':'<span class="ci-edit">✎</span>'}
          </div>
        </div>
        <input class="ci-qty" type="number" min="1" value="${it.qty}" onchange="setQty(${i}, this.value)">
        <div class="ci-total">${fmt(lineTotal(it))}</div>
        <button class="ci-del" onclick="removeFromCart(${i})">✕</button>
      </div>`;
    }).join('');
  }
  const totalUnits = cart.reduce((s, i) => s + lineUnits(i), 0);
  $('cartCount').textContent = `${cart.length} ítems · ${totalUnits} u`;
  $('posTotal').textContent  = fmt(cartTotal());
  updateChange();
}

function updateChange() {
  const rec = parseFloat($('cashReceived').value) || 0;
  const ch  = rec - cartTotal();
  $('posChange').textContent = (payMethod === 'efectivo' && rec > 0) ? fmt(ch) : 'Bs —';
}

// Pago mixto: muestra cuánto falta (negativo) o sobra (positivo) respecto al total
function updateMixDiff() {
  const ef = parseFloat($('mixEfectivo').value) || 0;
  const qr = parseFloat($('mixQr').value) || 0;
  const diff = (ef + qr) - cartTotal();
  const el = $('mixDiff');
  el.textContent = fmt(diff);
  el.style.color = Math.abs(diff) < 0.005 ? 'var(--green)' : (diff < 0 ? 'var(--red)' : 'var(--amber)');
}

// ═══════════════════════════════════════════════════════
//  SCAN / BÚSQUEDA
// ═══════════════════════════════════════════════════════
// Añade la variante al carrito si el texto coincide EXACTO con un código.
// Devuelve true si lo hizo. Centraliza scanner físico, cámara y tecleo.
function intentarPorCodigo(code) {
  code = (code || '').trim();
  if (!code) return false;
  const hit = Store.buscarPorBarcode(code);
  if (hit) {
    addToCart(hit.producto, hit.variante.tamaño, hit.variante.sabor);
    toast(`+ ${hit.producto.nombre} ${[hit.variante.tamaño,hit.variante.sabor].filter(Boolean).join(' ')}`.trim(), 'success');
    return true;
  }
  return false;
}
function initScan() {
  const input = $('scanInput'), sug = $('suggestions');
  // Enter: intenta código; si no, deja las sugerencias por nombre
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const code = input.value.trim(); if (!code) return;
    if (intentarPorCodigo(code)) { input.value=''; sug.innerHTML=''; }
    else renderSuggestions(Store.buscarProductos(code));
  });
  // En vivo: si lo tecleado/pegado ya coincide con un código exacto,
  // se añade solo (sin pulsar Enter). Si no, muestra sugerencias por nombre.
  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (q && intentarPorCodigo(q)) { input.value=''; sug.innerHTML=''; return; }
    renderSuggestions(q ? Store.buscarProductos(q) : []);
  });
  $('btnScanClear').addEventListener('click', () => { input.value=''; sug.innerHTML=''; input.focus(); });
  $('btnCamera').addEventListener('click', openScanner);
  document.addEventListener('click', e => { if (!$('scanArea').contains(e.target)) sug.innerHTML=''; });
}
function renderSuggestions(prods) {
  const sug = $('suggestions');
  if (!prods.length) { sug.innerHTML=''; return; }
  sug.innerHTML = prods.map(p =>
    `<div class="sug-item" onclick='abrirVariantePorId("${esc(p.id)}")'>
      <span>${esc(p.nombre)}</span>
      <span class="sug-cat">${esc(Store.categoriaNombre(p.categoria_id))}</span>
      <span class="sug-price">${fmt(p.precio)}</span>
    </div>`).join('');
}

// ── Escáner por cámara (BarcodeDetector + getUserMedia) ──
let _scanStream = null, _scanLoop = null, _scanBusy = false;
async function openScanner() {
  const video = $('scannerVideo'), status = $('scannerStatus');
  if (!('BarcodeDetector' in window)) {
    // Sin soporte nativo: avisar y usar el lector físico / tecleo
    toast('Tu navegador no soporta escáner por cámara. Usa un lector USB o teclea el código.', 'error');
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) { toast('Cámara no disponible', 'error'); return; }
  openModal('modalScanner');
  status.textContent = 'Iniciando cámara…';
  try {
    _scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = _scanStream;
    await video.play();
    const detector = new BarcodeDetector({
      formats: ['ean_13','ean_8','code_128','code_39','upc_a','upc_e','qr_code','itf']
    });
    status.textContent = 'Apunta al código de barras…';
    _scanLoop = setInterval(async () => {
      if (_scanBusy || video.readyState < 2) return;
      _scanBusy = true;
      try {
        const codes = await detector.detect(video);
        if (codes && codes.length) {
          const code = (codes[0].rawValue || '').trim();
          if (code) {
            if (intentarPorCodigo(code)) {
              status.textContent = `✓ ${code} — añadido`;
              if (navigator.vibrate) navigator.vibrate(80);
              await new Promise(r => setTimeout(r, 700)); // pausa para no duplicar
            } else {
              status.textContent = `Código ${code} no encontrado en el catálogo`;
            }
          }
        }
      } catch (_) {}
      _scanBusy = false;
    }, 350);
  } catch (e) {
    status.textContent = 'No se pudo acceder a la cámara: ' + e.message;
    toast('No se pudo acceder a la cámara (¿permiso denegado?)', 'error');
  }
}
function closeScanner() {
  if (_scanLoop) { clearInterval(_scanLoop); _scanLoop = null; }
  if (_scanStream) { _scanStream.getTracks().forEach(t => t.stop()); _scanStream = null; }
  _scanBusy = false;
  $('scannerVideo').srcObject = null;
}

// ── Modal de variante (elegir tamaño/sabor al buscar por nombre) ──
// El selector "barcode" ya no se usa: cada tamaño+sabor ES una variante
// con su propio código. Se elige tamaño → sabor y eso resuelve todo.
let _mvProducto = null;
function abrirVariantePorId(id) { const p = Store.getProducto(id); if (p) abrirVariante(p); }
function abrirVariante(producto) {
  _mvProducto = producto;
  $('mvNombre').textContent = producto.nombre;
  // Ocultar el selector de barcode (ya no aplica)
  $('mvBarcode').closest('.form-group').style.display = 'none';
  const tams = Store.tamañosDe(producto);
  $('mvTamaño').innerHTML = (tams.length ? tams : ['']).map(v=>`<option value="${esc(v)}">${esc(v)||'—'}</option>`).join('');
  _mvFillSabores();
  $('mvTamaño').onchange = () => { _mvFillSabores(); _mvRefreshStock(); };
  $('mvSabor').onchange  = _mvRefreshStock;
  _mvRefreshStock();
  openModal('modalVariante');
}
function _mvFillSabores() {
  const sabs = Store.saboresDe(_mvProducto, $('mvTamaño').value);
  $('mvSabor').innerHTML = (sabs.length ? sabs : ['']).map(v=>`<option value="${esc(v)}">${esc(v)||'—'}</option>`).join('');
}
function _mvRefreshStock() {
  const t = $('mvTamaño').value, s = $('mvSabor').value;
  const info = Store.variantInfo(_mvProducto, t, s);
  const st = Store.variantStock(_mvProducto.id, t, s);
  $('mvStock').innerHTML = `Precio: <b>${fmt(info.precio)}</b> · Stock: <b>${st}</b>${info.code?` · cód ${esc(info.code)}`:''}`;
  $('mvStock').style.color = st > 0 ? 'var(--text2)' : 'var(--red)';
}
function confirmVariante() {
  if (!_mvProducto) return;
  addToCart(_mvProducto, $('mvTamaño').value, $('mvSabor').value);
  closeModal('modalVariante');
  $('scanInput').focus();
}

// ═══════════════════════════════════════════════════════
//  PAGO
// ═══════════════════════════════════════════════════════
function initPayment() {
  document.querySelectorAll('.pay-btn').forEach(b => b.addEventListener('click', () => {
    payMethod = b.dataset.method;
    document.querySelectorAll('.pay-btn').forEach(x => x.classList.toggle('active', x===b));
    $('cashSection').style.display  = payMethod==='efectivo' ? '' : 'none';
    $('mixtoSection').style.display = payMethod==='mixto'    ? '' : 'none';
    updateChange();
    if (payMethod==='mixto') updateMixDiff();
  }));
  $('cashReceived').addEventListener('input', updateChange);
  document.querySelectorAll('.denom-btn[data-v]').forEach(b => b.addEventListener('click', () => {
    $('cashReceived').value = (parseFloat($('cashReceived').value)||0) + parseFloat(b.dataset.v);
    updateChange();
  }));
  $('denomExact').addEventListener('click', () => { $('cashReceived').value = fmtN(cartTotal()); updateChange(); });
  $('denomClear').addEventListener('click', () => { $('cashReceived').value = ''; updateChange(); });
  // Mixto
  $('mixEfectivo').addEventListener('input', updateMixDiff);
  $('mixQr').addEventListener('input', updateMixDiff);
  $('mixQrResto').addEventListener('click', () => {
    const ef = parseFloat($('mixEfectivo').value) || 0;
    $('mixQr').value = fmtN(Math.max(0, cartTotal() - ef)); updateMixDiff();
  });
  $('mixCashResto').addEventListener('click', () => {
    const qr = parseFloat($('mixQr').value) || 0;
    $('mixEfectivo').value = fmtN(Math.max(0, cartTotal() - qr)); updateMixDiff();
  });
  $('btnClearCart').addEventListener('click', () => { cart=[]; renderCart(); });
  $('btnPay').addEventListener('click', processSale);
  $('ventaFecha').addEventListener('change', () => ventaFechaManual = true);
  fijarFechaVentaAhora();
}
function fijarFechaVentaAhora() {
  const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  $('ventaFecha').value = d.toISOString().slice(0,16);
  ventaFechaManual = false;
}

async function processSale() {
  if (!cart.length) { toast('El carrito está vacío', 'error'); return; }
  const total = cartTotal();
  const rec = parseFloat($('cashReceived').value) || 0;
  if (payMethod === 'efectivo' && rec < total) { toast('Monto insuficiente', 'error'); return; }

  // Desglose efectivo / QR (siempre se guarda, en cualquier método)
  let montoEfectivo = 0, montoQr = 0;
  if (payMethod === 'efectivo') {
    montoEfectivo = total;                       // el cambio no cuenta como ingreso
  } else if (payMethod === 'qr') {
    montoQr = total;
  } else { // mixto
    montoEfectivo = parseFloat($('mixEfectivo').value) || 0;
    montoQr       = parseFloat($('mixQr').value) || 0;
    if (Math.abs((montoEfectivo + montoQr) - total) > 0.005) {
      toast(`Efectivo + QR debe sumar ${fmt(total)}`, 'error'); return;
    }
  }

  // Validar stock por variante
  for (const it of cart) {
    const need = lineUnits(it);
    const st = Store.variantStock(it.producto.id, it.variante.tamaño, it.variante.sabor);
    if (st < need) { toast(`Sin stock: ${it.producto.nombre} (hay ${st})`, 'error'); return; }
  }

  // Confirmar el cobro
  const metodoTxt = payMethod === 'mixto'
    ? `mixto (efectivo ${fmt(montoEfectivo)} + QR ${fmt(montoQr)})`
    : payMethod;
  const cambioTxt = (payMethod === 'efectivo' && rec > total) ? `\nCambio: ${fmt(rec - total)}` : '';
  if (!await confirmar({
    titulo: 'Confirmar cobro',
    mensaje: `Cobrar ${fmt(total)} en ${metodoTxt}.${cambioTxt}`,
    ok: 'Cobrar'
  })) return;

  const fechaInput = $('ventaFecha').value;
  const fechaVenta = (ventaFechaManual && fechaInput) ? new Date(fechaInput).toISOString() : new Date().toISOString();
  const usuario = localStorage.getItem('pos_user') || '';

  showOverlay('Registrando venta…');
  try {
    const items = [];
    let totalCogs = 0;
    const lotesParaActualizar = [];

    for (const it of cart) {
      const tam = it.variante.tamaño, sab = it.variante.sabor;
      const units = lineUnits(it);
      const { cogs, lotesTocados } = Store.consumeFIFO(it.producto.id, tam, sab, units);
      totalCogs += cogs;
      lotesTocados.forEach(l => lotesParaActualizar.push(l));
      const lt = lineTotal(it);
      items.push({
        producto_id: it.producto.id, nombre: it.producto.nombre,
        tamaño: tam || '', sabor: sab || '',
        code: it.variante.code || '', multiplier: it.variante.multiplier || 1,
        qty: it.qty, units, precio: unitPrice(it), line_total: lt, item_cogs: cogs
      });
      // Movimiento (append, sin esperar; si falla no rompe la venta)
      Sheets.addMovimiento({
        fecha: fechaVenta, producto_id: it.producto.id, tamaño: tam, sabor: sab,
        tipo: 'venta', qty: -units, costo: 0, usuario
      }).catch(()=>{});
    }

    const venta = {
      fecha: fechaVenta, total, cogs: totalCogs, ganancia: total - totalCogs,
      metodo: payMethod, monto_efectivo: montoEfectivo, monto_qr: montoQr, items
    };

    const sheetsTimeout = ms => new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')), ms));
    await Promise.race([Sheets.addVenta(venta), sheetsTimeout(12000)]).catch(()=>{});

    // Actualizar qty_restante de los lotes tocados en Sheets
    showOverlay('Actualizando stock…');
    for (const l of lotesParaActualizar) {
      Sheets.updateLote(l.id, l.qty_restante).catch(()=>{});
    }

    hideOverlay();
    toast('✓ Venta registrada', 'success');
    showTicket(venta, rec);
    cart = []; renderCart();
    $('cashReceived').value = '';
    $('mixEfectivo').value = ''; $('mixQr').value = '';
    fijarFechaVentaAhora();
  } catch (err) {
    hideOverlay();
    toast('Error: ' + err.message, 'error');
  }
}

// ── Ticket ─────────────────────────────────────────────
function showTicket(venta, recibido) {
  const lines = venta.items.map(it => {
    const variante = [it.tamaño, it.sabor].filter(Boolean).join(' ');
    const nombre = `${it.nombre} ${variante}`.trim().slice(0, 22).padEnd(22);
    return `${nombre} ${String(it.qty).padStart(3)} ${fmtN(it.line_total).padStart(8)}`;
  }).join('\n');
  const cambio = recibido != null && venta.metodo === 'efectivo' ? recibido - venta.total : 0;
  $('ticketContent').textContent =
`        POS LICORES
${new Date(venta.fecha).toLocaleString('es-BO')}
────────────────────────────────
Producto               Cant    Total
────────────────────────────────
${lines}
────────────────────────────────
TOTAL                      ${fmtN(venta.total).padStart(8)}
Método: ${venta.metodo}
${venta.metodo==='efectivo' ? `Recibido: ${fmtN(recibido||0)}\nCambio:   ${fmtN(cambio)}` : ''}${venta.metodo==='mixto' ? `Efectivo: ${fmtN(venta.monto_efectivo||0)}\nQR:       ${fmtN(venta.monto_qr||0)}` : ''}
────────────────────────────────
        ¡Gracias!`;
  openModal('modalTicket');
}

// ═══════════════════════════════════════════════════════
//  PRODUCTOS
// ═══════════════════════════════════════════════════════
// Normaliza texto: minúsculas y sin acentos, para comparar sin importar
// mayúsculas/minúsculas ni tildes (á=a, ñ se conserva).
function normCat(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim();
}

// ── Buscador genérico con autocompletado (acentos/sin acentos/mayús/minús) ──
// cfg: { searchId, hiddenId, listId, items:()=>[{id,nombre}], onPick? }
const _searchers = {};
function makeSearchSelect(cfg) {
  const search = $(cfg.searchId), hidden = $(cfg.hiddenId), list = $(cfg.listId);
  if (!search || !hidden || !list) return null;
  const s = { cfg, search, hidden, list, idx: -1 };

  s.close = () => { list.style.display = 'none'; list.innerHTML = ''; s.idx = -1; };
  s.render = (q) => {
    const nq = normCat(q);
    const items = cfg.items().filter(it => !nq || normCat(it.nombre).includes(nq));
    list.innerHTML = items.length
      ? items.map(it => `<div class="cat-search-item" data-id="${esc(it.id)}">${esc(it.nombre)}</div>`).join('')
      : '<div class="cat-search-empty">Sin coincidencias</div>';
    list.style.display = 'block'; s.idx = -1;
  };
  s.pick = (id) => {
    const it = cfg.items().find(x => String(x.id) === String(id));
    if (!it) return;
    hidden.value = it.id; search.value = it.nombre; s.close();
    if (cfg.onPick) cfg.onPick(it.id);
  };
  // Fija valor inicial (id seleccionado) y su texto visible
  s.set = (selected) => {
    hidden.value = selected || '';
    const it = selected != null && selected !== '' ? cfg.items().find(x => String(x.id) === String(selected)) : null;
    search.value = it ? it.nombre : '';
    s.close();
  };

  if (!search._wired) {
    search._wired = true;
    search.addEventListener('input', () => { hidden.value = ''; s.render(search.value); });
    // Foco/clic: SIEMPRE lista completa (ignora el texto ya puesto)
    search.addEventListener('focus', () => s.render(''));
    search.addEventListener('click', () => s.render(''));
    search.addEventListener('keydown', (e) => {
      const items = [...list.querySelectorAll('.cat-search-item')];
      if (e.key === 'ArrowDown') { e.preventDefault(); s.idx = Math.min(s.idx + 1, items.length - 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); s.idx = Math.max(s.idx - 1, 0); }
      else if (e.key === 'Enter') {
        if (items[s.idx]) { e.preventDefault(); s.pick(items[s.idx].dataset.id); }
        return;
      } else if (e.key === 'Escape') { s.close(); return; }
      else return;
      items.forEach((el, i) => el.classList.toggle('active', i === s.idx));
      if (items[s.idx]) items[s.idx].scrollIntoView({ block: 'nearest' });
    });
    list.addEventListener('mousedown', (e) => {
      const it = e.target.closest('.cat-search-item');
      if (it) { e.preventDefault(); s.pick(it.dataset.id); }
    });
    document.addEventListener('click', (e) => {
      if (!search.closest('.cat-search').contains(e.target)) s.close();
    });
  }
  _searchers[cfg.searchId] = s;
  return s;
}

// Buscador de categoría (modal producto)
function initCatSearch() {
  return _searchers.fpCatSearch || makeSearchSelect({
    searchId: 'fpCatSearch', hiddenId: 'fpCat', listId: 'fpCatList',
    items: () => Store.categoriasOrdenadas().map(c => ({ id: c.id, nombre: c.nombre }))
  });
}
// Compat: fija categoría seleccionada en el buscador
function poblarCatSelect(_hidden, selected) {
  const s = initCatSearch();
  if (s) s.set(selected);
}
function renderProducts(filter='') {
  const grid = $('productsGrid');
  const q = (filter||'').toLowerCase().trim();
  const cats = Store.categoriasOrdenadas();
  let html = '';
  for (const cat of cats) {
    let prods = Store.productosDeCategoria(cat.id);
    if (q) prods = prods.filter(p => p.nombre.toLowerCase().includes(q));
    if (!prods.length) continue;
    html += `<div class="cat-group"><div class="cat-title" style="${catStyle(cat.id)}">${esc(cat.nombre)} <span class="cat-count">${prods.length}</span></div><div class="cat-cards">`;
    html += prods.map(prodCardHtml).join('');
    html += `</div></div>`;
  }
  // Productos sin categoría válida
  const huerfanos = Store.productos.filter(p => !cats.find(c=>c.id===p.categoria_id) && (!q || p.nombre.toLowerCase().includes(q)));
  if (huerfanos.length) {
    html += `<div class="cat-group"><div class="cat-title">Sin categoría</div><div class="cat-cards">${huerfanos.map(prodCardHtml).join('')}</div></div>`;
  }
  grid.innerHTML = html || `<div class="cart-empty">No hay productos. Crea uno con "+ Nuevo".</div>`;
}
function prodCardHtml(p) {
  const vars = Store.getVariantes(p);
  const min  = p.stock_min || 0;

  // Stock por variante + total
  let total = 0;
  const filas = (vars.length ? vars : [{tamaño:'',sabor:''}]).map(v => {
    const st = Store.variantStock(p.id, v.tamaño, v.sabor);
    total += st;
    const etiqueta = esc([v.tamaño, v.sabor].filter(Boolean).join(' · ')) || '—';
    const cls = st <= 0 ? 'r' : (st < min ? 'a' : 'g');
    return `<div class="pc-var"><span class="pc-var-name">${etiqueta}</span><span class="pc-var-stock m-${cls}">${st}</span></div>`;
  }).join('');

  const totalCls = total <= 0 ? 'r' : (total < min ? 'a' : 'g');
  return `<div class="prod-card" onclick='openEditProduct("${esc(p.id)}")'>
    <div class="pc-top">
      <div class="pc-name">${esc(p.nombre)}</div>
      <div class="pc-stock-total m-${totalCls}" title="Stock total (suma de variantes)">${total}<span>uds</span></div>
    </div>
    <div class="pc-meta">${esc(p.presentacion)} · ${fmt(p.precio)}</div>
    <div class="pc-vars">${filas}</div>
  </div>`;
}
function catStyle(id) {
  let h = 0; for (let i=0;i<id.length;i++) h=(h*31+id.charCodeAt(i))&0xFFFF;
  const palette = ['#F59E0B','#3FB950','#F85149','#BC8CFF','#00E5CC','#38BDF8','#FB923C','#F472B6','#818CF8','#10B981'];
  const c = palette[h % palette.length];
  // Toda la barra de color: fondo translúcido del color + texto en el color sólido
  return `background:${c}22;color:${c};border-left:none`;
}

function openNewProduct() {
  $('fpId').value = '';
  $('modalProdTitle').textContent = 'Nuevo producto';
  initCatSearch();
  poblarCatSelect($('fpCat'), '');
  $('fpNombre').value = '';
  $('fpPresentacion').value = 'unidad';
  $('fpPrecio').value = ''; $('fpCosto').value = ''; $('fpMinStock').value = '0';
  $('varRows').innerHTML = ''; addVarRow();
  $('btnDeleteProd').style.display = 'none';   // producto nuevo: no hay nada que eliminar
  openModal('modalProducto');
}
function openEditProduct(id) {
  const p = Store.getProducto(id); if (!p) return;
  $('fpId').value = p.id;
  $('modalProdTitle').textContent = 'Editar producto';
  $('btnDeleteProd').style.display = '';       // editar: permitir eliminar
  initCatSearch();
  poblarCatSelect($('fpCat'), p.categoria_id);
  $('fpNombre').value = p.nombre;
  $('fpPresentacion').value = p.presentacion || 'unidad';
  $('fpPrecio').value = p.precio; $('fpCosto').value = p.costo; $('fpMinStock').value = p.stock_min;
  $('varRows').innerHTML = '';
  const vars = Store.getVariantes(p);
  if (vars.length) vars.forEach(addVarRow); else addVarRow();
  openModal('modalProducto');
}
// Fila de variante: tamaño · sabor · código · multiplicador · precio · costo
function addVarRow(v = {}) {
  const div = document.createElement('div');
  div.className = 'var-row';
  div.innerHTML =
    `<input class="form-input vr-tam"   placeholder="2L"     value="${esc(v.tamaño)}">
     <input class="form-input vr-sab"   placeholder="Cola"   value="${esc(v.sabor)}">
     <input class="form-input vr-code"  placeholder="Código" value="${esc(v.code)}">
     <input class="form-input vr-mult"  type="number" min="1" value="${v.multiplier||1}">
     <input class="form-input vr-precio" type="number" min="0" step="0.50" placeholder="base" value="${v.precio!=null&&v.precio!==''?v.precio:''}">
     <input class="form-input vr-costo"  type="number" min="0" step="0.50" placeholder="base" value="${v.costo!=null&&v.costo!==''?v.costo:''}">
     <button class="bc-del" onclick="this.parentElement.remove()">✕</button>`;
  $('varRows').appendChild(div);
}
async function saveProduct() {
  const nombre = $('fpNombre').value.trim();
  if (!nombre) { toast('El nombre es obligatorio', 'error'); return; }
  if (!$('fpCat').value) { toast('Selecciona una categoría de la lista', 'error'); return; }
  const precio = parseFloat($('fpPrecio').value) || 0;
  if (precio <= 0) { toast('Precio base inválido', 'error'); return; }

  const num = s => { const n = parseFloat(s); return isNaN(n) ? null : n; };
  const variantes = [...document.querySelectorAll('.var-row')].map(r => ({
    tamaño:     r.querySelector('.vr-tam').value.trim(),
    sabor:      r.querySelector('.vr-sab').value.trim(),
    code:       r.querySelector('.vr-code').value.trim(),
    multiplier: parseInt(r.querySelector('.vr-mult').value) || 1,
    precio:     num(r.querySelector('.vr-precio').value),
    costo:      num(r.querySelector('.vr-costo').value)
  })).filter(v => v.tamaño || v.sabor || v.code);

  // Avisar de códigos duplicados dentro del producto
  const codes = variantes.map(v=>v.code).filter(Boolean);
  if (new Set(codes).size !== codes.length) { toast('Hay códigos de barras repetidos', 'error'); return; }

  const esEdicion = !!$('fpId').value;
  const id = $('fpId').value || nuevoProductoId();
  // …y duplicados contra OTROS productos (rompería el escaneo)
  for (const code of codes) {
    const hit = Store.buscarPorBarcode(code);
    if (hit && hit.producto.id !== id) {
      toast(`El código ${code} ya lo usa "${hit.producto.nombre}"`, 'error'); return;
    }
  }

  if (!await confirmar({ titulo: esEdicion?'Guardar cambios':'Crear producto', mensaje:`¿Guardar el producto "${nombre}"?`, ok:'Guardar' })) return;
  const p = {
    id, categoria_id: $('fpCat').value,
    nombre,
    presentacion: $('fpPresentacion').value,
    precio, costo: parseFloat($('fpCosto').value) || 0,
    stock_min: parseFloat($('fpMinStock').value) || 0, variantes
  };
  showOverlay('Guardando…');
  await Sheets.saveProducto(p).catch(()=>{});
  // Reflejar en caché
  const idx = Store.productos.findIndex(x => x.id === id);
  if (idx >= 0) Store.productos[idx] = p; else Store.productos.push(p);
  hideOverlay();
  closeModal('modalProducto');
  toast('✓ Producto guardado', 'success');
  renderProducts($('prodSearch').value);
}
async function deleteProduct(id) {
  const p = Store.getProducto(id); if (!p) return;
  const stockRest = Store.lotes
    .filter(l => l.producto_id === id)
    .reduce((s, l) => s + (l.qty_restante || 0), 0);
  const aviso = stockRest > 0 ? `\n⚠ Aún tiene ${stockRest} u en stock (sus lotes quedarán huérfanos en la hoja Lotes).` : '';
  if (!await confirmar({ titulo:'Eliminar producto', mensaje:`¿Eliminar "${p.nombre}"? No se puede deshacer.${aviso}`, ok:'Eliminar', peligro:true })) return;
  showOverlay('Eliminando…');
  await Sheets.deleteProducto(id).catch(()=>{});
  Store.productos = Store.productos.filter(x => x.id !== id);
  hideOverlay(); toast('🗑 Eliminado', 'success');
  renderProducts($('prodSearch').value);
}

// ═══════════════════════════════════════════════════════
//  CATEGORÍAS
// ═══════════════════════════════════════════════════════
function renderCategorias() {
  const body = $('catBody');
  const cats = Store.categoriasOrdenadas();
  if (!cats.length) { body.innerHTML = `<tr><td colspan="4" class="empty-cell">Sin categorías</td></tr>`; return; }
  body.innerHTML = cats.map(c => {
    const n = Store.productosDeCategoria(c.id).length;
    return `<tr>
      <td>${c.orden}</td>
      <td style="font-weight:600">${esc(c.nombre)}</td>
      <td>${n}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick='openEditCategoria("${esc(c.id)}")'>✏</button>
        <button class="btn btn-ghost btn-sm" onclick='deleteCategoria("${esc(c.id)}")'>🗑</button>
      </td></tr>`;
  }).join('');
}
function openNewCategoria() {
  $('fcId').value = ''; $('modalCatTitle').textContent = 'Nueva categoría';
  $('fcNombre').value = ''; $('fcOrden').value = Store.categorias.length + 1;
  openModal('modalCategoria');
}
function openEditCategoria(id) {
  const c = Store.categorias.find(x=>x.id===id); if (!c) return;
  $('fcId').value = c.id; $('modalCatTitle').textContent = 'Editar categoría';
  $('fcNombre').value = c.nombre; $('fcOrden').value = c.orden;
  openModal('modalCategoria');
}
async function saveCategoria() {
  const nombre = $('fcNombre').value.trim();
  if (!nombre) { toast('Nombre obligatorio', 'error'); return; }
  const esEdicion = !!$('fcId').value;
  if (!await confirmar({ titulo: esEdicion?'Guardar cambios':'Crear categoría', mensaje:`¿Guardar la categoría "${nombre}"?`, ok:'Guardar' })) return;
  const id = $('fcId').value || nuevaCategoriaId();
  const c = { id, nombre, orden: parseInt($('fcOrden').value) || 0 };
  showOverlay('Guardando…');
  await Sheets.saveCategoria(c).catch(()=>{});
  const idx = Store.categorias.findIndex(x=>x.id===id);
  if (idx>=0) Store.categorias[idx]=c; else Store.categorias.push(c);
  hideOverlay(); closeModal('modalCategoria'); toast('✓ Categoría guardada','success');
  renderCategorias();
}
async function deleteCategoria(id) {
  const c = Store.categorias.find(x=>x.id===id); if (!c) return;
  const n = Store.productosDeCategoria(id).length;
  if (n > 0) { toast(`Tiene ${n} productos — reasígnalos primero`, 'error'); return; }
  if (!await confirmar({ titulo:'Eliminar categoría', mensaje:`¿Eliminar la categoría "${c.nombre}"?`, ok:'Eliminar', peligro:true })) return;
  showOverlay('Eliminando…');
  await Sheets.deleteCategoria(id).catch(()=>{});
  Store.categorias = Store.categorias.filter(x=>x.id!==id);
  hideOverlay(); toast('🗑 Eliminada','success'); renderCategorias();
}

// ═══════════════════════════════════════════════════════
//  INVENTARIO
// ═══════════════════════════════════════════════════════
// Una fila de inventario por cada variante declarada del producto.
// Si el producto no tiene variantes, una fila vacía (tamaño/sabor en blanco).
function todasLasVariantes() {
  const out = [];
  for (const p of Store.productos) {
    const vars = Store.getVariantes(p);
    if (vars.length) vars.forEach(v => out.push({ producto: p, tamaño: v.tamaño||'', sabor: v.sabor||'', code: v.code||'' }));
    else out.push({ producto: p, tamaño: '', sabor: '', code: '' });
  }
  return out;
}
// Panel "Por vencer" en la vista de Inventario
function renderVencerPanel() {
  const panel = $('invVencerPanel'); if (!panel) return;
  const lista = lotesPorVencer();
  if (!lista.length) { panel.style.display = 'none'; return; }
  panel.style.display = '';
  panel.classList.add('collapsed');   // retraído por defecto en cada render
  $('vencerCount').textContent = `${lista.length} lote${lista.length>1?'s':''}`;
  $('vencerList').innerHTML = lista.map(({lote, prod, dias}) => {
    const variante = esc([lote.tamaño, lote.sabor].filter(Boolean).join(' · '));
    const urgente = dias < 0;       // ya vencido
    return `<div class="vencer-item ${urgente?'vencido':''}"
       onclick='verLotes("${esc(lote.producto_id)}", ${esc(JSON.stringify(lote.tamaño||''))}, ${esc(JSON.stringify(lote.sabor||''))})'
       title="Ver lotes">
      <span class="vi-prod">${prod?esc(prod.nombre):'?'}${variante?` · ${variante}`:''}</span>
      <span class="vi-qty">${lote.qty_restante} u</span>
      <span class="vi-fecha">${fmtDate(lote.vencimiento)}</span>
      <span class="vi-dias ${urgente?'m-r':'m-a'}">${textoVence(dias)}</span>
    </div>`;
  }).join('');
}

function renderInventory(filter='') {
  renderVencerPanel();
  const body = $('invBody');
  const q = (filter||'').toLowerCase().trim();
  let vars = todasLasVariantes();
  if (q) vars = vars.filter(v => v.producto.nombre.toLowerCase().includes(q) || Store.categoriaNombre(v.producto.categoria_id).toLowerCase().includes(q));
  if (!vars.length) { body.innerHTML = `<tr><td colspan="8" class="empty-cell">Sin productos</td></tr>`; return; }
  body.innerHTML = vars.map(v => {
    const stock = Store.variantStock(v.producto.id, v.tamaño, v.sabor);
    const min = v.producto.stock_min || 0;
    let estado = '<span class="badge ok">OK</span>';
    if (stock <= 0) estado = '<span class="badge red">Agotado</span>';
    else if (stock < min) estado = '<span class="badge warn">Stock bajo</span>';
    // vencimiento más próximo
    const lots = Store.lotesActivos(v.producto.id, v.tamaño, v.sabor);
    let venceTxt = '—';
    if (lots.length) {
      const prox = lots.map(l=>l.vencimiento).filter(Boolean).sort()[0];
      if (prox) {
        const d = daysToExpiry(prox);
        venceTxt = `<span class="${d!=null && d<=EXPIRY_WARN_DAYS?'exp-warn':''}">${fmtDate(prox)}</span>`;
      }
    }
    const nLotes = lots.length;
    return `<tr class="inv-row" onclick='verLotes("${esc(v.producto.id)}", ${esc(JSON.stringify(v.tamaño||''))}, ${esc(JSON.stringify(v.sabor||''))})' title="Ver lotes FIFO">
      <td>${esc(v.producto.nombre)}</td>
      <td>${esc(Store.categoriaNombre(v.producto.categoria_id))}</td>
      <td>${esc(v.tamaño)||'—'}</td><td>${esc(v.sabor)||'—'}</td>
      <td style="font-weight:700">${stock} ${nLotes?`<span class="inv-lotes-tag">${nLotes} lote${nLotes>1?'s':''}</span>`:''}</td><td>${min}</td>
      <td>${estado}</td><td>${venceTxt}</td>
    </tr>`;
  }).join('');
}

// ── Modal: lotes FIFO de una variante ─────────────────
function verLotes(prodId, tam, sab) {
  const p = Store.getProducto(prodId); if (!p) return;
  const variante = [tam, sab].filter(Boolean).join(' · ') || '—';
  $('lotesTitulo').textContent = `${p.nombre} · ${variante}`;
  // Todos los lotes de la variante, ordenados FIFO (más antiguo primero)
  const lotsAll = Store.lotesDeVariante(prodId, tam, sab);
  let lots = lotsAll;
  // Filtro por rango de fecha de compra (inputs del modal; vacíos = sin filtro)
  const fDesde = $('lotesFDesde').value, fHasta = $('lotesFHasta').value;
  const filtrado = fDesde || fHasta;
  if (filtrado) {
    lots = lots.filter(l => {
      const f = l.fecha_compra ? fechaLocalISO(l.fecha_compra) : '';
      return (!fDesde || f >= fDesde) && (!fHasta || f <= fHasta);
    });
  }
  const stockTotal = lots.filter(l=>l.qty_restante>0).reduce((s,l)=>s+l.qty_restante,0);
  $('lotesResumen').innerHTML = `Stock total: <b>${stockTotal}</b> · ${lots.length} lote${lots.length!==1?'s':''}${filtrado?' (filtrado)':''}`;

  if (!lots.length) {
    $('lotesBody').innerHTML = `<tr><td colspan="8" class="empty-cell">${filtrado?'Sin lotes en ese rango de fechas.':'Sin lotes. Usa "+ Entrada / Ajuste".'}</td></tr>`;
  } else {
    $('lotesBody').innerHTML = lots.map(l => {
      const i = lotsAll.indexOf(l);
      const agotado = (l.qty_restante||0) <= 0;
      const dVence  = daysToExpiry(l.vencimiento);
      const venceCls = dVence!=null && dVence<=EXPIRY_WARN_DAYS ? 'exp-warn' : '';
      const valor = (l.qty_restante||0) * (l.costo_u||0);
      return `<tr class="${agotado?'lote-agotado':''}">
        <td>${i+1}º</td>
        <td>${fmtDate(l.fecha_compra)}</td>
        <td>${fmt(l.costo_u||0)}</td>
        <td><b>${l.qty_restante||0}</b> / ${l.qty_inicial||0}</td>
        <td>${fmt(valor)}</td>
        <td class="${venceCls}">${l.vencimiento?fmtDate(l.vencimiento):'—'}</td>
        <td class="mono" style="font-size:.72rem">${esc(l.notas)}</td>
        <td class="lote-acciones">
          <button class="btn btn-ghost btn-sm" onclick='editarLote("${esc(l.id)}")' title="Editar lote">✏</button>
          <button class="btn btn-ghost btn-sm" onclick='borrarLote("${esc(l.id)}")' title="Eliminar lote">🗑</button>
        </td>
      </tr>`;
    }).join('');
  }
  // Recordar la variante abierta para refrescar tras editar/borrar
  _lotesCtx = { prodId, tam, sab };
  openModal('modalLotes');
}
let _lotesCtx = null;
function refrescarLotesModal() {
  if (_lotesCtx) verLotes(_lotesCtx.prodId, _lotesCtx.tam, _lotesCtx.sab);
}
function limpiarFiltroLotes() {
  $('lotesFDesde').value = '';
  $('lotesFHasta').value = '';
  refrescarLotesModal();
}

// ── Editar un lote (todos los campos) ─────────────────
const _isoADate = iso => iso ? fechaLocalISO(iso) : '';
function editarLote(lotId) {
  const l = Store.lotes.find(x => x.id === lotId); if (!l) return;
  const p = Store.getProducto(l.producto_id);
  const variante = [l.tamaño, l.sabor].filter(Boolean).join(' · ') || '—';
  $('elId').value = l.id;
  $('elProdInfo').innerHTML = `<b>${p?esc(p.nombre):'?'}</b> · ${esc(variante)} <span class="mono">(${esc(l.id)})</span>`;
  $('elQtyRest').value = l.qty_restante || 0;
  $('elQtyIni').value  = l.qty_inicial  || 0;
  $('elCosto').value   = l.costo_u      || 0;
  $('elFecha').value   = _isoADate(l.fecha_compra);
  $('elVence').value   = _isoADate(l.vencimiento);
  $('elNotas').value   = l.notas || '';
  openModal('modalEditLote');
}
async function guardarEditLote() {
  const l = Store.lotes.find(x => x.id === $('elId').value); if (!l) return;
  const qr = parseInt($('elQtyRest').value); const qi = parseInt($('elQtyIni').value);
  const co = parseFloat($('elCosto').value); const fe = $('elFecha').value;
  if (isNaN(qr) || qr < 0) { toast('Qty restante inválida', 'error'); return; }
  if (!fe) { toast('Fecha de compra obligatoria', 'error'); return; }
  if (!await confirmar({ titulo:'Guardar cambios', mensaje:'¿Guardar los cambios de este lote?', ok:'Guardar' })) return;
  // Actualizar el objeto del lote en caché
  l.qty_restante = qr;
  l.qty_inicial  = isNaN(qi) ? l.qty_inicial : qi;
  l.costo_u      = isNaN(co) ? l.costo_u : co;
  // Recalcular costo total del lote a partir de qty inicial × costo/u
  l.costo_total  = Math.round((l.qty_inicial || 0) * (l.costo_u || 0) * 100) / 100;
  l.fecha_compra = new Date(fe + 'T12:00:00').toISOString();
  l.vencimiento  = $('elVence').value ? new Date($('elVence').value + 'T12:00:00').toISOString() : '';
  l.notas        = $('elNotas').value.trim();
  showOverlay('Guardando lote…');
  await Sheets.editLote(l).catch(()=>{});
  hideOverlay(); closeModal('modalEditLote'); toast('✓ Lote actualizado', 'success');
  refrescarLotesModal();
  renderInventory($('invSearch').value);
}
async function borrarLote(lotId) {
  const l = Store.lotes.find(x => x.id === lotId); if (!l) return;
  if (!await confirmar({ titulo:'Eliminar lote', mensaje:`Qty restante: ${l.qty_restante} · Costo: ${fmt(l.costo_u)}.\nNo se puede deshacer.`, ok:'Eliminar', peligro:true })) return;
  showOverlay('Eliminando lote…');
  await Sheets.deleteLote(lotId).catch(()=>{});
  Store.lotes = Store.lotes.filter(x => x.id !== lotId);
  hideOverlay(); toast('🗑 Lote eliminado', 'success');
  refrescarLotesModal();
  renderInventory($('invSearch').value);
}

function openStockAdj() {
  if (!Store.productos.length) { toast('Crea un producto primero', 'error'); return; }
  const fillTam = () => {
    const p = Store.getProducto($('adjProd').value);
    const tams = Store.tamañosDe(p);
    $('adjTamaño').innerHTML = (tams.length?tams:['']).map(v=>`<option value="${esc(v)}">${esc(v)||'—'}</option>`).join('');
    fillSab();
  };
  const fillSab = () => {
    const p = Store.getProducto($('adjProd').value);
    const sabs = Store.saboresDe(p, $('adjTamaño').value);
    $('adjSabor').innerHTML = (sabs.length?sabs:['']).map(v=>`<option value="${esc(v)}">${esc(v)||'—'}</option>`).join('');
  };
  // Buscador de producto con autocompletado; al elegir, recarga tamaños/sabores
  const prodSearch = makeSearchSelect({
    searchId: 'adjProdSearch', hiddenId: 'adjProd', listId: 'adjProdList',
    items: () => Store.productos.map(p => ({ id: p.id, nombre: p.nombre })),
    onPick: fillTam
  });
  prodSearch.set(Store.productos[0].id);   // preselecciona el primero, como antes
  $('adjTamaño').onchange = fillSab;
  fillTam();
  $('adjCantidad').value=''; $('adjCostoTotal').value=''; $('adjCosto').value='';
  $('adjFecha').value = fechaLocalISO();
  $('adjVencimiento').value=''; $('adjNotas').value='';
  openModal('modalStock');
}
function recalcCostoUnit() {
  const total = parseFloat($('adjCostoTotal').value)||0;
  const cant  = parseFloat($('adjCantidad').value)||0;
  $('adjCosto').value = cant>0 ? calcCostoUnitario(total, cant) : '';
}
async function saveStockAdj() {
  const p = Store.getProducto($('adjProd').value);
  if (!p) { toast('Selecciona un producto de la lista', 'error'); return; }
  const cant = parseInt($('adjCantidad').value)||0;
  const total = parseFloat($('adjCostoTotal').value)||0;
  if (cant<=0) { toast('Cantidad inválida','error'); return; }
  const costoU = calcCostoUnitario(total, cant);
  const fecha = $('adjFecha').value;
  if (!fecha) { toast('Fecha obligatoria','error'); return; }
  const variante = [$('adjTamaño').value, $('adjSabor').value].filter(Boolean).join(' · ');
  const avisoCosto = costoU <= 0 ? '\n⚠ Costo 0: la ganancia de estas unidades se calculará sin costo.' : '';
  if (!await confirmar({ titulo:'Registrar entrada', mensaje:`Agregar lote de ${cant} u a "${p.nombre}${variante?` · ${variante}`:''}" (costo ${fmt(costoU)}/u).${avisoCosto}`, ok:'Guardar' })) return;
  const lote = {
    id: nuevoLoteId(), producto_id: p.id,
    tamaño: $('adjTamaño').value, sabor: $('adjSabor').value,
    fecha_compra: new Date(fecha+'T12:00:00').toISOString(),
    costo_u: costoU, costo_total: Math.round(total*100)/100, qty_inicial: cant, qty_restante: cant,
    vencimiento: $('adjVencimiento').value ? new Date($('adjVencimiento').value+'T12:00:00').toISOString() : '',
    notas: $('adjNotas').value.trim()
  };
  showOverlay('Guardando lote…');
  await Sheets.addLote(lote).catch(()=>{});
  Sheets.addMovimiento({ fecha: lote.fecha_compra, producto_id: p.id, tamaño: lote.tamaño, sabor: lote.sabor, tipo:'entrada', qty: cant, costo: costoU, usuario: localStorage.getItem('pos_user')||'' }).catch(()=>{});
  Store.lotes.push(lote);
  hideOverlay(); closeModal('modalStock'); toast('✓ Lote agregado','success');
  renderInventory($('invSearch').value);
}

// ═══════════════════════════════════════════════════════
//  VENTAS
// ═══════════════════════════════════════════════════════
const _salesCache = {};
async function renderSales(dateStr='') {
  if (!dateStr) dateStr = fechaLocalISO();
  setStatus('loading','Leyendo ventas…');
  let ventas;
  try { ventas = await Sheets.loadVentasRango(dateStr, dateStr); setStatus('ok','Base de datos'); }
  catch (e) { setStatus('error','Error'); toast(e.message,'error'); return; }

  let totalDia=0, cash=0, cashN=0, qr=0, qrN=0;
  const body = $('salesBody');
  Object.keys(_salesCache).forEach(k => delete _salesCache[k]);  // sin restos del día anterior
  body.innerHTML = ventas.map((v,i) => {
    _salesCache[i] = v;
    totalDia += v.total;
    const { efectivo, qr: vqr } = desglosePago(v);
    if (efectivo > 0) { cash += efectivo; cashN++; }
    if (vqr > 0)      { qr   += vqr;      qrN++; }
    const nItems = (v.items||[]).reduce((s,it)=>s+(it.qty||0),0);
    return `<tr>
      <td class="mono">${esc(v.id)}</td><td>${esc(v.hora)}</td>
      <td>${fmtN(v.total)}</td><td>${fmtN(v.ganancia)}</td>
      <td>${esc(v.metodo)}</td><td>${nItems}</td>
      <td><button class="btn btn-ghost btn-sm btn-del-venta" data-i="${i}">🗑</button></td>
    </tr>`;
  }).join('') || `<tr><td colspan="7" class="empty-cell">Sin ventas este día</td></tr>`;

  $('vTotalDia').textContent = fmt(totalDia);
  $('vCountDia').textContent = `${ventas.length} ventas`;
  $('vCashTotal').textContent = fmt(cash); $('vCashCount').textContent = `${cashN} op.`;
  $('vQrTotal').textContent = fmt(qr); $('vQrCount').textContent = `${qrN} op.`;
}

// ═══════════════════════════════════════════════════════
//  ESTADÍSTICAS (§9)
// ═══════════════════════════════════════════════════════
function preajusteRango(gran) {
  const hoy = new Date();
  let desde, hasta;
  if (gran === 'dia') { desde = hasta = hoy; }
  else if (gran === 'semana') { desde = startOfWeek(hoy); hasta = new Date(desde); hasta.setDate(hasta.getDate()+6); }
  else { desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1); hasta = new Date(hoy.getFullYear(), hoy.getMonth()+1, 0); }
  $('statDesde').value = fechaLocalISO(desde);
  $('statHasta').value = fechaLocalISO(hasta);
}
async function aplicarStats() {
  const desde = $('statDesde').value, hasta = $('statHasta').value;
  if (!desde || !hasta) { preajusteRango(statGran); return aplicarStats(); }
  setStatus('loading','Calculando…');
  let ventas;
  try { ventas = await Sheets.loadVentasRango(desde, hasta); setStatus('ok','Base de datos'); }
  catch (e) { setStatus('error','Error'); toast(e.message,'error'); return; }

  const stats = Store.calcStats(ventas);
  $('stRevenue').textContent = fmt(stats.revenue);
  $('stCount').textContent   = `${stats.salesCount} ventas`;
  $('stCogs').textContent    = fmt(stats.cogs);
  $('stProfit').textContent  = fmt(stats.profit);
  $('stMargin').textContent  = `Margen: ${stats.margin.toFixed(1)}%`;
  $('stUnits').textContent   = stats.units;

  // Desglose efectivo / QR (cuenta el mixto por su parte real)
  let efectivo=0, efN=0, qr=0, qrN=0;
  for (const v of ventas) {
    const d = desglosePago(v);
    if (d.efectivo > 0) { efectivo += d.efectivo; efN++; }
    if (d.qr > 0)       { qr       += d.qr;       qrN++; }
  }
  $('stEfectivo').textContent  = fmt(efectivo);
  $('stEfectivoN').textContent = `${efN} op.`;
  $('stQr').textContent        = fmt(qr);
  $('stQrN').textContent       = `${qrN} op.`;

  // Agrupar por período (incluye desglose efectivo/QR por bucket)
  const buckets = {};
  for (const v of ventas) {
    const k = bucketKey(v.fecha, statGran);
    if (!buckets[k]) buckets[k] = { ventas:0, units:0, revenue:0, cogs:0, efectivo:0, qr:0 };
    buckets[k].ventas++;
    buckets[k].revenue += v.total; buckets[k].cogs += v.cogs;
    buckets[k].units += (v.items||[]).reduce((s,it)=>s+(it.units||0),0);
    const d = desglosePago(v);
    buckets[k].efectivo += d.efectivo; buckets[k].qr += d.qr;
  }
  const rows = Object.keys(buckets).sort().map(k => {
    const b = buckets[k];
    return `<tr><td class="mono">${k}</td><td>${b.ventas}</td><td>${b.units}</td>
      <td>${fmtN(b.revenue)}</td><td>${fmtN(b.cogs)}</td><td>${fmtN(b.revenue-b.cogs)}</td>
      <td class="m-g">${fmtN(b.efectivo)}</td><td style="color:var(--blue)">${fmtN(b.qr)}</td></tr>`;
  }).join('');
  $('stPeriodBody').innerHTML = rows || `<tr><td colspan="8" class="empty-cell">Sin datos en el rango</td></tr>`;

  // Top productos
  $('stTopBody').innerHTML = stats.top.slice(0,30).map(p => {
    const mc = p.margin>=30?'g':p.margin>=15?'a':'r';
    return `<tr><td>${p.nombre}</td><td>${p.tamaño||'—'}</td><td>${p.sabor||'—'}</td>
      <td>${p.units}</td><td>${fmtN(p.revenue)}</td><td>${fmtN(p.profit)}</td>
      <td class="m-${mc}">${p.margin.toFixed(0)}%</td></tr>`;
  }).join('') || `<tr><td colspan="7" class="empty-cell">Sin datos</td></tr>`;
}
function initStats() {
  document.querySelectorAll('#statGran .seg-btn').forEach(b => b.addEventListener('click', () => {
    statGran = b.dataset.g;
    document.querySelectorAll('#statGran .seg-btn').forEach(x=>x.classList.toggle('active', x===b));
    preajusteRango(statGran);
    aplicarStats();
  }));
  $('btnStatFilter').addEventListener('click', aplicarStats);
  $('btnStatPrint').addEventListener('click', () => window.print());
  preajusteRango('dia');
}

// ═══════════════════════════════════════════════════════
//  LOGIN (§8-bis)
// ═══════════════════════════════════════════════════════
function showUserChip() {
  const nombre = localStorage.getItem('pos_nombre') || '';
  const rol = localStorage.getItem('pos_rol') || '';
  $('userChip').style.display = 'flex';
  $('userName').textContent = nombre;
  $('userRole').textContent = rol;
}
async function logout() {
  const nombre = localStorage.getItem('pos_nombre') || '';
  if (!await confirmar({ titulo:'Cerrar sesión', mensaje:`¿Cerrar la sesión de ${nombre || 'este usuario'}?`, ok:'Cerrar sesión', peligro:true })) return;
  ['pos_user','pos_rol','pos_nombre'].forEach(k=>localStorage.removeItem(k));
  location.reload();
}
function setupLoginScreen() {
  $('loginScreen').style.display = 'flex';
  const u = $('loginUser'), p = $('loginPass'), err = $('loginError');
  function doLogin() {
    const cuentas = (typeof CUENTAS !== 'undefined') ? CUENTAS : [];
    const c = cuentas.find(x => x.user === u.value.trim() && x.pass === p.value);
    if (c) {
      localStorage.setItem('pos_user', c.user);
      localStorage.setItem('pos_rol', c.rol);
      localStorage.setItem('pos_nombre', c.nombre);
      location.reload();
    } else {
      err.textContent = 'Usuario o contraseña incorrectos.';
      p.value=''; p.focus();
    }
  }
  $('btnLogin').addEventListener('click', doLogin);
  p.addEventListener('keydown', e => { if (e.key==='Enter') doLogin(); });
  u.addEventListener('keydown', e => { if (e.key==='Enter') p.focus(); });
}

// ═══════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════
async function init() {
  if (!localStorage.getItem('pos_user')) { setupLoginScreen(); return; }

  showUserChip();
  $('btnLogout').addEventListener('click', logout);
  initNav();
  aplicarPermisos();

  // Modales: cerrar con [data-close] y overlay. Al cerrar el escáner, apagar la cámara.
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => {
    closeModal(b.dataset.close);
    if (b.dataset.close === 'modalScanner') closeScanner();
  }));
  document.querySelectorAll('.modal-overlay').forEach(o => o.addEventListener('click', e => {
    if (e.target!==o) return;
    if (o.id === 'modalConfirm') { _confCerrar(false); return; }  // cerrar = cancelar, resuelve la Promise
    o.classList.remove('open');
    if (o.id === 'modalScanner') closeScanner();
  }));

  // Modal de confirmación reutilizable
  $('confSi').addEventListener('click', () => _confCerrar(true));
  $('confNo').addEventListener('click', () => _confCerrar(false));

  // Escape cierra el modal abierto (Confirmar = cancelar; escáner apaga cámara)
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const abiertos = document.querySelectorAll('.modal-overlay.open');
    if (!abiertos.length) return;
    const o = abiertos[abiertos.length - 1];
    if (o.id === 'modalConfirm') { _confCerrar(false); return; }
    o.classList.remove('open');
    if (o.id === 'modalScanner') closeScanner();
  });

  initScan(); initPayment(); initStats();
  $('btnAddVariante').addEventListener('click', confirmVariante);
  $('btnDiscOk').addEventListener('click', aplicarDiscount);
  $('btnDiscReset').addEventListener('click', quitarDiscount);
  $('discInput').addEventListener('input', _discUpdateMargen);
  $('discInput').addEventListener('keydown', e => { if (e.key==='Enter') aplicarDiscount(); });
  $('btnNuevoProd').addEventListener('click', openNewProduct);
  $('btnSaveProd').addEventListener('click', saveProduct);
  $('btnDeleteProd').addEventListener('click', async () => {
    const id = $('fpId').value; if (!id) return;
    await deleteProduct(id);                 // confirma internamente
    if (!Store.getProducto(id)) closeModal('modalProducto');  // se borró → cerrar
  });
  $('btnAddVar').addEventListener('click', () => addVarRow());
  $('btnNuevaCat').addEventListener('click', openNewCategoria);
  $('btnSaveCat').addEventListener('click', saveCategoria);
  $('btnEntradaStock').addEventListener('click', openStockAdj);
  $('btnLotesEntrada').addEventListener('click', () => { closeModal('modalLotes'); openStockAdj(); });
  $('btnSaveEditLote').addEventListener('click', guardarEditLote);
  $('btnCalcUnit').addEventListener('click', recalcCostoUnit);
  $('btnSaveAdj').addEventListener('click', saveStockAdj);
  $('btnRefreshInv').addEventListener('click', () => recargar(true));
  $('btnLotesPDF').addEventListener('click', () => { try { POSPdf.exportLotes(); } catch(err){ toast('Error al generar PDF','error'); console.error(err);} });
  $('btnVentasPDF').addEventListener('click', async () => { try { showOverlay('Generando PDF…'); await POSPdf.exportVentas($('ventasFecha').value); } catch(err){ toast('Error al generar PDF','error'); console.error(err);} finally { hideOverlay(); } });
  $('btnPrintTicket').addEventListener('click', () => window.print());
  $('prodSearch').addEventListener('input', e => renderProducts(e.target.value));
  $('invSearch').addEventListener('input', e => renderInventory(e.target.value));

  // Ventas: fecha hoy
  $('ventasFecha').value = fechaLocalISO();
  $('ventasFecha').addEventListener('change', e => renderSales(e.target.value));
  $('salesBody').addEventListener('click', async e => {
    const btn = e.target.closest('.btn-del-venta'); if (!btn) return;
    const v = _salesCache[btn.dataset.i]; if (!v?.id) return;
    if (!await confirmar({ titulo:'Eliminar venta', mensaje:`Venta ${v.id} · Total ${fmt(v.total)}.\nNo se puede deshacer.`, ok:'Eliminar', peligro:true })) return;
    showOverlay('Eliminando…');
    await Sheets.deleteVenta(v.id).catch(()=>{});
    hideOverlay(); toast('🗑 Venta eliminada','success');
    renderSales($('ventasFecha').value);
  });

  // Banner de vencimientos
  $('expiryBannerGo').addEventListener('click', () => { $('expiryBanner').style.display='none'; irAVista('inventario'); });
  $('expiryBannerX').addEventListener('click', () => { $('expiryBanner').style.display='none'; });
  // Panel "por vencer": colapsar/expandir
  $('vencerHead').addEventListener('click', () => $('invVencerPanel').classList.toggle('collapsed'));

  renderCart(); tickClock(); setInterval(tickClock, 1000);

  // Carga inicial desde Sheets
  await recargar(false);
}

async function recargar(notify) {
  if (!Sheets.isConfigured()) {
    setStatus('error','config.js sin configurar');
    toast('Configura config.js (SHEETS_ID y API_KEY)','error');
    return;
  }
  setStatus('loading','Cargando…');
  try {
    await Sheets.loadAll(msg => setStatus('loading', msg));
    setStatus('ok','Base de datos');
    if (notify) toast('✓ Datos actualizados','success');
    // Re-render de la vista activa
    irAVista(vistaActual());
    avisarVencimientos();   // banner si hay lotes por vencer
  } catch (e) {
    setStatus('error','Error');
    toast('Error al cargar: ' + e.message, 'error');
  }
}

// Banner de aviso al cargar datos: cuántos lotes vencen/vencieron
function avisarVencimientos() {
  const banner = $('expiryBanner'); if (!banner) return;
  const lista = lotesPorVencer();
  if (!lista.length) { banner.style.display = 'none'; return; }
  const vencidos = lista.filter(x => x.dias < 0).length;
  const proximos = lista.length - vencidos;
  let txt = '⚠ ';
  if (vencidos) txt += `${vencidos} lote${vencidos>1?'s':''} VENCIDO${vencidos>1?'S':''}`;
  if (vencidos && proximos) txt += ' y ';
  if (proximos) txt += `${proximos} por vencer (≤${EXPIRY_WARN_DAYS} días)`;
  $('expiryBannerText').textContent = txt;
  banner.classList.toggle('grave', vencidos > 0);
  banner.style.display = 'flex';
}

document.addEventListener('DOMContentLoaded', init);
