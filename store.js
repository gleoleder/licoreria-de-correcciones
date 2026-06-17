// ═══════════════════════════════════════════════════════
//  POS Licorería v3 — Store (caché EN MEMORIA)
//  NO es una base de datos: arrays en memoria que se
//  rellenan desde Google Sheets al arrancar. Sin IndexedDB.
//  Fuente de verdad = Google Sheets.
// ═══════════════════════════════════════════════════════

// ── Generación automática de IDs (§3-bis) ──────────────
// Ningún ID se escribe a mano. Cliente genera CAT / PRD / LOT.
// La venta (VTA) la genera el Apps Script (servidor).
function genId(prefijo) {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.floor(Math.random() * 1e6).toString(36).toUpperCase();
  return `${prefijo}-${t}-${r}`;
}
const nuevaCategoriaId = () => genId('CAT');
const nuevoProductoId  = () => genId('PRD');
const nuevoLoteId      = () => genId('LOT');

// ── Clave de variante (producto + tamaño + sabor) ──────
function variantKey(prodId, tam, sab) {
  return `${prodId}|${(tam || '').trim()}|${(sab || '').trim()}`;
}

const Store = {
  categorias: [],   // [{id, nombre, orden}]
  productos:  [],   // [{id, categoria_id, nombre, presentacion, precio, costo, stock_min, variantes[]}]
                    // variantes: [{tamaño, sabor, code, multiplier, precio, costo}]
                    //   precio/costo de la variante son opcionales → si faltan, se usa el del producto.
  lotes:      [],   // [{id, producto_id, tamaño, sabor, fecha_compra, costo_u, qty_inicial, qty_restante, vencimiento, notas}]
  ventas:     [],   // cargadas por rango cuando se necesitan

  // ── Categorías ───────────────────────────────────────
  categoriaNombre(id) {
    const c = this.categorias.find(c => c.id === id);
    return c ? c.nombre : '—';
  },
  categoriasOrdenadas() {
    return [...this.categorias].sort((a, b) => (a.orden || 0) - (b.orden || 0));
  },

  // ── Productos ────────────────────────────────────────
  getProducto(id) { return this.productos.find(p => p.id === id) || null; },
  productosDeCategoria(catId) {
    return this.productos.filter(p => p.categoria_id === catId);
  },
  buscarProductos(q) {
    q = (q || '').toLowerCase().trim();
    if (!q) return [];
    return this.productos.filter(p =>
      p.nombre.toLowerCase().includes(q) ||
      this.categoriaNombre(p.categoria_id).toLowerCase().includes(q)
    ).slice(0, 12);
  },
  // Cada variante (tamaño+sabor) tiene su propio código → el escaneo
  // resuelve directamente la variante exacta, sin pedir elegir.
  buscarPorBarcode(code) {
    code = (code || '').trim();
    if (!code) return null;
    for (const p of this.productos) {
      const v = (p.variantes || []).find(x => (x.code || '').trim() === code);
      if (v) return { producto: p, variante: v };
    }
    return null;
  },

  // Lista de variantes de un producto (siempre array)
  getVariantes(p) { return (p && p.variantes) ? p.variantes : []; },

  // Resuelve datos de UNA variante por tamaño+sabor, con fallback al producto
  variantInfo(p, tam, sab) {
    const t = (tam || '').trim(), s = (sab || '').trim();
    const v = this.getVariantes(p).find(x =>
      (x.tamaño || '').trim() === t && (x.sabor || '').trim() === s) || {};
    return {
      tamaño:     t,
      sabor:      s,
      code:       v.code || '',
      multiplier: v.multiplier || 1,
      precio:     (v.precio != null && v.precio !== '') ? Number(v.precio) : (p.precio || 0),
      costo:      (v.costo  != null && v.costo  !== '') ? Number(v.costo)  : (p.costo  || 0)
    };
  },

  // Tamaños/sabores derivados de las variantes (para selects)
  tamañosDe(p) { return [...new Set(this.getVariantes(p).map(v => (v.tamaño||'').trim()))]; },
  saboresDe(p, tam) {
    const t = (tam||'').trim();
    return [...new Set(this.getVariantes(p)
      .filter(v => t === '' || (v.tamaño||'').trim() === t)
      .map(v => (v.sabor||'').trim()))];
  },

  // ── Lotes / Stock por variante ───────────────────────
  lotesDeVariante(prodId, tam, sab) {
    const t = (tam || '').trim(), s = (sab || '').trim();
    return this.lotes
      .filter(l => l.producto_id === prodId &&
                   (l.tamaño || '').trim() === t &&
                   (l.sabor  || '').trim() === s)
      .sort((a, b) => new Date(a.fecha_compra) - new Date(b.fecha_compra));
  },
  lotesActivos(prodId, tam, sab) {
    return this.lotesDeVariante(prodId, tam, sab).filter(l => (l.qty_restante || 0) > 0);
  },
  variantStock(prodId, tam, sab) {
    return this.lotesActivos(prodId, tam, sab)
      .reduce((s, l) => s + (l.qty_restante || 0), 0);
  },
  // Costo promedio ponderado de las unidades activas de una variante
  variantAvgCost(prodId, tam, sab) {
    const act = this.lotesActivos(prodId, tam, sab);
    const u   = act.reduce((s, l) => s + l.qty_restante, 0);
    const c   = act.reduce((s, l) => s + l.qty_restante * (l.costo_u || 0), 0);
    return u > 0 ? c / u : 0;
  },

  // ── Consumo FIFO ─────────────────────────────────────
  // Descuenta del lote más antiguo primero. Devuelve COGS (Bs).
  // Opera en centavos enteros y TRUNCA el costo por fracción
  // (nunca redondea hacia arriba al deducir) para no inflar COGS.
  // Devuelve { cogs, lotesTocados } para que el caller actualice Sheets.
  consumeFIFO(prodId, tam, sab, units) {
    const lots = this.lotesActivos(prodId, tam, sab);
    let rem = units, cogsCents = 0;
    const tocados = [];
    for (const lot of lots) {
      if (rem <= 0) break;
      const take = Math.min(lot.qty_restante, rem);
      const costCentsU = Math.floor((lot.costo_u || 0) * 100);
      cogsCents += costCentsU * take;
      lot.qty_restante -= take;
      rem -= take;
      tocados.push(lot);
    }
    if (rem > 0) {
      // Fallback: faltaban lotes → usar costo de la variante (o del producto)
      const p = this.getProducto(prodId);
      const costoFallback = p ? this.variantInfo(p, tam, sab).costo : 0;
      cogsCents += Math.floor((costoFallback || 0) * 100) * rem;
    }
    return { cogs: cogsCents / 100, lotesTocados: tocados };
  },

  // ── Estadísticas ─────────────────────────────────────
  // Deriva ingresos/COGS/ganancia desde los ITEMS de cada venta.
  // Agrupa top por producto_id + tamaño + sabor (estable aunque se renombre).
  calcStats(ventas) {
    let revenue = 0, cogs = 0, units = 0;
    const byVar = {};
    for (const v of ventas) {
      const items = v.items || [];
      for (const it of items) {
        const lt = it.line_total || 0;
        const ic = it.item_cogs  || 0;
        const iu = it.units      || 0;
        revenue += lt; cogs += ic; units += iu;
        const key = `${it.producto_id || it.nombre}|${it.tamaño || ''}|${it.sabor || ''}`;
        if (!byVar[key]) byVar[key] = {
          nombre: it.nombre || '—', tamaño: it.tamaño || '', sabor: it.sabor || '',
          revenue: 0, cogs: 0, units: 0
        };
        byVar[key].revenue += lt;
        byVar[key].cogs    += ic;
        byVar[key].units   += iu;
      }
    }
    const profit = revenue - cogs;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    const top = Object.values(byVar)
      .map(p => ({ ...p, profit: p.revenue - p.cogs,
                   margin: p.revenue > 0 ? (p.revenue - p.cogs) / p.revenue * 100 : 0 }))
      .sort((a, b) => b.profit - a.profit);
    return { revenue, cogs, profit, margin, salesCount: ventas.length, units, top };
  }
};
