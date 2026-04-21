// netlify/functions/sync-sheets.js
const { GoogleAuth } = require('google-auth-library')
const { google } = require('googleapis')
const { createClient } = require('@supabase/supabase-js')

const VENTAS_ID    = '1lQXdKtkh5kdGS52SgJ6w0GiLIzyrHzph'
const HORARIOS_DIR = '1Aab8VfGyMykYOgitY9x4b4tj2fTpH-1i'
const MESES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SETIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE']

function norm(s) {
  return String(s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
}

async function getClients() {
  const creds = JSON.parse(process.env.GOOGLE_SA_JSON)
  const auth = new GoogleAuth({
    credentials: creds,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/drive.readonly'
    ]
  })
  const client = await auth.getClient()
  return {
    sheets: google.sheets({ version: 'v4', auth: client }),
    drive:  google.drive({  version: 'v3', auth: client })
  }
}

function getSB() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
}

function getMeses() {
  const now = new Date()
  const cur = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0')
  const prev = new Date(now.getFullYear(), now.getMonth()-1, 1)
  const pre = prev.getFullYear() + '-' + String(prev.getMonth()+1).padStart(2,'0')
  return [cur, pre]
}

function pn(v) {
  return parseFloat(String(v||'0').replace(/[^0-9.-]/g,'')) || 0
}

async function syncVentas(sheets, db, mes) {
  const mn = MESES[parseInt(mes.split('-')[1]) - 1]
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: VENTAS_ID,
    range: mn + '!A1:K30'
  })
  const rows = res.data.values || []
  if (rows.length < 2) return 0

  const hi = rows.findIndex(function(r) {
    return r.some(function(c) { return String(c||'').trim().toUpperCase() === 'TIENDAS' })
  })
  if (hi < 0) return 0

  const hdr = rows[hi]
  const ct = hdr.findIndex(function(v) { return String(v||'').trim().toUpperCase() === 'TIENDAS' })
  const dc = []
  for (var j = 0; j < hdr.length; j++) {
    if (/[A-Za-z]{3}-\d{2}/.test(String(hdr[j]||''))) dc.push(j)
  }
  const cv  = dc.length > 0 ? dc[dc.length-1] : -1
  const cva = dc.length > 1 ? dc[dc.length-2] : -1
  var cm = -1
  for (var k = 0; k < hdr.length; k++) {
    var v = String(hdr[k]||'').toLowerCase()
    if (v.includes('meta') && !v.includes('total')) { cm = k; break }
  }
  if (ct < 0 || cv < 0) return 0

  var ups = []
  for (var i = hi+1; i < rows.length; i++) {
    var row = rows[i]
    var n = String(row[ct]||'').trim()
    if (!n) continue
    var nu = n.toUpperCase()
    if (nu === 'TIENDAS' || nu === 'TOTAL' || nu.includes('META')) continue
    var vr = pn(row[cv])
    var va = cva >= 0 ? pn(row[cva]) : 0
    if (va === 0 && cv > 0) { var alt = pn(row[cv-1]); if (alt > 0) va = alt }
    var ma = cm >= 0 ? pn(row[cm]) : 0
    if (vr > 0 || va > 0 || ma > 0) {
      ups.push({ mes: mes, tienda: nu, venta_real: vr, venta_ant: va, meta_abs: ma, nombre_original: n, synced_at: new Date().toISOString() })
    }
  }
  if (ups.length > 0) {
    await db.from('incentivos_ventas').upsert(ups, { onConflict: 'mes,tienda' })
  }
  return ups.length
}

async function syncHorarios(sheets, drive, db, mes) {
  const mn = MESES[parseInt(mes.split('-')[1]) - 1]
  const yr = mes.split('-')[0]
  const res = await drive.files.list({
    q: "'" + HORARIOS_DIR + "' in parents and trashed = false",
    fields: 'files(id,name)'
  })
  var file = null
  var files = res.data.files || []
  for (var i = 0; i < files.length; i++) {
    if (files[i].name.toUpperCase().includes(mn) && files[i].name.includes(yr)) {
      file = files[i]; break
    }
  }
  if (!file) return 0

  const res2 = await sheets.spreadsheets.values.get({
    spreadsheetId: file.id,
    range: 'Resumen Mensual!A1:M200'
  })
  var rows = res2.data.values || []
  if (rows.length < 2) return 0

  var hdr = rows[0]
  var tc = []
  for (var j = 1; j < hdr.length; j++) {
    var v = String(hdr[j]||'').trim()
    if (v && !v.toLowerCase().includes('total')) {
      tc.push({ col: j, tienda: norm(v) })
    }
  }

  var ups = []
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i]
    var co = String(row[0]||'').trim()
    if (!co) continue
    for (var t = 0; t < tc.length; t++) {
      var h = parseFloat(String(row[tc[t].col]||'0')) || 0
      if (h > 0) {
        ups.push({ mes: mes, colaboradora: co, tienda: tc[t].tienda, horas: h, synced_at: new Date().toISOString() })
      }
    }
  }
  if (ups.length > 0) {
    await db.from('incentivos_horarios').upsert(ups, { onConflict: 'mes,colaboradora,tienda' })
  }
  return ups.length
}

exports.handler = async function(event) {
  if (event.httpMethod === 'POST') {
    var auth = (event.headers['authorization']||'').replace('Bearer ','')
    if (auth !== process.env.SYNC_CRON_SECRET) {
      return { statusCode: 401, body: 'Unauthorized' }
    }
  }

  var db = getSB()
  var clients = await getClients()
  var sheets = clients.sheets
  var drive  = clients.drive
  var meses  = getMeses()
  var results = []

  for (var i = 0; i < meses.length; i++) {
    var mes = meses[i]
    try {
      var vr = await syncVentas(sheets, db, mes)
      var hr = await syncHorarios(sheets, drive, db, mes)
      await db.from('incentivos_sync_log').insert({ mes: mes, ventas_rows: vr, horarios_rows: hr, status: 'ok' })
      results.push({ mes: mes, ventas: vr, horarios: hr, status: 'ok' })
    } catch(e) {
      await db.from('incentivos_sync_log').insert({ mes: mes, status: 'error', error_detail: e.message })
      results.push({ mes: mes, status: 'error', error: e.message })
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ synced: results, at: new Date().toISOString() })
  }
}
