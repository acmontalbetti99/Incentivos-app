// v5 - auto-sync desde Google Sheets via Supabase
import { useState, useEffect } from 'react'
import { supabase, loadConfig } from './lib/supabase'
import './App.css'

function norm(s) { return String(s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'') }
const BONO_BASE = 20, BONO_PCT = 0.04, BONO_MAX = 500, VENTA_MIN = 30000, CRECIMIENTO_MIN = 0.01
const MESES_LABELS = [
  {val:'2026-01',label:'Enero 2026'},{val:'2026-02',label:'Febrero 2026'},
  {val:'2026-03',label:'Marzo 2026'},{val:'2026-04',label:'Abril 2026'},
  {val:'2026-05',label:'Mayo 2026'},{val:'2026-06',label:'Junio 2026'},
  {val:'2026-07',label:'Julio 2026'},{val:'2026-08',label:'Agosto 2026'},
  {val:'2026-09',label:'Setiembre 2026'},{val:'2026-10',label:'Octubre 2026'},
  {val:'2026-11',label:'Noviembre 2026'},{val:'2026-12',label:'Diciembre 2026'},
]
const S = {
  input:{background:'rgba(255,255,255,0.08)',border:'1px solid rgba(255,255,255,0.2)',borderRadius:6,color:'#fff',fontSize:12,padding:'5px 8px',width:'100%'},
  btnSm:{border:'none',borderRadius:6,fontSize:12,padding:'6px 14px',cursor:'pointer'},
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


function App() {
  const hoy = new Date()
  const mesActual = hoy.getFullYear()+'-'+String(hoy.getMonth()+1).padStart(2,'0')
  const [mes, setMes] = useState(mesActual)
  const [config, setConfig] = useState(null)
  const [ventasData, setVentasData] = useState(null)
  const [horariosData, setHorariosData] = useState(null)
  const [resultados, setResultados] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showConfig, setShowConfig] = useState(false)
  const [syncInfo, setSyncInfo] = useState(null)

  useEffect(() => { loadConfig().then(cfg => { if(cfg) setConfig(cfg) }) }, [])
  useEffect(() => { if(mes) cargarDeSupabase(mes) }, [mes])
  useEffect(() => {
    if(ventasData && horariosData && config) setResultados(calcularBonosLocal())
  }, [ventasData, horariosData, config])

  async function cargarDeSupabase(m) {
    setLoading(true); setError(''); setVentasData(null); setHorariosData(null); setResultados(null); setSyncInfo(null)
    try {
      const {data:ventas,error:ve} = await supabase.from('incentivos_ventas').select('*').eq('mes',m)
      if(ve) throw new Error('Ventas: '+ve.message)
      const {data:horarios,error:he} = await supabase.from('incentivos_horarios').select('*').eq('mes',m)
      if(he) throw new Error('Horarios: '+he.message)
      const {data:logs} = await supabase.from('incentivos_sync_log').select('synced_at').eq('mes',m).eq('status','ok').order('synced_at',{ascending:false}).limit(1)
      if(logs&&logs[0]) setSyncInfo(new Date(logs[0].synced_at).toLocaleString('es-PE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}))
      if(!ventas||ventas.length===0){setError('Sin datos para este mes. El sync corre cada hora en punto.');setLoading(false);return}
      const vdata={}
      ventas.forEach(r=>{vdata[r.tienda]={ventaReal:r.venta_real,ventaAnt:r.venta_ant,metaAbs:r.meta_abs,nombreOriginal:r.nombre_original}})
      setVentasData(vdata)
      const hdata={}
      if(horarios) horarios.forEach(r=>{if(!hdata[r.colaboradora])hdata[r.colaboradora]={};hdata[r.colaboradora][r.tienda]=(hdata[r.colaboradora][r.tienda]||0)+r.horas})
      setHorariosData(hdata)
    } catch(err){setError(err.message)}
    setLoading(false)
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
      const esRefugio = norm(tienda.nombre).includes('refugio')
      const activaBono = esRefugio
        ? crecPct >= 0.05
        : ventaReal >= VENTA_MIN && crecPct >= CRECIMIENTO_MIN
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

  if(!config) return <div className="loading-screen"><div className="spinner"/><p>Conectando...</p></div>

  return (
    <div className="app">
      {showConfig && <ConfigPanel config={config} setConfig={setConfig} onClose={()=>setShowConfig(false)} S={S} supabase={supabase} mes={mes}/>}

      <header className="header">
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <h1 className="logo">Incentivos tiendas</h1>
          <span style={{color:'rgba(255,255,255,0.4)'}}>|</span>
          <select value={mes} onChange={e=>setMes(e.target.value)}
            style={{background:'rgba(255,255,255,0.15)',border:'none',borderRadius:8,color:'#fff',fontSize:14,padding:'6px 12px',cursor:'pointer'}}>
            {MESES_LABELS.map(m=>(
              <option key={m.val} value={m.val} style={{background:'#3730a3',color:'#fff'}}>{m.label}</option>
            ))}
          </select>
          {syncInfo && <span style={{fontSize:11,color:'rgba(255,255,255,0.5)'}}>Sync: {syncInfo}</span>}
        </div>
        <button onClick={()=>setShowConfig(true)} style={{...S.btnSm,background:'rgba(255,255,255,0.15)',color:'#fff'}}>Config</button>
      </header>

      {error && <div style={{background:'#fef2f2',border:'1px solid #fca5a5',borderRadius:8,padding:'10px 16px',margin:'12px 24px',color:'#7f1d1d',fontSize:13}}>
        {error} <button onClick={()=>setError('')} style={{float:'right',background:'none',border:'none',cursor:'pointer',color:'#7f1d1d',fontSize:16}}>x</button>
      </div>}

      {loading && <div style={{textAlign:'center',padding:'48px',color:'#6366f1'}}>
        <div className="spinner" style={{margin:'0 auto 12px'}}/><p>Cargando datos...</p>
      </div>}

      {!loading && resultados && (() => {
        const sortedTiendas = config.tiendas.slice().sort((a,b)=>a.nombre.localeCompare(b.nombre))
        const metrics = [
          {label:'Tiendas con bono',value:resultados.tiendasConBono+' / '+resultados.totalTiendas,sub:'alcanzaron meta'},
          {label:'Total bonos',value:fmt(resultados.totalBonos),sub:'en S/'},
          {label:'Venta total',value:fmt(resultados.ventaTotal),sub:'vs '+fmt(resultados.ventaAntTotal)+' ant.'},
          {label:'Crecimiento',value:pct(resultados.crecimientoPromedio),sub:'promedio tiendas'},
        ]
        return (
          <div className="panel">
            <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:16}}>
              {metrics.map(m=>(
                <div key={m.label} className="metric-card">
                  <div className="metric-label">{m.label}</div>
                  <div className="metric-value">{m.value}</div>
                  <div className="metric-sub">{m.sub}</div>
                </div>
              ))}
            </div>
            <h3 style={{marginBottom:10,fontSize:14,color:'#1e1b4b'}}>Resultados por tienda</h3>
            <div style={{overflowX:'auto'}}>
              <table className="results-table">
                <thead><tr>
                  <th>Tienda</th><th>Venta real</th><th>Venta ant.</th><th>Crec.</th>
                  <th>Meta abs.</th><th>Estado</th><th>Bono tienda</th>
                  <th>Colaboradoras</th><th>Bono x colab.</th>
                </tr></thead>
                <tbody>
                {sortedTiendas.map(tienda => {
                  const r = resultados.porTienda[tienda.nombre.toUpperCase()]
                  if(!r) return null
                  return (
                    <tr key={tienda.nombre} className={r.alcanzoBono?'row-bono':''}>
                      <td><strong>{r.nombreOriginal||tienda.nombre}</strong></td>
                      <td>{fmt(r.ventaReal)}</td>
                      <td>{fmt(r.ventaAnt)}</td>
                      <td style={{color:r.crecPct>=0?'#16a34a':'#dc2626'}}>{pct(r.crecPct)}</td>
                      <td>{r.metaAbs>0?fmt(r.metaAbs):'-'}</td>
                      <td><span className={'badge '+(r.alcanzoBono?'badge-ok':'badge-no')}>{r.alcanzoBono?'Con bono':'Sin bono'}</span></td>
                      <td><strong>{r.alcanzoBono?fmt(r.bonoTienda):'-'}</strong></td>
                      <td>{r.colaboradoras.length>0?r.colaboradoras.length:'-'}</td>
                      <td>{r.alcanzoBono&&r.colaboradoras.length>0?fmtDec(r.bonoXColab):'-'}</td>
                    </tr>
                  )
                })}
                </tbody>
              </table>
            </div>
            {resultados.colaboradorasConBono.length>0&&(
              <div style={{marginTop:20}}>
                <h3 style={{marginBottom:10,fontSize:14,color:'#1e1b4b'}}>Detalle por colaboradora</h3>
                <div style={{overflowX:'auto'}}>
                  <table className="results-table">
                    <thead><tr><th>Colaboradora</th><th>Tiendas c/bono</th><th>Horas totales</th><th>Bono estimado</th></tr></thead>
                    <tbody>
                    {resultados.colaboradorasConBono.map(col=>(
                      <tr key={col.nombre}>
                        <td><strong>{col.nombre}</strong></td>
                        <td>{col.tiendas.join(', ')}</td>
                        <td>{col.horas}</td>
                        <td><strong>{fmtDec(col.bono)}</strong></td>
                      </tr>
                    ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {!loading && !resultados && !error && (
        <div style={{textAlign:'center',padding:'48px',color:'#9CA3AF',fontSize:14}}>
          <p>Sin datos para {MESES_LABELS.find(m=>m.val===mes)?.label}.</p>
          <p style={{fontSize:12,marginTop:8}}>El sync corre automaticamente cada hora.</p>
        </div>
      )}
    </div>
  )
}

export default App
