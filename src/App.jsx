// v5 - auto-sync Google Sheets via Supabase, sin upload
import { useState, useEffect } from 'react'
import { supabase, loadConfig } from './lib/supabase'
import './App.css'

function norm(s) { return String(s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'') }

const BONO_BASE = 20
const BONO_PCT = 0.04
const BONO_MAX = 500
const VENTA_MIN = 30000
const CRECIMIENTO_MIN = 0.01

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
  const [ventasData, setVentasData] = useState(null)
  const [horariosData, setHorariosData] = useState(null)
  const [resultados, setResultados] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [syncInfo, setSyncInfo] = useState(null)

  useEffect(() => { loadConfig().then(cfg => { if(cfg) setConfig(cfg) }) }, [])
  useEffect(() => { if(mes) cargarDeSupabase(mes) }, [mes])
  useEffect(() => {
    if(ventasData && horariosData && config) setResultados(calcularBonosLocal())
  }, [ventasData, horariosData, config])

  const reviews = {}

  async function cargarDeSupabase(m) {
    setLoading(true); setError(''); setVentasData(null); setHorariosData(null); setResultados(null); setSyncInfo(null)
    try {
      const {data:ventas, error:ve} = await supabase.from('incentivos_ventas').select('*').eq('mes', m)
      if(ve) throw new Error('Ventas: ' + ve.message)
      const {data:horarios, error:he} = await supabase.from('incentivos_horarios').select('*').eq('mes', m)
      if(he) throw new Error('Horarios: ' + he.message)
      const {data:logs} = await supabase
        .from('incentivos_sync_log').select('synced_at')
        .eq('mes',m).eq('status','ok')
        .order('synced_at',{ascending:false}).limit(1)
      if(logs && logs[0]) {
        const d = new Date(logs[0].synced_at)
        setSyncInfo(d.toLocaleString('es-PE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}))
      }
      if(!ventas || ventas.length === 0) {
        setError('Sin datos para este mes. El sync corre cada hora en punto.')
        setLoading(false)
        return
      }
      const vdata = {}
      ventas.forEach(r => {
        vdata[r.tienda] = { ventaReal: r.venta_real, ventaAnt: r.venta_ant, metaAbs: r.meta_abs, nombreOriginal: r.nombre_original }
      })
      setVentasData(vdata)
      const hdata = {}
      if(horarios) horarios.forEach(r => {
        if(!hdata[r.colaboradora]) hdata[r.colaboradora] = {}
        hdata[r.colaboradora][r.tienda] = (hdata[r.colaboradora][r.tienda]||0) + r.horas
      })
      setHorariosData(hdata)
    } catch(err) { setError(err.message) }
    setLoading(false)
  }

  function calcularBonosLocal() {
    if (!ventasData || !horariosData || !config) return null
    const esRefugio = (n) => norm(n).includes('refugio')
    const porTienda = {}
    let totalBonos = 0, ventaTotal = 0, ventaAntTotal = 0, tiendasConBono = 0
    const crecPcts = []

    config.tiendas.forEach(function(tienda) {
      const key = tienda.nombre.toUpperCase()
      const v = ventasData[key]
      if (!v) return

      const ventaReal = v.ventaReal || 0
      const ventaAnt  = v.ventaAnt  || 0
      const metaAbs   = v.metaAbs   || 0
      const crecPct   = ventaAnt > 0 ? (ventaReal - ventaAnt) / ventaAnt : 0
      const tiendaNorm = norm(tienda.nombre)

      const cumpleMeta = metaAbs > 0
        ? ventaReal >= metaAbs
        : (esRefugio(tienda.nombre) ? crecPct >= 0.05 : (ventaReal >= VENTA_MIN && crecPct >= CRECIMIENTO_MIN))

      // Colaboradoras que trabajaron en esta tienda
      const colaboradoras = []
      let horasTienda = 0
      Object.keys(horariosData).forEach(function(colab) {
        const horas = horariosData[colab][tiendaNorm] || 0
        if (horas > 0) {
          colaboradoras.push({ nombre: colab, horas: horas })
          horasTienda += horas
        }
      })

      const bonoTienda = cumpleMeta
        ? Math.min(BONO_BASE + ventaReal * BONO_PCT, BONO_MAX)
        : 0
      const bonoXColab = colaboradoras.length > 0 ? bonoTienda / colaboradoras.length : 0

      porTienda[key] = {
        nombreOriginal: v.nombreOriginal || tienda.nombre,
        ventaReal, ventaAnt, metaAbs, crecPct,
        alcanzoBono: cumpleMeta,
        bonoTienda, bonoXColab,
        colaboradoras: colaboradoras.map(function(c) { return c.nombre })
      }

      if (cumpleMeta) { totalBonos += bonoTienda; tiendasConBono++ }
      ventaTotal    += ventaReal
      ventaAntTotal += ventaAnt
      if (ventaAnt > 0) crecPcts.push(crecPct)
    })

    // Consolidar bonos por colaboradora
    const bonosPorColab = {}
    Object.keys(porTienda).forEach(function(key) {
      const t = porTienda[key]
      if (!t.alcanzoBono || t.colaboradoras.length === 0) return
      t.colaboradoras.forEach(function(nombre) {
        if (!bonosPorColab[nombre]) bonosPorColab[nombre] = { nombre: nombre, tiendas: [], horas: 0, bono: 0 }
        bonosPorColab[nombre].tiendas.push(t.nombreOriginal)
        bonosPorColab[nombre].horas += horariosData[nombre] ? (horariosData[nombre][norm(t.nombreOriginal)] || 0) : 0
        bonosPorColab[nombre].bono  += t.bonoXColab
      })
    })

    return {
      porTienda,
      totalBonos,
      ventaTotal,
      ventaAntTotal,
      tiendasConBono,
      totalTiendas: config.tiendas.length,
      crecimientoPromedio: crecPcts.length > 0 ? crecPcts.reduce(function(a,b){return a+b},0) / crecPcts.length : 0,
      colaboradorasConBono: Object.values(bonosPorColab)
    }
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


  const fmt    = (n) => `S/ ${Math.round(n||0).toLocaleString('es-PE')}`
  const fmtDec = (n) => `S/ ${(n||0).toFixed(2)}`
  const pct    = (n) => `${(n*100).toFixed(1)}%`

  if(!config) return <div className="loading-screen"><div className="spinner"/><p>Conectando...</p></div>

  const sortedTiendas = config.tiendas ? config.tiendas.slice().sort((a,b) => a.nombre.localeCompare(b.nombre)) : []

  return (
    <div className="app">
      <header className="header">
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <h1 className="logo">Incentivos tiendas</h1>
          <span style={{color:'rgba(255,255,255,0.35)',fontSize:18}}>|</span>
          <select value={mes} onChange={e => setMes(e.target.value)}
            style={{background:'rgba(255,255,255,0.15)',border:'none',borderRadius:8,color:'#fff',fontSize:14,padding:'6px 14px',cursor:'pointer'}}>
            {MESES_LABELS.map(m => (
              <option key={m.val} value={m.val} style={{background:'#3730a3',color:'#fff'}}>{m.label}</option>
            ))}
          </select>
          {syncInfo && <span style={{fontSize:11,color:'rgba(255,255,255,0.5)'}}>Sync: {syncInfo}</span>}
        </div>
        <button onClick={() => cargarDeSupabase(mes)}
          style={{background:'rgba(255,255,255,0.15)',border:'none',borderRadius:8,color:'#fff',fontSize:13,padding:'7px 16px',cursor:'pointer'}}>
          &#x1f504; Actualizar
        </button>
      </header>

      {error && (
        <div style={{background:'#fef2f2',border:'1px solid #fca5a5',borderRadius:8,padding:'10px 16px',margin:'12px 24px',color:'#7f1d1d',fontSize:13,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span>{error}</span>
          <button onClick={() => setError('')} style={{background:'none',border:'none',cursor:'pointer',color:'#7f1d1d',fontSize:18,lineHeight:1}}>x</button>
        </div>
      )}

      {loading && (
        <div style={{textAlign:'center',padding:'60px',color:'#6366f1'}}>
          <div className="spinner" style={{margin:'0 auto 16px'}}/>
          <p style={{fontSize:14}}>Cargando datos de Supabase...</p>
        </div>
      )}

      {!loading && resultados && (() => {
        const metrics = [
          {label:'Tiendas con bono', value: resultados.tiendasConBono + ' / ' + resultados.totalTiendas, sub:'alcanzaron meta'},
          {label:'Total bonos',      value: fmt(resultados.totalBonos),    sub:'en S/'},
          {label:'Venta total',      value: fmt(resultados.ventaTotal),    sub:'vs ' + fmt(resultados.ventaAntTotal) + ' ant.'},
          {label:'Crecimiento prom.',value: pct(resultados.crecimientoPromedio), sub:'promedio tiendas'},
        ]
        return (
          <div className="panel">
            <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:16}}>
              {metrics.map(m => (
                <div key={m.label} className="metric-card">
                  <div className="metric-label">{m.label}</div>
                  <div className="metric-value">{m.value}</div>
                  <div className="metric-sub">{m.sub}</div>
                </div>
              ))}
            </div>

            <h3 style={{marginBottom:10,fontSize:14,color:'#1e1b4b',fontWeight:700}}>Resultados por tienda</h3>
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
                    <tr key={tienda.nombre} className={r.alcanzoBono ? 'row-bono' : ''}>
                      <td><strong>{r.nombreOriginal || tienda.nombre}</strong></td>
                      <td>{fmt(r.ventaReal)}</td>
                      <td>{fmt(r.ventaAnt)}</td>
                      <td style={{color: r.crecPct >= 0 ? '#16a34a' : '#dc2626'}}>{pct(r.crecPct)}</td>
                      <td>{r.metaAbs > 0 ? fmt(r.metaAbs) : '-'}</td>
                      <td><span className={'badge ' + (r.alcanzoBono ? 'badge-ok' : 'badge-no')}>{r.alcanzoBono ? 'Con bono' : 'Sin bono'}</span></td>
                      <td><strong>{r.alcanzoBono ? fmt(r.bonoTienda) : '-'}</strong></td>
                      <td>{r.colaboradoras.length > 0 ? r.colaboradoras.length : '-'}</td>
                      <td>{r.alcanzoBono && r.colaboradoras.length > 0 ? fmtDec(r.bonoXColab) : '-'}</td>
                    </tr>
                  )
                })}
                </tbody>
              </table>
            </div>

            {resultados.colaboradorasConBono.length > 0 && (
              <div style={{marginTop:24}}>
                <h3 style={{marginBottom:10,fontSize:14,color:'#1e1b4b',fontWeight:700}}>Detalle por colaboradora</h3>
                <div style={{overflowX:'auto'}}>
                  <table className="results-table">
                    <thead><tr>
                      <th>Colaboradora</th><th>Tiendas con bono</th><th>Horas</th><th>Bono estimado</th>
                    </tr></thead>
                    <tbody>
                    {resultados.colaboradorasConBono.map(col => (
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
        <div style={{textAlign:'center',padding:'60px',color:'#9CA3AF'}}>
          <p style={{fontSize:15,marginBottom:8}}>Sin datos para {MESES_LABELS.find(m => m.val===mes)?.label || mes}</p>
          <p style={{fontSize:12}}>El sync corre automaticamente cada hora en punto.</p>
        </div>
      )}
    </div>
  )
}
