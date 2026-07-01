// ═══════════════════════════════════════════════════════
//  POS Licorería v3 — Sincronización con Google Sheets
//  Lee  → API Google Sheets v4 con API Key (sin auth)
//  Escribe → Google Apps Script Web App (POST no-cors)
// ═══════════════════════════════════════════════════════

const Sheets = {

  _id()        { return (typeof SHEETS_ID       !== 'undefined' ? SHEETS_ID       : '').trim(); },
  _apiKey()    { return (typeof SHEETS_API_KEY  !== 'undefined' ? SHEETS_API_KEY  : '').trim(); },
  _scriptUrl() { return (typeof APPS_SCRIPT_URL !== 'undefined' ? APPS_SCRIPT_URL : '').trim(); },
  isConfigured() { return !!this._id() && !!this._apiKey(); },

  // ── GET (API Key) ─────────────────────────────────────
  async readSheet(sheetName, timeoutMs = 15000) {
    const id = this._id(), key = this._apiKey();
    if (!id || !key) throw new Error('Base de datos no configurada en config.js');
    const url  = `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(sheetName)}?key=${encodeURIComponent(key)}`;
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(tid);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        let msg = err?.error?.message || `Error ${res.status}`;
        if (res.status === 403) msg += ' — Habilita la Google Sheets API en Google Cloud Console.';
        throw new Error(msg);
      }
      const json = await res.json();
      return json.values || [];
    } catch (e) {
      clearTimeout(tid);
      if (e.name === 'AbortError') throw new Error(`Timeout leyendo "${sheetName}"`);
      throw e;
    }
  },

  // ── POST (no-cors, no se lee respuesta) ───────────────
  async _post(payload) {
    const url = this._scriptUrl();
    if (!url) { console.warn('[Sheets._post] APPS_SCRIPT_URL no configurada'); return; }
    // text/plain: en mode no-cors el navegador descarta application/json
    // (no es un header "safelisted"); Apps Script lee e.postData.contents igual.
    await fetch(url, {
      method:  'POST',
      mode:    'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body:    JSON.stringify(payload)
    });
  },

  // ── Helpers de parseo ─────────────────────────────────
  _val(row, n)  { return row[n] != null ? String(row[n]).trim() : ''; },
  _num(row, n)  { return parseFloat(this._val(row, n)) || 0; },
  _json(row, n, def) { try { return JSON.parse(this._val(row, n) || JSON.stringify(def)); } catch (_) { return def; } },
  _date(raw) {
    raw = (raw || '').trim();
    if (!raw) return '';
    const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // dd/MM/yyyy
    if (m) {
      const d = new Date(`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}T12:00:00`);
      return isNaN(d) ? '' : d.toISOString();
    }
    const d = new Date(raw);
    return isNaN(d) ? '' : d.toISOString();
  },

  // ════════════════════════════════════════════════════
  //  ESCRITURAS
  // ════════════════════════════════════════════════════

  // ── Categorías (upsert por id) ────────────────────────
  async saveCategoria(c) {
    await this._post({ accion: 'saveCategoria', id: c.id, nombre: c.nombre, orden: c.orden || 0 });
  },
  async deleteCategoria(id) {
    await this._post({ accion: 'deleteCategoria', id });
  },

  // ── Productos (upsert por id) ─────────────────────────
  async saveProducto(p) {
    await this._post({
      accion:       'saveProducto',
      id:           p.id,
      categoria_id: p.categoria_id,
      nombre:       p.nombre,
      presentacion: p.presentacion || 'unidad',
      precio:       p.precio    || 0,   // precio/costo base = valor por defecto de variantes
      costo:        p.costo     || 0,
      stock_min:    p.stock_min || 0,
      variantes:    JSON.stringify(p.variantes || [])
    });
  },
  async deleteProducto(id) {
    await this._post({ accion: 'deleteProducto', id });
  },

  // ── Lotes ─────────────────────────────────────────────
  async addLote(l) {
    await this._post({
      accion:        'addLote',
      id:            l.id,
      producto_id:   l.producto_id,
      tamaño:        l.tamaño || '',
      sabor:         l.sabor  || '',
      fecha_compra:  l.fecha_compra,
      costo_u:       l.costo_u || 0,
      qty_inicial:   l.qty_inicial   || 0,
      qty_restante:  l.qty_restante  || 0,
      vencimiento:   l.vencimiento   || '',
      notas:         l.notas         || '',
      costo_total:   l.costo_total   || 0
    });
  },
  async updateLote(id, qty_restante) {
    await this._post({ accion: 'updateLote', id, qty_restante });
  },
  async editLote(l) {
    await this._post({
      accion:        'editLote',
      id:            l.id,
      producto_id:   l.producto_id,
      tamaño:        l.tamaño || '',
      sabor:         l.sabor  || '',
      fecha_compra:  l.fecha_compra || '',
      costo_u:       l.costo_u || 0,
      qty_inicial:   l.qty_inicial  || 0,
      qty_restante:  l.qty_restante || 0,
      vencimiento:   l.vencimiento  || '',
      notas:         l.notas        || '',
      costo_total:   l.costo_total  || 0
    });
  },
  async deleteLote(id) {
    await this._post({ accion: 'deleteLote', id });
  },

  // ── Ventas (id lo genera el servidor) ─────────────────
  async addVenta(v) {
    await this._post({
      accion:         'addVenta',
      fecha:          v.fecha,           // ISO; el servidor formatea dd/MM/yyyy
      total:          v.total    || 0,
      cogs:           v.cogs     || 0,
      ganancia:       v.ganancia || 0,
      metodo:         v.metodo   || 'efectivo',
      monto_efectivo: v.monto_efectivo || 0,
      monto_qr:       v.monto_qr       || 0,
      items:          JSON.stringify(v.items || [])
    });
  },
  async editVenta(v) {
    await this._post({
      accion:   'editVenta',
      id:       v.id,
      fecha:    v.fecha,           // dd/MM/yyyy
      hora:     v.hora,            // HH:MM
      total:    v.total    || 0,
      cogs:     v.cogs     || 0,
      ganancia: v.ganancia || 0,
      metodo:   v.metodo   || '',
      items:    typeof v.items === 'string' ? v.items : JSON.stringify(v.items || [])
    });
  },
  async deleteVenta(id) {
    await this._post({ accion: 'deleteVenta', id });
  },

  // ── Movimientos (solo append) ─────────────────────────
  async addMovimiento(m) {
    await this._post({
      accion:      'addMovimiento',
      fecha:       m.fecha,
      producto_id: m.producto_id || '',
      tamaño:      m.tamaño || '',
      sabor:       m.sabor  || '',
      tipo:        m.tipo,
      qty:         m.qty,
      costo:       m.costo || 0,
      usuario:     m.usuario || ''
    });
  },

  // ════════════════════════════════════════════════════
  //  CARGA INICIAL
  // ════════════════════════════════════════════════════
  async loadAll(onProgress) {
    // 1. Categorías
    onProgress?.('Leyendo categorías…');
    try {
      const rows = await this.readSheet('Categorias');
      Store.categorias = rows.slice(1).filter(r => r[0]).map(r => ({
        id:     this._val(r, 0),
        nombre: this._val(r, 1),
        orden:  this._num(r, 2)
      }));
    } catch (_) { Store.categorias = []; }

    // 2. Productos
    onProgress?.('Leyendo productos…');
    const prodRows = await this.readSheet('Productos');
    // Cols: A=id B=categoria_id C=nombre D=presentacion E=precio F=costo G=stock_min H=variantes
    Store.productos = prodRows.slice(1).filter(r => r[0]).map(r => ({
      id:           this._val(r, 0),
      categoria_id: this._val(r, 1),
      nombre:       this._val(r, 2),
      presentacion: this._val(r, 3) || 'unidad',
      precio:       this._num(r, 4),
      costo:        this._num(r, 5),
      stock_min:    this._num(r, 6),
      variantes:    this._json(r, 7, [])
    }));

    // 3. Lotes (dedupe por id)
    onProgress?.('Cargando lotes FIFO…');
    try {
      const lotRows = await this.readSheet('Lotes');
      const seen = new Set();
      Store.lotes = [];
      for (const r of lotRows.slice(1).filter(r => r[0] && r[1])) {
        const id = this._val(r, 0);
        if (seen.has(id)) continue;
        seen.add(id);
        Store.lotes.push({
          id,
          producto_id:  this._val(r, 1),
          tamaño:       this._val(r, 2),
          sabor:        this._val(r, 3),
          fecha_compra: this._date(this._val(r, 4)) || new Date().toISOString(),
          costo_u:      this._num(r, 5),
          qty_inicial:  this._num(r, 6),
          qty_restante: this._num(r, 7),
          vencimiento:  this._date(this._val(r, 8)) || '',
          notas:        this._val(r, 9),
          // Col K (índice 10): costo total real del lote como se compró.
          // Lotes viejos sin este dato → qty × costo_u redondeado al múltiplo
          // de 0.50 más cercano (.00 o .50).
          costo_total:  this._num(r, 10) || Math.round(this._num(r, 6) * this._num(r, 5) * 2) / 2
        });
      }
    } catch (e) { console.warn('[loadAll] Lotes:', e); Store.lotes = []; }

    onProgress?.('¡Listo!');
  },

  // ── Ventas por rango (vista Ventas y Estadísticas) ────
  async loadVentasRango(desde, hasta) {
    let rows;
    try { rows = await this.readSheet('Ventas'); } catch (_) { return []; }
    const fromD = new Date(desde + 'T00:00:00');
    const toD   = new Date(hasta + 'T23:59:59.999');
    const out = [];
    for (const r of rows.slice(1).filter(r => r[0])) {
      const fechaIso = this._date(this._val(r, 1));
      if (!fechaIso) continue;
      const d = new Date(fechaIso);
      if (d < fromD || d > toD) continue;
      out.push({
        id:       this._val(r, 0),
        fecha:    fechaIso,
        fechaRaw: this._val(r, 1),
        hora:     this._val(r, 2),
        total:          this._num(r, 3),
        cogs:           this._num(r, 4),
        ganancia:       this._num(r, 5),
        metodo:         this._val(r, 6),
        items:          this._json(r, 7, []),
        monto_efectivo: r[8] != null && r[8] !== '' ? this._num(r, 8) : null,
        monto_qr:       r[9] != null && r[9] !== '' ? this._num(r, 9) : null
      });
    }
    return out;
  }
};
