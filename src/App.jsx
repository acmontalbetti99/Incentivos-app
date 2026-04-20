// v4 - auto-sync Google Sheets, sin upload
import { useState, useEffect, useCallback } from 'react'
import { supabase, loadConfig, saveHorarios, saveResultados, saveVentasMes } from './lib/supabase'
import { calcularBonos } from './lib/calculos'
import './App.css'

function norm(s) { return String(s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'') }

const BONO_BASE = 20
const BONO_PCT = 0.04
const BONO_MAX = 500
const VENTA_MIN = 30000
const CRECIMIENTO_MIN = 0.01
const VENTAS_SHEET_ID = '1lQXdKtkh5kdGS52SgJ6w0GiLIzyrHzph'
const HORARIOS_SHEET_ID = '1XLPIqlAkeGblhENSm-3sGB4U6ZN6Qkia'
const MESES_ES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SETIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE']

const S = {
  input: { background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.2)', borderRadius:6, color:'#fff', fontSize:12, padding:'5px 8px', width:'100%' },
  btnSm: { border:'none', borderRadius:6, fontSize:12, padding:'6px 14px', cursor:'pointer' },
}

async function fetchGviz(sheetId, sheetName) {
  const url = 'https://docs.google.com/spreadsheets/d/' + sheetId + '/gviz/tq?tqx=out:json&sheet=' + encodeURIComponent(sheetName)
  const resp = await fetch(url)
  const text = await resp.text()
  const jsonStart = text.indexOf('{')
  const jsonEnd = text.lastIndexOf('}')
  if (jsonStart < 0) throw new Error('Hoja "' + sheetName + '" no encontrada')
  return JSON.parse(text.substring(jsonStart, jsonEnd + 1))
}

// v3 - tipo badges fix
import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { supabase, loadConfig, saveHorarios, saveResultados, saveVentasMes } from './lib/supabase'
import { calcularBonos } from './lib/calculos'
import './App.css'

function norm(s) { return String(s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'') }

const BONO_BASE = 20
const BONO_PCT = 0.04
const BONO_MAX = 500
const VENTA_MIN = 30000
const CRECIMIENTO_MIN = 0.01
const VENTAS_SHEET_ID = '1lQXdKtkh5kdGS52SgJ6w0GiLIzyrHzph'
const MESES_ES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SETIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE']

const S = {
  input: { background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.2)', borderRadius:6, color:'#fff', fontSize:12, padding:'5px 8px', width:'100%' },
  btnSm: { border:'none', borderRadius:6, fontSize:12, padding:'6px 14px', cursor:'pointer' },
  btnPrimary: { background:'#4F46E5', color:'#fff' },
  btnDanger: { background:'#7f1d1d', color:'#fca5a5' },
  btnSuccess: { background:'#14532d', color:'#86efac' },
  section: { marginBottom:16, paddingBottom:16, borderBottom:'1px solid rgba(255,255,255,0.08)' },
  configPanel: { background:'#1e1b4b', border:'1px solid #534AB7', borderRadius:10, padding:'1rem 1.25rem', marginBottom:'1rem' },
  msg: (ok) => ({ marginTop:8, padding:'7px 12px', background: ok?'rgba(134,239,172,0.12)':'rgba(252,165,165,0.12)', borderRadius:6, color:ok?'#86efac':'#fca5a5', fontSize:12 }),
}


export default function App() {
  const hoy = new Date()
  const mesActual = hoy.getFullYear() + '-' + String(hoy.getMonth()+1).padStart(2,'0')
  const [mes, setMes] = useState(mesActual)
  const [config, setConfig] = useState(null)
  const [ventasData, setVentasData] = useState(null)
  const [horariosData, setHorariosData] = useState(null)
  const [resultados, setResultados] = useState(null)
  const [loading, setLoading] = useState({ ventas: false, horarios: false })
  const [error, setError] = useState('')
  const [showConfig, setShowConfig] = useState(false)
  const [syncStatus, setSyncStatus] = useState('')

  useEffect(() => { loadConfig().then(cfg => { if(cfg) setConfig(cfg) }) }, [])

  const cargarDesdeSheets = useCallback(async (mesParam) => {
    const m = mesParam || mes
    const mesNombre = MESES_ES[parseInt(m.split('-')[1]) - 1]
    setError('')
    setVentasData(null)
    setHorariosData(null)
    setResultados(null)
    setSyncStatus('Sincronizando...')
    setLoading({ ventas: true, horarios: true })

    // -- Load ventas --
    try {
      const gdata = await fetchGviz(VENTAS_SHEET_ID, mesNombre)
      const rows = gdata.table.rows || []
      const hdrCells = (rows[0]?.c || []).map(c => c ? c.v : null)
      let colTienda = -1
      const dateCols = []
      let colMeta = -1
      for (let j = 0; j < hdrCells.length; j++) {
        const v = hdrCells[j]
        if (typeof v === 'string' && v.trim().toUpperCase() === 'TIENDAS') colTienda = j
        if (typeof v === 'number' && v > 40000 && v < 50000) dateCols.push(j)
      }
      if (colTienda < 0) colTienda = 1
      for (let j = 0; j < hdrCells.length; j++) {
        const v = String(hdrCells[j]||'').toLowerCase()
        if (v.includes('meta') && !v.includes('total')) { colMeta = j; break }
      }
      if (colMeta < 0 && dateCols.length > 0) colMeta = dateCols[dateCols.length - 1] + 2
      const colVentas = dateCols.length > 0 ? dateCols[dateCols.length - 1] : -1
      const colVentaAnt = dateCols.length > 1 ? dateCols[dateCols.length - 2] : -1
      const pn = (cell) => { if(!cell||cell.v===null) return 0; return typeof cell.v==='number'?cell.v:parseFloat(String(cell.v).replace(/[^0-9.-]/g,''))||0 }
      const vdata = {}
      for (let i = 1; i < rows.length; i++) {
        const cells = rows[i].c || []
        const nombre = String(cells[colTienda]?.v||'').trim()
        if (!nombre) continue
        const nu = nombre.toUpperCase()
        if (['TIENDAS','TOTAL'].includes(nu) || nu.includes('META')) continue
        const ventaReal = colVentas >= 0 ? pn(cells[colVentas]) : 0
        let ventaAnt = colVentaAnt >= 0 ? pn(cells[colVentaAnt]) : 0
        if (ventaAnt === 0 && colVentas > 0) { const av = pn(cells[colVentas-1]); if(av>0) ventaAnt = av }
        const metaAbs = colMeta >= 0 ? pn(cells[colMeta]) : 0
        if (ventaReal > 0 || ventaAnt > 0 || metaAbs > 0) vdata[nu] = { ventaReal, metaAbs, ventaAnt, nombreOriginal: nombre }
      }
      setVentasData(vdata)
      setLoading(l => ({...l, ventas: false}))
    } catch(err) {
      setError('Ventas: ' + err.message)
      setLoading(l => ({...l, ventas: false}))
    }

    // -- Load horarios (sheet "Resumen Mensual") --
    try {
      const gdata = await fetchGviz(HORARIOS_SHEET_ID, 'Resumen Mensual')
      const rows = gdata.table.rows || []
      const hdrCells = (rows[0]?.c || []).map(c => c ? String(c.v||'') : '')
      let colColab = -1, colTienda = -1, colHoras = -1
      for (let j = 0; j < hdrCells.length; j++) {
        const v = hdrCells[j].toLowerCase()
        if (v.includes('colabor')) colColab = j
        else if (v.includes('tienda')) colTienda = j
        else if (v.includes('hora')) colHoras = j
      }
      if (colColab < 0) colColab = 0
      if (colTienda < 0) colTienda = 1
      if (colHoras < 0) colHoras = 2
      const pn = (cell) => { if(!cell||cell.v===null) return 0; return typeof cell.v==='number'?cell.v:parseFloat(String(cell.v).replace(/[^0-9.-]/g,''))||0 }
      const hdata = {}
      for (let i = 1; i < rows.length; i++) {
        const cells = rows[i].c || []
        const colab = String(cells[colColab]?.v||'').trim()
        const tienda = String(cells[colTienda]?.v||'').trim()
        const horas = pn(cells[colHoras])
        if (!colab || !tienda || horas <= 0) continue
        if (!hdata[colab]) hdata[colab] = {}
        hdata[colab][norm(tienda)] = (hdata[colab][norm(tienda)] || 0) + horas
      }
      setHorariosData(hdata)
      setLoading(l => ({...l, horarios: false}))
    } catch(err) {
      setError(e => e + (e?'  |  ':'') + 'Horarios: ' + err.message)
      setLoading(l => ({...l, horarios: false}))
    }

    setSyncStatus('Sincronizado ' + new Date().toLocaleTimeString('es-PE'))
  }, [mes])

  // Auto-load on mount and when mes changes
  useEffect(() => { cargarDesdeSheets(mes) }, [mes])

  // Auto-calculate when both datasets ready
  useEffect(() => {
    if (ventasData && horariosData && config) {
      const res = calcularBonosLocal()
      if (res) setResultados(res)
    }
  }, [ventasData, horariosData, config])

  
  async function cargarVentasDesdeSheets(mesParam) {
    const mesActual = mesParam || mes
    const mesNombre = MESES_ES[parseInt(mesActual.split('-')[1]) - 1]
    setVentasFile('Google Sheets: ' + mesNombre)
    setError('')
    try {
      const url = 'https://docs.google.com/spreadsheets/d/' + VENTAS_SHEET_ID + '/gviz/tq?tqx=out:json&sheet=' + encodeURIComponent(mesNombre)
      const resp = await fetch(url)
      const text = await resp.text()
      const jsonStart = text.indexOf('{')
      const jsonEnd = text.lastIndexOf('}')
      if (jsonStart < 0) { setError('Hoja ' + mesNombre + ' no encontrada en Google Sheets'); setVentasFile(null); return }
      const gdata = JSON.parse(text.substring(jsonStart, jsonEnd + 1))
      const cols = gdata.table.cols || []
      const rows = gdata.table.rows || []

      // Use cols metadata to find column indices
      // col types: 'string' = text, 'number' = number, 'date' = date
      // Find tienda col (string col containing TIENDAS label or first string col)
      let colTienda = -1
      const dateCols = []
      let colMeta = -1

      for (let j = 0; j < cols.length; j++) {
        const col = cols[j]
        const lbl = String(col.label || '').trim().toUpperCase()
        if (col.type === 'string' && lbl === 'TIENDAS') colTienda = j
        if (col.type === 'date') dateCols.push(j)
      }
      // Fallback: first string col is tienda
      if (colTienda < 0) colTienda = cols.findIndex(c => c.type === 'string')

      // Find meta col: number col after date cols whose label contains 'meta' (case insensitive, not 'total')
      for (let j = 0; j < cols.length; j++) {
        const lbl = String(cols[j].label || '').toLowerCase()
        if (lbl.includes('meta') && !lbl.includes('total')) { colMeta = j; break }
      }

      // Last two date cols = ventaAnt, ventaReal
      const colVentas = dateCols.length > 0 ? dateCols[dateCols.length - 1] : -1
      const colVentaAnt = dateCols.length > 1 ? dateCols[dateCols.length - 2] : -1

      if (colTienda < 0 || colVentas < 0) {
        setError('No se pudo detectar columnas en hoja ' + mesNombre + ' (tienda=' + colTienda + ' ventas=' + colVentas + ')')
        return
      }

      const parseNum = (cell) => {
        if (!cell || cell.v === null || cell.v === undefined) return 0
        if (typeof cell.v === 'number') return cell.v
        return parseFloat(String(cell.v).replace(/[^0-9.-]/g, '')) || 0
      }

      const data = {}
      // Skip header row (row 0 has TIENDAS label), start from row 1
      for (let i = 0; i < rows.length; i++) {
        const cells = rows[i].c || []
        const nombreCell = cells[colTienda]
        const nombre = String(nombreCell ? (nombreCell.v || '') : '').trim()
        if (!nombre) continue
        const nombreU = nombre.toUpperCase()
        if (['TIENDAS', 'TOTAL'].includes(nombreU) || nombreU.includes('META')) continue

        const ventaReal = parseNum(cells[colVentas])
        let ventaAnt = colVentaAnt >= 0 ? parseNum(cells[colVentaAnt]) : 0
        // If ventaAnt is 0 but previous numeric col has value, use it (El Refugio case)
        if (ventaAnt === 0 && colVentas > 0) {
          const altVal = parseNum(cells[colVentas - 1])
          if (altVal > 0) ventaAnt = altVal
        }
        const metaAbs = colMeta >= 0 ? parseNum(cells[colMeta]) : 0

        if (ventaReal > 0 || ventaAnt > 0 || metaAbs > 0) {
          data[nombreU] = { ventaReal, metaAbs, ventaAnt, nombreOriginal: nombre }
        }
      }
      if (Object.keys(data).length === 0) {
        setError('No se encontraron tiendas con datos en hoja ' + mesNombre)
        return
      }
      setVentasData(data)
      setError('')
    } catch(err) {
      setError('Error Google Sheets: ' + err.message)
      setVentasFile(null)
    }
  }
  function parsearHorarios(file) {
    setHorariosFile(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type:'array' })
        const data = {}

        // Detect format A: sheets named "Dia N"
        const daySheets = wb.SheetNames.filter(n => /^Dia \d+$/i.test(n.trim()))
        const isRowPerShift = daySheets.length >= 1

        if (isRowPerShift) {
          // FORMAT A: each day sheet has rows [Fecha, Colaborador/a, Tienda, Horas, Notas]
          for (const sheetName of daySheets) {
            const ws = wb.Sheets[sheetName]
            const rawRows = XLSX.utils.sheet_to_json(ws, { header:1, defval:null })
            // Find header row: look for row with "Colaborador" in any cell
            let hdrIdx = -1
            for (let i = 0; i < rawRows.length; i++) {
              const row = rawRows[i] || []
              if (row.some(c => String(c||'').toLowerCase().includes('colaborador'))) {
                hdrIdx = i; break
              }
            }
            if (hdrIdx < 0) continue
            const hdrs = (rawRows[hdrIdx] || []).map(h => norm(String(h||'')))
            const colColab  = hdrs.findIndex(h => h.includes('colaborador'))
            const colTienda = hdrs.findIndex(h => h.includes('tienda'))
            const colHoras  = hdrs.findIndex(h => h.includes('hora'))
            if (colColab < 0 || colTienda < 0 || colHoras < 0) continue

            for (let i = hdrIdx + 1; i < rawRows.length; i++) {
              const row = rawRows[i] || []
              const colab  = String(row[colColab]  || '').trim()
              const tienda = String(row[colTienda] || '').trim()
              const horas  = parseFloat(row[colHoras]) || 0
              if (!colab || !tienda || horas <= 0) continue
              if (!data[colab]) data[colab] = {}
              data[colab][tienda] = (data[colab][tienda] || 0) + horas
            }
          }
          setHorariosData(data)
          setError('')
        } else {
          // FORMAT B/C: single sheet legacy (matrix or row-per-shift)
          const sheetName = wb.SheetNames.find(n => n.toLowerCase().includes('resumen') || n.toLowerCase().includes('mensual')) || wb.SheetNames[0]
          const ws = wb.Sheets[sheetName]
          const rawRows = XLSX.utils.sheet_to_json(ws, { header:1, defval:null })
          // Detect if it is row-per-shift (has a "Tienda" column) or matrix
          let hdrIdx = -1
          for (let i = 0; i < rawRows.length; i++) {
            const row = rawRows[i] || []
            if (row.some(c => String(c||'').toLowerCase().includes('colaborador'))) {
              hdrIdx = i; break
            }
          }
          if (hdrIdx < 0) { setError('No se encontro fila de encabezado en horarios.'); return }
          const hdrs = (rawRows[hdrIdx] || []).map(h => norm(String(h||'')))
          const hasTiendaCol = hdrs.some(h => h === 'tienda')

          if (hasTiendaCol) {
            // Row-per-shift single sheet
            const colColab  = hdrs.findIndex(h => h.includes('colaborador'))
            const colTienda = hdrs.findIndex(h => h === 'tienda')
            const colHoras  = hdrs.findIndex(h => h.includes('hora'))
            for (let i = hdrIdx + 1; i < rawRows.length; i++) {
              const row = rawRows[i] || []
              const colab  = String(row[colColab]  || '').trim()
              const tienda = String(row[colTienda] || '').trim()
              const horas  = parseFloat(row[colHoras]) || 0
              if (!colab || !tienda || horas <= 0) continue
              if (!data[colab]) data[colab] = {}
              data[colab][tienda] = (data[colab][tienda] || 0) + horas
            }
          } else {
            // Legacy matrix format
            const colNames = rawRows[hdrIdx].map(h => String(h||'').trim())
            for (let i = hdrIdx + 1; i < rawRows.length; i++) {
              const row = rawRows[i]
              const nombre = String(row[0]||'').trim()
              if (!nombre || nombre.toUpperCase().includes('TOTAL')) continue
              data[nombre] = {}
              for (let j = 1; j < colNames.length; j++) {
                const colName = colNames[j]
                if (!colName || colName.toUpperCase().includes('TOTAL')) continue
                const h = parseFloat(row[j]) || 0
                if (h > 0) data[nombre][colName] = h
              }
            }
          }
          setHorariosData(data)
          setError('')
        }
      } catch(err) { setError('Error al leer horarios: '+err.message) }
    }
    reader.readAsArrayBuffer(file)
  }
  

  const fmt = (n) => `S/ ${Math.round(n||0).toLocaleString('es-PE')}`
  const fmtDec = (n) => `S/ ${(n||0).toFixed(2)}`
  const pct = (n) => `${(n*100).toFixed(1)}%`

  if (!config) return <div className="loading-screen"><div className="spinner"/><p>{error||'Conectando...'}</p></div>

  const sortedTiendas = config.tiendas.slice().sort((a,b) => a.nombre.localeCompare(b.nombre))
  const isLoading = loading.ventas || loading.horarios

  return (
    <div className="app">
      {showConfig && <ConfigPanel config={config} setConfig={setConfig} onClose={()=>setShowConfig(false)} S={S} supabase={supabase} mes={mes}/>}
      <header className="header">
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <h1 className="logo">Incentivos tiendas</h1>
          <span style={{color:'rgba(255,255,255,0.4)'}}>.</span>
          <select value={mes} onChange={e=>setMes(e.target.value)}
            style={{background:'rgba(255,255,255,0.15)',border:'none',borderRadius:8,color:'#fff',fontSize:14,padding:'6px 12px',cursor:'pointer'}}>
            {MESES_ES.map((nm,i) => {
              const val = hoy.getFullYear() + '-' + String(i+1).padStart(2,'0')
              return <option key={val} value={val} style={{background:'#3730a3',color:'#fff'}}>{nm} {hoy.getFullYear()}</option>
            })}
          </select>
          <span style={{fontSize:11,color:'rgba(255,255,255,0.5)'}}>{syncStatus}</span>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <button onClick={()=>cargarDesdeSheets(mes)} style={{...S.btnSm,background:'rgba(255,255,255,0.15)',color:'#fff',fontSize:11}}
            title="Sincronizar ahora">&#x1f504; Sync</button>
          <button onClick={()=>setShowConfig(true)} style={{...S.btnSm,background:'rgba(255,255,255,0.15)',color:'#fff'}}>Config</button>
        </div>
      </header>

      {error && <div style={{background:'#fef2f2',border:'1px solid #fca5a5',borderRadius:8,padding:'10px 16px',margin:'12px 24px',color:'#7f1d1d',fontSize:13}}>
        {error} <button onClick={()=>setError('')} style={{float:'right',background:'none',border:'none',cursor:'pointer',color:'#7f1d1d'}}>&#x2715;</button>
      </div>}

      {isLoading && <div style={{textAlign:'center',padding:'48px',color:'#6366f1',fontSize:14}}>
        <div className="spinner" style={{margin:'0 auto 12px'}}/> Cargando datos desde Google Sheets...
      </div>}

      {!isLoading && resultados && (() => {
        
      })()}

      {!isLoading && !resultados && !error && <div style={{textAlign:'center',padding:'48px',color:'#9CA3AF',fontSize:14}}>
        Sin datos para {MESES_ES[parseInt(mes.split('-')[1])-1]}. Verifica que el Google Sheet tenga esta hoja.
      </div>}
    </div>
  )
}
