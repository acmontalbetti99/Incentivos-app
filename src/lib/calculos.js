function getBonusByPct(pct, tiers, field) {
  const intPct = Math.round(pct * 100)
  const tier = [...tiers].reverse().find(t => intPct >= t.desde_pct)
  return tier ? (tier[field] || 0) : 0
}

export function procesarReporteRapifac(rows, mapping) {
  const { col_sucursal, col_total } = mapping
  const ventasPorTienda = {}
  for (const row of rows) {
    const tienda = String(row[col_sucursal] || '').trim()
    const total = parseFloat(
      String(row[col_total] || '0').replace(/[^0-9.-]/g, '')
    ) || 0
    if (!tienda) continue
    ventasPorTienda[tienda] = (ventasPorTienda[tienda] || 0) + total
  }
  return ventasPorTienda
}

export function calcularBonos({
  tiendas, tiersM, tiersY, params, empleadas,
  ventasMes, ventasAnt, horarios, reviews,
}) {
  const pesoMeta = parseFloat(params.peso_meta || 0.6)
  const pesoYoy  = parseFloat(params.peso_yoy  || 0.4)
  const pesoRev  = parseFloat(params.peso_reviews || 0.15)
  const scoreMin = parseFloat(params.score_min || 4.2)
  const scoreObj = parseFloat(params.score_obj || 4.7)
  const usaRev   = (params.usar_reviews || 'SI') === 'SI'
  const regla    = params.regla_multi || 'PRORRATEO'

  const storeResults = {}
  for (const tienda of tiendas) {
    const actual  = ventasMes[tienda.id] || 0
    const meta    = tienda.venta_ant * (1 + tienda.crec_obj)
    const antVal  = ventasAnt[tienda.id] || tienda.venta_ant
    const pctMeta = meta > 0 ? actual / meta : 0
    const pctYoy  = antVal > 0 ? (actual - antVal) / antVal : 0
    const bonoMeta = getBonusByPct(pctMeta, tiersM, 'bono_ind')
    const poolGrp  = getBonusByPct(pctMeta, tiersM, 'pool_grp')
    const bonoYoy  = getBonusByPct(pctYoy,  tiersY, 'bono_adic')
    const rev      = reviews[tienda.id]
    const revScore = usaRev && rev
      ? Math.max(0, Math.min(1, (rev - scoreMin) / Math.max(scoreObj - scoreMin, 0.01)))
      : 0
    storeResults[tienda.id] = { tienda, actual, meta, pctMeta, pctYoy, bonoMeta, poolGrp, bonoYoy, revScore }
  }

  const totalHorasTienda = {}
  for (const h of horarios) {
    totalHorasTienda[h.tienda_id] = (totalHorasTienda[h.tienda_id] || 0) + h.horas
  }

  const resultados = []
  for (const emp of empleadas) {
    const misHoras = horarios.filter(h => h.empleada_id === emp.id && h.horas > 0)
    const totalH   = misHoras.reduce((s, h) => s + h.horas, 0) || 1
    let bonoMetaEmp = 0, bonoYoyEmp = 0, poolEmp = 0, revEmp = 0
    if (regla === 'PRORRATEO') {
      for (const h of misHoras) {
        const sr = storeResults[h.tienda_id]
        if (!sr) continue
        const w = h.horas / totalH
        const wPool = h.horas / Math.max(totalHorasTienda[h.tienda_id] || 1, 1)
        bonoMetaEmp += sr.bonoMeta * w; bonoYoyEmp += sr.bonoYoy * w;
        poolEmp += sr.poolGrp * wPool; revEmp += sr.revScore * w
      }
    } else if (regla === 'PRINCIPAL') {
      const main = [...misHoras].sort((a, b) => b.horas - a.horas)[0]
      if (main) { const sr = storeResults[main.tienda_id]; if (sr) { bonoMetaEmp = sr.bonoMeta; bonoYoyEmp = sr.bonoYoy; poolEmp = sr.poolGrp * (main.horas / Math.max(totalHorasTienda[main.tienda_id] || 1, 1)); revEmp = sr.revScore } }
    } else {
      for (const h of misHoras) { const sr = storeResults[h.tienda_id]; if (!sr) continue; bonoMetaEmp += sr.bonoMeta; bonoYoyEmp += sr.bonoYoy; poolEmp += sr.poolGrp * (h.horas / Math.max(totalHorasTienda[h.tienda_id] || 1, 1)); revEmp += sr.revScore }
      const n = misHoras.length || 1; bonoMetaEmp /= n; bonoYoyEmp /= n; revEmp /= n
    }
    const bonoBase = Math.round(bonoMetaEmp * pesoMeta + bonoYoyEmp * pesoYoy)
    const bonoReviews = usaRev ? Math.round(bonoBase * pesoRev * revEmp) : 0
    resultados.push({ empleada_id: emp.id, nombre: emp.nombre, tiendas: misHoras.map(h => storeResults[h.tienda_id]?.tienda?.nombre).filter(Boolean), bono_meta: Math.round(bonoMetaEmp), bono_yoy: Math.round(bonoYoyEmp), bono_combinado: bonoBase, pool_grupal: Math.round(poolEmp), bono_reviews: bonoReviews, total_bono: Math.round(bonoBase + poolEmp + bonoReviews) })
  }
  resultados.sort((a, b) => b.total_bono - a.total_bono)
  return { resultados, storeResults }
}
