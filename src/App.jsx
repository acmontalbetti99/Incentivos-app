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

function UploadCard({ title, subtitle, hint, icon, onFile, fileName, done, status }) {
  return (
    <div style={{background:done?'rgba(22,163,74,0.1)':'rgba(79,70,229,0.07)',border:`2px solid ${done?'#16A34A':'rgba(79,70,229,0.3)'}`,borderRadius:12,padding:'1.2rem',flex:1,minWidth:260}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
        <span style={{fontSize:26}}>{done ? '\u2705' : icon}</span>
        <div>
          <div style={{fontWeight:700,fontSize:13,color:done?'#86efac':'#fff'}}>{title}</div>
          <div style={{fontSize:11,color:'#9CA3AF'}}>{subtitle}</div>
        </div>
      </div>
      {hint && <div style={{fontSize:11,color:'#6B7280',marginBottom:10,fontStyle:'italic'}}>{hint}</div>}
      {done
        ? <div style={{fontSize:12,color:'#86efac'}}>{'\u2713'} {fileName}</div>
        : <label style={{background:'#4F46E5',color:'#fff',borderRadius:6,padding:'8px 18px',fontSize:12,cursor:'pointer',display:'inline-block'}}>
            Seleccionar archivo
            <input type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}} onChange={e=>{onFile(e.target.files[0]);e.target.value='';}}/>
          </label>
      }
      {status && !done && <div style={{marginTop:8,fontSize:11,color:'#F59E0B'}}>{status}</div>}
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

  useEffect(() => {
    loadConfig().then(cfg => setConfig(cfg)).catch(e => setError('Error al conectar: '+e.message))
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
        const wb = XLSX.read(e.target.result, { type:'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:null })
        let colTienda = 1, colVentas = 6, colMeta = 9, dataStart = 1
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i] || []
          for (let j = 0; j < row.length; j++) {
            if (String(row[j] || '').trim().toUpperCase() === 'TIENDAS') {
              colTienda = j; dataStart = i + 1
              let lastD = -1, lastM = -1
              for (let k = j+1; k < row.length; k++) {
                if (row[k] instanceof Date) lastD = k;
                if (typeof row[k] === 'string' && row[k].toLowerCase().includes('meta') && !row[k].toLowerCase().includes('total')) lastM = k
              }
              if (lastD >= 0) colVentas = lastD
              if (lastM >= 0) colMeta = lastM
              break
            }
          }
          if (dataStart > 1) break
        }
        const data = {}
        for (let i = dataStart; i < rows.length; i++) {
          const row = rows[i] || []
          const nombre = row[colTienda]
          if (!nombre || typeof nombre !== 'string') continue
          const nU = nombre.trim().toUpperCase()
          if (['TIENDAS','TOTAL'].includes(nU) || nU.includes('META T') || nU.includes('META E')) continue
          const vR = typeof row[colVentas] === 'number' ? row[colVentas] : parseFloat(row[colVentas]) || 0
          const mA = typeof row[colMeta] === 'number' ? row[colMeta] : parseFloat(row[colMeta]) || 0
          const vA = typeof row[colTienda+4] === 'number' ? row[colTienda+4] : parseFloat(row[colTienda+4]) || 0
          if (vR > 0 || mA > 0 || vA > 0) data[nU] = { ventaReal:vR, metaAbs:mA, ventaAnt:vA, nombreOriginal:nombre.trim() }
        }
        setVentasData(data); setError('')
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
        const sN = wb.SheetNames.find(n => n.toLowerCase().includes('resumen') || n.toLowerCase().includes('mensual')) || wb.SheetNames[0]
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sN], { defval:0 })
        if (!rows.length) { setError('Horarios vacio.'); return }
        const cols = Object.keys(rows[0]), colE = cols[0], data = {}
        for (const row of rows) {
          const n = String(row[colE]||'').trim()
          if (!n || n.toUpperCase().includes('TOTAL')) continue
          data[n] = {}
          for (const c of cols.slice(1)) {
            if (norm(c).includes('total')) continue
            const h = parseFloat(row[c]) || 0
            if (h > 0) data[n][c] = h
          }
        }
        setHorariosData(data); setError('')
      } catch(err) { setError('Error horarios:'+err.message) }
    }
    reader.readAsArrayBuffer(file)
  }

  async function calcular() {
    if (!ventasData || !horariosData) { setError('Sube los dos archivos primero.'); return }
    setLoading(true); setError('')
    try {
      const cfg = config || await loadConfig()
      const params = { ...cfg.params }
      const ventasMes = {}, metasOverride = {}
      for (const t of cfg.tiendas) {
        const mk = Object.keys(ventasData).find(k => norm(k) === norm(t.nombre))
        if (mk) { ventasMes[t.id] = ventasData[mk].ventaReal; if (ventasData[mk].metaAbs > 0) metasOverride[t.nombre] = ventasData[mk].metaAbs }
      }
      await saveVentasMes(mes, Object.fromEntries(cfg.tiendas.map(t => [t.id, { total: ventasMes[t.id] || 0 }])))
      if (Object.keys(metasOverride).length) {
        let mt = {}; try { mt = JSON.parse(params.metas_tienda || '{}') } catch {}
        for (const [n, m] of Object.entries(metasOverride)) { const k = Object.keys(mt).find(k => norm(k) === norm(n)); if (k) mt[k].meta = m }
        params.metas_tienda = JSON.stringify(mt)
      }
      const horarios = []
      for (const [nC, rH] of Object.entries(horariosData)) {
        const e = cfg.empleadas.find(x => norm(x.nombre) === norm(nC)); if (!e) continue
        for (const [nT, h] of Object.entries(rH)) {
          const t = cfg.tiendas.find(x => norm(x.nombre) === norm(nT)); if (!t || h <= 0) continue
          horarios.push({ empleada_id:e.id, empleada_nombre:e.nombre, tienda_id:t.id, tienda_nombre:t.nombre, horas:h })
        }
      }
      const resultado = calcularBonos({ tiendas:cfg.tiendas, empleadas:cfg.empleadas, horarios, ventasMes, params, reviews:{} })
      setResultados(resultado)
      await saveHorarios(mes, horarios); await saveResultados(mes, resultado.resultados)
    } catch(er) { setError('Error al calcular: '+er.message) }
    finally { setLoading(false) }
  }

  function exportarExcel() {
    if (!resultados) return
    const d = resultados.resultados.map(r => ({'Colaboradora':r.nombre,'Tiendas':r.tiendas.join(', '),'Horas':r.horas_total,'Bono Individual 70% (S/)':r.bono_individual,'Bono Empresa 30% (S/)':r.bono_empresa,'TOTAL BONO (S/)':r.total_bono}))
    const ws2 = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(ws2, XLSX.utils.json_to_sheet(d), 'Bonos')
    XLSX.writeFile(ws2, 'bonos_'+mes+'.xlsx')
  }

  async function reload() { const c = await loadConfig(); setConfig(c); return c }
  async function addT() { const n=newTienda.trim(); if(!n) return; try { await supabase.from('tiendas').insert({nombre:n,activa:true,venta_ant:80000,crec_obj:0.05}); const c=await reload(); setEditingTiendas(c.tiendas.map(t=>({...t}))); setNewTienda(''); setMsg('Anadido.') } catch(e){setMsg('Err:'+e.message,false)} }
  async function delT(t) { if(!confirm('Eliminar "'+t.nombre+'"?')) return; try { await supabase.from('tiendas').delete().eq('id',t.id); const c=await reload(); setEditingTiendas(c.tiendas.map(x=>({...x}))); setMsg('Eliminado.') } catch(e){setMsg('Err:'­îe.message,false)} }
  async function saveT() { try { await Promise.all(editingTiendas.map(t=>supabase.from('tiendas').update({nombre:t.nombre.trim()}).eq('id',t.id))); const c=await reload(); setEditingTiendas(c.tiendas.map(t=>({...t}))); setMsg('Guardado.') } catch(e){setMsg('Err:'­îe.message,false)} }
  async function addE() { const n=newEmpleada.trim(); if(!n) return; try { await supabase.from('empleadas').insert({nombre:n,activa:true}); const c=await reload(); setEditingEmpleadas(c.empleadas.map(e=>({...e}))); setNewEmpleada(''); setMsg('Anadida.') } catch(e){setMsg('Err:'­îe.message,false)} }
  async function delE(em) { if(!confirm('Eliminar a "'+em.nombre+'"?')) return; try { await supabase.from('empleadas').delete().eq('id',em.id); const c=await reload(); setEditingEmpleadas(c.empleadas.map(x=>({...x}))); setMsg('Eliminada.') } catch(e){setMsg('Err:'+e.message,false)} }

  const fmt = n => `S/ ${Math.round(n)||0).toLocaleString('es-PE')}`
  const pct = n => `${(n*100).toFixed(1)}%`

  if (!config) return <div className="loading-screen"><div className="spinner"/><p>{error||'Conectando...'}</p></div>

  const tSM = ventasData ? Object.keys(ventasData).filter(k => !config.tiendas.find(t => norm(t.nombre) === norm(k))) : []
  const cSM = horariosData ? Object.keys(horariosData).filter(k => !config.empleadas.find(e => norm(e.nombre) === norm(k))) : []

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-left">
          <span className="topbar-title">Incentivos tiendas</span>
          <span className="topbar-sep">Â·</span>
          <input type="month" value={mes} onChange={e=>setMes(e.target.value)} className="month-input"/>
        </div>
        <button onClick={openConfig} style={{background:'rgba(255,255,255,0.18)',border:'none',borderRadius:6,color:'#fff',fontSize:11,padding:'4px 14px',cursor:'pointer'}}>Config</button>
      </div>

      {showConfig && (
        <div style={S.configPanel}>
          <div style={{display:'flex',nombreCallback:true,justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
            <span style={{color:'#fff',fontWeight:600,fontSize:15}}>Configuracion</span>
            <button onClick={()=>setShowConfig(false)} style={{background:'none',border:'none',color:'#aaa',fontSize:20,cursor:'pointer'}}>x</button>
          </div>
          <div style={S.section}>
            <strong style={{color:'~fff',fontSize:12,display:'block',marginBottom:4}}>Locales ({editingTiendas.length})</strong>
            <p style={{color:'#aaa',fontSize:11,marginBottom:8}}>Deben coincidir con los nombres en el archivo de horarios y ventas.</p>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:5,marginBottom:8}}>
              {editingTiendas.map((t,i)=>(
                <div key={t.id} style={{display:'flex',gap:4,alignItems:'center'}}>
                  <input value={t.nombre} style={{...S.input,flex:1}} onChange={e=>setEditingTiendas(prev=>prev.map((x,j)=>j===i?{...x,nombre:e.target.value}:x))}/>
                  <button onClick={()=>delT(t)} style={{...S.btnSm,background:'#450a0a',color:'#fca5a5',padding:'5px 8px',flexShrink:0}}>x</button>
                </div>
              ))}
            </div>
            <div style={{display:'flex',gap:6,marginBottom:8}}>
              <input value={newTienda} placeholder="Nuevo local..." style={{...S.input,flex:1}} onChange={e=>setNewTienda(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addT()}/>
              <button onClick={addT} style={{...S.btnSm,...S.btnSuccess,flexShrink:0}}>+ Anadir</button>
            </div>
            <button onClick={saveT} style={{...S.btnSm,...S.btnPrimary}}>Guardar nombres</button>
          </div>
          <div style={S.section}>
            <strong style={{color:'~fff',fontSize:12,display:'block',marginBottom:4}}>Colaboradoras ({editingEmpleadas.length})</strong>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:5,marginBottom:8}}>
              {editingEmpleadas.map(e=>(
                <div key={e.id} style={{display:'flex',gap:4,alignItems:'center'}}>
                  <span style={{color:'#ccc',fontSize:11,flex:1,overflow:hidden,textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.nombre}</span>
                  <button onClick={()=>delE(e)} style={{...S.btnSm,background:'#450a0a',color:'~fca5a5',padding:'3px 7px',flexShrink:0,fontSize:10}}>x</button>
                </div>
              ))}
            </div>
            <div style={{display:'flex',gap:6}}>
              <input value={newEmpleada} placeholder="Nueva colaboradora..." style={{...S.input,flex:1}} onChange={e=>setNewEmpleada(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addE()}/>
              <button onClick={addE} style={{...S.btnSm,...S.btnSuccess,flexShrink:0}}>+ Anadir</button>
            </div>
          </div>
          {configMsg && <div style={S.msg(configMsgOk)}>{configMsg}</div>}
        </div>
      )}

      {error && <div className="error-bar">{error}<button onClick={()=>setError('')}>x</button></div>}

      <div className="panel">
        <div className="card">
          <h3 style={{marginBottom:6}}>Subir archivos del mes - {mes}</h3>
          <p className="hint">Sube los dos archivos para calcular los bonos automaticamente.</p>
          <div style={{display:'flex',gap:16,flewWrap:'wrap',marginTop:12}}>
            <UploadCard title="1. Ventas mensual" subtitle="Excel de ventas por sucursal" hint="Col B=tienda Col G=ventas mes Col J=meta" icon="[1]" onFile={parsearVentas} fileName={ventasFile} done={!!ventasData} status={ventasData?Object.keys(ventasData).length+' tiendas leidas':'' }/>
            <UploadCard title="2. Horarios mensual" subtitle="Excel con horas por colaboradora" hint="Hoja Resumen Mensual - Col A=colaboradora Resto=tiendas" icon="[2]" onFile={parsearHorarios} fileName={horariosFile} done={!!horariosData} status={horariosData?Object.keys(horariosData).length+' colaboradoras leidas':''}/>
          </div>
          {ventasData && (
            <div style={{marginTop:16}}>
              <div style={{fontSize:12,fontWeight:600,color:'#9FE1CB',marginBottom:8}}>Vista previa ventas por tienda ({Object.keys(ventasData).length} leidas):</div>
              <div className="ventas-summary">
                {config.tiendas.map(t => {
                  const mk = Object.keys(ventasData).find(k => norm(k) === norm(t.nombre))
                  const d = mk ? ventasData[mk] : null
                  const v = d?.ventaReal || 0, m = d?.metaAbs || (t.venta_ant*(1+t.crec_obj)), p = m>0?v/m:0
                  return <div key={t.id} className="tienda-chip"><div className="tienda-name">{t.nombre}</div><div className="tienda-total">{fmt(v)</div><div className={`tienda-pct ${p>=1?'green':p>=0.8>'amber':v>0?'red':''}`}>{v>0?`${(p*100).toFixed(0)}%`:'â€”'}</div></div>
                })}
              </div>
            </div>
          )}
          {tSM.length>0 && <div className="info-card amber" style={{marginTop:10}}>Sin coincidencia: <strong>{tSM.join(', ')}</strong><span style={{display:'block',fontSize:11}}>Usa Config para ajustar nombres.</span></div>}
          {cSM.length>0 && <div className="info-card amber" style={{marginTop:8}}>Colaboradoras sin match: <strong>{cSM.join(', ')}</strong></div>}
          <div style={{marginTop:20,display:'flex',justifyContent:'flex-end'}}>
            <button className="btn primary" style={{fontSize:14,padding:'10px 28px',opacity:(ventasData&&horariosData)?1:0.5}} onClick={calcular} disabled={loading||!ventasData||!horariosData}>
              {loading?'Calculando...':(ventasData&&horariosData?'Calcular bonos':'Sube los dos archivos primero')}
            </button>
          </div>
        </div>
      </div>

      {resultados && (
        <div className="panel">
          <div style={{background:resultados.empresaAlcanzo?'rgba(22,163,74,0.15)':'rgba(220,38,38,0.12)',border:`1px solid ${resultados.empresaAlcanzo?'#16A34A':'#DC2626'}`,borderRadius:10,padding:'14px 18px',marginBottom:12,display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
            <div><div style={{fontWeight:700,fontSize:14,color:resultados.empresaAlcanzo?'#86efac':'#fca5a5'}}>{resultados.empresaAlcanzo?'META EMPRESA ALCANZADA':'Meta empresa no alcanzada'}</div>
            <div style={{fontSize:12,color:'#ccc',marginTop:2}}>Ventas totales: <b>{fmt(resultados.totalVentasEmpresa)}</b> Meta: <b>{fmt(resultados.META_EMPRESA)}</b> {pct(resultados.pctEmpresaLogrado)}</div></div>
            <div style={{textAlign:'right'}}><div style={{fontSize:11,color:'#aaa'}}>Componente empresa (30%)</div><div style={{fontSize:16,fontWeight:700,color:resultados.empresaAlcanzo?'#86efac':'#fca5a5'}}>{resultados.empresaAlcanzo?'S/ 600':'S/ 0'}</div></div>
          </div>
          <div className="metrics-row">
            {[{label:'Total bonos',value:fmt(resultados.resultados.reduce((s,r)=>s+r.total_bono,0))},{label:'Colaboradoras',value:resultados.resultados.length},{label:'Tiendas >= 100%',value:`${Object.values(resultados.storeResults).filter(s=>s.cumplimiento>=1).length}/${config.tiendas.length}`},{label:'Cumpl. promedio',value:pct(Object.values(resultados.storeResults).reduce((s,r)=>s+r.cumplimiento,0)/Math.max(config.tiendas.length,1))}].map(m=><div key={m.label} className="metric-card"><div className="metric-label">{m.label}</div><div className="metric-value">{m.value}</div></div>)}
          </div>
          <div className="card"><h3>Resultados por tienda</h3><div className="table-scroll"><table className="res-table"><thead><tr><th>Tienda</th><th>Tipo</th><th>Meta</th><th>Real</th><th>Cumpl.</th><th>Tier aplicado</th></tr></thead><tbody>{Object.values(resultados.storeResults).sort((a,b)=>a.tienda.nombre.localeCompare(b.tienda.nombre)).map(sr=>{const isC=sr.tipo==='chica'; const tL=sr.cumplimiento>=1.10?'>=110%->110%':sr.cumplimiento>=1.05?(isC?'105-109%->100%':'105-109%->105%'):sr.cumplimiento>=1.00?(isC?'100-104%->80%':'100-104%->100%'):sr.cumplimiento>=0.95?(isC?'95-99%->25%':'95-99%->40%'):'<95%->Sin bono';const bC=sr.cumplimiento>=1?'green':sr.cumplimiento>=.25?'teal':sr.cumplimiento>=.8?'amber':'red';return <tr key={sr.tienda.id}><td className="bold">{sr.tienda.nombre}</td><td><span style={{fontSize:10,padding:'2px 7px',borderRadius:10,background:sr.tipo==='grande'?'#1e3a5f':sr.tipo==='mediana'?'#1a3a2a':'#3a1a1a',color:sr.tipo==='grande'?'#93c5fd':sr.tipo==='mediana'?'#86efac':'#fca5a5'}}>{sr.tipo}</span></td><td>{fmt(sr.meta)}</td><td>{fmt(sr.ventaReal)}</td><td><span className={`badge ${bC}`}>{pct(sr.cumplimientn)}</span></td><td style={{fontSize:11,color:'#9CA3AF'}}>{tL}</td></tr>})}</tbody></table></div></div>
          <div className="card"><h3>Bonos por colaboradora</h3><div style={{fontSize:11,color:'9CA3AF',marginBottom:8}}>S/2,000 = <span style={{color:'818CF8'}}>70% individual (S/1,400)</span> + <span style={{color:'34D399'}}>30% empresa (S/600)</span> proporcional a horas</sdiv><div className="table-scroll"><table className="res-table"><thead><tr><th>Peisonas</th><th>Tiendas</th><th>Horas</th><th>Individual</th><th>Empresa</th><th>TOTAL</th></tr></thead><tbody>{resultados.resultados.map(r=><tr key={r.empleada_id}><td className="bold">{r.nombre}</td><td style={{fontSize:10}}>{r.tiendas.map(t=><span key={t} className="pill">{t}</span>)}</td><td style={{textAlign:'~center'}}>{r.horas_total}</td><td style={{textAlign:'right',color:'#818CF8'}}>{fmt(r.bono_individual)}</td><td style={{textAlign:'right',color:'#34D399'}}>{fmt(r.bono_empresa)}</td><td><strong className="total-bono">{fmt(r.total_bono)}</strong></td></tr>)}<tr className="total-row"><td colSpan={3}>TOTAL A PAGAR</td><td style={{textAlign:'right',color:'818CF8'}}>{fmt(resultados.resultados.reduce((s,r)=>s+r.bono_individual,0))}</td><td style={{textAlign:'right',color:'#34D399'}}>{fmt(resultados.resultados.reduce((s,r)=>s+r.bono_empresa,0))}</td><td><strong>{fmt(resultados.resultados.reduce((s,r)=>s+r.total_bono,0))}</strong></td></tr></tbody></table></div></div>
          <div style={{display:'flex',justifyContent:'flex-end',gap:12,marginTop:8}}>
            <button className="btn" onClick={()=>setResultados(null)}>Nuevo mes</button>
            <button className="btn primary" onClick={exportarExcel}>Exportar Excel</button>
          </div>
        </div>
      )}
    </div>
  )
}
