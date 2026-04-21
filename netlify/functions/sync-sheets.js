// netlify/functions/sync-sheets.js
// gviz public API - no auth needed
const { createClient } = require('@supabase/supabase-js')
const https = require('https')

const VENTAS_ID = '1lQXdKtkh5kdGS52SgJ6w0GiLIzyrHzph'
const MESES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SETIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE']

var HORARIOS_IDS = {
  '2026-04': '1UhthKK4MeoIXnLcgldk_NswaRDGWFFUC',
  '2026-03': '1XLPIqlAkeGblhENSm-3sGB4U6ZN6Qkia'
}

function norm(s) {
  return String(s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
}
function getSB() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
}
function getMeses() {
  var now = new Date()
  var cur = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0')
  var prev = new Date(now.getFullYear(), now.getMonth()-1, 1)
  return [cur, prev.getFullYear() + '-' + String(prev.getMonth()+1).padStart(2,'0')]
}
function fetchGviz(sheetId, sheetName) {
  return new Promise(function(resolve, reject) {
    var url = 'https://docs.google.com/spreadsheets/d/' + sheetId + '/gviz/tq?tqx=out:json&sheet=' + encodeURIComponent(sheetName)
    https.get(url, function(res) {
      var data = ''
      res.on('data', function(chunk) { data += chunk })
      res.on('end', function() {
        var j1 = data.indexOf('{'), j2 = data.lastIndexOf('}')
        if (j1 < 0) { reject(new Error('No JSON for: ' + sheetName)); return }
        try { resolve(JSON.parse(data.substring(j1, j2+1))) }
        catch(e) { reject(new Error('Parse error for: ' + sheetName)) }
      })
    }).on('error', reject)
  })
}
function pn(cell) {
  if (!cell || cell.v === null || cell.v === undefined) return 0
  if (typeof cell.v === 'number') return cell.v
  return parseFloat(String(cell.v).replace(/[^0-9.-]/g,'')) || 0
}

async function syncVentas(db, mes) {
  var mn = MESES[parseInt(mes.split('-')[1]) - 1]
  var gdata = await fetchGviz(VENTAS_ID, mn)
  var rows = gdata.table.rows || []
  if (rows.length < 2) return 0

  // Row 0 = header row with date serials
  // Find column indices from header:
  // - TIENDAS column: string cell with "TIENDAS"
  // - Date columns: numeric cells > 40000 (date serials)
  // - Last date col = venta actual (col H = mar-26 = most recent)
  // - Second to last date col = venta anterior
  // - Last numeric col that is NOT a date serial AND not small (not %) = meta soles
  var hdr = rows[0].c || []
  var colT = -1
  var dateCols = []
  
  for (var j = 0; j < hdr.length; j++) {
    var cell = hdr[j]
    if (!cell || cell.v === null) continue
    if (typeof cell.v === 'string' && cell.v.trim().toUpperCase() === 'TIENDAS') colT = j
    // Date serial: number between 40000 and 50000
    if (typeof cell.v === 'number' && cell.v > 40000 && cell.v < 50000) dateCols.push(j)
  }

  if (colT < 0) colT = 1
  if (dateCols.length === 0) return 0

  // venta actual = last date col, venta anterior = second to last
  var colV = dateCols[dateCols.length - 1]
  var colVA = dateCols.length > 1 ? dateCols[dateCols.length - 2] : -1

  // Meta soles = last column with a large positive number (> 1000)
  // It's the last non-date numeric column in the header area
  // Strategy: look at data row 1 (SURCO) and find the last col with value > 10000
  // that comes AFTER the date cols
  var afterLastDate = dateCols[dateCols.length - 1] + 1
  var colMeta = -1
  if (rows[1]) {
    var dataRow = rows[1].c || []
    // Scan from last col backwards to find first large value (meta soles)
    for (var k = dataRow.length - 1; k >= afterLastDate; k--) {
      var v = pn(dataRow[k])
      if (v > 10000) { colMeta = k; break }
    }
  }

  var ups = []
  for (var i = 1; i < rows.length; i++) {
    var cells = rows[i].c || []
    var n = String(cells[colT] ? (cells[colT].v||'') : '').trim()
    if (!n) continue
    var nu = n.toUpperCase()
    if (nu === 'TIENDAS' || nu === 'TOTAL' || nu.includes('META')) continue

    var vr = pn(cells[colV])
    // venta anterior: use second-to-last date col, if 0 search backwards
    var va = 0
    for (var dc = dateCols.length - 2; dc >= 0; dc--) {
      var candidate = pn(cells[dateCols[dc]])
      if (candidate > 0) { va = candidate; break }
    }
    var ma = colMeta >= 0 ? pn(cells[colMeta]) : 0

    if (vr > 0 || va > 0 || ma > 0) {
      ups.push({ mes: mes, tienda: nu, venta_real: vr, venta_ant: va, meta_abs: ma, nombre_original: n, synced_at: new Date().toISOString() })
    }
  }
  if (ups.length > 0) await db.from('incentivos_ventas').upsert(ups, { onConflict: 'mes,tienda' })
  return ups.length
}

async function syncHorarios(db, mes) {
  var fileId = HORARIOS_IDS[mes]
  if (!fileId) return 0

  // gviz for xlsx: the actual header row (Colaborador/a, Chorrillos, ...) becomes
  // the column labels in gviz. So gviz cols[0].label = 'Colaborador/a' etc.
  // and rows start from the first data row (Adela, 4, 0, ...)
  var gdata = await fetchGviz(fileId, 'Resumen Mensual')
  var cols = gdata.table.cols || []
  var rows = gdata.table.rows || []
  if (rows.length < 1) return 0

  // cols[0] = Colaborador/a, cols[1..N-1] = tienda names, cols[N-1] = Total horas
  var tiendaCols = []
  for (var j = 1; j < cols.length; j++) {
    var label = String(cols[j].label || '').trim()
    if (label && !label.toLowerCase().includes('total') && !label.match(/^\d/)) {
      tiendaCols.push({ col: j, tienda: norm(label) })
    }
  }

  var ups = []
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i].c || []
    var colab = String(row[0] ? (row[0].v||'') : '').trim()
    if (!colab) continue
    for (var t = 0; t < tiendaCols.length; t++) {
      var cell = row[tiendaCols[t].col]
      var h = cell ? (typeof cell.v === 'number' ? cell.v : parseFloat(String(cell.v||'0'))||0) : 0
      if (h > 0) ups.push({ mes: mes, colaboradora: colab, tienda: tiendaCols[t].tienda, horas: h, synced_at: new Date().toISOString() })
    }
  }
  if (ups.length > 0) await db.from('incentivos_horarios').upsert(ups, { onConflict: 'mes,colaboradora,tienda' })
  return ups.length
}

exports.handler = async function(event) {
  var db = getSB()
  var meses = getMeses()
  var results = []
  for (var i = 0; i < meses.length; i++) {
    var mes = meses[i]
    try {
      var vr = await syncVentas(db, mes)
      var hr = await syncHorarios(db, mes)
      await db.from('incentivos_sync_log').insert({ mes: mes, ventas_rows: vr, horarios_rows: hr, status: 'ok' })
      results.push({ mes: mes, ventas: vr, horarios: hr, status: 'ok' })
    } catch(e) {
      await db.from('incentivos_sync_log').insert({ mes: mes, status: 'error', error_detail: e.message })
      results.push({ mes: mes, status: 'error', error: e.message })
    }
  }
  return { statusCode: 200, body: JSON.stringify({ synced: results, at: new Date().toISOString() }) }
}