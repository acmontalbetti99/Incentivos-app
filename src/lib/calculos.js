function norm(s) {
  return String(s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}
function parsearJSON(str, fallback) {
  try { return JSON.parse(str) } catch { return fallback }
}
function getTierPct(cumplimiento, tipo, tiersGM, tiersCH) {
  const tiers = tipo === 'chica' ? tiersCH : tiersGM
  for (const t of tiers) {
    if (cumplimiento >= t.min && cumplimiento <= t.max) return t.pct
  }
  return 0
}
export function procesarReporteRapifac(rows, mapping) {
  const { col_sucursal, col_total } = mapping
  const ventas = {}
  for (const row of rows) {
    const tienda = String(row[col_sucursal] || '').trim()
    const total = parseFloat(String(row[col_total] || '0').replace(/[^0-9.-]/g, '')) || 0
    if (!tienda || total <= 0) continue
    ventas[tienda] = (ventas[tienda] || 0) + total
  }
  return ventas
}
export function calcularBonos({ tiendas, empleadas, horarios, ventasMes, params, reviews = {} }) {
  const BONO_TOTAL      = parseFloat(params.bono_total || 2000)
  const PCT_IND         = parseFloat(params.pct_individual || 0.70)
  const PCT_EMP         = parseFloat(params.pct_empresa || 0.30)
  const META_EMPRESA    = parseFloat(params.meta_empresa_total || 915780)
  const REVIEWS_BONUS   = parseFloat(params.reviews_bonus_pct || 0.10)
  const REVIEWS_PENALTY = parseFloat(params.reviews_penalty_pct || 0.05)
  const REVIEWS_MIN     = parseFloat(params.reviews_min_stars || 4)
  const BONO_IND        = BONO_TOTAL * PCT_IND
  const BONO_EMP        = BONO_TOTAL * PCT_EMP
  const metasTienda = parsearJSON(params.metas_tienda, {})
  const tiersGM     = parsearJSON(params.tiers_grande_mediana, [])
  const tiersCH     = parsearJSON(params.tiers_chica, [])
  const storeResults = {}
  let totalVentasEmpresa = 0
  for (const tienda of tiendas) {
    const ventaReal = ventasMes[tienda.id] || 0
    totalVentasEmpresa += ventaReal
    const metaKey  = Object.keys(metasTienda).find(k => norm(k) === norm(tienda.nombre))
    const metaData = metaKey ? metasTienda[metaKey] : null
    const meta     = metaData?.meta || tienda.venta_ant * (1 + tienda.crec_obj)
    const tipo     = metaData?.tipo || 'chica'
    const cumplimiento = meta > 0 ? ventaReal / meta : 0
    const tierPct      = getTierPct(cumplimiento, tipo, tiersGM, tiersCH)
    const reviewScore  = reviews[tienda.id] ?? null
    let reviewsFactor  = 1
    if (reviewScore !== null) {
      if (reviewScore > REVIEWS_MIN)      reviewsFactor = 1 + REVIEWS_BONUS
      else if (reviewScore < REVIEWS_MIN) reviewsFactor = 1 - REVIEWS_PENALTY
    }
    storeResults[tienda.id] = { tienda, ventaReal, meta, tipo, cumplimiento, tierPct, reviewScore, reviewsFactor }
  }
  const empresaAlcanzo    = totalVentasEmpresa >= META_EMPRESA
  const pctEmpresaLogrado = totalVentasEmpresa / META_EMPRESA
  const factorEmpresa     = empresaAlcanzo ? 1 : 0
  const horasTotalesByTienda = {}
  for (const h of horarios) {
    if (h.horas > 0) horasTotalesByTienda[h.tienda_id] = (horasTotalesByTienda[h.tienda_id] || 0) + h.horas
  }
  const totalHorasTodas = Object.values(horasTotalesByTienda).reduce((s,v)=>s+v,0)
  const resultados = []
  for (const emp of empleadas) {
    const horasEmp = horarios.filter(h => h.empleada_id === emp.id && h.horas > 0)
    const totalHorasEmp = horasEmp.reduce((s,h)=>s+h.horas,0)
    if (totalHorasEmp === 0) continue
    let bonoIndividual = 0
    const tiendasTrabajadas = []
    for (const h of horasEmp) {
      const sr = storeResults[h.tienda_id]
      if (!sr) continue
      const totalHorasTienda = horasTotalesByTienda[h.tienda_id] || 1
      const fraccion = h.horas / totalHorasTienda
      bonoIndividual += BONO_IND * sr.tierPct * sr.reviewsFactor * fraccion
      tiendasTrabajadas.push(sr.tienda.nombre)
    }
    const fraccionEmp = totalHorasTodas > 0 ? totalHorasEmp / totalHorasTodas : 0
    const bonoEmpresa = BONO_EMP * factorEmpresa * fraccionEmp
    resultados.push({
      empleada_id:    emp.id,
      nombre:         emp.nombre,
      tiendas:        [...new Set(tiendasTrabajadas)],
      horas_total:    totalHorasEmp,
      bono_individual: Math.round(bonoIndividual),
      bono_empresa:   Math.round(bonoEmpresa),
      bono_meta:      Math.round(bonoIndividual),
      bono_yoy:       0,
      bono_combinado: Math.round(bonoIndividual),
      pool_grupal:    Math.round(bonoEmpresa),
      bono_reviews:   0,
      total_bono:     Math.round(bonoIndividual + bonoEmpresa),
    })
  }
  resultados.sort((a,b) => a.nombre.localeCompare(b.nombre))
  return { resultados, storeResults, totalVentasEmpresa, empresaAlcanzo, pctEmpresaLogrado, META_EMPRESA }
}