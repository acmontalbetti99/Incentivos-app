// netlify/functions/sync-sheets.js
// Uses public gviz/tq API (files are public) - no auth needed
const { createClient } = require('@supabase/supabase-js')
const https = require('https')

const VENTAS_ID    = '1lQXdKtkh5kdGS52SgJ6w0GiLIzyrHzph'
const MESES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SETIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE']

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
function pn(cell) {
  if (!cell || cell.v === null || cell.v === undefined) return 0
  if (typeof cell.v === 'number') return cell.v
  return parseFloat(String(cell.v).replace(/[^0-9.-]/g,'')) || 0
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

// Known horarios file IDs by month
var HORARIOS_IDS = {
  '2026-04': '1UhthKK4MeoIXnLcgldk_NswaRDGWFFUC',
  '2026-03': '1XLPIqlAkeGblhENSm-3sGB4U6ZN6Qkia'
}

async function syncVentas(db, mes) {
  var mn = MESES[parseInt(mes.split('-')[1]) - 1]
  var gdata = await fetchGviz(VENTAS_ID, mn)
  var rows = gdata.table.rows || []
  if (rows.length < 2) return 0
  var hdr = (rows[0].c || []).map(function(c) { return c ? c.v : null })
  var colT = -1, colM = -1, dateCols = []
  for (var j = 0; j < hdr.length; j++) {
    var v = hdr[j]
    if (typeof v === 'string' && v.trim().toUpperCase() === 'TIENDAS') colT = j
    if (typeof v === 'number' && v > 40000 && v < 50000) dateCols.push(j)
  }
  if (colT < 0) colT = 1
  for (var k = 0; k < hdr.length; k++) {
    var vk = String(hdr[k]||'').toLowerCase()
    if (vk.includes('meta') && !vk.includes('total')) { colM = k; break }
  }
  var cv = dateCols.length > 0 ? dateCols[dateCols.length-1] : -1
  var cva = dateCols.length > 1 ? dateCols[dateCols.length-2] : -1
  if (cv < 0) return 0
  var ups = []
  for (var i = 1; i < rows.length; i++) {
    var cells = rows[i].c || []
    var n = String(cells[colT] ? (cells[colT].v||'') : '').trim()
    if (!n) continue
    var nu = n.toUpperCase()
    if (nu === 'TIENDAS' || nu === 'TOTAL' || nu.includes('META')) continue
    var vr = pn(cells[cv])
    var va = cva >= 0 ? pn(cells[cva]) : 0
    if (va === 0 && cv > 0) { var alt = pn(cells[cv-1]); if (alt > 0) va = alt }
    var ma = colM >= 0 ? pn(cells[colM]) : 0
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
  var gdata = await fetchGviz(fileId, 'Resumen Mensual')
  var rows = gdata.table.rows || []
  if (rows.length < 2) return 0
  var hdr = (rows[0].c || []).map(function(c) { return c ? String(c.v||'') : '' })
  var tc = []
  for (var j = 1; j < hdr.length; j++) {
    var v = hdr[j].trim()
    if (v && !v.toLowerCase().includes('total')) tc.push({ col: j, tienda: norm(v) })
  }
  var ups = []
  for (var i = 1; i < rows.length; i++) {
    var cells = rows[i].c || []
    var co = String(cells[0] ? (cells[0].v||'') : '').trim()
    if (!co) continue
    for (var t = 0; t < tc.length; t++) {
      var cell = cells[tc[t].col]
      var h = cell ? (typeof cell.v === 'number' ? cell.v : parseFloat(String(cell.v||'0'))||0) : 0
      if (h > 0) ups.push({ mes: mes, colaboradora: co, tienda: tc[t].tienda, horas: h, synced_at: new Date().toISOString() })
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
