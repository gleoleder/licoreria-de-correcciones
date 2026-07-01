// ═══════════════════════════════════════════════════════
//  POS Licorería — Generación de reportes PDF profesionales
//  Usa jsPDF + jsPDF-AutoTable (cargados desde CDN en index.html)
// ═══════════════════════════════════════════════════════
(function () {
  'use strict';

  // ── Paleta corporativa ────────────────────────────────
  const C = {
    navy:   [13, 27, 62],     // encabezados / franja superior
    accent: [201, 162, 39],   // dorado (línea de acento)
    dark:   [33, 37, 41],     // texto principal
    gray:   [110, 118, 129],  // texto secundario
    light:  [244, 246, 249],  // fondo de filas alternas / cajas
    green:  [22, 130, 70],
    red:    [190, 45, 45],
    amber:  [176, 120, 20]
  };

  const money = n => 'Bs ' + Number(n || 0).toFixed(2);
  const num   = n => Number(n || 0).toFixed(2);

  function biz() {
    return (typeof NEGOCIO !== 'undefined' && NEGOCIO) ? NEGOCIO : { nombre: 'Licorería' };
  }

  function ahora() {
    return new Date().toLocaleString('es-BO', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function fecha(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('es-BO'); } catch (_) { return '—'; }
  }

  function getDoc() {
    const jsPDFns = window.jspdf;
    if (!jsPDFns || !jsPDFns.jsPDF) {
      alert('No se pudo cargar el generador de PDF (jsPDF). Verifica tu conexión a internet.');
      return null;
    }
    return new jsPDFns.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  }

  // ── Encabezado corporativo (se dibuja en cada página vía didDrawPage) ──
  function header(doc, titulo, subtitulo) {
    const W = doc.internal.pageSize.getWidth();
    const b = biz();
    // Franja superior navy
    doc.setFillColor.apply(doc, C.navy);
    doc.rect(0, 0, W, 26, 'F');
    // Línea de acento dorada
    doc.setFillColor.apply(doc, C.accent);
    doc.rect(0, 26, W, 1.2, 'F');

    // Nombre del negocio
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(b.nombre || 'Licorería', 14, 12);

    // Datos secundarios del negocio
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const meta = [b.direccion, b.telefono, b.nit].filter(Boolean).join('   ·   ');
    if (meta) doc.text(meta, 14, 18);

    // Título del reporte (derecha)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(titulo, W - 14, 11, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    if (subtitulo) doc.text(subtitulo, W - 14, 16.5, { align: 'right' });
    doc.text('Emitido: ' + ahora(), W - 14, 21, { align: 'right' });
  }

  // ── Pie de página con numeración ──────────────────────
  function footer(doc) {
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const page = doc.internal.getNumberOfPages();
    doc.setDrawColor.apply(doc, C.light);
    doc.setLineWidth(0.3);
    doc.line(14, H - 12, W - 14, H - 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor.apply(doc, C.gray);
    doc.text(biz().nombre + ' — Documento generado automáticamente', 14, H - 7);
    doc.text('Página ' + page, W - 14, H - 7, { align: 'right' });
  }

  // ── Caja de resumen tipo "KPI" ────────────────────────
  function resumenCajas(doc, y, cajas) {
    const W = doc.internal.pageSize.getWidth();
    const margin = 14;
    const gap = 4;
    const w = (W - margin * 2 - gap * (cajas.length - 1)) / cajas.length;
    const h = 18;
    cajas.forEach((c, i) => {
      const x = margin + i * (w + gap);
      doc.setFillColor.apply(doc, C.light);
      doc.roundedRect(x, y, w, h, 1.5, 1.5, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor.apply(doc, C.gray);
      doc.text(String(c.label).toUpperCase(), x + 4, y + 6);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor.apply(doc, c.color || C.navy);
      doc.text(String(c.value), x + 4, y + 13);
      if (c.sub) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.8);
        doc.setTextColor.apply(doc, C.gray);
        doc.text(String(c.sub), x + 4, y + 16.5);
      }
    });
    return y + h;
  }

  const commonTable = (doc, titulo, subtitulo) => ({
    theme: 'striped',
    headStyles: { fillColor: C.navy, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5, halign: 'left' },
    bodyStyles: { fontSize: 8, textColor: C.dark },
    alternateRowStyles: { fillColor: C.light },
    styles: { cellPadding: 2, overflow: 'linebreak', lineColor: [224, 228, 234], lineWidth: 0.1 },
    margin: { top: 32, bottom: 16, left: 14, right: 14 },
    didDrawPage: () => { header(doc, titulo, subtitulo); footer(doc); }
  });

  // ═══════════════════════════════════════════════════════
  //  REPORTE 1 — INVENTARIO DETALLADO
  // ═══════════════════════════════════════════════════════
  function exportInventario() {
    const doc = getDoc();
    if (!doc) return;
    const titulo = 'REPORTE DE INVENTARIO';
    const subtitulo = 'Existencias, valorización e inversión en lotes';

    const vars = (typeof todasLasVariantes === 'function') ? todasLasVariantes() : [];

    // Construir filas + totales — solo variantes CON lotes/stock
    let totUnidades = 0, totValorCosto = 0, totValorVenta = 0;
    let nAgotados = 0, nBajos = 0;

    const rows = [];
    vars.forEach(v => {
      const lots = Store.lotesActivos(v.producto.id, v.tamaño, v.sabor);
      // Omitir variantes sin lotes existentes
      if (!lots.length) return;

      const stock = Store.variantStock(v.producto.id, v.tamaño, v.sabor);
      const min = v.producto.stock_min || 0;
      const info = Store.variantInfo(v.producto, v.tamaño, v.sabor);
      const costoU = Store.variantAvgCost(v.producto.id, v.tamaño, v.sabor) || info.costo || 0;
      const precioU = info.precio || 0;
      const valorCosto = stock * costoU;
      const valorVenta = stock * precioU;

      let estado = 'OK';
      if (stock <= 0) { estado = 'Agotado'; nAgotados++; }
      else if (stock < min) { estado = 'Stock bajo'; nBajos++; }

      let venceTxt = '—';
      const prox = lots.map(l => l.vencimiento).filter(Boolean).sort()[0];
      if (prox) venceTxt = fecha(prox);

      totUnidades += stock;
      totValorCosto += valorCosto;
      totValorVenta += valorVenta;

      rows.push({
        estado,
        cells: [
          v.producto.nombre || '',
          Store.categoriaNombre(v.producto.categoria_id) || '',
          v.tamaño || '—',
          v.sabor || '—',
          String(stock),
          String(min),
          estado,
          money(costoU),
          money(precioU),
          money(valorCosto),
          venceTxt
        ]
      });
    });

    // Inversión total en lotes (TODOS los lotes, incluso agotados):
    //   gastoTotalLotes  = Σ (qty_inicial × costo_u)  → lo que gastaste comprando
    //   valorStockActual = Σ (qty_restante × costo_u) → lo que aún tienes en bodega
    //   gastoConsumido   = diferencia → costo de lo ya vendido/consumido
    let gastoTotalLotes = 0, valorStockActual = 0, nLotesTotal = 0;
    (Store.lotes || []).forEach(l => {
      nLotesTotal++;
      gastoTotalLotes  += (l.qty_inicial  || 0) * (l.costo_u || 0);
      valorStockActual += (l.qty_restante || 0) * (l.costo_u || 0);
    });
    const gastoConsumido = gastoTotalLotes - valorStockActual;

    // Encabezado + resumen (solo en la primera página)
    header(doc, titulo, subtitulo);
    let y = 34;
    // Fila 1: inversión en compras (lo que gastaste hasta el momento)
    y = resumenCajas(doc, y, [
      { label: 'Gasto total en lotes', value: money(gastoTotalLotes), color: C.navy, sub: nLotesTotal + ' lotes comprados' },
      { label: 'Valor stock actual', value: money(valorStockActual), color: C.amber, sub: 'costo en bodega' },
      { label: 'Costo ya vendido', value: money(gastoConsumido), color: C.gray, sub: 'lotes consumidos' },
      { label: 'Valor venta stock', value: money(totValorVenta), color: C.green, sub: 'a precio de venta' }
    ]);
    y += 3;
    // Fila 2: existencias y estados
    y = resumenCajas(doc, y, [
      { label: 'Ítems', value: String(rows.length), sub: 'variantes con stock' },
      { label: 'Unidades', value: String(totUnidades), sub: 'en stock' },
      { label: 'Agotados', value: String(nAgotados), color: nAgotados ? C.red : C.navy },
      { label: 'Stock bajo', value: String(nBajos), color: nBajos ? C.amber : C.navy }
    ]);
    y += 4;

    // Fila de TOTALES: se agrega al final del cuerpo para que aparezca
    // solo una vez, en la última página (no repetida por hoja como un foot).
    const totalRow = [
      { content: 'TOTALES', colSpan: 4, styles: { halign: 'right', fontStyle: 'bold' } },
      { content: String(totUnidades), styles: { halign: 'center', fontStyle: 'bold' } },
      { content: '', colSpan: 4 },
      { content: money(totValorCosto), styles: { halign: 'right', fontStyle: 'bold' } },
      { content: '' }
    ];
    const body = rows.map(r => r.cells);
    body.push(totalRow);
    const totalRowIdx = body.length - 1;

    doc.autoTable(Object.assign(commonTable(doc, titulo, subtitulo), {
      startY: y,
      head: [['Producto', 'Categoría', 'Tamaño', 'Sabor', 'Stock', 'Mín', 'Estado', 'Costo/u', 'Precio/u', 'Valor costo', 'Vence']],
      body: body,
      columnStyles: {
        4: { halign: 'center' }, 5: { halign: 'center' },
        7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' }
      },
      didParseCell: (data) => {
        // Estilo de la fila de totales
        if (data.section === 'body' && data.row.index === totalRowIdx) {
          data.cell.styles.fillColor = [230, 234, 241];
          data.cell.styles.textColor = C.navy;
          return;
        }
        // Color del estado
        if (data.section === 'body' && data.column.index === 6) {
          const est = data.cell.raw;
          if (est === 'Agotado') { data.cell.styles.textColor = C.red; data.cell.styles.fontStyle = 'bold'; }
          else if (est === 'Stock bajo') { data.cell.styles.textColor = C.amber; data.cell.styles.fontStyle = 'bold'; }
          else { data.cell.styles.textColor = C.green; }
        }
      },
      // Encabezado corporativo SOLO en la primera página; pie en todas.
      margin: { top: 14, bottom: 16, left: 14, right: 14 },
      didDrawPage: (data) => {
        if (data.pageNumber === 1) header(doc, titulo, subtitulo);
        footer(doc);
      }
    }));

    doc.save('inventario_' + new Date().toISOString().slice(0, 10) + '.pdf');
  }

  // ═══════════════════════════════════════════════════════
  //  REPORTE — LOTES (gasto por lote)
  //  Muestra cada lote con su costo total. Simple y directo.
  // ═══════════════════════════════════════════════════════
  function exportLotes() {
    const doc = getDoc();
    if (!doc) return;
    const titulo = 'REPORTE DE LOTES';
    const subtitulo = 'Costo de cada lote comprado';

    // Todos los lotes, ordenados por fecha de compra (más antiguo primero)
    const lotes = (Store.lotes || []).slice().sort(
      (a, b) => new Date(a.fecha_compra) - new Date(b.fecha_compra)
    );

    let gastoTotal = 0, unidadesTotal = 0;
    const body = lotes.map(l => {
      const p = Store.getProducto(l.producto_id);
      const nombre = (p ? p.nombre : (l.producto_id || '—'));
      const variante = [l.tamaño, l.sabor].filter(Boolean).join(' · ');
      const prod = variante ? (nombre + ' · ' + variante) : nombre;
      const qty = l.qty_inicial || 0;
      const costoU = l.costo_u || 0;
      // Costo total real del lote, tal como se compró (guardado en la base).
      // Si el lote es viejo y no tiene el dato, se reconstruye con qty × costo_u
      // redondeado a centavos.
      const costoLote = (l.costo_total != null && l.costo_total > 0)
        ? l.costo_total
        : Math.round(qty * costoU * 100) / 100;
      gastoTotal += costoLote;
      unidadesTotal += qty;
      return [
        prod,
        fecha(l.fecha_compra),
        String(qty),
        money(costoU),
        money(costoLote)
      ];
    });

    // Fila de total (solo al final)
    const totalRow = [
      { content: 'GASTO TOTAL EN LOTES', colSpan: 2, styles: { halign: 'right', fontStyle: 'bold' } },
      { content: String(unidadesTotal), styles: { halign: 'center', fontStyle: 'bold' } },
      { content: '' },
      { content: money(gastoTotal), styles: { halign: 'right', fontStyle: 'bold' } }
    ];
    body.push(totalRow);
    const totalRowIdx = body.length - 1;

    header(doc, titulo, subtitulo);
    let y = 34;
    y = resumenCajas(doc, y, [
      { label: 'Total lotes', value: String(lotes.length) },
      { label: 'Unidades compradas', value: String(unidadesTotal) },
      { label: 'Gasto total', value: money(gastoTotal), color: C.navy, sub: 'invertido en compras' }
    ]);
    y += 4;

    doc.autoTable(Object.assign(commonTable(doc, titulo, subtitulo), {
      startY: y,
      head: [['Producto', 'Fecha compra', 'Cantidad', 'Costo/u', 'Costo total lote']],
      body: body,
      columnStyles: {
        1: { halign: 'center' },
        2: { halign: 'center' },
        3: { halign: 'right' },
        4: { halign: 'right' }
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.row.index === totalRowIdx) {
          data.cell.styles.fillColor = [230, 234, 241];
          data.cell.styles.textColor = C.navy;
        }
      },
      margin: { top: 14, bottom: 16, left: 14, right: 14 },
      didDrawPage: (data) => {
        if (data.pageNumber === 1) header(doc, titulo, subtitulo);
        footer(doc);
      }
    }));

    doc.save('lotes_' + new Date().toISOString().slice(0, 10) + '.pdf');
  }

  // ═══════════════════════════════════════════════════════
  //  REPORTE 2 — VENTAS DEL DÍA / RANGO
  // ═══════════════════════════════════════════════════════
  async function exportVentas(dateStr) {
    const doc = getDoc();
    if (!doc) return;
    dateStr = dateStr || (typeof fechaLocalISO === 'function' ? fechaLocalISO() : new Date().toISOString().slice(0, 10));

    let ventas;
    try {
      ventas = await Sheets.loadVentasRango(dateStr, dateStr);
    } catch (e) {
      alert('No se pudieron leer las ventas: ' + (e && e.message ? e.message : e));
      return;
    }

    const titulo = 'REPORTE DE VENTAS';
    const subtitulo = 'Ventas del ' + fecha(dateStr + 'T12:00:00');

    // Totales
    let total = 0, ganancia = 0, cash = 0, cashN = 0, qr = 0, qrN = 0, totUnidades = 0;
    const dg = (typeof desglosePago === 'function') ? desglosePago : () => ({ efectivo: 0, qr: 0 });

    const bodyRows = ventas.map((v, i) => {
      total += v.total || 0;
      ganancia += v.ganancia || 0;
      const d = dg(v);
      if (d.efectivo > 0) { cash += d.efectivo; cashN++; }
      if (d.qr > 0) { qr += d.qr; qrN++; }
      const nItems = (v.items || []).reduce((s, it) => s + (it.qty || 0), 0);
      totUnidades += nItems;
      return [
        String(i + 1),
        v.id || '',
        v.hora || '',
        v.metodo || '',
        String(nItems),
        money(v.ganancia),
        money(v.total)
      ];
    });

    header(doc, titulo, subtitulo);
    let y = 34;
    y = resumenCajas(doc, y, [
      { label: 'Total del día', value: money(total), color: C.navy, sub: ventas.length + ' ventas' },
      { label: 'Ganancia', value: money(ganancia), color: C.green },
      { label: 'Efectivo', value: money(cash), color: C.green, sub: cashN + ' op.' },
      { label: 'QR', value: money(qr), color: [40, 90, 180], sub: qrN + ' op.' }
    ]);
    y += 4;

    doc.autoTable(Object.assign(commonTable(doc, titulo, subtitulo), {
      startY: y,
      head: [['#', 'ID', 'Hora', 'Método', 'Ítems', 'Ganancia', 'Total Bs']],
      body: bodyRows.length ? bodyRows : [[{ content: 'Sin ventas registradas este día', colSpan: 7, styles: { halign: 'center', textColor: C.gray } }]],
      columnStyles: {
        0: { halign: 'center', cellWidth: 10 },
        4: { halign: 'center' },
        5: { halign: 'right' },
        6: { halign: 'right', fontStyle: 'bold' }
      },
      foot: bodyRows.length ? [[
        { content: 'TOTALES', colSpan: 4, styles: { halign: 'right', fontStyle: 'bold' } },
        { content: String(totUnidades), styles: { halign: 'center', fontStyle: 'bold' } },
        { content: money(ganancia), styles: { halign: 'right', fontStyle: 'bold' } },
        { content: money(total), styles: { halign: 'right', fontStyle: 'bold' } }
      ]] : undefined,
      footStyles: { fillColor: [230, 234, 241], textColor: C.navy, fontSize: 8.5 }
    }));

    // ── Detalle de productos vendidos (agregado) ──────────
    const prodMap = {};
    for (const v of ventas) {
      for (const it of (v.items || [])) {
        const key = [it.nombre || it.producto_nombre || it.id, it.tamaño || '', it.sabor || ''].join('|');
        if (!prodMap[key]) prodMap[key] = {
          nombre: it.nombre || it.producto_nombre || it.id || '—',
          tam: it.tamaño || '—', sab: it.sabor || '—', qty: 0, importe: 0
        };
        prodMap[key].qty += (it.qty || 0);
        prodMap[key].importe += (it.line_total != null ? it.line_total : (it.precio || 0) * (it.qty || 0));
      }
    }
    const detalle = Object.values(prodMap).sort((a, b) => b.importe - a.importe);
    if (detalle.length) {
      const startY = doc.lastAutoTable.finalY + 8;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor.apply(doc, C.navy);
      doc.text('Detalle de productos vendidos', 14, startY);
      doc.autoTable(Object.assign(commonTable(doc, titulo, subtitulo), {
        startY: startY + 3,
        head: [['Producto', 'Tamaño', 'Sabor', 'Unid.', 'Importe Bs']],
        body: detalle.map(d => [d.nombre, d.tam, d.sab, String(d.qty), money(d.importe)]),
        columnStyles: { 3: { halign: 'center' }, 4: { halign: 'right' } }
      }));
    }

    doc.save('ventas_' + dateStr + '.pdf');
  }

  // Exponer API global
  window.POSPdf = { exportInventario, exportLotes, exportVentas };
})();
