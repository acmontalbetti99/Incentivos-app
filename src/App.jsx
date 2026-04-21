// v6 - Supabase sync, UI identico al original
import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { supabase, loadConfig } from './lib/supabase'
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

const MESES_LABELS = [
  {val:'2026-01',label:'Enero 2026'},{val:'2026-02',label:'Febrero 2026'},
  {val:'2026-03',label:'Marzo 2026'},{val:'2026-04',label:'Abril 2026'},
  {val:'2026-05',label:'Mayo 2026'},{val:'2026-06',label:'Junio 2026'},
  {val:'2026-07',label:'Julio 2026'},{val:'2026-08',label:'Agosto 2026'},
  {val:'2026-09',label:'Setiembre 2026'},{val:'2026-10',label:'Octubre 2026'},
  {val:'2026-11',label:'Noviembre 2026'},{val:'2026-12',label:'Diciembre 2026'},
]

export default function App() {
  const hoy = new Date()
  const mesActual = hoy.getFullYear() + '-' + String(hoy.getMonth()+1).padStart(2,'0')
  const [mes, setMes] = useState(mesActual)
  const [config, setConfig] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
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
  const [syncInfo, setSyncInfo] = useState(null)
  const [metaTotalEmpresa, setMetaTotalEmpresa] = useState(0)

  useEffect(() => {
    loadConfig().then(cfg => {
      setConfig(cfg)
      const rv = {}
      cfg.tiendas.forEach(t => { rv[t.id] = '' })
      setReviews(rv)
    }).catch(e => setError('Error al conectar: ' + e.message))
  }, [])

  useEffect(() => { if (mes) cargarDeSupabase(mes) }, [mes])

  useEffect(() => {
    if (ventasData && horariosData && config) setResultados(calcularBonosLocal())
  }, [ventasData, horariosData, config])

  function setMsg(txt, ok=true) { setConfigMsg(txt); setConfigMsgOk(ok) }

  function openConfig() {
    setEditingTiendas(config?.tiendas?.map(t=>({...t}))||[])
    setEditingEmpleadas(config?.empleadas?.map(e=>({...e}))||[])
    setNewTienda(''); setNewEmpleada(''); setConfigMsg(''); setShowConfig(true)
  }

  async function cargarDeSupabase(m) {
    setLoading(true); setError(''); setVentasData(null); setHorariosData(null); setResultados(null); setSyncInfo(null)
    try {
      const {data:ventas, error:ve} = await supabase.from('incentivos_ventas').select('*').eq('mes', m)
      if (ve) throw new Error('Ventas: ' + ve.message)
      const {data:horarios, error:he} = await supabase.from('incentivos_horarios').select('*').eq('mes', m)
      if (he) throw new Error('Horarios: ' + he.message)
      const {data:logs} = await supabase.from('incentivos_sync_log').select('synced_at').eq('mes',m).eq('status','ok').order('synced_at',{ascending:false}).limit(1)
      if (logs && logs[0]) setSyncInfo(new Date(logs[0].synced_at).toLocaleString('es-PE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}))
      if (!ventas || ventas.length === 0) { setError('Sin datos para este mes. El sync corre cada hora.'); setLoading(false); return }
      const vdata = {}
      ventas.forEach(r => {
        if (r.tienda === '_META_TOTAL') { setMetaTotalEmpresa(r.meta_abs); return }
        vdata[r.tienda] = { ventaReal: r.venta_real, ventaAnt: r.venta_ant, metaAbs: r.meta_abs, nombreOriginal: r.nombre_original }
      })
      setVentasData(vdata)
      const hdata = {}
      if (horarios) horarios.forEach(r => {
        if (!hdata[r.colaboradora]) hdata[r.colaboradora] = {}
        hdata[r.colaboradora][r.tienda] = (hdata[r.colaboradora][r.tienda]||0) + r.horas
      })
      setHorariosData(hdata)
    } catch(err) { setError(err.message) }
    setLoading(false)
  }

  function calcularBonosLocal() {
    if (!ventasData || !horariosData || !config) return null
    const tiendas = config.tiendas
    const empleadas = config.empleadas
    const storeResults = {}

    for (const tienda of tiendas) {
      const key = tienda.nombre.toUpperCase()
      const vd = ventasData[key]
      const ventaReal = vd?.ventaReal || 0
      const metaAbs   = vd?.metaAbs  || 0
      const ventaAnt  = vd?.ventaAnt  || 0
      const crecSoles = ventaReal - ventaAnt
      const crecPct   = ventaAnt > 0 ? crecSoles / ventaAnt : 0
      const cumplimiento = metaAbs > 0 ? ventaReal / metaAbs : 0
      const esRefugio = norm(tienda.nombre).includes('refugio')
      const activaBono = esRefugio ? crecPct >= 0.05 : ventaReal >= VENTA_MIN && crecPct >= CRECIMIENTO_MIN
      const tiendaNorm = norm(tienda.nombre)

      const horasPorColab = {}
      for (const [nombreColab, tiendaHoras] of Object.entries(horariosData)) {
        const h = tiendaHoras[tiendaNorm] || 0
        if (h > 0) horasPorColab[nombreColab] = h
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
      storeResults[key] = { tienda, ventaReal, metaAbs, ventaAnt, crecSoles, crecPct, cumplimiento, activaBono, numColabs, bonoBaseColab, bonoReviews, horasPorColab }
    }

    const resultadosColab = []
    for (const empleada of empleadas) {
      const colabNorm = norm(empleada.nombre)
      const tiendaHorasObj = horariosData[Object.keys(horariosData).find(k => norm(k) === colabNorm)] || {}
      const tiendasTrabajadas = []
      let horasTotal = 0, bonoTotal = 0, bonoRevTotal = 0
      for (const [tiendaNorm2, horas] of Object.entries(tiendaHorasObj)) {
        const tiendaMatch = tiendas.find(t => norm(t.nombre) === tiendaNorm2)
        if (!tiendaMatch || horas <= 0) continue
        const sr = storeResults[tiendaMatch.nombre.toUpperCase()]
        if (!sr) continue
        horasTotal += horas
        tiendasTrabajadas.push(tiendaMatch.nombre)
        if (sr.activaBono) { bonoTotal += sr.bonoBaseColab; bonoRevTotal += sr.bonoReviews }
      }
      if (horasTotal > 0) {
        const totalBono = Math.max(0, bonoTotal + bonoRevTotal)
        resultadosColab.push({ empleada_id: empleada.id, nombre: empleada.nombre, tiendas: tiendasTrabajadas, horas_total: horasTotal, bono_base: bonoTotal, bono_reviews: bonoRevTotal, total_bono: totalBono })
      }
    }
    resultadosColab.sort((a,b) => b.total_bono - a.total_bono)

    const totalVentasEmpresa = tiendas.reduce((s,t) => s + (storeResults[t.nombre.toUpperCase()]?.ventaReal||0), 0)
    const totalMetaEmpresa   = metaTotalEmpresa > 0 ? metaTotalEmpresa : tiendas.reduce((s,t) => s + (storeResults[t.nombre.toUpperCase()]?.metaAbs||0), 0)
    const pctEmpresa = totalMetaEmpresa > 0 ? totalVentasEmpresa / totalMetaEmpresa : 0

    return { storeResults, resultados: resultadosColab, totalVentasEmpresa, META_EMPRESA: totalMetaEmpresa, pctEmpresaLogrado: pctEmpresa, empresaAlcanzo: pctEmpresa >= 1 }
  }

  function exportarExcel() {
    if (!resultados) return
    const data = resultados.resultados.map(r => ({
      'Colaboradora': r.nombre, 'Tiendas': r.tiendas.join(', '), 'Horas': r.horas_total,
      'Bono base (S/)': r.bono_base.toFixed(2), 'Bono reviews (S/)': r.bono_reviews.toFixed(2), 'TOTAL BONO (S/)': r.total_bono.toFixed(2)
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Bonos ' + mes)
    XLSX.writeFile(wb, 'bonos_' + mes + '.xlsx')
  }

  async function resetAndReload() { const cfg = await loadConfig(); setConfig(cfg); return cfg }
  async function addTienda() {
    const n=newTienda.trim(); if(!n) return
    try { await supabase.from('tiendas').insert({nombre:n,activa:true}); const cfg=await resetAndReload(); setEditingTiendas(cfg.tiendas.map(t=>({...t}))); setNewTienda(''); setMsg('Local "'+n+'" anadido.') }
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

  const fmt    = (n) => `S/ ${Math.round(n||0).toLocaleString('es-PE')}`
  const fmtDec = (n) => `S/ ${(n||0).toFixed(2)}`
  const pct    = (n) => `${(n*100).toFixed(1)}%`

  if (!config) return <div className="loading-screen"><div className="spinner"/><p>{error||'Conectando...'}</p></div>

  const sortedTiendas = config.tiendas.slice().sort((a,b) => a.nombre.localeCompare(b.nombre))

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-left">
          <span className="topbar-title">Incentivos tiendas</span>
          <span className="topbar-sep">&middot;</span>
          <select value={mes} onChange={e => { setMes(e.target.value); setResultados(null) }} className="month-input" style={{paddingRight:8}}>
            {MESES_LABELS.map(m => <option key={m.val} value={m.val} style={{background:'#3730a3'}}>{m.label}</option>)}
          </select>
          {syncInfo && <span style={{fontSize:10,color:'rgba(255,255,255,0.5)',marginLeft:4}}>Sync: {syncInfo}</span>}
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <button onClick={() => cargarDeSupabase(mes)} style={{background:'rgba(255,255,255,0.15)',border:'none',borderRadius:6,color:'#fff',fontSize:11,padding:'4px 12px',cursor:'pointer'}}>&#x1f504; Actualizar</button>
          <button onClick={openConfig} style={{background:'rgba(255,255,255,0.18)',border:'none',borderRadius:6,color:'#fff',fontSize:11,padding:'4px 14px',cursor:'pointer'}}>Config</button>
        </div>
      </div>

      {showConfig && (
        <div style={S.configPanel}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
            <span style={{color:'#fff',fontWeight:600,fontSize:15}}>Configuracion</span>
            <button onClick={()=>setShowConfig(false)} style={{background:'none',border:'none',color:'#aaa',fontSize:20,cursor:'pointer'}}>x</button>
          </div>
          <div style={S.section}>
            <strong style={{color:'#fff',fontSize:12,display:'block',marginBottom:4}}>Locales ({editingTiendas.length})</strong>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:5,marginBottom:8}}>
              {editingTiendas.map((t,i)=>(
                <div key={t.id} style={{display:'flex',gap:4,alignItems:'center'}}>
                  <input value={t.nombre} style={{...S.input,flex:1}} onChange={e=>setEditingTiendas(prev=>prev.map((x,j)=>j===i?{...x,nombre:e.target.value}:x))}/>
                  <button onClick={()=>deleteTienda(t)} style={{...S.btnSm,background:'#450a0a',color:'#fca5a5',padding:'5px 8px'}}>x</button>
                </div>
              ))}
            </div>
            <div style={{display:'flex',gap:6,marginBottom:8}}>
              <input value={newTienda} placeholder="Nuevo local..." style={{...S.input,flex:1}} onChange={e=>setNewTienda(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addTienda()}/>
              <button onClick={addTienda} style={{...S.btnSm,...S.btnSuccess}}>+ Anadir</button>
            </div>
            <button onClick={saveTiendas} style={{...S.btnSm,...S.btnPrimary}}>Guardar nombres</button>
          </div>
          <div style={S.section}>
            <strong style={{color:'#fff',fontSize:12,display:'block',marginBottom:4}}>Colaboradoras ({editingEmpleadas.length})</strong>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:5,marginBottom:8}}>
              {editingEmpleadas.map((e)=>(
                <div key={e.id} style={{display:'flex',gap:4,alignItems:'center'}}>
                  <span style={{color:'#ccc',fontSize:11,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.nombre}</span>
                  <button onClick={()=>deleteEmpleada(e)} style={{...S.btnSm,background:'#450a0a',color:'#fca5a5',padding:'3px 7px',fontSize:10}}>x</button>
                </div>
              ))}
            </div>
            <div style={{display:'flex',gap:6}}>
              <input value={newEmpleada} placeholder="Nueva colaboradora..." style={{...S.input,flex:1}} onChange={e=>setNewEmpleada(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addEmpleada()}/>
              <button onClick={addEmpleada} style={{...S.btnSm,...S.btnSuccess}}>+ Anadir</button>
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

      {loading && <div style={{textAlign:'center',padding:'40px',color:'#818CF8'}}><div className="spinner" style={{margin:'0 auto 12px'}}/><p>Cargando datos...</p></div>}

      {!loading && ventasData && (
        <div className="panel">
          <div style={{marginBottom:12}}>
            <div style={{fontSize:12,fontWeight:600,color:'#9FE1CB',marginBottom:8}}>Vista previa ventas por tienda:</div>
            <div className="ventas-summary">
              {config.tiendas.map(tienda => {
                const key = tienda.nombre.toUpperCase()
                const d = ventasData[key]
                const venta = d?.ventaReal || 0
                const ant   = d?.ventaAnt  || 0
                const p = ant > 0 ? (venta - ant) / ant : 0
                return (
                  <div key={tienda.id} className="tienda-chip">
                    <div className="tienda-name">{tienda.nombre}</div>
                    <div className="tienda-total">{fmt(venta)}</div>
                    <div className={`tienda-pct ${p>=0.05?'green':p>=-0.01?'amber':'red'}`}>{ant>0?`${(p*100).toFixed(1)}%`:''}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {!loading && resultados && (
        <div className="panel">
          <div style={{background:resultados.empresaAlcanzo?'rgba(22,163,74,0.15)':'rgba(220,38,38,0.18)',border:`1px solid ${resultados.empresaAlcanzo?'#16A34A':'#DC2626'}`,borderRadius:10,padding:'14px 18px',marginBottom:12,display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
            <div>
              <div style={{fontWeight:700,fontSize:14,color:resultados.empresaAlcanzo?'#166534':'#7f1d1d'}}>
                {resultados.empresaAlcanzo?'META EMPRESA ALCANZADA':'Meta empresa no alcanzada'}
              </div>
              <div style={{fontSize:12,color:resultados.empresaAlcanzo?'#14532d':'#7f1d1d',marginTop:2}}>
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
              {label:'Total bonos',    value:fmt(resultados.resultados.reduce((s,r)=>s+r.total_bono,0))},
              {label:'Colaboradoras', value:resultados.resultados.length},
              {label:'Tiendas con bono', value:`${Object.values(resultados.storeResults).filter(s=>s.activaBono).length}/${config.tiendas.length}`},
              {label:'Cumpl. promedio', value:pct(Object.values(resultados.storeResults).reduce((s,r)=>s+r.cumplimiento,0)/Math.max(config.tiendas.length,1))},
            ].map(m=><div key={m.label} className="metric-card"><div className="metric-label">{m.label}</div><div className="metric-value">{m.value}</div></div>)}
          </div>

          <div className="card">
            <h3>Resultados por tienda</h3>
            <div className="table-scroll">
              <table className="res-table">
                <thead><tr><th>Tienda</th><th>Venta ant.</th><th>Venta act.</th><th>Crec. %</th><th>Crec. S/</th><th>Reviews</th><th style={{color:'#818CF8'}}>Bono base/colab.</th></tr></thead>
                <tbody>
                {sortedTiendas.map(t=>{
                  const sr = resultados.storeResults[t.nombre.toUpperCase()]
                  if (!sr) return null
                  const rv = reviews[t.id]!==''?parseFloat(reviews[t.id]):null
                  const rvLabel = rv!==null&&!isNaN(rv)?rv.toFixed(1)+'*':'-'
                  return (
                    <tr key={t.id}>
                      <td className="bold">{t.nombre}</td>
                      <td>{fmt(sr.ventaAnt)}</td>
                      <td>{fmt(sr.ventaReal)}</td>
                      <td><span className={`badge ${sr.crecPct>=CRECIMIENTO_MIN?'green':'red'}`}>{pct(sr.crecPct)}</span></td>
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
                      const h = horariosData[colabKey]?.[norm(t.nombre)]||0
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
                      const ck = Object.keys(horariosData).find(k=>norm(k)===norm(r.nombre))||''
                      return s + (horariosData[ck]?.[norm(t.nombre)]||0)
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

      {!loading && !ventasData && !error && (
        <div style={{textAlign:'center',padding:'60px',color:'#9CA3AF'}}>
          <p style={{fontSize:15,marginBottom:8}}>Sin datos para {MESES_LABELS.find(m=>m.val===mes)?.label||mes}</p>
          <p style={{fontSize:12}}>El sync corre automaticamente cada hora en punto.</p>
        </div>
      )}
    </div>
  )
}
