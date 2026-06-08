// v7 - Sin Supabase. Lee directamente de Google Sheets via gviz.
import { useState } from 'react'
import * as XLSX from 'xlsx'
import './App.css'

const VENTAS_ID    = '1lQXdKtkh5kdGS52SgJ6w0GiLIzyrHzph'
const HORARIOS_IDS = {
  '2026-04': '1UhthKK4MeoIXnLcgldk_NswaRDGWFFUC',
  '2026-05': '1HwZhrb8aHLjjzjsN6bmMimnmbGdbg7xj'
}
const MESES_ES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SETIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE']
const MESES_LABELS = [
  {val:'2026-01',label:'Enero 2026'},{val:'2026-02',label:'Febrero 2026'},
  {val:'2026-03',label:'Marzo 2026'},{val:'2026-04',label:'Abril 2026'},
  {val:'2026-05',label:'Mayo 2026'},{val:'2026-06',label:'Junio 2026'},
  {val:'2026-07',label:'Julio 2026'},{val:'2026-08',label:'Agosto 2026'},
  {val:'2026-09',label:'Setiembre 2026'},{val:'2026-10',label:'Octubre 2026'},
  {val:'2026-11',label:'Noviembre 2026'},{val:'2026-12',label:'Diciembre 2026'},
]
const BONO_BASE = 20, BONO_PCT = 0.04, BONO_MAX = 500, VENTA_MIN = 30000, CRECIMIENTO_MIN = 0.01
const TIENDAS = ['Chorrillos','El Refugio','La Molina','Los Olivos','Miraflores','Pueblo Libre','San Borja','San Juan de Lurigancho','San Juan de Miraflores','San Martin de Porres','San Miguel','Surco']

function norm(s) { return String(s||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'') }
function pn(cell) {
  if (!cell || cell.v === null || cell.v === undefined) return 0
  if (typeof cell.v === 'number') return cell.v
  return parseFloat(String(cell.v).replace(/[^0-9.-]/g,'')) || 0
}
async function fetchGviz(sheetId, sheetName) {
  const url = 'https://docs.google.com/spreadsheets/d/' + sheetId + '/gviz/tq?tqx=out:json&sheet=' + encodeURIComponent(sheetName)
  const res = await fetch(url)
  const txt = await res.text()
  return JSON.parse(txt.substring(txt.indexOf('{'), txt.lastIndexOf('}')+1))
}
async function leerVentas(mes) {
  const MESES_ABR = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
  const labelMesActual = (m) => { const [yr,mn]=m.split('-'); return MESES_ABR[parseInt(mn)-1]+'-'+yr.slice(2) }
  const labelAnioAnterior = (m) => { const [yr,mn]=m.split('-'); return MESES_ABR[parseInt(mn)-1]+'-'+String(Number(yr)-1).slice(2) }
  const labelMesAnterior = (m) => { let [yr,mn]=m.split('-').map(Number); let pm=mn-1,py=yr; if(pm<1){pm=12;py=yr-1} return MESES_ABR[pm-1]+'-'+String(py).slice(2) }
  const mn = MESES_ES[parseInt(mes.split('-')[1]) - 1]
  const gdata = await fetchGviz(VENTAS_ID, mn)
  const rows = gdata.table.rows || []
  if (rows.length < 2) return { ventas: {}, metaTotal: 0 }
  const hdr = rows[0].c || []
  const lActual = labelMesActual(mes), lAnioAnt = labelAnioAnterior(mes), lMesAnt = labelMesAnterior(mes)
  let colT = -1, colV = -1, colAnioAnt = -1, colMesAnt = -1, dateCols = []
  for (let j = 0; j < hdr.length; j++) {
    const cell = hdr[j]; if (!cell) continue
    if (typeof cell.v === 'string' && cell.v.trim().toUpperCase() === 'TIENDAS') colT = j
    if (typeof cell.v === 'number' && cell.v > 40000 && cell.v < 50000) {
      dateCols.push(j)
      const f = (cell.f||'').toLowerCase().trim()
      if (f === lActual) colV = j
      if (f === lAnioAnt) colAnioAnt = j
      if (f === lMesAnt) colMesAnt = j
    }
  }
  if (colT < 0) colT = 1
  if (colV < 0 && dateCols.length > 0) colV = dateCols[dateCols.length-1]
  if (colV < 0) return { ventas: {}, metaTotal: 0 }
  let colMeta = -1
  if (rows[1]) { const dr = rows[1].c||[]; for (let k=dr.length-1; k>=0; k--) { if (pn(dr[k])>10000){colMeta=k;break} } }
  const ventas = {}; let metaTotal = 0
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].c || []
    const n = String(cells[colT]?(cells[colT].v||''):'').trim(); if (!n) continue
    const nu = n.toUpperCase()
    if (nu.includes('META')&&nu.includes('TOTAL')) { metaTotal=pn(cells[2]); continue }
    if (nu==='TIENDAS'||nu==='TOTAL'||nu.includes('META')) continue
    const esRefugio = norm(n).includes('refugio')
    const vr = colV>=0?pn(cells[colV]):0
    // El Refugio: comparar vs mes anterior. Resto: vs mismo mes del anio anterior.
    let colComparar = esRefugio ? colMesAnt : colAnioAnt
    let va = colComparar>=0?pn(cells[colComparar]):0
    // Fallback: si la columna de comparacion esta vacia, buscar hacia atras
    if (va===0) {
      const colVIdx = dateCols.indexOf(colV)
      for (let dc=colVIdx-1; dc>=0; dc--) { const c2=pn(cells[dateCols[dc]]); if(c2>0){va=c2;break} }
    }
    const ma = colMeta>=0?pn(cells[colMeta]):0
    if (vr>0||va>0||ma>0) ventas[nu] = { ventaReal:vr, ventaAnt:va, metaAbs:ma, nombreOriginal:n }
  }
  return { ventas, metaTotal }
}

async function leerHorarios(mes) {
  const fileId = HORARIOS_IDS[mes]; if (!fileId) return {}
  const gdata = await fetchGviz(fileId, 'Resumen Mensual')
  const cols = gdata.table.cols||[], rows = gdata.table.rows||[]
  if (rows.length < 1) return {}
  const tiendaCols = []
  for (let j=1; j<cols.length; j++) {
    const label = String(cols[j].label||'').trim()
    if (label && !label.toLowerCase().includes('total') && !label.match(/^\d/)) tiendaCols.push({col:j,tienda:norm(label)})
  }
  const hdata = {}
  for (let i=0; i<rows.length; i++) {
    const row = rows[i].c||[]; const colab = String(row[0]?(row[0].v||''):'').trim(); if (!colab) continue
    for (const tc of tiendaCols) {
      const cell = row[tc.col]; const h = cell?(typeof cell.v==='number'?cell.v:parseFloat(String(cell.v||'0'))||0):0
      if (h>0) { if (!hdata[colab]) hdata[colab]={}; hdata[colab][tc.tienda]=(hdata[colab][tc.tienda]||0)+h }
    }
  }
  return hdata
}

const S = {
  input:{background:'rgba(255,255,255,0.08)',border:'1px solid rgba(255,255,255,0.2)',borderRadius:6,color:'#fff',fontSize:12,padding:'5px 8px',width:'100%'},
  configPanel:{background:'#1e1b4b',border:'1px solid #534AB7',borderRadius:10,padding:'1rem 1.25rem',marginBottom:'1rem'},
}

export default function App() {
  const hoy = new Date()
  const mesActual = hoy.getFullYear()+'-'+String(hoy.getMonth()+1).padStart(2,'0')
  const [mes, setMes] = useState(mesActual)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resultados, setResultados] = useState(null)
  const [syncInfo, setSyncInfo] = useState(null)
  const [reviews, setReviews] = useState({})
  const [showConfig, setShowConfig] = useState(false)

  async function cargarDatos(m) {
    setLoading(true); setError(''); setResultados(null); setSyncInfo(null)
    try {
      const [{ ventas, metaTotal }, horarios] = await Promise.all([leerVentas(m), leerHorarios(m)])
      if (Object.keys(ventas).length===0) { setError('Sin datos para '+MESES_ES[parseInt(m.split('-')[1])-1]+'. Verifica el sheet.'); setLoading(false); return }
      setSyncInfo(new Date().toLocaleString('es-PE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}))
      setResultados(calcular(ventas, horarios, metaTotal, reviews))
    } catch(e) { setError('Error: '+e.message) }
    setLoading(false)
  }

  function calcular(ventasData, horariosData, metaTotal, revs) {
    const storeResults = {}
    for (const tienda of TIENDAS) {
      const key = tienda.toUpperCase(), vd = ventasData[key]
      const ventaReal=vd?.ventaReal||0, metaAbs=vd?.metaAbs||0, ventaAnt=vd?.ventaAnt||0
      const crecSoles=ventaReal-ventaAnt, crecPct=ventaAnt>0?crecSoles/ventaAnt:0
      const cumplimiento=metaAbs>0?ventaReal/metaAbs:0
      const esRefugio=norm(tienda).includes('refugio')
      const activaBono=metaAbs>0?ventaReal>=metaAbs:(esRefugio?crecPct>=0.05:ventaReal>=VENTA_MIN&&crecPct>=CRECIMIENTO_MIN)
      const tiendaNorm=norm(tienda), horasPorColab={}
      for (const [colabName,th] of Object.entries(horariosData)) { const h=th[tiendaNorm]||0; if(h>0) horasPorColab[colabName]=h }
      const numColabs=Object.keys(horasPorColab).length
      const rv=revs[tienda]!==''?parseFloat(revs[tienda]):null
      let bonoReviews=0; if(rv!==null&&!isNaN(rv)){if(rv>4.0)bonoReviews=10;else if(rv<4.0)bonoReviews=-5}
      let bonoBaseColab=0; if(activaBono&&numColabs>0) bonoBaseColab=Math.min(Math.max(BONO_BASE+(BONO_PCT*crecSoles/numColabs),0),BONO_MAX)
      storeResults[key]={tienda,ventaReal,metaAbs,ventaAnt,crecSoles,crecPct,cumplimiento,activaBono,numColabs,bonoBaseColab,bonoReviews,horasPorColab,nombreOriginal:vd?.nombreOriginal||tienda}
    }
    const resultadosColab = []
    for (const colabName of Object.keys(horariosData)) {
      const tiendaHorasObj=horariosData[colabName]||{}
      const tiendasTrabajadas=[]; let horasTotal=0,bonoTotal=0,bonoRevTotal=0
      for (const [tiendaNorm2,horas] of Object.entries(tiendaHorasObj)) {
        const tiendaMatch=TIENDAS.find(t=>norm(t)===tiendaNorm2); if(!tiendaMatch||horas<=0) continue
        const sr=storeResults[tiendaMatch.toUpperCase()]; if(!sr) continue
        horasTotal+=horas; tiendasTrabajadas.push(tiendaMatch)
        if(sr.activaBono){bonoTotal+=sr.bonoBaseColab;bonoRevTotal+=sr.bonoReviews}
      }
      if(horasTotal>0) resultadosColab.push({nombre:colabName,tiendas:tiendasTrabajadas,horas_total:horasTotal,bono_base:bonoTotal,bono_reviews:bonoRevTotal,total_bono:Math.max(0,bonoTotal+bonoRevTotal)})
    }
    resultadosColab.sort((a,b)=>b.total_bono-a.total_bono)
    const totalVentas=TIENDAS.reduce((s,t)=>s+(storeResults[t.toUpperCase()]?.ventaReal||0),0)
    const META_EMPRESA=metaTotal>0?metaTotal:TIENDAS.reduce((s,t)=>s+(storeResults[t.toUpperCase()]?.metaAbs||0),0)
    const pctEmpresa=META_EMPRESA>0?totalVentas/META_EMPRESA:0
    return {storeResults,resultados:resultadosColab,totalVentasEmpresa:totalVentas,META_EMPRESA,pctEmpresaLogrado:pctEmpresa,empresaAlcanzo:pctEmpresa>=1}
  }

  function exportarExcel() {
    if(!resultados) return
    const data=resultados.resultados.map(r=>({'Colaboradora':r.nombre,'Tiendas':r.tiendas.join(', '),'Horas':r.horas_total,'Bono base (S/)':r.bono_base.toFixed(2),'Bono reviews (S/)':r.bono_reviews.toFixed(2),'TOTAL BONO (S/)':r.total_bono.toFixed(2)}))
    const ws=XLSX.utils.json_to_sheet(data); const wb=XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb,ws,'Bonos '+mes); XLSX.writeFile(wb,'bonos_'+mes+'.xlsx')
  }

  const fmt=n=>'S/ '+Math.round(n||0).toLocaleString('es-PE')
  const fmtDec=n=>'S/ '+(n||0).toFixed(2)
  const pct=n=>(n*100).toFixed(1)+'%'
  const sortedTiendas=[...TIENDAS].sort((a,b)=>a.localeCompare(b))

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-left">
          <span className="topbar-title">Incentivos tiendas</span>
          <span className="topbar-sep">&middot;</span>
          <select value={mes} onChange={e=>{setMes(e.target.value);setResultados(null)}} className="month-input">
            {MESES_LABELS.map(m=><option key={m.val} value={m.val} style={{background:'#3730a3'}}>{m.label}</option>)}
          </select>
          {syncInfo&&<span style={{fontSize:10,color:'rgba(255,255,255,0.5)',marginLeft:4}}>Actualizado: {syncInfo}</span>}
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <button onClick={()=>cargarDatos(mes)} style={{background:'rgba(255,255,255,0.15)',border:'none',borderRadius:6,color:'#fff',fontSize:11,padding:'4px 12px',cursor:'pointer'}}>&#x1f504; Actualizar</button>
          <button onClick={()=>setShowConfig(!showConfig)} style={{background:'rgba(255,255,255,0.18)',border:'none',borderRadius:6,color:'#fff',fontSize:11,padding:'4px 14px',cursor:'pointer'}}>Config</button>
        </div>
      </div>

      {showConfig&&(
        <div style={S.configPanel}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
            <span style={{color:'#fff',fontWeight:600,fontSize:15}}>Google Reviews por tienda</span>
            <button onClick={()=>setShowConfig(false)} style={{background:'none',border:'none',color:'#aaa',fontSize:20,cursor:'pointer'}}>x</button>
          </div>
          <p style={{color:'#aaa',fontSize:11,marginBottom:8}}>Mayor a 4.0 = +S/10 | Menor a 4.0 = -S/5 | Sin dato = S/0</p>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6}}>
            {TIENDAS.map(t=>(
              <div key={t} style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{color:'#ccc',fontSize:11,flex:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{t}</span>
                <input type="number" min="1" max="5" step="0.1" placeholder="--" value={reviews[t]||''} onChange={e=>setReviews(prev=>({...prev,[t]:e.target.value}))} style={{...S.input,width:60,textAlign:'center'}}/>
              </div>
            ))}
          </div>
        </div>
      )}

      {error&&<div className="error-bar">{error}<button onClick={()=>setError('')}>x</button></div>}
      {loading&&<div style={{textAlign:'center',padding:'40px',color:'#818CF8'}}><div className="spinner" style={{margin:'0 auto 12px'}}/><p>Leyendo Google Sheets...</p></div>}

      {!loading&&!resultados&&!error&&(
        <div style={{textAlign:'center',padding:'60px',color:'#9CA3AF'}}>
          <p style={{fontSize:15,marginBottom:12}}>Selecciona un mes y presiona <strong>Actualizar</strong></p>
          <button onClick={()=>cargarDatos(mes)} style={{background:'#4F46E5',border:'none',borderRadius:8,color:'#fff',fontSize:13,padding:'10px 24px',cursor:'pointer'}}>&#x1f504; Cargar {MESES_LABELS.find(m=>m.val===mes)?.label}</button>
        </div>
      )}

      {!loading&&resultados&&(
        <div className="panel">
          <div style={{background:resultados.empresaAlcanzo?'rgba(22,163,74,0.15)':'rgba(220,38,38,0.18)',border:'1px solid '+(resultados.empresaAlcanzo?'#16A34A':'#DC2626'),borderRadius:10,padding:'14px 18px',marginBottom:12,display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
            <div>
              <div style={{fontWeight:700,fontSize:14,color:resultados.empresaAlcanzo?'#166534':'#7f1d1d'}}>{resultados.empresaAlcanzo?'META EMPRESA ALCANZADA':'Meta empresa no alcanzada'}</div>
              <div style={{fontSize:12,color:resultados.empresaAlcanzo?'#14532d':'#7f1d1d',marginTop:2}}>Ventas totales: <b>{fmt(resultados.totalVentasEmpresa)}</b> &middot; Meta: <b>{fmt(resultados.META_EMPRESA)}</b> &middot; {pct(resultados.pctEmpresaLogrado)}</div>
            </div>
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:11,color:'#aaa'}}>Total bonos a pagar</div>
              <div style={{fontSize:18,fontWeight:700,color:'#818CF8'}}>{fmt(resultados.resultados.reduce((s,r)=>s+r.total_bono,0))}</div>
            </div>
          </div>

          <div className="metrics-row">
            {[{label:'Total bonos',value:fmt(resultados.resultados.reduce((s,r)=>s+r.total_bono,0))},{label:'Colaboradoras',value:resultados.resultados.length},{label:'Tiendas con bono',value:Object.values(resultados.storeResults).filter(s=>s.activaBono).length+'/12'},{label:'Cumpl. promedio',value:pct(Object.values(resultados.storeResults).reduce((s,r)=>s+r.cumplimiento,0)/12)}].map(m=><div key={m.label} className="metric-card"><div className="metric-label">{m.label}</div><div className="metric-value">{m.value}</div></div>)}
          </div>

          <div className="card"><h3>Resultados por tienda</h3>
            <div className="table-scroll"><table className="res-table">
              <thead><tr><th>Tienda</th><th>Venta ant.</th><th>Venta act.</th><th>Crec. %</th><th>Crec. S/</th><th>Cumpl. meta</th><th>Reviews</th><th style={{color:'#818CF8'}}>Bono/colab.</th></tr></thead>
              <tbody>{sortedTiendas.map(t=>{
                const sr=resultados.storeResults[t.toUpperCase()]; if(!sr) return null
                const rv=reviews[t]!==''?parseFloat(reviews[t]):null
                return(<tr key={t}><td className="bold">{sr.nombreOriginal}</td><td>{fmt(sr.ventaAnt)}</td><td>{fmt(sr.ventaReal)}</td>
                  <td><span className={'badge '+(sr.crecPct>=CRECIMIENTO_MIN?'green':'red')}>{pct(sr.crecPct)}</span></td>
                  <td style={{color:sr.crecSoles>=0?'#86efac':'#fca5a5'}}>{sr.crecSoles>=0?'+':''}{fmt(sr.crecSoles)}</td><td style={{textAlign:'center',fontWeight:600,color:sr.metaAbs<=0?'#94a3b8':(sr.cumplimiento>=1?'#16a34a':sr.cumplimiento>=0.9?'#d97706':'#dc2626')}}>{sr.metaAbs>0?pct(sr.cumplimiento):'-'}</td>
                  <td style={{textAlign:'center',color:rv&&rv>4?'#86efac':rv&&rv<4?'#fca5a5':'#aaa'}}>{rv&&!isNaN(rv)?rv.toFixed(1)+'*':'-'}</td>
                  <td style={{textAlign:'right',color:'#818CF8',fontWeight:600}}>{sr.activaBono?fmtDec(sr.bonoBaseColab):'S/ 0'}</td>
                </tr>)
              })}</tbody>
            </table></div>
          </div>

          <div className="card"><h3>Horas trabajadas por colaboradora</h3>
            <div className="table-scroll"><table className="res-table">
              <thead><tr>
                <th style={{minWidth:110}}>Colaboradora</th>
                {sortedTiendas.map(t=>(<th key={t} style={{width:52,maxWidth:52,padding:'4px 2px',verticalAlign:'bottom',textAlign:'center'}}><div style={{writingMode:'vertical-rl',transform:'rotate(180deg)',fontSize:10,fontWeight:600,lineHeight:1.2,maxHeight:80,overflow:'hidden',whiteSpace:'nowrap',color:'#cbd5e1'}}>{t}</div></th>))}
                <th style={{color:'#818CF8',textAlign:'center',minWidth:60}}>Total h.</th>
                <th style={{color:'#818CF8',textAlign:'right',minWidth:72}}>Bono ind.</th>
              </tr></thead>
              <tbody>
              {resultados.resultados.map(r=>(<tr key={r.nombre}>
                <td className="bold" style={{fontSize:11}}>{r.nombre}</td>
                {sortedTiendas.map(t=>{const h=(resultados.storeResults[t.toUpperCase()]?.horasPorColab||{})[r.nombre]||0;return<td key={t} style={{textAlign:'center',fontSize:11,fontWeight:h>0?600:400,color:h>0?'#1e293b':'#94a3b8',background:h>0?'#e0e7ff':'transparent',borderRadius:4,padding:'2px 4px'}}>{h>0?h:'-'}</td>})}
                <td style={{textAlign:'center',fontWeight:700,color:'#818CF8',fontSize:11}}>{r.horas_total}</td>
                <td style={{textAlign:'right',fontWeight:700,color:'#818CF8',fontSize:11}}>{fmtDec(r.bono_base)}</td>
              </tr>))}
              <tr className="total-row"><td style={{fontSize:10}}>TOTAL HORAS</td>
                {sortedTiendas.map(t=>{const tot=resultados.resultados.reduce((s,r)=>s+((resultados.storeResults[t.toUpperCase()]?.horasPorColab||{})[r.nombre]||0),0);return<td key={t} style={{textAlign:'center',fontSize:10}}>{tot||'-'}</td>})}
                <td style={{textAlign:'center',fontWeight:700}}>{resultados.resultados.reduce((s,r)=>s+r.horas_total,0)}</td>
                <td style={{textAlign:'right',fontWeight:700,color:'#818CF8'}}>{fmtDec(resultados.resultados.reduce((s,r)=>s+r.bono_base,0))}</td>
              </tr>
              </tbody>
            </table></div>
          </div>

          <div className="card"><h3>Bonos por colaboradora</h3>
            <div style={{fontSize:11,color:'#9CA3AF',marginBottom:8}}>Formula: S/20 + (4% x crec S/ / colabs) | Max: S/500</div>
            <div className="table-scroll"><table className="res-table">
              <thead><tr><th>Colaboradora</th><th>Tiendas</th><th>Horas</th><th style={{color:'#818CF8'}}>Bono base</th><th style={{color:'#34D399'}}>Bono reviews</th><th>TOTAL</th></tr></thead>
              <tbody>
              {resultados.resultados.map(r=>(<tr key={r.nombre}>
                <td className="bold">{r.nombre}</td>
                <td style={{fontSize:10}}>{r.tiendas.map(t=><span key={t} className="pill">{t}</span>)}</td>
                <td style={{textAlign:'center'}}>{r.horas_total}</td>
                <td style={{textAlign:'right',color:'#818CF8'}}>{fmtDec(r.bono_base)}</td>
                <td style={{textAlign:'right',color:r.bono_reviews>=0?'#34D399':'#fca5a5'}}>{fmtDec(r.bono_reviews)}</td>
                <td><strong className="total-bono">{fmtDec(r.total_bono)}</strong></td>
              </tr>))}
              <tr className="total-row">
                <td colSpan={3}>TOTAL A PAGAR</td>
                <td style={{textAlign:'right',color:'#818CF8'}}>{fmtDec(resultados.resultados.reduce((s,r)=>s+r.bono_base,0))}</td>
                <td style={{textAlign:'right',color:'#34D399'}}>{fmtDec(resultados.resultados.reduce((s,r)=>s+r.bono_reviews,0))}</td>
                <td><strong>{fmtDec(resultados.resultados.reduce((s,r)=>s+r.total_bono,0))}</strong></td>
              </tr>
              </tbody>
            </table></div>
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