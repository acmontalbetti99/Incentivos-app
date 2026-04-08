import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { supabase, loadConfig, saveHorarios, saveResultados, saveVentasMes } from './lib/supabase'
import { calcularBonos } from './lib/calculos'
import './App.css'

function norm(s) { return String(s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'') }

const S = {
  inp: { background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.2)', borderRadius:6, color:'#fff', fontSize:12, padding:'5px 8px', width:'100%' },
  btn: { border:'none', borderRadius:6, fontSize:12, padding:'6px 14px', cursor:'pointer' },
  pri: { background:'#4F46E5', color:'#fff' },
  suc: { background:'#14532d', color:'#86efac' },
  sec: { marginBottom:16, paddingBottom:16, borderBottom:'1px solid rgba(255,255,255,0.08)' },
  cfg: { background:'#1e1b4b', border:'1px solid #534AB7', borderRadius:10, padding:'1rem 1.25rem', marginBottom:'1rem' },
  msg: (ok) => ({ marginTop:8, padding:'7px 12px', background: ok?'rgba(134,239,172,0.12)':'rgba(252,165,165,0.12)', borderRadius:6, color:ok?'#86efac':'#fca5a5', fontSize:12 }),
}

function Card({ title, sub, hint, icon, onFile, fileName, done, status }) {
  return (
    <div style={{background:done?'rgba(22,163,74,0.1)':'rgba(79,70,229,0.07)',border:`2px solid ${done?'#16A34A':'rgba(79,70,229,0.3)'}`,borderRadius:12,padding:'1.2rem',flex:1,minWidth:260}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
        <span style={{fontSize:22}}>{done?'OK':icon}</span>
        <div>
          <div style={{fontWeight:700,fontSize:13,color:done?'#86efac':'#fff'}}>{title}</div>
          <div style={{fontSize:11,color:'#9CA3AF'}}>{sub}</div>
        </div>
      </div>
      {hint&&<div style={{fontSize:11,color:'#6B7280',marginBottom:10,fontStyle:'italic'}}>{hint}</div>}
      {done
        ? <div style={{fontSize:12,color:'#86efac'}}>{'\u2713'} {fileName}</div>
        : <label style={{background:'#4F46E5',color:'#fff',borderRadius:6,padding:'8px 18px',fontSize:12,cursor:'pointer',display:'inline-block'}}>
            Seleccionar archivo
            <input type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}} onChange={e=>{onFile(e.target.files[0]);e.target.value='';}}/>
          </label>
      }
      {status&&!done&&<div style={{marginTop:8,fontSize:11,color:'#F59E0B'}}>{status}</div>}
    </div>
  )
}

export default function App() {
  const [mes, setMes] = useState(() => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` })
  const [config, setConfig] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [vFile, setVFile] = useState(null)
  const [hFile, setHFile] = useState(null)
  const [vData, setVData] = useState(null)
  const [hData, setHData] = useState(null)
  const [result, setResult] = useState(null)
  const [showCfg, setShowCfg] = useState(false)
  const [cfgMsg, setCfgMsg] = useState('')
  const [cfgOk, setCfgOk] = useState(true)
  const [eTiendas, setETiendas] = useState([])
  const [newT, setNewT] = useState('')
  const [eEmpl, setEEmpl] = useState([])
  const [newE, setNewE] = useState('')

  useEffect(() => {
    loadConfig().then(c => setConfig(c)).catch(e => setError('Error al conectar: '+e.message))
  }, [])

  function msg(txt, ok=true) { setCfgMsg(txt); setCfgOk(ok) }
  function openCfg() { setETiendas(config?.tiendas?.map(t=>({...t}))||[]); setEEmpl(config?.empleadas?.map(e=>({...e}))||[]); setNewT(''); setNewE(''); setCfgMsg(''); setShowCfg(true) }
  async function reload() { const c = await loadConfig(); setConfig(c); return c }

  async function addT() {
    const n = newT.trim(); if (!n) return
    try { await supabase.from('tiendas').insert({nombre:n,activa:true,venta_ant:80000,crec_obj:0.05}); const c=await reload(); setETiendas(c.tiendas.map(t=>({...t}))); setNewT(''); msg('Local anadido.') }
    catch(e) { msg('Error: '+e.message, false) }
  }
  async function delT(t) {
    if (!confirm('Eliminar '+t.nombre+'?')) return
    try { await supabase.from('tiendas').delete().eq('id',t.id); const c=await reload(); setETiendas(c.tiendas.map(x=>({...x}))); msg('Eliminado.') }
    catch(e) { msg('Error: '+e.message, false) }
  }
  async function saveT() {
    try { await Promise.all(eTiendas.map(t=>supabase.from('tiendas').update({nombre:t.nombre.trim()}).eq('id',t.id))); const c=await reload(); setETiendas(c.tiendas.map(t=>({...t}))); msg('Guardado.') }
    catch(e) { msg('Error: '+e.message, false) }
  }
  async function addE() {
    const n = newE.trim(); if (!n) return
    try { await supabase.from('empleadas').insert({nombre:n,activa:true}); const c=await reload(); setEEmpl(c.empleadas.map(e=>({...e}))); setNewE(''); msg('Anadida.') }
    catch(e) { msg('Error: '+e.message, false) }
  }
  async function delE(em) {
    if (!confirm('Eliminar a '+em.nombre+'?')) return
    try { await supabase.from('empleadas').delete().eq('id',em.id); const c=await reload(); setEEmpl(c.empleadas.map(x=>({...x}))); msg('Eliminada.') }
    catch(e) { msg('Error: '+e.message, false) }
  }

  function parseVentas(file) {
    setVFile(file.name)
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type:'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:null })
        let colT=1, colV=6, colM=9, start=1
        for (let i=0; i<rows.length; i++) {
          const row = rows[i]||[]
          for (let j=0; j<row.length; j++) {
            if (String(row[j]||'').trim().toUpperCase() === 'TIENDAS') {
              colT=j; start=i+1
              let lastDate=-1, lastMeta=-1
              for (let k=j+1; k<row.length; k++) {
                if (row[k] instanceof Date) lastDate=k
                if (typeof row[k]==='string' && row[k].toLowerCase().includes('meta') && !row[k].toLowerCase().includes('total')) lastMeta=k
              }
              if (lastDate>=0) colV=lastDate
              if (lastMeta>=0) colM=lastMeta
              break
            }
          }
          if (start>1) break
        }
        const data = {}
        for (let i=start; i<rows.length; i++) {
          const row=rows[i]||[]
          const nombre=row[colT]
          if (!nombre||typeof nombre!=='string') continue
          const nU=nombre.trim().toUpperCase()
          if (['TIENDAS','TOTAL'].includes(nU)||nU.startsWith('META T')||nU.startsWith('META E')) continue
          const vR = typeof row[colV]==='number' ? row[colV] : parseFloat(row[colV])||0
          const mA = typeof row[colM]==='number' ? row[colM] : parseFloat(row[colM])||0
          const vA = typeof row[colT+4]==='number' ? row[colT+4] : parseFloat(row[colT+4])||0
          if (vR>0||mA>0||vA>0) data[nU]={ventaReal:vR,metaAbs:mA,ventaAnt:vA,nombreOrig:nombre.trim()}
        }
        setVData(data); setError('')
      } catch(e) { setError('Error ventas: '+e.message) }
    }
    reader.readAsArrayBuffer(file)
  }

  function parseHorarios(file) {
    setHFile(file.name)
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type:'array' })
        const sn = wb.SheetNames.find(n=>n.toLowerCase().includes('resumen')||n.toLowerCase().includes('mensual'))||wb.SheetNames[0]
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval:0 })
        if (!rows.length) { setError('Horarios vacio.'); return }
        const cols=Object.keys(rows[0]), c0=cols[0], data={}
        for (const row of rows) {
          const n=String(row[c0]||'').trim()
          if (!n||n.toUpperCase().includes('TOTAL')) continue
          data[n]={}
          for (const c of cols.slice(1)) {
            if (norm(c).includes('total')) continue
            const h=parseFloat(row[c])||0
            if (h>0) data[n][c]=h
          }
        }
        setHData(data); setError('')
      } catch(e) { setError('Error horarios: '+e.message) }
    }
    reader.readAsArrayBuffer(file)
  }

  async function calcular() {
    if (!vData||!hData) { setError('Sube los dos archivos.'); return }
    setLoading(true); setError('')
    try {
      const cfg = config||await loadConfig()
      const params = {...cfg.params}
      const ventasMes={}, metasOv={}
      for (const t of cfg.tiendas) {
        const mk=Object.keys(vData).find(k=>norm(k)===norm(t.nombre))
        if (mk) { ventasMes[t.id]=vData[mk].ventaReal; if (vData[mk].metaAbs>0) metasOv[t.nombre]=vData[mk].metaAbs }
      }
      await saveVentasMes(mes, Object.fromEntries(cfg.tiendas.map(t=>[t.id,{total:ventasMes[t.id]||0}])))
      if (Object.keys(metasOv).length) {
        let mt={}; try { mt=JSON.parse(params.metas_tienda||'{}') } catch {}
        for (const [n,m] of Object.entries(metasOv)) { const k=Object.keys(mt).find(k=>norm(k)===norm(n)); if (k) mt[k].meta=m }
        params.metas_tienda=JSON.stringify(mt)
      }
      const horarios=[]
      for (const [nc,rh] of Object.entries(hData)) {
        const e=cfg.empleadas.find(x=>norm(x.nombre)===norm(nc)); if (!e) continue
        for (const [nt,h] of Object.entries(rh)) {
          const t=cfg.tiendas.find(x=>norm(x.nombre)===norm(nt)); if (!t||h<=0) continue
          horarios.push({empleada_id:e.id,empleada_nombre:e.nombre,tienda_id:t.id,tienda_nombre:t.nombre,horas:h})
        }
      }
      const res=calcularBonos({tiendas:cfg.tiendas,empleadas:cfg.empleadas,horarios,ventasMes,params,reviews:{}})
      setResult(res)
      await saveHorarios(mes,horarios); await saveResultados(mes,res.resultados)
    } catch(e) { setError('Error calcular: '+e.message) }
    finally { setLoading(false) }
  }

  function exportar() {
    if (!result) return
    const d=result.resultados.map(r=>({'Colaboradora':r.nombre,'Tiendas':r.tiendas.join(', '),'Horas':r.horas_total,'Individual 70%':r.bono_individual,'Empresa 30%':r.bono_empresa,'TOTAL':r.total_bono}))
    const wb2=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb2,XLSX.utils.json_to_sheet(d),'Bonos')
    XLSX.writeFile(wb2,'bonos_'+mes+'.xlsx')
  }

  const fmt=n=>'S/ '+Math.round(n||0).toLocaleString('es-PE')
  const pct=n=>((n||0)*100).toFixed(1)+'%'

  if (!config) return <div className="loading-screen"><div className="spinner"/><p>{error||'Conectando...'}</p></div>

  const tSM=vData?Object.keys(vData).filter(k=>!config.tiendas.find(t=>norm(t.nombre)===norm(k))):[]
  const cSM=hData?Object.keys(hData).filter(k=>!config.empleadas.find(e=>norm(e.nombre)===norm(k))):[]

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-left">
          <span className="topbar-title">Incentivos tiendas</span>
          <span className="topbar-sep">&middot;</span>
          <input type="month" value={mes} onChange={e=>setMes(e.target.value)} className="month-input"/>
        </div>
        <button onClick={openCfg} style={{background:'rgba(255,255,255,0.18)',border:'none',borderRadius:6,color:'#fff',fontSize:11,padding:'4px 14px',cursor:'pointer'}}>Config</button>
      </div>

      {showCfg&&(
        <div style={S.cfg}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
            <span style={{color:'#fff',fontWeight:600,fontSize:15}}>Configuracion</span>
            <button onClick={()=>setShowCfg(false)} style={{background:'none',border:'none',color:'#aaa',fontSize:20,cursor:'pointer'}}>x</button>
          </div>
          <div style={S.sec}>
            <strong style={{color:'#fff',fontSize:12,display:'block',marginBottom:4}}>Locales ({eTiendas.length})</strong>
            <p style={{color:'#aaa',fontSize:11,marginBottom:8}}>Deben coincidir con los nombres en horarios y ventas.</p>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:5,marginBottom:8}}>
              {eTiendas.map((t,i)=>(
                <div key={t.id} style={{display:'flex',gap:4,alignItems:'center'}}>
                  <input value={t.nombre} style={{...S.inp,flex:1}} onChange={e=>setETiendas(prev=>prev.map((x,j)=>j===i?{...x,nombre:e.target.value}:x))}/>
                  <button onClick={()=>delT(t)} style={{...S.btn,background:'#450a0a',color:'#fca5a5',padding:'5px 8px',flexShrink:0}}>x</button>
                </div>
              ))}
            </div>
            <div style={{display:'flex',gap:6,marginBottom:8}}>
              <input value={newT} placeholder="Nuevo local..." style={{...S.inp,flex:1}} onChange={e=>setNewT(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addT()}/>
              <button onClick={addT} style={{...S.btn,...S.suc,flexShrink:0}}>+ Anadir</button>
            </div>
            <button onClick={saveT} style={{...S.btn,...S.pri}}>Guardar nombres</button>
          </div>
          <div style={S.sec}>
            <strong style={{color:'#fff',fontSize:12,display:'block',marginBottom:4}}>Colaboradoras ({eEmpl.length})</strong>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:5,marginBottom:8}}>
              {eEmpl.map(e=>(
                <div key={e.id} style={{display:'flex',gap:4,alignItems:'center'}}>
                  <span style={{color:'#ccc',fontSize:11,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{e.nombre}</span>
                  <button onClick={()=>delE(e)} style={{...S.btn,background:'#450a0a',color:'#fca5a5',padding:'3px 7px',flexShrink:0,fontSize:10}}>x</button>
                </div>
              ))}
            </div>
            <div style={{display:'flex',gap:6}}>
              <input value={newE} placeholder="Nueva colaboradora..." style={{...S.inp,flex:1}} onChange={e=>setNewE(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addE()}/>
              <button onClick={addE} style={{...S.btn,...S.suc,flexShrink:0}}>+ Anadir</button>
            </div>
          </div>
          {cfgMsg&&<div style={S.msg(cfgOk)}>{cfgMsg}</div>}
        </div>
      )}

      {error&&<div className="error-bar">{error}<button onClick={()=>setError('')}>x</button></div>}

      <div className="panel">
        <div className="card">
          <h3 style={{marginBottom:6}}>Subir archivos del mes - {mes}</h3>
          <p className="hint">Sube los dos archivos para calcular los bonos automaticamente.</p>
          <div style={{display:'flex',gap:16,flexWrap:'wrap',marginTop:12}}>
            <Card title="1. Ventas mensual" sub="Excel de ventas por sucursal" hint="Col B=tienda Col G=ventas mes Col J=meta" icon="[1]" onFile={parseVentas} fileName={vFile} done={!!vData} status={vData?Object.keys(vData).length+' tiendas leidas':''}/>
            <Card title="2. Horarios mensual" sub="Excel horas por colaboradora" hint="Hoja Resumen Mensual - Col A=colaboradora Resto=tiendas" icon="[2]" onFile={parseHorarios} fileName={hFile} done={!!hData} status={hData?Object.keys(hData).length+' colaboradoras leidas':''}/>
          </div>

          {vData&&(
            <div style={{marginTop:16}}>
              <div style={{fontSize:12,fontWeight:600,color:'#9FE1CB',marginBottom:8}}>Vista previa ventas ({Object.keys(vData).length} leidas):</div>
              <div className="ventas-summary">
                {config.tiendas.map(t=>{
                  const mk=Object.keys(vData).find(k=>norm(k)===norm(t.nombre))
                  const d=mk?vData[mk]:null; const v=d?.ventaReal||0
                  const m=d?.metaAbs||(t.venta_ant*(1+t.crec_obj)); const p=m>0?v/m:0
                  return <div key={t.id} className="tienda-chip"><div className="tienda-name">{t.nombre}</div><div className="tienda-total">{fmt(v)}</div><div className={`tienda-pct ${p>=1?'green':p>=0.8?'amber':v>0?'red':''}`}>{v>0?((p*100).toFixed(0)+'%'):'--'}</div></div>
                })}
              </div>
            </div>
          )}

          {tSM.length>0&&<div className="info-card amber" style={{marginTop:10}}>Sin match en sistema: <strong>{tSM.join(', ')}</strong><span style={{display:'block',fontSize:11}}>Usa Config para ajustar nombres.</span></div>}
          {cSM.length>0&&<div className="info-card amber" style={{marginTop:8}}>Colaboradoras sin match: <strong>{cSM.join(', ')}</strong></div>}

          <div style={{marginTop:20,display:'flex',justifyContent:'flex-end'}}>
            <button className="btn primary" style={{fontSize:14,padding:'10px 28px',opacity:(vData&&hData)?1:0.5}} onClick={calcular} disabled={loading||!vData||!hData}>
              {loading?'Calculando...':(vData&&hData?'Calcular bonos':'Sube los dos archivos primero')}
            </button>
          </div>
        </div>
      </div>

      {result&&(
        <div className="panel">
          <div style={{background:result.empresaAlcanzo?'rgba(22,163,74,0.15)':'rgba(220,38,38,0.12)',border:`1px solid ${result.empresaAlcanzo?'#16A34A':'#DC2626'}`,borderRadius:10,padding:'14px 18px',marginBottom:12,display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
            <div>
              <div style={{fontWeight:700,fontSize:14,color:result.empresaAlcanzo?'#86efac':'#fca5a5'}}>{result.empresaAlcanzo?'META EMPRESA ALCANZADA':'Meta empresa no alcanzada'}</div>
              <div style={{fontSize:12,color:'#ccc',marginTop:2}}>Ventas: <b>{fmt(result.totalVentasEmpresa)}</b> / Meta: <b>{fmt(result.META_EMPRESA)}</b> = {pct(result.pctEmpresaLogrado)}</div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:11,color:'#aaa'}}>Componente empresa (30%)</div>
              <div style={{fontSize:16,fontWeight:700,color:result.empresaAlcanzo?'#86efac':'#fca5a5'}}>{result.empresaAlcanzo?'S/ 600':'S/ 0'}</div>
            </div>
          </div>
          <div className="metrics-row">
            {[{label:'Total bonos',value:fmt(result.resultados.reduce((s,r)=>s+r.total_bono,0))},{label:'Colaboradoras',value:result.resultados.length},{label:'Tiendas >= 100%',value:Object.values(result.storeResults).filter(s=>s.cumplimiento>=1).length+'/'+config.tiendas.length},{label:'Cumpl. promedio',value:pct(Object.values(result.storeResults).reduce((s,r)=>s+r.cumplimiento,0)/Math.max(config.tiendas.length,1))}].map(m=><div key={m.label} className="metric-card"><div className="metric-label">{m.label}</div><div className="metric-value">{m.value}</div></div>)}
          </div>
          <div className="card">
            <h3>Resultados por tienda</h3>
            <div className="table-scroll">
              <table className="res-table">
                <thead><tr><th>Tienda</th><th>Tipo</th><th>Meta</th><th>Real</th><th>Cumpl.</th><th>Tier</th></tr></thead>
                <tbody>{Object.values(result.storeResults).sort((a,b)=>a.tienda.nombre.localeCompare(b.tienda.nombre)).map(sr=>{
                  const ic=sr.tipo==='chica'
                  const tl=sr.cumplimiento>=1.10?'>=110%->110%':sr.cumplimiento>=1.05?(ic?'105-109%->100%':'105-109%->105%'):sr.cumplimiento>=1.00?(ic?'100-104%->80%':'100-104%->100%'):sr.cumplimiento>=0.95?(ic?'95-99%->25%':'95-99%->40%'):'<95%->Sin bono'
                  const bc=sr.cumplimiento>=1?'green':sr.cumplimiento>=0.95?'teal':sr.cumplimiento>=0.8?'amber':'red'
                  return <tr key={sr.tienda.id}><td className="bold">{sr.tienda.nombre}</td><td><span style={{fontSize:10,padding:'2px 7px',borderRadius:10,background:sr.tipo==='grande'?'#1e3a5f':sr.tipo==='mediana'?'#1a3a2a':'#3a1a1a',color:sr.tipo==='grande'?'#93c5fd':sr.tipo==='mediana'?'#86efac':'#fca5a5'}}>{sr.tipo}</span></td><td>{fmt(sr.meta)}</td><td>{fmt(sr.ventaReal)}</td><td><span className={`badge ${bc}`}>{pct(sr.cumplimiento)}</span></td><td style={{fontSize:11,color:'#9CA3AF'}}>{tl}</td></tr>
                })}</tbody>
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
                  {result.resultados.map(r=>(
                    <tr key={r.empleada_id}><td className="bold">{r.nombre}</td><td style={{fontSize:10}}>{r.tiendas.map(t=><span key={t} className="pill">{t}</span>)}</td><td style={{textAlign:'center'}}>{r.horas_total}</td><td style={{textAlign:'right',color:'#818CF8'}}>{fmt(r.bono_individual)}</td><td style={{textAlign:'right',color:'#34D399'}}>{fmt(r.bono_empresa)}</td><td><strong className="total-bono">{fmt(r.total_bono)}</strong></td></tr>
                  ))}
                  <tr className="total-row"><td colSpan={3}>TOTAL A PAGAR</td><td style={{textAlign:'right',color:'#818CF8'}}>{fmt(result.resultados.reduce((s,r)=>s+r.bono_individual,0))}</td><td style={{textAlign:'right',color:'#34D399'}}>{fmt(result.resultados.reduce((s,r)=>s+r.bono_empresa,0))}</td><td><strong>{fmt(result.resultados.reduce((s,r)=>s+r.total_bono,0))}</strong></td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div style={{display:'flex',justifyContent:'flex-end',gap:12,marginTop:8}}>
            <button className="btn" onClick={()=>setResult(null)}>Nuevo mes</button>
            <button className="btn primary" onClick={exportar}>Exportar Excel</button>
          </div>
        </div>
      )}
    </div>
  )
}