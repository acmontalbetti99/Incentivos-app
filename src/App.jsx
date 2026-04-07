import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import {
  supabase, loadConfig, loadColumnMapping, saveColumnMapping,
  saveVentasMes, saveHorarios, saveResultados, loadHorariosMesAnterior,
} from './lib/supabase'
import { calcularBonos, procesarReporteRapifac } from './lib/calculos'
import './App.css'

const STEPS = ['Subir archivo', 'Mapear columnas', 'Horarios', 'Resultados', 'Exportar']

function norm(s) { return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') }

function cruzarVentasConTiendas(ventasRaw, tiendas) {
  const result = {}
  const noMatch = []
  for (const [nombreExcel, total] of Object.entries(ventasRaw)) {
    const tienda = tiendas.find(t => norm(t.nombre) === norm(nombreExcel))
    if (tienda) {
      result[tienda.id] = { nombre: tienda.nombre, total }
    } else {
      noMatch.push(nombreExcel)
    }
  }
  return { ventasPorId: result, noMatch }
}

export default function App() {
  const [step, setStep] = useState(0)
  const [mes, setMes] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
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

  useEffect(() => {
    async function init() {
      try {
        const cfg = await loadConfig()
        setConfig(cfg)
        const m = await loadColumnMapping()
        if (m) setSavedMapping(m)
      } catch (e) {
        setError('Error al conectar con Supabase. Verifica las variables de entorno.')
      }
    }
    init()
  }, [])

  const handleFile = useCallback((file) => {
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
        if (!rows.length) { setError('El archivo esta vacio.'); return }
        setRawRows(rows)
        setColumns(Object.keys(rows[0]))
        if (savedMapping) {
          setMapping(savedMapping)
          procesarYContinuar(rows, savedMapping)
        } else {
          const cols = Object.keys(rows[0])
          setMapping({ col_sucursal: cols[0], col_total: cols[0], col_fecha: cols[0], col_cajero: '' })
          goStep(1)
        }
      } catch {
        setError('No se pudo leer el archivo. Asegurate de que sea .xlsx, .xls o .csv')
      }
    }
    reader.readAsArrayBuffer(file)
  }, [savedMapping])

  async function procesarYContinuar(rows, map) {
    setLoading(true)
    try {
      const cfg = config || await loadConfig()
      const ventasRaw = procesarReporteRapifac(rows, map)
      const { ventasPorId: vpi, noMatch } = cruzarVentasConTiendas(ventasRaw, cfg.tiendas)
      setVentasPorId(vpi)
      setNoMatchTiendas(noMatch)
      for (const [tienda_id, { total }] of Object.entries(vpi)) {
        await supabase.from('ventas_mes').upsert(
          { mes, tienda_id: parseInt(tienda_id), total_ventas: total },
          { onConflict: 'mes,tienda_id' }
        )
      }
      const horasAnt = await loadHorariosMesAnterior(mes)
      if (horasAnt.length) {
        setHorarios(horasAnt.map(h => ({
          empleada_id: h.empleada_id,
          empleada_nombre: h.empleadas?.nombre || '',
          tienda_id: h.tienda_id,
          tienda_nombre: h.tiendas?.nombre || '',
          horas: h.horas,
        })))
      } else {
        const filas = []
        for (const emp of cfg.empleadas) {
          for (const ti of cfg.tiendas) {
            filas.push({ empleada_id: emp.id, empleada_nombre: emp.nombre, tienda_id: ti.id, tienda_nombre: ti.nombre, horas: 0 })
          }
        }
        setHorarios(filas)
      }
      goStep(2)
    } catch (e) {
      setError('Error al procesar el archivo: ' + e.message)
    } finally { setLoading(false) }
  }

  async function confirmarMapeo() {
    setLoading(true)
    try {
      await saveColumnMapping(mapping)
      setSavedMapping(mapping)
      await procesarYContinuar(rawRows, mapping)
    } catch (e) {
      setError('Error al guardar el mapeo.')
      setLoading(false)
    }
  }

  async function calcular() {
    setLoading(true)
    try {
      const ventasMesById = Object.fromEntries(
        Object.entries(ventasPorId).map(([id, { total }]) => [id, total])
      )
      const ventasAntById = {}
      for (const t of config.tiendas) ventasAntById[t.id] = t.venta_ant

      const reviewsById = {}
      const { data: revData } = await supabase.from('reviews').select('*').eq('mes', mes)
      if (revData) for (const r of revData) reviewsById[r.tienda_id] = r.score

      const { resultados: res, storeResults } = calcularBonos({
        tiendas: config.tiendas, tiersM: config.tiersM, tiersY: config.tiersY,
        params: config.params, empleadas: config.empleadas,
        ventasMes: ventasMesById, ventasAnt: ventasAntById,
        horarios, reviews: reviewsById,
      })
      setResultados({ resultados: res, storeResults })
      await saveHorarios(mes, horarios)
      await saveResultados(mes, res)
      goStep(3)
    } catch (e) {
      setError('Error al calcular bonos: ' + e.message)
    } finally { setLoading(false) }
  }

  function exportarExcel() {
    if (!resultados) return
    const data = resultados.resultados.map(r => ({
      'Empleada': r.nombre,
      'Tiendas': r.tiendas.join(', '),
      'Bono Meta (S/)': r.bono_meta,
      'Bono YoY (S/)': r.bono_yoy,
      'Bono Combinado (S/)': r.bono_combinado,
      'Pool Grupal (S/)': r.pool_grupal,
      'Bono Reviews (S/)': r.bono_reviews,
      'TOTAL BONO (S/)': r.total_bono,
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, `Bonos ${mes}`)
    XLSX.writeFile(wb, `bonos_${mes}.xlsx`)
  }

  function goStep(n) { setStep(n); setError('') }
  const fmt = (n) => `S/ ${Math.round(n || 0).toLocaleString('es-PE')}`
  const pct = (n) => `${Math.round((n || 0) * 100)}%`

  if (!config) return (
    <div className="loading-screen">
      <div className="spinner" />
      <p>{error || 'Conectando...'}</p>
    </div>
  )

  return (
    <div className="app">
      <div className="topbar">
        <div className="topbar-left">
          <span className="topbar-title">Incentivos tiendas</span>
          <span className="topbar-sep">·</span>
          <input type="month" value={mes} onChange={e => setMes(e.target.value)} className="month-input" />
        </div>
        {savedMapping && <span className="saved-pill">Mapeo Rapifac guardado</span>}
      </div>
      <div className="steps-bar">
        {STEPS.map((s, i) => (
          <div key={i} className={`step-item ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`} onClick={() => i < step && goStep(i)}>
            <div className="step-circle">{i < step ? '✓' : i + 1}</div>
            <div className="step-label">{s}</div>
          </div>
        ))}
      </div>
      {error && <div className="error-bar">{error}<button onClick={() => setError('')}>×</button></div>}

      {step === 0 && (
        <div className="panel">
          <div className="card">
            <h3>Reporte de ventas de Rapifac</h3>
            <p className="hint">En Rapifac: <strong>Reportes → Ventas por sucursal → mes → Exportar Excel</strong></p>
            <div className="upload-zone" onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }} onDragOver={e => e.preventDefault()} onClick={() => document.getElementById('fi').click()}>
              <div className="upload-icon">↑</div>
              <div className="upload-title">Arrastra el Excel o haz clic para seleccionar</div>
              <div className="upload-sub">.xlsx · .xls · .csv</div>
              <input id="fi" type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
            </div>
          </div>
          {savedMapping && <div className="info-card purple">Configuracion de columnas guardada — el archivo se procesara automaticamente.</div>}
        </div>
      )}

      {step === 1 && (
        <div className="panel">
          <div className="card">
            <div className="card-header"><h3>Archivo cargado</h3><span className="file-pill">{fileName}</span></div>
            <p className="hint">Vista previa — primeras filas:</p>
            <div className="table-scroll">
              <table className="preview-table">
                <thead><tr>{columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>{rawRows.slice(0, 3).map((r, i) => (<tr key={i}>{columns.map(c => <td key={c}>{String(r[c] ?? '')}</td>)}</tr>))}</tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <h3>Mapear columnas <span className="hint-inline">— solo la primera vez</span></h3>
            <div className="mapper-grid">
              {[
                { key: 'col_sucursal', label: 'Sucursal / tienda', req: true },
                { key: 'col_total', label: 'Monto total', req: true },
                { key: 'col_fecha', label: 'Fecha', req: true },
                { key: 'col_cajero', label: 'Cajero / vendedor', req: false },
              ].map(({ key, label, req }) => (
                <div key={key} className="map-item">
                  <label>{label} {req && <span className="req">*</span>}</label>
                  <select value={mapping?.[key] || ''} onChange={e => setMapping(m => ({ ...m, [key]: e.target.value }))}>
                    {!req && <option value="">— no disponible —</option>}
                    {columns.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="info-card teal">Esta configuracion se guardara. El proximo mes solo subes el archivo.</div>
            <div className="card-footer">
              <span className="hint-small"><span className="req">*</span> Obligatorios</span>
              <button className="btn primary" onClick={confirmarMapeo} disabled={loading}>{loading ? 'Procesando...' : 'Guardar y continuar →'}</button>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="panel">
          <div className="card">
            <div className="card-header">
              <h3>Ventas del mes — {mes}</h3>
              <span className="saved-pill">✓ {Object.keys(ventasPorId).length} tiendas</span>
            </div>
            {noMatchTiendas.length > 0 && (
              <div className="info-card amber" style={{marginBottom: 10}}>
                ⚠ Estas tiendas del Excel no coinciden con Supabase: <strong>{noMatchTiendas.join(', ')}</strong>
              </div>
            )}
            <div className="ventas-summary">
              {config.tiendas.map(tienda => {
                const v = ventasPorId[tienda.id]
                const total = v?.total || 0
                const meta = tienda.venta_ant * (1 + tienda.crec_obj)
                const p = meta > 0 ? total / meta : 0
                return (
                  <div key={tienda.id} className="tienda-chip">
                    <div className="tienda-name">{tienda.nombre}</div>
                    <div className="tienda-total">{fmt(total)}</div>
                    <div className={`tienda-pct ${p >= 1 ? 'green' : p >= 0.8 ? 'amber' : total > 0 ? 'red' : ''}`}>{total > 0 ? pct(p) : '—'}</div>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="card">
            <h3>Horas por empleada</h3>
            <p className="hint">Ingresa las horas trabajadas en cada tienda este mes.</p>
            <div className="table-scroll">
              <table className="hours-table">
                <thead><tr><th className="emp-col">Empleada</th>{config.tiendas.map(t => <th key={t.id} title={t.nombre}>{t.nombre.slice(0, 8)}</th>)}<th className="total-col">Total</th></tr></thead>
                <tbody>
                  {config.empleadas.map(emp => {
                    const empH = config.tiendas.map(ti => { const h = horarios.find(r => r.empleada_id === emp.id && r.tienda_id === ti.id); return h?.horas || 0 })
                    const tot = empH.reduce((s, h) => s + h, 0)
                    return (
                      <tr key={emp.id}>
                        <td className="emp-name">{emp.nombre}</td>
                        {config.tiendas.map((ti, idx) => (
                          <td key={ti.id}>
                            <input type="number" min="0" max="300" value={empH[idx]} className="hours-input"
                              onChange={e => {
                                const val = parseFloat(e.target.value) || 0
                                setHorarios(prev => {
                                  const next = prev.filter(r => !(r.empleada_id === emp.id && r.tienda_id === ti.id))
                                  if (val > 0) next.push({ empleada_id: emp.id, empleada_nombre: emp.nombre, tienda_id: ti.id, tienda_nombre: ti.nombre, horas: val })
                                  return next
                                })
                              }} />
                          </td>
                        ))}
                        <td className="total-h">{tot}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="card-footer">
              <span className="hint-small">Puedes usar decimales (ej: 37.5)</span>
              <button className="btn primary" onClick={calcular} disabled={loading}>{loading ? 'Calculando...' : 'Calcular bonos →'}</button>
            </div>
          </div>
        </div>
      )}

      {step === 3 && resultados && (
        <div className="panel">
          <div className="metrics-row">
            {[
              { label: 'Total bonos', value: fmt(resultados.resultados.reduce((s, r) => s + r.total_bono, 0)) },
              { label: 'Empleadas', value: resultados.resultados.length },
              { label: 'Tiendas en meta', value: `${Object.values(resultados.storeResults).filter(s => s.pctMeta >= 1).length} / ${config.tiendas.length}` },
              { label: 'Cumpl. promedio', value: pct(Object.values(resultados.storeResults).reduce((s, r) => s + r.pctMeta, 0) / Math.max(config.tiendas.length, 1)) },
            ].map(m => (<div key={m.label} className="metric-card"><div className="metric-label">{m.label}</div><div className="metric-value">{m.value}</div></div>))}
          </div>
          <div className="card">
            <h3>Ventas por tienda</h3>
            <div className="table-scroll">
              <table className="res-table">
                <thead><tr><th>Tienda</th><th>Meta</th><th>Real</th><th>Cumpl.</th><th>YoY</th><th>Pool</th><th>Estado</th></tr></thead>
                <tbody>
                  {Object.values(resultados.storeResults).map(({ tienda, actual, meta, pctMeta, pctYoy, poolGrp }) => (
                    <tr key={tienda.id}>
                      <td className="bold">{tienda.nombre}</td>
                      <td>{fmt(meta)}</td><td>{fmt(actual)}</td>
                      <td><span className={`badge ${pctMeta >= 1.05 ? 'green' : pctMeta >= 0.95 ? 'teal' : pctMeta >= 0.8 ? 'amber' : 'red'}`}>{pct(pctMeta)}</span></td>
                      <td className={pctYoy >= 0 ? 'text-green' : 'text-red'}>{pct(pctYoy)}</td>
                      <td>{fmt(poolGrp)}</td>
                      <td><span className={`badge ${pctMeta >= 1.05 ? 'green' : pctMeta >= 0.95 ? 'teal' : pctMeta >= 0.8 ? 'amber' : 'red'}`}>{pctMeta >= 1.15 ? 'Exceeds' : pctMeta >= 1.05 ? 'Stretch' : pctMeta >= 0.95 ? 'On target' : pctMeta >= 0.8 ? 'Near' : 'Below'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <h3>Bonos por empleada</h3>
            <div className="table-scroll">
              <table className="res-table">
                <thead><tr><th>Empleada</th><th>Tiendas</th><th>Combinado</th><th>Pool</th><th>Reviews</th><th>TOTAL</th></tr></thead>
                <tbody>
                  {resultados.resultados.map(r => (
                    <tr key={r.empleada_id}>
                      <td className="bold">{r.nombre}</td>
                      <td>{r.tiendas.map(t => <span key={t} className="pill">{t}</span>)}</td>
                      <td>{fmt(r.bono_combinado)}</td><td>{fmt(r.pool_grupal)}</td><td>{fmt(r.bono_reviews)}</td>
                      <td><strong className="total-bono">{fmt(r.total_bono)}</strong></td>
                    </tr>
                  ))}
                  <tr className="total-row"><td colSpan={5}>TOTAL A PAGAR</td><td><strong>{fmt(resultados.resultados.reduce((s, r) => s + r.total_bono, 0))}</strong></td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div className="card-footer standalone">
            <button className="btn" onClick={() => goStep(2)}>← Ajustar horarios</button>
            <button className="btn primary" onClick={() => goStep(4)}>Exportar →</button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="panel">
          <div className="card">
            <h3>Exportar resultados — {mes}</h3>
            <div className="export-options">
              <div className="export-item" onClick={exportarExcel}>
                <div className="export-icon green">↓</div>
                <div><div className="export-title">Excel para RR.HH.</div><div className="export-sub">Todas las empleadas · desglose completo · listo para procesar pago</div></div>
                <span className="export-ext green">.xlsx</span>
              </div>
            </div>
            <div className="success-banner"><div className="success-dot" /><div><div className="success-title">Resultados guardados en Supabase</div><div className="success-sub">Historico disponible desde cualquier dispositivo</div></div></div>
            <div className="card-footer">
              <span className="hint-small purple">Mapeo guardado — el proximo mes solo sube el Excel</span>
              <button className="btn" onClick={() => { setStep(0); setRawRows([]); setResultados(null); setVentasPorId({}) }}>Nuevo mes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}