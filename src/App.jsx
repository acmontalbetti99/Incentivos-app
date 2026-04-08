import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import {
  supabase, loadConfig, loadColumnMapping, saveColumnMapping,
  saveVentasMes, saveHorarios, saveResultados, loadHorariosMesAnterior,
} from './lib/supabase'
import { calcularBonos, procesarReporteRapifac } from './lib/calculos'
import './App.css'

const STEPS = ['Subir archivo', 'Mapear columnas', 'Horarios', 'Resultados', 'Exportar']
function norm(s) { return String(s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'') }

function cruzarVentasConTiendas(ventasRaw, tiendas) {
  const result = {}, noMatch = []
  for (const [nombreExcel, total] of Object.entries(ventasRaw)) {
    const t = tiendas.find(t => norm(t.nombre) === norm(nombreExcel))
    if (t) result[t.id] = { nombre: t.nombre, total }
    else noMatch.push(nombreExcel)
  }
  return { ventasPorId: result, noMatch }
}

const S = {
  input: { background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.2)', borderRadius:6, color:'#fff', fontSize:12, padding:'5px 8px', width:'100%' },
  btnSm: { border:'none', borderRadius:6, fontSize:12, padding:'6px 14px', cursor:'pointer' },
  btnPrimary: { background:'#4F46E5', color:'#fff' },
  btnDanger: { background:'#7f1d1d', color:'#fca5a5' },
  btnSuccess: { background:'#14532d', color:'#86efac' },
  section: { marginBottom:16, paddingBottom:16, borderBottom:'1px solid rgba(255,255,255,0.08)' },
  configPanel: { background:'#1e1b4b', border:'1px solid #534AB7', borderRadius:10, padding:'1rem 1.25rem', marginBottom:'1rem' },
  msg: (ok) => ({ marginTop:8, padding:'7px 12px', background: ok ? 'rgba(134,239,172,0.12)' : 'rgba(252,165,165,0.12)', borderRadius:6, color: ok ? '#86efac' : '#fca5a5', fontSize:12 }),
}

export default function App() {
  const [step, setStep] = useState(0)
  const [mes, setMes] = useState(() => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` })
  const [config, setConfig] = useState(null)
  const [mapping, setMapping] = useState(null)
  const [savedMapping, setSavedMapping] = useState(null)
  const [rawRows, setRawRows] = useState([])
  const [columns, setColumns] = useState([])
  const [fileName, setFileName] = useState('')
  const [ventasPorId, setVentasPorId] = useState({})
  const [noMatchTiendas, setNoMatchTiendas] = useState([])
  const [horarios, setHorarios] = useState([])
  const [resultados, setResultados] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showConfig, setShowConfig] = useState(false)
  const [configMsg, setConfigMsg] = useState('')
  const [configMsgOk, setConfigMsgOk] = useState(true)
  const [editingTiendas, setEditingTiendas] = useState([])
  const [newTienda, setNewTienda] = useState('')
  const [editingEmpleadas, setEditingEmpleadas] = useState([])
  const [newEmpleada, setNewEmpleada] = useState('')

  useEffect(() => {
    async function init() {
      try { const cfg=await loadConfig(); setConfig(cfg); const m=await loadColumnMapping(); if(m) setSavedMapping(m) }
      catch(e) { setError('Error al conectar con Supabase.') }
    }
    init()
  }, [])

  function openConfig() {
    setEditingTiendas(config?.tiendas?.map(t=>({...t}))||[])
    setEditingEmpleadas(config?.empleadas?.map(e=>({...e}))||[])
    setNewTienda(''); setNewEmpleada(''); setConfigMsg(''); setShowConfig(true)
  }
  function setMsg(txt,ok=true){setConfigMsg(txt);setConfigMsgOk(ok)}

  async function resetMapping() {
    try { await supabase.from('column_mapping').delete().neq('id',0); setSavedMapping(null); setMapping(null); setRawRows([]); setVentasPorId({}); setStep(0); setShowConfig(false) }
    catch(e){setMsg('Error: '+e.message,false)}
  }
  async function addTienda() {
    const nombre=newTienda.trim(); if(!nombre) return
    try { await supabase.from('tiendas').insert({nombre,activa:true,venta_ant:80000,crec_obj:0.05}); const cfg=await loadConfig(); setConfig(cfg); setEditingTiendas(cfg.tiendas.map(t=>({...t}))); setNewTienda(''); setMsg('Local "'+nombre+'" anadido.') }
    catch(e){setMsg('Error: '+e.message,false)}
  }
  async function deleteTienda(t) {
    if(!confirm('Eliminar el local "'+t.nombre+'"?')) return
    try { await supabase.from('tiendas').delete().eq('id',t.id); const cfg=await loadConfig(); setConfig(cfg); setEditingTiendas(cfg.tiendas.map(x=>({...x}))); setMsg('Local "'+t.nombre+'" eliminado.') }
    catch(e){setMsg('Error: '+e.message,false)}
  }
  async function saveTiendas() {
    try { await Promise.all(editingTiendas.map(t=>supabase.from('tiendas').update({nombre:t.nombre.trim()}).eq('id',t.id))); const cfg=await loadConfig(); setConfig(cfg); setEditingTiendas(cfg.tiendas.map(t=>({...t}))); setMsg('Nombres de locales guardados.') }
    catch(e){setMsg('Error: '+e.message,false)}
  }
  async function addEmpleada() {
    const nombre=newEmpleada.trim(); if(!nombre) return
    try { await supabase.from('empleadas').insert({nombre,activa:true}); const cfg=await loadConfig(); setConfig(cfg); setEditingEmpleadas(cfg.empleadas.map(e=>({...e}))); setNewEmpleada(''); setMsg('Colaboradora "'+nombre+'" anadida.') }
    catch(e){setMsg('Error: '+e.message,false)}
  }
  async function deleteEmpleada(emp) {
    if(!confirm('Eliminar a "'+emp.nombre+'"?')) return
    try { await supabase.from('empleadas').delete().eq('id',emp.id); const cfg=await loadConfig(); setConfig(cfg); setEditingEmpleadas(cfg.empleadas.map(x=>({...x}))); setMsg('Colaboradora "'+emp.nombre+'" eliminada.') }
    catch(e){setMsg('Error: '+e.message,false)}
  }

  function cargarHorariosDesdeExcel(file) {
    if(!file) return
    const reader=new FileReader()
    reader.onload=(e)=>{
      try {
        const wb=XLSX.read(e.target.result,{type:'array'})
        const sheetName=wb.SheetNames.find(n=>n.toLowerCase().includes('resumen')||n.toLowerCase().includes('mensual'))||wb.SheetNames[0]
        const ws=wb.Sheets[sheetName]; const rows=XLSX.utils.sheet_to_json(ws,{defval:0})
        if(!rows.length){setError('El archivo esta vacio.');return}
        const cols=Object.keys(rows[0]); const colEmp=cols[0]
        const nuevosHorarios=[]
        for(const row of rows){
          const nombreEmp=String(row[colEmp]||'').trim()
          if(!nombreEmp||nombreEmp.toLowerCase().includes('total')) continue
          const emp=config.empleadas.find(e=>norm(e.nombre)===norm(nombreEmp))
          if(!emp) continue
          for(const col of cols.slice(1)){
            if(norm(col).includes('total')) continue
            const tienda=config.tiendas.find(t=>norm(t.nombre)===norm(col))
            if(!tienda) continue
            const horas=parseFloat(row[col])||0
            if(horas>0) nuevosHorarios.push({empleada_id:emp.id,empleada_nombre:emp.nombre,tienda_id:tienda.id,tienda_nombre:tienda.nombre,horas})
          }
        }
        setHorarios(prev=>{
          const base=prev.filter(h=>!nuevosHorarios.find(n=>n.empleada_id===h.empleada_id&&n.tienda_id===h.tienda_id))
          return [...base,...nuevosHorarios]
        })
        setMsg(nuevosHorarios.length+' registros cargados desde "'+sheetName+'".')
      } catch(err){setError('Error al leer horarios: '+err.message)}
    }
    reader.readAsArrayBuffer(file)
  }

  const handleFile=useCallback((file)=>{
    if(!file) return; setFileName(file.name)
    const reader=new FileReader()
    reader.onload=(e)=>{
      try {
        const wb=XLSX.read(e.target.result,{type:'array'}); const ws=wb.Sheets[wb.SheetNames[0]]
        const rows=XLSX.utils.sheet_to_json(ws,{defval:''})
        if(!rows.length){setError('El archivo esta vacio.');return}
        setRawRows(rows); setColumns(Object.keys(rows[0]))
        if(savedMapping){setMapping(savedMapping);procesarYContinuar(rows,savedMapping)}
        else{const cols=Object.keys(rows[0]);setMapping({col_sucursal:cols[0],col_total:cols[0],col_fecha:cols[0],col_cajero:''});goStep(1)}
      } catch{setError('No se pudo leer el archivo.')}
    }
    reader.readAsArrayBuffer(file)
  },[savedMapping])

  async function procesarYContinuar(rows,map){
    setLoading(true)
    try{
      const cfg=config||await loadConfig()
      const ventasRaw=procesarReporteRapifac(rows,map)
      const{ventasPorId:vpi,noMatch}=cruzarVentasConTiendas(ventasRaw,cfg.tiendas)
      setVentasPorId(vpi);setNoMatchTiendas(noMatch);await saveVentasMes(mes,vpi)
      const horasAnt=await loadHorariosMesAnterior(mes)
      if(horasAnt.length){
        setHorarios(horasAnt.map(h=>({empleada_id:h.empleada_id,empleada_nombre:h.empleadas?.nombre||'',tienda_id:h.tienda_id,tienda_nombre:h.tiendas?.nombre||'',horas:h.horas})))
      } else {
        const filas=[]
        for(const emp of cfg.empleadas) for(const ti of cfg.tiendas) filas.push({empleada_id:emp.id,empleada_nombre:emp.nombre,tienda_id:ti.id,tienda_nombre:ti.nombre,horas:0})
        setHorarios(filas)
      }
      goStep(2)
    } catch(e){setError('Error al procesar: '+e.message)}
    finally{setLoading(false)}
  }

  async function confirmarMapeo(){
    setLoading(true)
    try{await saveColumnMapping(mapping);setSavedMapping(mapping);await procesarYContinuar(rawRows,mapping)}
    catch(e){setError('Error al guardar el mapeo.');setLoading(false)}
  }

  async function calcular(){
    setLoading(true)
    try{
      const ventasMesById=Object.fromEntries(Object.entries(ventasPorId).map(([id,{total}])=>[id,total]))
      const reviewsById={}
      const{data:revData}=await supabase.from('reviews').select('*').eq('mes',mes)
      if(revData) for(const r of revData) reviewsById[r.tienda_id]=r.score
      const resultado=calcularBonos({tiendas:config.tiendas,empleadas:config.empleadas,horarios,ventasMes:ventasMesById,params:config.params,reviews:reviewsById})
      setResultados(resultado)
      await saveHorarios(mes,horarios)
      await saveResultados(mes,resultado.resultados)
      goStep(3)
    } catch(e){setError('Error al calcular: '+e.message)}
    finally{setLoading(false)}
  }

  function exportarExcel(){
    if(!resultados) return
    const data=resultados.resultados.map(r=>({
      'Colaboradora':r.nombre,
      'Tiendas':r.tiendas.join(', '),
      'Horas':r.horas_total,
      'Bono Individual 70% (S/)':r.bono_individual,
      'Bono Empresa 30% (S/)':r.bono_empresa,
      'TOTAL BONO (S/)':r.total_bono,
    }))
    const ws=XLSX.utils.json_to_sheet(data);const wb=XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb,ws,`Bonos ${mes}`);XLSX.writeFile(wb,`bonos_${mes}.xlsx`)
  }

  function goStep(n){setStep(n);setError('')}
  const fmt=(n)=>`S/ ${Math.round(n||0).toLocaleString('es-PE')}`
  const pct=(n)=>`${(n*100).toFixed(1)}%`
  const badge=(pct,tipo)=>{
    const isChica=tipo==='chica'
    if(pct>=1.10) return 'green'
    if(pct>=1.05) return 'green'
    if(pct>=1.00) return 'teal'
    if(pct>=0.95) return 'amber'
    return 'red'
  }
  const tierLabel=(cumpl,tipo)=>{
    if(tipo==='chica'){
      if(cumpl>=1.10) return '110%+ → 110%'
      if(cumpl>=1.05) return '105-109% → 100%'
      if(cumpl>=1.00) return '100-104% → 80%'
      if(cumpl>=0.95) return '95-99% → 25%'
      return '<95% → Sin bono'
    } else {
      if(cumpl>=1.10) return '110%+ → 110%'
      if(cumpl>=1.05) return '105-109% → 105%'
      if(cumpl>=1.00) return '100-104% → 100%'
      if(cumpl>=0.95) return '95-99% → 40%'
      return '<95% → Sin bono'
    }
  }

  if(!config) return <div className="loading-screen"><div className="spinner"/><p>{error||'Conectando...'}</p></div>

  return(
    <div className="app">
      <div className="topbar">
        <div className="topbar-left">
          <span className="topbar-title">Incentivos tiendas</span>
          <span className="topbar-sep">·</span>
          <input type="month" value={mes} onChange={e=>setMes(e.target.value)} className="month-input"/>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          {savedMapping&&<span className="saved-pill">Mapeo guardado</span>}
          <button onClick={openConfig} style={{background:'rgba(255,255,255,0.18)',border:'none',borderRadius:6,color:'#fff',fontSize:11,padding:'4px 14px',cursor:'pointer'}}>⚙ Config</button>
        </div>
      </div>

      {showConfig&&(
        <div style={S.configPanel}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
            <span style={{color:'#fff',fontWeight:600,fontSize:15}}>⚙ Configuracion</span>
            <button onClick={()=>setShowConfig(false)} style={{background:'none',border:'none',color:'#aaa',fontSize:20,cursor:'pointer'}}>×</button>
          </div>
          <div style={S.section}>
            <strong style={{color:'#fff',fontSize:12,display:'block',marginBottom:6}}>Mapeo columnas Rapifac</strong>
            {savedMapping?<div style={{color:'#9FE1CB',fontSize:11,marginBottom:8}}>Guardado — Sucursal: <b>{savedMapping.col_sucursal}</b> · Total: <b>{savedMapping.col_total}</b></div>:<div style={{color:'#F09595',fontSize:11,marginBottom:8}}>Sin mapeo guardado</div>}
            {savedMapping&&<button onClick={resetMapping} style={{...S.btnSm,...S.btnDanger}}>🗑 Resetear mapeo</button>}
          </div>
          <div style={S.section}>
            <strong style={{color:'#fff',fontSize:12,display:'block',marginBottom:4}}>Locales ({editingTiendas.length})</strong>
            <p style={{color:'#aaa',fontSize:11,marginBottom:8}}>Deben coincidir con la columna Sucursal de Rapifac.</p>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:5,marginBottom:8}}>
              {editingTiendas.map((t,i)=>(
                <div key={t.id} style={{display:'flex',gap:4,alignItems:'center'}}>
                  <input value={t.nombre} style={{...S.input,flex:1}} onChange={e=>setEditingTiendas(prev=>prev.map((x,j)=>j===i?{...x,nombre:e.target.value}:x))}/>
                  <button onClick={()=>deleteTienda(t)} style={{...S.btnSm,background:'#450a0a',color:'#fca5a5',padding:'5px 8px',flexShrink:0}}>✕</button>
                </div>
              ))}
            </div>
            <div style={{display:'flex',gap:6,marginBottom:8}}>
              <input value={newTienda} placeholder="Nombre del nuevo local..." style={{...S.input,flex:1}} onChange={e=>setNewTienda(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addTienda()}/>
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
                  <button onClick={()=>deleteEmpleada(e)} style={{...S.btnSm,background:'#450a0a',color:'#fca5a5',padding:'3px 7px',flexShrink:0,fontSize:10}}>✕</button>
                </div>
              ))}
            </div>
            <div style={{display:'flex',gap:6}}>
              <input value={newEmpleada} placeholder="Nombre de la nueva colaboradora..." style={{...S.input,flex:1}} onChange={e=>setNewEmpleada(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addEmpleada()}/>
              <button onClick={addEmpleada} style={{...S.btnSm,...S.btnSuccess,flexShrink:0}}>+ Anadir</button>
            </div>
          </div>
          {configMsg&&<div style={S.msg(configMsgOk)}>{configMsg}</div>}
        </div>
      )}

      <div className="steps-bar">
        {STEPS.map((s,i)=>(
          <div key={i} className={`step-item ${i===step?'active':''} ${i<step?'done':''}`} onClick={()=>i<step&&goStep(i)}>
            <div className="step-circle">{i<step?'✓':i+1}</div>
            <div className="step-label">{s}</div>
          </div>
        ))}
      </div>
      {error&&<div className="error-bar">{error}<button onClick={()=>setError('')}>×</button></div>}

      {step===0&&(
        <div className="panel">
          <div className="card">
            <h3>Reporte de ventas de Rapifac</h3>
            <p className="hint">En Rapifac: <strong>Reportes → Ventas por sucursal → mes → Exportar Excel</strong></p>
            <div className="upload-zone" onDrop={e=>{e.preventDefault();handleFile(e.dataTransfer.files[0])}} onDragOver={e=>e.preventDefault()} onClick={()=>document.getElementById('fi').click()}>
              <div className="upload-icon">↑</div>
              <div className="upload-title">Arrastra el Excel o haz clic para seleccionar</div>
              <div className="upload-sub">.xlsx · .xls · .csv</div>
              <input id="fi" type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}} onChange={e=>handleFile(e.target.files[0])}/>
            </div>
          </div>
          {savedMapping?<div className="info-card purple">Mapeo guardado — Sucursal: <b>{savedMapping.col_sucursal}</b>. Para cambiar usa ⚙ Config → Resetear mapeo.</div>:<div className="info-card teal">Primera vez: sube el Excel y mapea las columnas una sola vez.</div>}
        </div>
      )}

      {step===1&&(
        <div className="panel">
          <div className="card">
            <div className="card-header"><h3>Archivo cargado</h3><span className="file-pill">{fileName}</span></div>
            <div className="table-scroll"><table className="preview-table"><thead><tr>{columns.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{rawRows.slice(0,3).map((r,i)=><tr key={i}>{columns.map(c=><td key={c}>{String(r[c]??'')}</td>)}</tr>)}</tbody></table></div>
          </div>
          <div className="card">
            <h3>Mapear columnas <span className="hint-inline">— solo la primera vez</span></h3>
            <div className="mapper-grid">
              {[{key:'col_sucursal',label:'Sucursal / tienda',req:true},{key:'col_total',label:'Monto total',req:true},{key:'col_fecha',label:'Fecha',req:true},{key:'col_cajero',label:'Cajero',req:false}].map(({key,label,req})=>(
                <div key={key} className="map-item">
                  <label>{label} {req&&<span className="req">*</span>}</label>
                  <select value={mapping?.[key]||''} onChange={e=>setMapping(m=>({...m,[key]:e.target.value}))}>
                    {!req&&<option value="">— no disponible —</option>}
                    {columns.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="card-footer"><span className="hint-small"><span className="req">*</span> Obligatorios</span><button className="btn primary" onClick={confirmarMapeo} disabled={loading}>{loading?'Procesando...':'Guardar y continuar →'}</button></div>
          </div>
        </div>
      )}

      {step===2&&(
        <div className="panel">
          <div className="card">
            <div className="card-header"><h3>Ventas del mes — {mes}</h3><span className="saved-pill">✓ {Object.keys(ventasPorId).length} tiendas</span></div>
            {noMatchTiendas.length>0&&<div className="info-card amber" style={{marginBottom:10}}>⚠ Sin coincidencia: <strong>{noMatchTiendas.join(', ')}</strong><span style={{display:'block',fontSize:11,marginTop:2}}>Usa ⚙ Config → edita los nombres.</span></div>}
            <div className="ventas-summary">
              {config.tiendas.map(tienda=>{
                const v=ventasPorId[tienda.id];const total=v?.total||0
                const meta=tienda.venta_ant*(1+tienda.crec_obj);const p=meta>0?total/meta:0
                return(<div key={tienda.id} className="tienda-chip"><div className="tienda-name">{tienda.nombre}</div><div className="tienda-total">{fmt(total)}</div><div className={`tienda-pct ${p>=1?'green':p>=0.8?'amber':total>0?'red':''}`}>{total>0?pct(p):'—'}</div></div>)
              })}
            </div>
          </div>
          <div className="card">
            <h3>Horas por colaboradora</h3>
            <div style={{display:'flex',gap:16,marginBottom:14,flexWrap:'wrap',alignItems:'flex-start',padding:'12px',background:'rgba(79,70,229,0.08)',borderRadius:8,border:'1px solid rgba(79,70,229,0.2)'}}>
              <div>
                <div style={{color:'#9FE1CB',fontSize:12,fontWeight:600,marginBottom:6}}>📂 Subir Excel de horarios</div>
                <label style={{background:'#4F46E5',color:'#fff',borderRadius:6,padding:'8px 16px',fontSize:12,cursor:'pointer',display:'inline-block'}}>
                  Seleccionar archivo
                  <input type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}} onChange={e=>{cargarHorariosDesdeExcel(e.target.files[0]);e.target.value='';}}/>
                </label>
                {horarios.filter(h=>h.horas>0).length>0&&<span style={{color:'#86efac',fontSize:11,display:'block',marginTop:4}}>✓ {horarios.filter(h=>h.horas>0).length} registros</span>}
              </div>
              <div style={{color:'#6B7280',alignSelf:'center',fontSize:11}}>— o ingresa manualmente →</div>
            </div>
            <div className="table-scroll">
              <table className="hours-table">
                <thead><tr><th className="emp-col">Colaborador/a</th>{config.tiendas.map(t=><th key={t.id} title={t.nombre}>{t.nombre.slice(0,7)}</th>)}<th className="total-col">Total</th></tr></thead>
                <tbody>
                  {config.empleadas.map(emp=>{
                    const empH=config.tiendas.map(ti=>{const h=horarios.find(r=>r.empleada_id===emp.id&&r.tienda_id===ti.id);return h?.horas||0})
                    const tot=empH.reduce((s,h)=>s+h,0)
                    return(<tr key={emp.id}><td className="emp-name">{emp.nombre}</td>
                      {config.tiendas.map((ti,idx)=>(<td key={ti.id}><input type="number" min="0" max="300" value={empH[idx]} className="hours-input"
                        onChange={e=>{const val=parseFloat(e.target.value)||0;setHorarios(prev=>{const next=prev.filter(r=>!(r.empleada_id===emp.id&&r.tienda_id===ti.id));if(val>0)next.push({empleada_id:emp.id,empleada_nombre:emp.nombre,tienda_id:ti.id,tienda_nombre:ti.nombre,horas:val});return next})}}/></td>))}
                      <td className="total-h">{tot}</td></tr>)
                  })}
                </tbody>
              </table>
            </div>
            <div className="card-footer"><span className="hint-small">Puedes usar decimales (ej: 37.5)</span><button className="btn primary" onClick={calcular} disabled={loading}>{loading?'Calculando...':'Calcular bonos →'}</button></div>
          </div>
        </div>
      )}

      {step===3&&resultados&&(
        <div className="panel">
          {/* Banner empresa */}
          <div style={{background:resultados.empresaAlcanzo?'rgba(22,163,74,0.15)':'rgba(220,38,38,0.12)',border:`1px solid ${resultados.empresaAlcanzo?'#16A34A':'#DC2626'}`,borderRadius:10,padding:'14px 18px',marginBottom:12,display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
            <div>
              <div style={{fontWeight:700,fontSize:14,color:resultados.empresaAlcanzo?'#86efac':'#fca5a5'}}>
                {resultados.empresaAlcanzo?'✅ META EMPRESA ALCANZADA':'❌ Meta empresa no alcanzada'}
              </div>
              <div style={{fontSize:12,color:'#ccc',marginTop:2}}>
                Ventas totales: <b>{fmt(resultados.totalVentasEmpresa)}</b> / Meta: <b>{fmt(resultados.META_EMPRESA)}</b> · Cumplimiento: <b>{pct(resultados.pctEmpresaLogrado)}</b>
              </div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:11,color:'#aaa'}}>Componente empresa (30%)</div>
              <div style={{fontSize:16,fontWeight:700,color:resultados.empresaAlcanzo?'#86efac':'#fca5a5'}}>{resultados.empresaAlcanzo?'S/ 600 por colab.':'S/ 0'}</div>
            </div>
          </div>

          {/* Métricas rápidas */}
          <div className="metrics-row">
            {[
              {label:'Total bonos a pagar',value:fmt(resultados.resultados.reduce((s,r)=>s+r.total_bono,0))},
              {label:'Colaboradoras',value:resultados.resultados.length},
              {label:'Tiendas ≥100% meta',value:`${Object.values(resultados.storeResults).filter(s=>s.cumplimiento>=1).length} / ${config.tiendas.length}`},
              {label:'Promedio cumplimiento',value:pct(Object.values(resultados.storeResults).reduce((s,r)=>s+r.cumplimiento,0)/Math.max(config.tiendas.length,1))},
            ].map(m=><div key={m.label} className="metric-card"><div className="metric-label">{m.label}</div><div className="metric-value">{m.value}</div></div>)}
          </div>

          {/* Tabla tiendas */}
          <div className="card">
            <h3>Resultados por tienda</h3>
            <div className="table-scroll">
              <table className="res-table">
                <thead><tr><th>Tienda</th><th>Tipo</th><th>Meta</th><th>Real</th><th>Cumpl.</th><th>Tier</th></tr></thead>
                <tbody>
                  {Object.values(resultados.storeResults).sort((a,b)=>a.tienda.nombre.localeCompare(b.tienda.nombre)).map(sr=>(
                    <tr key={sr.tienda.id}>
                      <td className="bold">{sr.tienda.nombre}</td>
                      <td><span style={{fontSize:10,padding:'2px 7px',borderRadius:10,background:sr.tipo==='grande'?'#1e3a5f':sr.tipo==='mediana'?'#1a3a2a':'#3a1a1a',color:sr.tipo==='grande'?'#93c5fd':sr.tipo==='mediana'?'#86efac':'#fca5a5'}}>{sr.tipo}</span></td>
                      <td>{fmt(sr.meta)}</td>
                      <td>{fmt(sr.ventaReal)}</td>
                      <td><span className={`badge ${badge(sr.cumplimiento,sr.tipo)}`}>{pct(sr.cumplimiento)}</span></td>
                      <td style={{fontSize:11,color:'#9CA3AF'}}>{tierLabel(sr.cumplimiento,sr.tipo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Tabla bonos colaboradoras */}
          <div className="card">
            <h3>Bonos por colaboradora</h3>
            <div style={{fontSize:11,color:'#9CA3AF',marginBottom:8}}>
              S/2,000 total = <span style={{color:'#818CF8'}}>70% individual (S/1,400)</span> + <span style={{color:'#34D399'}}>30% empresa (S/600)</span> — proporcional a horas trabajadas
            </div>
            <div className="table-scroll">
              <table className="res-table">
                <thead><tr><th>Colaboradora</th><th>Tiendas</th><th>Horas</th><th style={{color:'#818CF8'}}>Individual 70%</th><th style={{color:'#34D399'}}>Empresa 30%</th><th>TOTAL</th></tr></thead>
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
          <div className="card-footer standalone">
            <button className="btn" onClick={()=>goStep(2)}>← Ajustar horarios</button>
            <button className="btn primary" onClick={()=>goStep(4)}>Exportar →</button>
          </div>
        </div>
      )}

      {step===4&&(
        <div className="panel"><div className="card">
          <h3>Exportar resultados — {mes}</h3>
          <div className="export-options"><div className="export-item" onClick={exportarExcel}><div className="export-icon green">↓</div><div><div className="export-title">Excel para RR.HH.</div><div className="export-sub">Individual 70% + Empresa 30% · todas las colaboradoras · listo para pago</div></div><span className="export-ext green">.xlsx</span></div></div>
          <div className="success-banner"><div className="success-dot"/><div><div className="success-title">Resultados guardados en Supabase</div><div className="success-sub">Historico disponible desde cualquier dispositivo</div></div></div>
          <div className="card-footer"><span className="hint-small purple">Proximo mes: solo sube el Excel</span><button className="btn" onClick={()=>{setStep(0);setRawRows([]);setResultados(null);setVentasPorId({})}}>Nuevo mes</button></div>
        </div></div>
      )}
    </div>
  )
}