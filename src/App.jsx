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

function UploadCard({ title, subtitle, hint, icon, onFile, status, fileName, done }) {
  return (
    <div style={{background:done?'rgba(22,163,74,0.1)':'rgba(79,70,229,0.07)',border:`2px solid ${done?'#16A34A':'rgba(79,70,229,0.3)'}`,borderRadius:12,padding:'1.2rem',flex:1,minWidth:260}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
        <span style={{fontSize:28}}>{done?'✅':icon}</span>
        <div>
          <div style={{fontWeight:700,fontSize:13,color:done?'#86efac':'#fff'}}>{title}</div>
          <div style={{fontSize:11,color:'#9CA3AF'}}>{subtitle}</div>
        </div>
      </div>
      {hint && <div style={{fontSize:11,color:'#6B7280',marginBottom:10,fontStyle:'italic'}}>{hint}</div>}
      {done
        ? <div style={{fontSize:12,color:'#86efac'}}>{fileName}</div>
        : <label style={{background:'#4F46E5',color:'#fff',borderRadius:6,padding:'8px 18px',fontSize:12,cursor:'pointer',display:'inline-block'}}>
            Seleccionar archivo
            <input type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}} onChange={e=>{onFile(e.target.files[0]);e.target.value='';}}/>
          </label>
      }
      {status && <div style={{marginTop:8,fontSize:11,color:'#F59E0B'}}>{status}</div>}
    </div>
  )
}

export default function App() {
  const [mes, setMes] = useState(() => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` })
  const [config, setConfig] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [ventasFile, setVentasFile] = useState(null)
  const [horariosFile, setHorariosFile] = useState(null)
  const [ventasData, setVentasData] = useState(null)
  const [horariosData, setHorariosData] = useState(null)
  const [resultados, setResultados] = useState(null)

  const [showConfig, setShowConfig] = useState(false)
  const [configMsg, setConfigMsg] = useState('')
  const [configMsgOk, setConfigMsgOk] = useState(true)
  const [editingTiendas, setEditingTiendas] = useState([])
  const [newTienda, setNewTienda] = useState('')
  const [editingEmpleadas, setEditingEmpleadas] = useState([])
  const [newEmpleada, setNewEmpleada] = useState('')
  const [reviews, setReviews] = useState({})

  useEffect(() => {
    loadConfig().then(cfg => {
      setConfig(cfg)
      const rv = {}
      cfg.tiendas.forEach(t => { rv[t.id] = '' })
      setReviews(rv)
    }).catch(e => setError('Error al conectar: '+e.message))
  }, [])

  function setMsg(txt,ok=true){setConfigMsg(txt);setConfigMsgOk(ok)}

  function openConfig() {
    setEditingTiendas(config?.tiendas?.map(t=>({...t}))||[])
    setEditingEmpleadas(config?.empleadas?.map(e=>({...e}))||[])
    setNewTienda(''); setNewEmpleada(''); setConfigMsg(''); setShowConfig(true)
  }

  function parsearVentas(file) {
    setVentasFile(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type:'array', cellDates:true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:null })
        let colTienda=1, colVentas=6, colMeta=9, colVentaAnt=4, dataStartRow=1
        for (let i=0; i<rows.length; i++) {
          const row=rows[i]||[]
          for (let j=0; j<row.length; j++) {
            if (String(row[j]||'').trim().toUpperCase()==='TIENDAS') {
              colTienda=j; dataStartRow=i+1
              let lastDate=-1, lastMeta=-1
              for (let k=j+1; k<row.length; k++) {
                const cell=row[k]
                if (cell instanceof Date) lastDate=k
                if (typeof cell==='string' && cell.toLowerCase().includes('meta') && !cell.toLowerCase().includes('total')) lastMeta=k
              }
              if (lastDate>=0) colVentas=lastDate
              if (lastMeta>=0) colMeta=lastMeta
              colVentaAnt=colVentas-2>=colTienda+1?colVentas-2:colTienda+4
              break
            }
          }
          if (dataStartRow>1) break
        }
        const data={}
        for (let i=dataStartRow; i<rows.length; i++) {
          const row=rows[i]; if(!row) continue
          const nombre=row[colTienda]
          if (!nombre || typeof nombre!=='string') continue
          const nombreU=nombre.trim().toUpperCase()
          if (['TIENDAS','TOTAL'].includes(nombreU)||nombreU.includes('META TO')||nombreU.includes('META EM')) continue
          const ventaReal=typeof row[colVentas]==='number'?row[colVentas]:parseFloat(row[colVentas])||0
          const metaAbs=typeof row[colMeta]==='number'?row[colMeta]:parseFloat(row[colMeta])||0
          const ventaAnt=typeof row[colVentaAnt]==='number'?row[colVentaAnt]:parseFloat(row[colVentaAnt])||0
          if (ventaReal>0||metaAbs>0||ventaAnt>0) data[nombreU]={ventaReal,metaAbs,ventaAnt,nombreOriginal:nombre.trim()}
        }
        setVentasData(data)
        setError('')
      } catch(err) { setError('Error al leer ventas: '+err.message) }
    }
    reader.readAsArrayBuffer(file)
  }

  function parsearHorarios(file) {
    setHorariosFile(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type:'array' })
        const sheetName = wb.SheetNames.find(n => n.toLowerCase().includes('resumen') || n.toLowerCase().includes('mensual')) || wb.SheetNames[0]
        const ws = wb.Sheets[sheetName]
        const rawRows = XLSX.utils.sheet_to_json(ws, { header:1, defval:null })
        let headerRowIdx = -1
        for (let i = 0; i < rawRows.length; i++) {
          const cell = String(rawRows[i][0]||'').trim()
          if (cell.toLowerCase().includes('colaborador') || cell.toLowerCase() === 'nombre') {
            headerRowIdx = i; break
          }
        }
        if (headerRowIdx < 0) { setError('No se encontro fila de encabezado en horarios.'); return }
        const headers = rawRows[headerRowIdx]
        const colNames = headers.map(h => String(h||'').trim())
        const data = {}
        for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
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
        setHorariosData(data)
        setError('')
      } catch(err) { setError('Error al leer horarios: '+err.message) }
    }
    reader.readAsArrayBuffer(file)
  }

  function calcularBonosLocal() {
    if (!ventasData || !horariosData || !config) return null
    const tiendas = config.tiendas
    const empleadas = config.empleadas
    const storeResults = {}
    for (const tienda of tiendas) {
      const matchKey = Object.keys(ventasData).find(k => norm(k) === norm(tienda.nombre))
      const vd = matchKey ? ventasData[matchKey] : null
      const ventaReal = vd?.ventaReal || 0
      const metaAbs = vd?.metaAbs || tienda.meta_actual || 0
      const ventaAnt = vd?.ventaAnt || tienda.venta_ant || 0
      const crecSoles = ventaReal - ventaAnt
      const crecPct = ventaAnt > 0 ? crecSoles / ventaAnt : 0
      const cumplimiento = metaAbs > 0 ? ventaReal / metaAbs : 0
      const activaBono = ventaReal >= VENTA_MIN && crecPct >= CRECIMIENTO_MIN
      const horasPorColab = {}
      for (const [nombreColab, tiendaHoras] of Object.entries(horariosData)) {
        const matchTienda = Object.keys(tiendaHoras).find(k => norm(k) === norm(tienda.nombre))
        if (matchTienda && tiendaHoras[matchTienda] > 0) horasPorColab[nombreColab] = tiendaHoras[matchTienda]
      }
      const numColabs = Object.keys(horasPorColab).length
      const reviewRating = reviews[tienda.id] !== '' ? parseFloat(reviews[tienda.id]) : null
      let bonoReviews = 0
      if (reviewRating !== null && !isNaN(reviewRating)) {
        if (reviewRating > 4.0) bonoReviews = 10
        else if (reviewRating < 4.0) bonoReviews = -5
      }
      let bonoBaseColab = 0
      if (activaBono && numColabs > 0) {
        bonoBaseColab = BONO_BASE + (BONO_PCT * crecSoles / numColabs)
        bonoBaseColab = Math.min(bonoBaseColab, BONO_MAX)
        bonoBaseColab = Math.max(bonoBaseColab, 0)
      }
      storeResults[tienda.id] = { tienda, ventaReal, metaAbs, ventaAnt, crecSoles, crecPct, cumplimiento, activaBono, numColabs, bonoBaseColab, bonoReviews, horasPorColab }
    }
    const resultadosColab = []
    for (const empleada of empleadas) {
      const tiendaHoras = horariosData[Object.keys(horariosData).find(k => norm(k) === norm(empleada.nombre))] || {}
      const tiendasTrabajadas = []
      let horasTotal = 0, bonoTotal = 0, bonoRevTotal = 0
      for (const [tiendaNombre, horas] of Object.entries(tiendaHoras)) {
        const tiendaMatch = tiendas.find(t => norm(t.nombre) === norm(tiendaNombre))
        if (!tiendaMatch || horas <= 0) continue
        const sr = storeResults[tiendaMatch.id]
        if (!sr) continue
        horasTotal += horas
        tiendasTrabajadas.push(tiendaNombre)
        if (sr.activaBono) { bonoTotal += sr.bonoBaseColab; bonoRevTotal += sr.bonoReviews }
      }
      if (horasTotal > 0) {
        const totalBono = Math.max(0, bonoTotal + bonoRevTotal)
        resultadosColab.push({ empleada_id: empleada.id, nombre: empleada.nombre, tiendas: tiendasTrabajadas, horas_total: horasTotal, bono_base: bonoTotal, bono_reviews: bonoRevTotal, total_bono: totalBono, bono_individual: bonoTotal, bono_empresa: 0 })
      }
    }
    resultadosColab.sort((a,b) => b.total_bono - a.total_bono)
    const totalVentasEmpresa = tiendas.reduce((s,t) => s + (storeResults[t.id]?.ventaReal||0), 0)
    const totalMetaEmpresa = tiendas.reduce((s,t) => s + (storeResults[t.id]?.metaAbs||0), 0)
    const pctEmpresa = totalMetaEmpresa > 0 ? totalVentasEmpresa / totalMetaEmpresa : 0
    return { storeResults, resultados: resultadosColab, totalVentasEmpresa, META_EMPRESA: totalMetaEmpresa, pctEmpresaLogrado: pctEmpresa, empresaAlcanzo: pctEmpresa >= 1 }
  }

  async function calcular() {
    if (!ventasData || !horariosData) { setError('Sube los dos archivos primero.'); return }
    setLoading(true); setError('')
    try {
      const res = calcularBonosLocal()
      setResultados(res)
      const horariosArr = []
      for (const [nombreColab, tiendaHoras] of Object.entries(horariosData)) {
        const emp = config.empleadas.find(e => norm(e.nombre) === norm(nombreColab))
        if (!emp) continue
        for (const [nombreTienda, horas] of Object.entries(tiendaHoras)) {
          const tienda = config.tiendas.find(t => norm(t.nombre) === norm(nombreTienda))
          if (!tienda || horas <= 0) continue
          horariosArr.push({ empleada_id: emp.id, empleada_nombre: emp.nombre, tienda_id: tienda.id, tienda_nombre: tienda.nombre, horas })
        }
      }
      await saveHorarios(mes, horariosArr)
      await saveResultados(mes, res.resultados)
      await saveVentasMes(mes, Object.fromEntries(config.tiendas.map(t => [t.id, { total: res.storeResults[t.id]?.ventaReal || 0 }])))
    } catch(e) { setError('Error al calcular: '+e.message) }
    finally { setLoading(false) }
  }

  function exportarExcel() {
    if (!resultados) return
    const data = resultados.resultados.map(r => ({ 'Colaboradora': r.nombre, 'Tiendas': r.tiendas.join(', '), 'Horas': r.horas_total, 'Bono base (S/)': r.bono_base.toFixed(2), 'Bono reviews (S/)': r.bono_reviews.toFixed(2), 'TOTAL BONO (S/)': r.total_bono.toFixed(2) }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, `Bonos ${mes}`)
    XLSX.writeFile(wb, `bonos_${mes}.xlsx`)
  }

  async function resetAndReload() { const cfg = await loadConfig(); setConfig(cfg); return cfg; }

  async function addTienda() {
    const n=newTienda.trim(); if(!n) return
    try { await supabase.from('tiendas').insert({nombre:n,activa:true,venta_ant:80000,crec_obj:0.05}); const cfg=await resetAndReload(); setEditingTiendas(cfg.tiendas.map(t=>({...t}))); setNewTienda(''); setMsg('Local "'+n+'" anadido.') }
    catch(e){setMsg('Error: '+e.message,false)}
  }
  async function deleteTienda(t) {
    if(!confirm('Eliminar "'+t.nombre+'"?')) return
    try { await supabase.from('tiendas').delete().eq('id',t.id); const cfg=await resetAndReload(); setEditingTiendas(cfg.tiendas.map(x=>({...x}))); setMsg('Eliminado.') }
    catch(e){setMsg('Error: '+e.message,false)}
  }
  async function saveTiendas() {
    try { await Promise.all(editingTiendas.map(t=>supabase.from('tiendas').update({nombre:t.nombre.trim()}).eq('id',t.id))); const cfg=await resetAndReload(); setEditingTiendas(cfg.tiendas.map(t=>({...t}))); setMsg('Nombres guardados.') }
    catch(e){setMsg('Error: '+e.message,false)}
  }
  async function addEmpleada() {
    const n=newEmpleada.trim(); if(!n) return
    try { await supabase.from('empleadas').insert({nombre:n,activa:true}); const cfg=await resetAndReload(); setEditingEmpleadas(cfg.empleadas.map(e=>({...e}))); setNewEmpleada(''); setMsg('Colaboradora "'+n+'" anadida.') }
    catch(e){setMsg('Error: '+e.message,false)}
  }
  async function deleteEmpleada(emp) {
    if(!confirm('Eliminar a "'+emp.nombre+'"?')) return
    try { await supabase.from('empleadas').delete().eq('id',emp.id); const cfg=await resetAndReload(); setEditingEmpleadas(cfg.empleadas.map(x=>({...x}))); setMsg('Eliminada.') }
    catch(e){setMsg('Error: '+e.message,false)}
  }

  const fmt = (n) => `S/ ${Math.round(n||0).toLocaleString('es-PE')}`
  const fmtDec = (n) => `S/ ${(n||0).toFixed(2)}`
  const pct = (n) => `${(n*100).toFixed(1)}%`
  const pctS = (n) => `${(n*100).toFixed(1)}%`

  if (!config) return <div className="loading-screen"><div className="spinner"/><p>{error||'Conectando...'}</p></div>

  const sortedTiendas = config.tiendas.slice().sort((a,b)=>a.nombre.localeCompare(b.nombre))

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-left">
          <span className="topbar-title">Incentivos tiendas</span>
          <span className="topbar-sep">&middot;</span>
          <input type="month" value={mes} onChange={e=>setMes(e.target.value)} className="month-input"/>
        </div>
        <button onClick={openConfig} style={{background:'rgba(255,255,255,0.18)',border:'none',borderRadius:6,color:'#fff',fontSize:11,padding:'4px 14px',cursor:'pointer'}}>Config</button>
      </div>

      {showConfig && (
        <div style={S.configPanel}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
            <span style={{color:'#fff',fontWeight:600,fontSize:15}}>Configuracion</span>
            <button onClick={()=>setShowConfig(false)} style={{background:'none',border:'none',color:'#aaa',fontSize:20,cursor:'pointer'}}>x</button>
          </div>
          <div style={S.section}>
            <strong style={{color:'#fff',fontSize:12,display:'block',marginBottom:4}}>Locales ({editingTiendas.length})</strong>
            <p style={{color:'#aaa',fontSize:11,marginBottom:8}}>Deben coincidir con los nombres en el archivo de horarios.</p>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:5,marginBottom:8}}>
              {editingTiendas.map((t,i)=>(
                <div key={t.id} style={{display:'flex',gap:4,alignItems:'center'}}>
                  <input value={t.nombre} style={{...S.input,flex:1}} onChange={e=>setEditingTiendas(prev=>prev.map((x,j)=>j===i?{...x,nombre:e.target.value}:x))}/>
                  <button onClick={()=>deleteTienda(t)} style={{...S.btnSm,background:'#450a0a',color:'#fca5a5',padding:'5px 8px',flexShrink:0}}>x</button>
                </div>
              ))}
            </div>
            <div style={{display:'flex',gap:6,marginBottom:8}}>
              <input value={newTienda} placeholder="Nuevo local..." style={{...S.input,flex:1}} onChange={e=>setNewTienda(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addTienda()}/>
              <button onClick={addTienda} style={{...S.btnSm,...S.btnSuccess,flexShrink:0}}>+ Anadir</button>
            </div>
            <button onClick={saveTiendas} style={{...S.btnSm,...S.btnPrimary}}>Guardar nombres</button>
          </div>
          <div style={S.section}>
            <strong style={{color:'#fff',fontSize:12,display:'block',marginBottom:4}}>Colaboradoras ({editingEmpleadas.length})</strong>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:5,marginBottom:8}}>
              {editingEmpleadas.map((e)=>(
                <div key={e.id} style={{display:'flex',gap:4,alignItems:'center'}}>
                  <span style={{color:'#ccc',fontSize:11,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.nombre}</span>
                  <button onClick={()=>deleteEmpleada(e)} style={{...S.btnSm,background:'#450a0a',color:'#fca5a5',padding:'3px 7px',flexShrink:0,fontSize:10}}>x</button>
                </div>
              ))}
            </div>
            <div style={{display:'flex',gap:6}}>
              <input value={newEmpleada} placeholder="Nueva colaboradora..." style={{...S.input,flex:1}} onChange={e=>setNewEmpleada(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addEmpleada()}/>
              <button onClick={addEmpleada} style={{...S.btnSm,...S.btnSuccess,flexShrink:0}}>+ Anadir</button>
            </div>
          </div>
          <div>
            <strong style={{color:'#fff',fontSize:12,display:'block',marginBottom:4}}>Rating Google Reviews por tienda</strong>
            <p style={{color:'#aaa',fontSize:11,marginBottom:8}}>Mayor a 4.0 = +S/10 | Menor a 4.0 = -S/5 | Sin dato = S/0</p>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6}}>
              {config.tiendas.map(t=>(
                <div key={t.id} style={{display:'flex',alignItems:'center',gap:6}}>
                  <span style={{color:'#ccc',fontSize:11,flex:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{t.nombre}</span>
                  <input type="number" min="1" max="5" step="0.1" placeholder="--" value={reviews[t.id]||''} onChange={e=>setReviews(prev=>({...prev,[t.id]:e.target.value}))} style={{...S.input,width:60,textAlign:'center'}}/>
                </div>
              ))}
            </div>
          </div>
          {configMsg && <div style={S.msg(configMsgOk)}>{configMsg}</div>}
        </div>
      )}

      {error && <div className="error-bar">{error}<button onClick={()=>setError('')}>x</button></div>}

      <div className="panel">
        <div className="card">
          <h3 style={{marginBottom:6}}>Subir archivos del mes {mes}</h3>
          <p className="hint">Sube los dos archivos para calcular los bonos automaticamente.</p>
          <div style={{display:'flex',gap:16,flexWrap:'wrap',marginTop:12}}>
            <UploadCard title="1. Ventas mensual" subtitle="Archivo Excel de ventas por tienda" hint="Col B = tienda  Col G = ventas del mes  Col J = meta" icon="📊" onFile={parsearVentas} fileName={ventasFile} done={!!ventasData} status={ventasData ? ` ${Object.keys(ventasData).length} tiendas leidas` : ''}/>
            <UploadCard title="2. Horarios mensual" subtitle="Excel con horas por colaboradora y tienda" hint="Hoja 'Resumen Mensual'  Col A = colaboradora  Resto = tiendas" icon="📅" onFile={parsearHorarios} fileName={horariosFile} done={!!horariosData} status={horariosData ? ` ${Object.keys(horariosData).length} colaboradoras leidas` : ''}/>
          </div>

          {ventasData && (
            <div style={{marginTop:16}}>
              <div style={{fontSize:12,fontWeight:600,color:'#9FE1CB',marginBottom:8}}>Vista previa ventas por tienda:</div>
              <div className="ventas-summary">
                {config.tiendas.map(tienda => {
                  const match = Object.keys(ventasData).find(k => norm(k) === norm(tienda.nombre))
                  const d = match ? ventasData[match] : null
                  const venta = d?.ventaReal || 0
                  const meta = d?.metaAbs || tienda.meta_actual || (tienda.venta_ant * (1 + (tienda.crec_obj||0.05)))
                  const p = meta > 0 ? venta / meta : 0
                  return (
                    <div key={tienda.id} className="tienda-chip">
                      <div className="tienda-name">{tienda.nombre}</div>
                      <div className="tienda-total">{fmt(venta)}</div>
                      <div className={`tienda-pct ${p>=1?'green':p>=0.8?'amber':venta>0?'red':''}`}>{venta>0?`${(p*100).toFixed(0)}%`:''}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {ventasData && config && (()=>{
            const sinMatch = Object.keys(ventasData).filter(k => !config.tiendas.find(t => norm(t.nombre) === norm(k)))
            return sinMatch.length > 0 ? (
              <div className="info-card amber" style={{marginTop:10}}>
                Estas tiendas del Excel no coinciden con el sistema: <strong>{sinMatch.join(', ')}</strong><br/>
                <span style={{fontSize:11}}>Usa Config para ajustar los nombres.</span>
              </div>
            ) : null
          })()}

          {horariosData && config && (()=>{
            const sinMatch = Object.keys(horariosData).filter(k => !config.empleadas.find(e => norm(e.nombre) === norm(k)))
            return sinMatch.length > 0 ? (
              <div className="info-card amber" style={{marginTop:8}}>
                Estas colaboradoras del Excel no coinciden: <strong>{sinMatch.join(', ')}</strong>
              </div>
            ) : null
          })()}

          <div style={{marginTop:20,display:'flex',justifyContent:'flex-end'}}>
            <button className="btn primary" style={{fontSize:14,padding:'10px 28px'}} onClick={calcular} disabled={loading || !ventasData || !horariosData}>
              {loading ? 'Calculando...' : (ventasData && horariosData ? 'Calcular bonos' : 'Sube los dos archivos para continuar')}
            </button>
          </div>
        </div>
      </div>

      {resultados && (
        <div className="panel">
          <div style={{background:resultados.empresaAlcanzo?'rgba(22,163,74,0.15)':'rgba(220,38,38,0.12)',border:`1px solid ${resultados.empresaAlcanzo?'#16A34A':'#DC2626'}`,borderRadius:10,padding:'14px 18px',marginBottom:12,display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
            <div>
              <div style={{fontWeight:700,fontSize:14,color:resultados.empresaAlcanzo?'#86efac':'#fca5a5'}}>
                {resultados.empresaAlcanzo?'META EMPRESA ALCANZADA':'Meta empresa no alcanzada'}
              </div>
              <div style={{fontSize:12,color:'#ccc',marginTop:2}}>
                Ventas totales: <b>{fmt(resultados.totalVentasEmpresa)}</b> &middot; Meta: <b>{fmt(resultados.META_EMPRESA)}</b> &middot; {pct(resultados.pctEmpresaLogrado)}
              </div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:11,color:'#aaa'}}>Total bonos a pagar</div>
              <div style={{fontSize:18,fontWeight:700,color:'#818CF8'}}>{fmt(resultados.resultados.reduce((s,r)=>s+r.total_bono,0))}</div>
            </div>
          </div>

          <div className="metrics-row">
            {[
              {label:'Total bonos',value:fmt(resultados.resultados.reduce((s,r)=>s+r.total_bono,0))},
              {label:'Colaboradoras',value:resultados.resultados.length},
              {label:'Tiendas con bono',value:`${Object.values(resultados.storeResults).filter(s=>s.activaBono).length}/${config.tiendas.length}`},
              {label:'Cumpl. promedio',value:pct(Object.values(resultados.storeResults).reduce((s,r)=>s+r.cumplimiento,0)/Math.max(config.tiendas.length,1))},
            ].map(m=><div key={m.label} className="metric-card"><div className="metric-label">{m.label}</div><div className="metric-value">{m.value}</div></div>)}
          </div>

          <div className="card">
            <h3>Resultados por tienda</h3>
            <div className="table-scroll">
              <table className="res-table">
                <thead><tr><th>Tienda</th><th>Tipo</th><th>Venta ant.</th><th>Venta act.</th><th>Crec. %</th><th>Crec. S/</th><th>Reviews</th><th style={{color:'#818CF8'}}>Bono base/colab.</th></tr></thead>
                <tbody>
                  {sortedTiendas.map(t=>{
                    const sr = resultados.storeResults[t.id]
                    if (!sr) return null
                    const rv = reviews[t.id]!==''?parseFloat(reviews[t.id]):null
                    const rvLabel = rv!==null&&!isNaN(rv)?rv.toFixed(1)+'★':'-'
                    return (
                      <tr key={t.id}>
                        <td className="bold">{t.nombre}</td>
                        <td><span style={{fontSize:10,padding:'2px 7px',borderRadius:10,background:t.tipo==='grande'?'#1e3a5f':t.tipo==='mediana'?'#1a3a2a':'#3a1a1a',color:t.tipo==='grande'?'#93c5fd':t.tipo==='mediana'?'#86efac':'#fca5a5'}}>{t.tipo||'-'}</span></td>
                        <td>{fmt(sr.ventaAnt)}</td>
                        <td>{fmt(sr.ventaReal)}</td>
                        <td><span className={`badge ${sr.crecPct>=CRECIMIENTO_MIN?'green':'red'}`}>{pctS(sr.crecPct)}</span></td>
                        <td style={{color:sr.crecSoles>=0?'#86efac':'#fca5a5'}}>{sr.crecSoles>=0?'+':''}{fmt(sr.crecSoles)}</td>
                        <td style={{textAlign:'center',color:rv&&rv>4?'#86efac':rv&&rv<4?'#fca5a5':'#aaa'}}>{rvLabel}</td>
                        <td style={{textAlign:'right',color:'#818CF8',fontWeight:600}}>{sr.activaBono?fmtDec(sr.bonoBaseColab):'S/ 0'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h3>Horas trabajadas por colaboradora</h3>
            <div style={{fontSize:11,color:'#9CA3AF',marginBottom:8}}>Horas del mes segun archivo de horarios.</div>
            <div className="table-scroll">
              <table className="res-table">
                <thead>
                  <tr>
                    <th style={{minWidth:110}}>Colaboradora</th>
                    {sortedTiendas.map(t=>(
                      <th key={t.id} style={{width:52,maxWidth:52,padding:'4px 2px',verticalAlign:'bottom',textAlign:'center'}}>
                        <div style={{writingMode:'vertical-rl',transform:'rotate(180deg)',fontSize:10,fontWeight:600,lineHeight:1.2,maxHeight:80,overflow:'hidden',whiteSpace:'nowrap',color:'#cbd5e1'}}>{t.nombre}</div>
                      </th>
                    ))}
                    <th style={{color:'#818CF8',textAlign:'center',minWidth:60}}>Total h.</th>
                    <th style={{color:'#818CF8',textAlign:'right',minWidth:72}}>Bono ind.</th>
                  </tr>
                </thead>
                <tbody>
                  {resultados.resultados.map(r=>(
                    <tr key={r.empleada_id}>
                      <td className="bold" style={{fontSize:11}}>{r.nombre}</td>
                      {sortedTiendas.map(t=>{
                        const colabKey = Object.keys(horariosData).find(k=>norm(k)===norm(r.nombre))||''
                        const tiendaKey = Object.keys(horariosData[colabKey]||{}).find(k=>norm(k)===norm(t.nombre))
                        const h = horariosData[colabKey]?.[tiendaKey]||0
                        return <td key={t.id} style={{textAlign:'center',fontSize:11,fontWeight:h>0?600:400,color:h>0?'#1e293b':'#94a3b8',background:h>0?'#e0e7ff':'transparent',borderRadius:4,padding:'2px 4px'}}>{h>0?h:'-'}</td>
                      })}
                      <td style={{textAlign:'center',fontWeight:700,color:'#818CF8',fontSize:11}}>{r.horas_total}</td>
                      <td style={{textAlign:'right',fontWeight:700,color:'#818CF8',fontSize:11}}>{fmtDec(r.bono_base)}</td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td style={{fontSize:10}}>TOTAL HORAS</td>
                    {sortedTiendas.map(t=>{
                      const tot = resultados.resultados.reduce((s,r)=>{
                        const colabKey = Object.keys(horariosData).find(k=>norm(k)===norm(r.nombre))||''
                        const tiendaKey = Object.keys(horariosData[colabKey]||{}).find(k=>norm(k)===norm(t.nombre))
                        return s + (horariosData[colabKey]?.[tiendaKey]||0)
                      },0)
                      return <td key={t.id} style={{textAlign:'center',fontSize:10}}>{tot||'-'}</td>
                    })}
                    <td style={{textAlign:'center',fontWeight:700}}>{resultados.resultados.reduce((s,r)=>s+r.horas_total,0)}</td>
                    <td style={{textAlign:'right',fontWeight:700,color:'#818CF8'}}>{fmtDec(resultados.resultados.reduce((s,r)=>s+r.bono_base,0))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h3>Bonos por colaboradora</h3>
            <div style={{fontSize:11,color:'#9CA3AF',marginBottom:8}}>
              Formula: S/20 + (4% x crecimiento S/ / num colabs) | Maximo: S/500 | Activa si crec &gt;= 1% y ventas &gt;= S/30,000
            </div>
            <div className="table-scroll">
              <table className="res-table">
                <thead><tr><th>Colaboradora</th><th>Tiendas</th><th>Horas</th><th style={{color:'#818CF8'}}>Bono base</th><th style={{color:'#34D399'}}>Bono reviews</th><th>TOTAL</th></tr></thead>
                <tbody>
                  {resultados.resultados.map(r=>(
                    <tr key={r.empleada_id}>
                      <td className="bold">{r.nombre}</td>
                      <td style={{fontSize:10}}>{r.tiendas.map(t=><span key={t} className="pill">{t}</span>)}</td>
                      <td style={{textAlign:'center'}}>{r.horas_total}</td>
                      <td style={{textAlign:'right',color:'#818CF8'}}>{fmtDec(r.bono_base)}</td>
                      <td style={{textAlign:'right',color:r.bono_reviews>=0?'#34D399':'#fca5a5'}}>{r.bono_reviews!==0?fmtDec(r.bono_reviews):'S/ 0.00'}</td>
                      <td><strong className="total-bono">{fmtDec(r.total_bono)}</strong></td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td colSpan={3}>TOTAL A PAGAR</td>
                    <td style={{textAlign:'right',color:'#818CF8'}}>{fmtDec(resultados.resultados.reduce((s,r)=>s+r.bono_base,0))}</td>
                    <td style={{textAlign:'right',color:'#34D399'}}>{fmtDec(resultados.resultados.reduce((s,r)=>s+r.bono_reviews,0))}</td>
                    <td><strong>{fmtDec(resultados.resultados.reduce((s,r)=>s+r.total_bono,0))}</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div style={{display:'flex',justifyContent:'flex-end',gap:12,marginTop:8}}>
            <button className="btn" onClick={()=>setResultados(null)}>Nuevo mes</button>
            <button className="btn primary" onClick={exportarExcel}>Exportar Excel</button>
          </div>
        </div>
      )}
    </div>
  )
}
