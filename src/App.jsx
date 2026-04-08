import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import {
  supabase, loadConfig, saveHorarios, saveResultados, saveVentasMes,
} from './lib/supabase'
import { calcularBonos } from './lib/calculos'
import './App.css'

function norm(s) { return String(s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'') }

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
        <span style={{fontSize:28}}>{done?'[OK]':icon}</span>
        <div>
          <div style={{fontWeight:700,fontSize:13,color:done?'#86efac':'#fff'}}>{title}</div>
          <div style={{fontSize:11,color:'#9CA3AF'}}>{subtitle}</div>
        </div>
      </div>
      {hint && <div style={{fontSize:11,color:'#6B7280',marginBottom:10,fontStyle:'italic'}}>{hint}</div>}
      {done
        ? <div style={{fontSize:12,color:'#86efac'}}>[OK] {fileName}</div>
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
  // Files
  const [ventasFile, setVentasFile] = useState(null)
  const [horariosFile, setHorariosFile] = useState(null)
  const [ventasData, setVentasData] = useState(null)  // { [tienda_nombre_upper]: { ventaReal, meta } }
  const [horariosData, setHorariosData] = useState(null) // { [colaboradora]: { [tienda]: horas } }
  const [resultados, setResultados] = useState(null)
  // Config panel
  const [showConfig, setShowConfig] = useState(false)
  const [configMsg, setConfigMsg] = useState('')
  const [configMsgOk, setConfigMsgOk] = useState(true)
  const [editingTiendas, setEditingTiendas] = useState([])
  const [newTienda, setNewTienda] = useState('')
  const [editingEmpleadas, setEditingEmpleadas] = useState([])
  const [newEmpleada, setNewEmpleada] = useState('')

  useEffect(() => {
    loadConfig().then(cfg => setConfig(cfg)).catch(e => setError('Error al conectar: '+e.message))
  }, [])

  function setMsg(txt,ok=true){setConfigMsg(txt);setConfigMsgOk(ok)}
  function openConfig() {
    setEditingTiendas(config?.tiendas?.map(t=>({...t}))||[])
    setEditingEmpleadas(config?.empleadas?.map(e=>({...e}))||[])
    setNewTienda(''); setNewEmpleada(''); setConfigMsg(''); setShowConfig(true)
  }

  //  Parsear archivo de VENTAS 
  function parsearVentas(file) {
    setVentasFile(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type:'array', cellDates:true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:null })
        // Find header row with "TIENDAS" dynamically - handles blank first rows
        let colTienda=1, colVentas=6, colMeta=9, dataStartRow=1
        for (let i=0; i<rows.length; i++) {
          const row=rows[i]||[]
          for (let j=0; j<row.length; j++) {
            if (String(row[j]||'').trim().toUpperCase()==='TIENDAS') {
              colTienda=j; dataStartRow=i+1
              let lastDate=-1, lastMeta=-1
              for (let k=j+1; k<row.length; k++) {
                const cell=row[k]
                // cellDates:true makes date headers actual Date objects
                if (cell instanceof Date) lastDate=k
                if (typeof cell==='string' && cell.toLowerCase().includes('meta') && !cell.toLowerCase().includes('total')) lastMeta=k
              }
              if (lastDate>=0) colVentas=lastDate
              if (lastMeta>=0) colMeta=lastMeta
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
          const ventaAnt=typeof row[colTienda+4]==='number'?row[colTienda+4]:parseFloat(row[colTienda+4])||0
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
        // Use raw arrays to handle multi-row headers
        const rawRows = XLSX.utils.sheet_to_json(ws, { header:1, defval:null })
        // Find header row: the row that has "Colaborador" in col 0
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
  }  }

  //  CALCULAR BONOS 
  async function calcular() {
    if (!ventasData || !horariosData) { setError('Sube los dos archivos primero.'); return }
    setLoading(true); setError('')
    try {
      const cfg = config || await loadConfig()
      const params = cfg.params

      // Build ventasMes by tienda_id using ventas file
      const ventasMes = {}
      const metasOverride = {}  // meta real del archivo
      for (const tienda of cfg.tiendas) {
        const keyU = tienda.nombre.toUpperCase()
        const match = Object.keys(ventasData).find(k => norm(k) === norm(tienda.nombre))
        if (match) {
          ventasMes[tienda.id] = ventasData[match].ventaReal
          // Use meta from file if available, else use Supabase meta
          if (ventasData[match].metaAbs > 0) metasOverride[tienda.nombre] = ventasData[match].metaAbs
        }
      }

      // Save ventas to Supabase
      await saveVentasMes(mes, Object.fromEntries(
        cfg.tiendas.map(t => [t.id, { total: ventasMes[t.id] || 0 }])
      ))

      // Build horarios from file
      const horarios = []
      for (const [nombreColab, tiendaHoras] of Object.entries(horariosData)) {
        const emp = cfg.empleadas.find(e => norm(e.nombre) === norm(nombreColab))
        if (!emp) continue
        for (const [nombreTienda, horas] of Object.entries(tiendaHoras)) {
          const tienda = cfg.tiendas.find(t => norm(t.nombre) === norm(nombreTienda))
          if (!tienda || horas <= 0) continue
          horarios.push({ empleada_id: emp.id, empleada_nombre: emp.nombre, tienda_id: tienda.id, tienda_nombre: tienda.nombre, horas })
        }
      }

      // Override metas in params if file provided them
      if (Object.keys(metasOverride).length > 0) {
        let metas = {}
        try { metas = JSON.parse(params.metas_tienda || '{}') } catch {}
        for (const [nombre, meta] of Object.entries(metasOverride)) {
          const key = Object.keys(metas).find(k => norm(k) === norm(nombre))
          if (key) metas[key].meta = meta
        }
        params.metas_tienda = JSON.stringify(metas)
      }

      console.log('DEBUG horarios count:', horarios.length)
      console.log('DEBUG horarios sample:', JSON.stringify(horarios.slice(0,3)))
      console.log('DEBUG horariosData keys:', Object.keys(horariosData).slice(0,5))
      console.log('DEBUG empleadas names:', cfg.empleadas.map(e=>e.nombre).slice(0,5))
      console.log('DEBUG ventasMes:', JSON.stringify(ventasMes))
      const resultado = calcularBonos({ tiendas: cfg.tiendas, empleadas: cfg.empleadas, horarios, ventasMes, params, reviews: {} })
      setResultados(resultado)
      await saveHorarios(mes, horarios)
      await saveResultados(mes, resultado.resultados)
    } catch(e) { setError('Error al calcular: '+e.message) }
    finally { setLoading(false) }
  }

  //  EXPORTAR 
  function exportarExcel() {
    if (!resultados) return
    const data = resultados.resultados.map(r => ({
      'Colaboradora': r.nombre,
      'Tiendas': r.tiendas.join(', '),
      'Horas': r.horas_total,
      'Bono Individual 70% (S/)': r.bono_individual,
      'Bono Empresa 30% (S/)': r.bono_empresa,
      'TOTAL BONO (S/)': r.total_bono,
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, `Bonos ${mes}`)
    XLSX.writeFile(wb, `bonos_${mes}.xlsx`)
  }

  //  CONFIG CRUD 
  async function resetAndReload() { const cfg = await loadConfig(); setConfig(cfg); return cfg; }
  async function addTienda() {
    const n=newTienda.trim(); if(!n) return
    try { await supabase.from('tiendas').insert({nombre:n,activa:true,venta_ant:80000,crec_obj:0.05}); const cfg=await resetAndReload(); setEditingTiendas(cfg.tiendas.map(t=>({...t}))); setNewTienda(''); setMsg('Local "'+n+'" aadido.') }
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
    try { await supabase.from('empleadas').insert({nombre:n,activa:true}); const cfg=await resetAndReload(); setEditingEmpleadas(cfg.empleadas.map(e=>({...e}))); setNewEmpleada(''); setMsg('Colaboradora "'+n+'" aadida.') }
    catch(e){setMsg('Error: '+e.message,false)}
  }
  async function deleteEmpleada(emp) {
    if(!confirm('Eliminar a "'+emp.nombre+'"?')) return
    try { await supabase.from('empleadas').delete().eq('id',emp.id); const cfg=await resetAndReload(); setEditingEmpleadas(cfg.empleadas.map(x=>({...x}))); setMsg('Eliminada.') }
    catch(e){setMsg('Error: '+e.message,false)}
  }

  const fmt = (n) => `S/ ${Math.round(n||0).toLocaleString('es-PE')}`
  const pct = (n) => `${(n*100).toFixed(1)}%`

  if (!config) return <div className="loading-screen"><div className="spinner"/><p>{error||'Conectando...'}</p></div>

  return (
    <div className="app">
      {/* TOPBAR */}
      <div className="topbar">
        <div className="topbar-left">
          <span className="topbar-title">Incentivos tiendas</span>
          <span className="topbar-sep">&middot;</span>
          <input type="month" value={mes} onChange={e=>setMes(e.target.value)} className="month-input"/>
        </div>
        <button onClick={openConfig} style={{background:'rgba(255,255,255,0.18)',border:'none',borderRadius:6,color:'#fff',fontSize:11,padding:'4px 14px',cursor:'pointer'}}> Config</button>
      </div>

      {/* CONFIG PANEL */}
      {showConfig && (
        <div style={S.configPanel}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
            <span style={{color:'#fff',fontWeight:600,fontSize:15}}> Configuracion</span>
            <button onClick={()=>setShowConfig(false)} style={{background:'none',border:'none',color:'#aaa',fontSize:20,cursor:'pointer'}}></button>
          </div>
          <div style={S.section}>
            <strong style={{color:'#fff',fontSize:12,display:'block',marginBottom:4}}>Locales ({editingTiendas.length})</strong>
            <p style={{color:'#aaa',fontSize:11,marginBottom:8}}>Deben coincidir con los nombres en el archivo de horarios.</p>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:5,marginBottom:8}}>
              {editingTiendas.map((t,i)=>(
                <div key={t.id} style={{display:'flex',gap:4,alignItems:'center'}}>
                  <input value={t.nombre} style={{...S.input,flex:1}} onChange={e=>setEditingTiendas(prev=>prev.map((x,j)=>j===i?{...x,nombre:e.target.value}:x))}/>
                  <button onClick={()=>deleteTienda(t)} style={{...S.btnSm,background:'#450a0a',color:'#fca5a5',padding:'5px 8px',flexShrink:0}}></button>
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
                  <button onClick={()=>deleteEmpleada(e)} style={{...S.btnSm,background:'#450a0a',color:'#fca5a5',padding:'3px 7px',flexShrink:0,fontSize:10}}></button>
                </div>
              ))}
            </div>
            <div style={{display:'flex',gap:6}}>
              <input value={newEmpleada} placeholder="Nueva colaboradora..." style={{...S.input,flex:1}} onChange={e=>setNewEmpleada(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addEmpleada()}/>
              <button onClick={addEmpleada} style={{...S.btnSm,...S.btnSuccess,flexShrink:0}}>+ Anadir</button>
            </div>
          </div>
          {configMsg && <div style={S.msg(configMsgOk)}>{configMsg}</div>}
        </div>
      )}

      {error && <div className="error-bar">{error}<button onClick={()=>setError('')}></button></div>}

      {/* UPLOAD SECTION */}
      <div className="panel">
        <div className="card">
          <h3 style={{marginBottom:6}}>Subir archivos del mes  {mes}</h3>
          <p className="hint">Sube los dos archivos para calcular los bonos automticamente.</p>
          <div style={{display:'flex',gap:16,flexWrap:'wrap',marginTop:12}}>
            <UploadCard
              title="1. Ventas mensual"
              subtitle="Archivo Excel de ventas por tienda"
              hint="Columna B = tienda  Columna G = ventas del mes  Columna J = meta"
              icon=""
              onFile={parsearVentas}
              fileName={ventasFile}
              done={!!ventasData}
              status={ventasData ? ` ${Object.keys(ventasData).length} tiendas ledas` : ''}
            />
            <UploadCard
              title="2. Horarios mensual"
              subtitle="Excel con horas por colaboradora y tienda"
              hint="Hoja 'Resumen Mensual'  Columna A = colaboradora  Resto = tiendas"
              icon=""
              onFile={parsearHorarios}
              fileName={horariosFile}
              done={!!horariosData}
              status={horariosData ? ` ${Object.keys(horariosData).length} colaboradoras ledas` : ''}
            />
          </div>

          {/* Preview de ventas si estn cargadas */}
          {ventasData && (
            <div style={{marginTop:16}}>
              <div style={{fontSize:12,fontWeight:600,color:'#9FE1CB',marginBottom:8}}>Vista previa  ventas por tienda:</div>
              <div className="ventas-summary">
                {config.tiendas.map(tienda => {
                  const match = Object.keys(ventasData).find(k => norm(k) === norm(tienda.nombre))
                  const d = match ? ventasData[match] : null
                  const venta = d?.ventaReal || 0
                  const meta  = d?.metaAbs || (tienda.venta_ant * (1 + tienda.crec_obj))
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

          {/* Warning si hay nombres sin match */}
          {ventasData && config && (() => {
            const sinMatch = Object.keys(ventasData).filter(k => !config.tiendas.find(t => norm(t.nombre) === norm(k)))
            return sinMatch.length > 0 ? (
              <div className="info-card amber" style={{marginTop:10}}>
                 Estas tiendas del Excel no coinciden con el sistema: <strong>{sinMatch.join(', ')}</strong><br/>
                <span style={{fontSize:11}}>Usa  Config para ajustar los nombres.</span>
              </div>
            ) : null
          })()}

          {horariosData && config && (() => {
            const sinMatch = Object.keys(horariosData).filter(k => !config.empleadas.find(e => norm(e.nombre) === norm(k)))
            return sinMatch.length > 0 ? (
              <div className="info-card amber" style={{marginTop:8}}>
                 Estas colaboradoras del Excel no coinciden: <strong>{sinMatch.join(', ')}</strong>
              </div>
            ) : null
          })()}

          {/* BOTN CALCULAR */}
          <div style={{marginTop:20,display:'flex',justifyContent:'flex-end'}}>
            <button className="btn primary" style={{fontSize:14,padding:'10px 28px'}}
              onClick={calcular}
              disabled={loading || !ventasData || !horariosData}>
              {loading ? 'Calculando...' : (ventasData && horariosData ? ' Calcular bonos' : 'Sube los dos archivos para continuar')}
            </button>
          </div>
        </div>
      </div>

      {/* RESULTADOS */}
      {resultados && (
        <div className="panel">
          {/* Banner empresa */}
          <div style={{background:resultados.empresaAlcanzo?'rgba(22,163,74,0.15)':'rgba(220,38,38,0.12)',border:`1px solid ${resultados.empresaAlcanzo?'#16A34A':'#DC2626'}`,borderRadius:10,padding:'14px 18px',marginBottom:12,display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
            <div>
              <div style={{fontWeight:700,fontSize:14,color:resultados.empresaAlcanzo?'#86efac':'#fca5a5'}}>
                {resultados.empresaAlcanzo?' META EMPRESA ALCANZADA':' Meta empresa no alcanzada'}
              </div>
              <div style={{fontSize:12,color:'#ccc',marginTop:2}}>
                Ventas totales: <b>{fmt(resultados.totalVentasEmpresa)}</b>  Meta: <b>{fmt(resultados.META_EMPRESA)}</b>  {pct(resultados.pctEmpresaLogrado)}
              </div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:11,color:'#aaa'}}>Componente empresa (30%)</div>
              <div style={{fontSize:16,fontWeight:700,color:resultados.empresaAlcanzo?'#86efac':'#fca5a5'}}>{resultados.empresaAlcanzo?'S/ 600':'S/ 0'}</div>
            </div>
          </div>

          {/* Mtricas */}
          <div className="metrics-row">
            {[
              {label:'Total bonos',value:fmt(resultados.resultados.reduce((s,r)=>s+r.total_bono,0))},
              {label:'Colaboradoras',value:resultados.resultados.length},
              {label:'Tiendas 100%',value:`${Object.values(resultados.storeResults).filter(s=>s.cumplimiento>=1).length}/${config.tiendas.length}`},
              {label:'Cumpl. promedio',value:pct(Object.values(resultados.storeResults).reduce((s,r)=>s+r.cumplimiento,0)/Math.max(config.tiendas.length,1))},
            ].map(m=><div key={m.label} className="metric-card"><div className="metric-label">{m.label}</div><div className="metric-value">{m.value}</div></div>)}
          </div>

          {/* Tabla tiendas */}
          <div className="card">
            <h3>Resultados por tienda</h3>
            <div className="table-scroll">
              <table className="res-table">
                <thead><tr><th>Tienda</th><th>Tipo</th><th>Meta</th><th>Real</th><th>Cumpl.</th><th>Tier aplicado</th><th style={{color:'#818CF8'}}>Bono base</th></tr></thead>
                <tbody>
                  {Object.values(resultados.storeResults).sort((a,b)=>a.tienda.nombre.localeCompare(b.tienda.nombre)).map(sr=>{
                    const isChica=sr.tipo==='chica'
                    const tierLabel = sr.cumplimiento>=1.10?'>=110% (110%)':sr.cumplimiento>=1.05?(isChica?'105-109% (100%)':'105-109% (105%)'):sr.cumplimiento>=1.00?(isChica?'100-104% (80%)':'100-104% (100%)'):sr.cumplimiento>=0.95?(isChica?'95-99% (25%)':'95-99% (40%)'):'<95% (0%)'
                    const bColor=sr.cumplimiento>=1?'green':sr.cumplimiento>=0.95?'teal':sr.cumplimiento>=0.8?'amber':'red'
                    return(
                      <tr key={sr.tienda.id}>
                        <td className="bold">{sr.tienda.nombre}</td>
                        <td><span style={{fontSize:10,padding:'2px 7px',borderRadius:10,background:sr.tipo==='grande'?'#1e3a5f':sr.tipo==='mediana'?'#1a3a2a':'#3a1a1a',color:sr.tipo==='grande'?'#93c5fd':sr.tipo==='mediana'?'#86efac':'#fca5a5'}}>{sr.tipo}</span></td>
                        <td>{fmt(sr.meta)}</td>
                        <td>{fmt(sr.ventaReal)}</td>
                        <td><span className={`badge ${bColor}`}>{pct(sr.cumplimiento)}</span></td>
                        <td style={{fontSize:11,color:'#9CA3AF'}}>{tierLabel}</td><td style={{textAlign:'right',color:'#818CF8',fontWeight:600}}>{sr.tierPct>0?fmt(1400*sr.tierPct):'S/ 0'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tabla colaboradoras */}
          <div className="card">
            <h3>Horas trabajadas por colaboradora</h3>
            <div style={{fontSize:11,color:'#9CA3AF',marginBottom:8}}>Horas del mes segun archivo de horarios. El bono individual se prorratea por horas en cada tienda.</div>
            <div className="table-scroll">
              <table className="res-table">
                <thead>
                  <tr>
                    <th>Colaboradora</th>
                    {Object.values(resultados.storeResults).sort((a,b)=>a.tienda.nombre.localeCompare(b.tienda.nombre)).map(sr=>(
                      <th key={sr.tienda.id} style={{fontSize:9,textAlign:'center',padding:'4px 3px'}}>{sr.tienda.nombre.replace('San ','S.')}</th>
                    ))}
                    <th style={{color:'#818CF8',textAlign:'center'}}>Total h.</th>
                    <th style={{color:'#818CF8',textAlign:'right'}}>Bono ind.</th>
                  </tr>
                </thead>
                <tbody>
                  {resultados.resultados.map(r=>{
                    const sorted = Object.values(resultados.storeResults).sort((a,b)=>a.tienda.nombre.localeCompare(b.tienda.nombre))
                    return (
                      <tr key={r.empleada_id}>
                        <td className="bold" style={{fontSize:11}}>{r.nombre}</td>
                        {sorted.map(sr=>{
                          const h = horariosData?.[r.nombre]?.[sr.tienda.nombre] || 0
                          return <td key={sr.tienda.id} style={{textAlign:'center',fontSize:10,color:h>0?'#fff':'#374151'}}>{h>0?h:'-'}</td>
                        })}
                        <td style={{textAlign:'center',fontWeight:700,color:'#818CF8',fontSize:11}}>{r.horas_total}</td>
                        <td style={{textAlign:'right',fontWeight:700,color:'#818CF8',fontSize:11}}>{fmt(r.bono_individual)}</td>
                      </tr>
                    )
                  })}
                  <tr className="total-row">
                    <td style={{fontSize:10}}>TOTAL HORAS</td>
                    {Object.values(resultados.storeResults).sort((a,b)=>a.tienda.nombre.localeCompare(b.tienda.nombre)).map(sr=>{
                      const tot = resultados.resultados.reduce((s,r)=>s+(horariosData?.[r.nombre]?.[sr.tienda.nombre]||0),0)
                      return <td key={sr.tienda.id} style={{textAlign:'center',fontSize:10}}>{tot||'-'}</td>
                    })}
                    <td style={{textAlign:'center',fontWeight:700}}>{resultados.resultados.reduce((s,r)=>s+r.horas_total,0)}</td>
                    <td style={{textAlign:'right',fontWeight:700,color:'#818CF8'}}>{fmt(resultados.resultados.reduce((s,r)=>s+r.bono_individual,0))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h3>Bonos por colaboradora</h3>
            <div style={{fontSize:11,color:'#9CA3AF',marginBottom:8}}>S/2,000 = <span style={{color:'#818CF8'}}>70% individual (S/1,400)</span> + <span style={{color:'#34D399'}}>30% empresa (S/600)</span> proporcional a horas</div>
            <div className="table-scroll">
              <table className="res-table">
                <thead><tr><th>Colaboradora</th><th>Tiendas</th><th>Horas</th><th style={{color:'#818CF8'}}>Individual</th><th style={{color:'#34D399'}}>Empresa</th><th>TOTAL</th></tr></thead>
                <tbody>
                  {resultados.resultados.map(r=>(
                    <tr key={r.empleada_id}>
                      <td className="bold">{r.nombre}</td>
                      <td style={{fontSize:10}}>{r.tiendas.map(t=><span key={t} className="pill">{t}</span>)}</td>
                      <td style={{textAlign:'center'}}>{r.horas_total}</td>
                      <td style={{textAlign:'right',color:'#818CF8'}}>{fmt(r.bono_individual)}</td>
                      <td style={{textAlign:'right',color:'#34D399'}}>{fmt(r.bono_empresa)}</td>
                      <td><strong className="total-bono">{fmt(r.total_bono)}</strong></td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td colSpan={3}>TOTAL A PAGAR</td>
                    <td style={{textAlign:'right',color:'#818CF8'}}>{fmt(resultados.resultados.reduce((s,r)=>s+r.bono_individual,0))}</td>
                    <td style={{textAlign:'right',color:'#34D399'}}>{fmt(resultados.resultados.reduce((s,r)=>s+r.bono_empresa,0))}</td>
                    <td><strong>{fmt(resultados.resultados.reduce((s,r)=>s+r.total_bono,0))}</strong></td>
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