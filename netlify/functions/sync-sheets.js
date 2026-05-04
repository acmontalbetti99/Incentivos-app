// netlify/functions/sync-sheets.js
// Busca archivo de horarios dinamicamente en Drive por nombre de mes
const { createClient } = require('@supabase/supabase-js')
const https = require('https')
const crypto = require('crypto')

const VENTAS_ID    = '1lQXdKtkh5kdGS52SgJ6w0GiLIzyrHzph'
const HORARIOS_DIR = '1Aab8VfGyMykYOgitY9x4b4tj2fTpH-1i'
const MESES_ES     = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SETIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE']

function norm(s) { return String(s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'') }
function getSB() { return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY) }
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

function buildJWT(sa) {
  var now = Math.floor(Date.now() / 1000)
  var header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  var payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now
  })).toString('base64url')
  var unsigned = header + '.' + payload
  var sign = crypto.createSign('RSA-SHA256')
  sign.update(unsigned)
  var sig = sign.sign(sa.private_key, 'base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
  return unsigned + '.' + sig
}

function getAccessToken(sa) {
  return new Promise(function(resolve, reject) {
    var jwt = buildJWT(sa)
    var postData = 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt
    var req = https.request({
      hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': postData.length }
    }, function(res) {
      var d = ''
      res.on('data', function(c) { d += c })
      res.on('end', function() {
        try { resolve(JSON.parse(d).access_token) } catch(e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.write(postData)
    req.end()
  })
}

function listFolder(token, folderId, nameContains) {
  return new Promise(function(resolve, reject) {
    var q = encodeURIComponent("'" + folderId + "' in parents and trashed = false and name contains '" + nameContains + "'")
    https.get({
      hostname: 'www.googleapis.com',
      path: '/drive/v3/files?q=' + q + '&fields=files(id,name)',
      headers: { Authorization: 'Bearer ' + token }
    }, function(res) {
      var d = ''
      res.on('data', function(c) { d += c })
      res.on('end', function() {
        try { resolve(JSON.parse(d).files || []) } catch(e) { resolve([]) }
      })
    }).on('error', function() { resolve([]) })
  })
}

var HORARIOS_KNOWN = {
  '2026-04': '1UhthKK4MeoIXnLcgldk_NswaRDGWFFUC',
  '2026-05': '1HwZhrb8aHLjjzjsN6bmMimnmbGdbg7xj'
}

async function findHorariosFile(mes) {
  // Check known IDs first (instant, no API call)
  if (HORARIOS_KNOWN[mes]) return HORARIOS_KNOWN[mes]
  var parts = mes.split('-')
  var yr  = parts[0]
  var mn  = MESES_ES[parseInt(parts[1]) - 1]
  try {
    var sa = JSON.parse(process.env.GOOGLE_SA_JSON)
    var token = await getAccessToken(sa)
    var files = await listFolder(token, HORARIOS_DIR, mn)
    var match = files.find(function(f) { return f.name.toUpperCase().includes(mn) && f.name.includes(yr) })
    return match ? match.id : null
  } catch(e) { return null }
}

function getMeses(queryMes) {
  if (queryMes) return [queryMes]
  var now = new Date()
  var cur = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0')
  var prev = new Date(now.getFullYear(), now.getMonth()-1, 1)
  return [cur, prev.getFullYear() + '-' + String(prev.getMonth()+1).padStart(2,'0')]
}

async function syncVentas(db, mes) {
  var mn = MESES_ES[parseInt(mes.split('-')[1]) - 1]
  var gdata = await fetchGviz(VENTAS_ID, mn)
  var rows = gdata.table.rows || []
  if (rows.length < 2) return 0
  var hdr = rows[0].c || []
  var colT = -1, dateCols = []
  for (var j = 0; j < hdr.length; j++) {
    var cell = hdr[j]
    if (!cell || cell.v === null) continue
    if (typeof cell.v === 'string' && cell.v.trim().toUpperCase() === 'TIENDAS') colT = j
    if (typeof cell.v === 'number' && cell.v > 40000 && cell.v < 50000) dateCols.push(j)
  }
  if (colT < 0) colT = 1
  if (dateCols.length === 0) return 0
  var colV = dateCols[dateCols.length - 1]
  var colMeta = -1
  if (rows[1]) {
    var dr = rows[1].c || []
    for (var k = dr.length - 1; k >= colV + 1; k--) {
      if (pn(dr[k]) > 10000) { colMeta = k; break }
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
    var va = 0
    for (var dc = dateCols.length - 2; dc >= 0; dc--) {
      var c2 = pn(cells[dateCols[dc]])
      if (c2 > 0) { va = c2; break }
    }
    var ma = colMeta >= 0 ? pn(cells[colMeta]) : 0
    if (vr > 0 || va > 0 || ma > 0) {
      ups.push({ mes:mes, tienda:nu, venta_real:vr, venta_ant:va, meta_abs:ma, nombre_original:n, synced_at: new Date().toISOString() })
    }
  }
  for (var mt = 0; mt < rows.length; mt++) {
    var mc = rows[mt].c || []
    var label = String(mc[1] ? (mc[1].v||'') : '').toLowerCase()
    if (label.includes('meta') && label.includes('total')) {
      var mv = pn(mc[2])
      if (mv > 0) ups.push({ mes:mes, tienda:'_META_TOTAL', venta_real:0, venta_ant:0, meta_abs:mv, nombre_original:'Meta total empresa', synced_at: new Date().toISOString() })
      break
    }
  }
  if (ups.length > 0) await db.from('incentivos_ventas').upsert(ups, { onConflict: 'mes,tienda' })
  return ups.length
}

async function syncHorarios(db, mes) {
  var fileId = await findHorariosFile(mes)
  if (!fileId) return 0
  var gdata = await fetchGviz(fileId, 'Resumen Mensual')
  var cols = gdata.table.cols || []
  var rows = gdata.table.rows || []
  if (rows.length < 1) return 0
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
      if (h > 0) ups.push({ mes:mes, colaboradora:colab, tienda:tiendaCols[t].tienda, horas:h, synced_at: new Date().toISOString() })
    }
  }
  if (ups.length > 0) await db.from('incentivos_horarios').upsert(ups, { onConflict: 'mes,colaboradora,tienda' })
  return ups.length
}

exports.handler = async function(event) {
  var db = getSB()
  var queryMes = event.queryStringParameters && event.queryStringParameters.mes
  var meses = getMeses(queryMes)
  var results = []
  for (var i = 0; i < meses.length; i++) {
    var mes = meses[i]
    try {
      var vr = await syncVentas(db, mes)
      var hr = await syncHorarios(db, mes)
      await db.from('incentivos_sync_log').insert({ mes:mes, ventas_rows:vr, horarios_rows:hr, status:'ok' })
      results.push({ mes:mes, ventas:vr, horarios:hr, status:'ok' })
    } catch(e) {
      await db.from('incentivos_sync_log').insert({ mes:mes, status:'error', error_detail:e.message })
      results.push({ mes:mes, status:'error', error:e.message })
    }
  }
  return { statusCode:200, body:JSON.stringify({ synced:results, at:new Date().toISOString() }) }
}