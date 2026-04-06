import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

export async function loadConfig() {
  const [tiendas, tiersM, tiersY, params, empleadas] = await Promise.all([
    supabase.from('tiendas').select('*').eq('activa', true).order('nombre'),
    supabase.from('tiers_meta').select('*').order('orden'),
    supabase.from('tiers_yoy').select('*').order('orden'),
    supabase.from('parametros').select('*'),
    supabase.from('empleadas').select('*').eq('activa', true).order('nombre'),
  ])
  const p = Object.fromEntries((params.data || []).map(r => [r.clave, r.valor]))
  return {
    tiendas: tiendas.data || [],
    tiersM: tiersM.data || [],
    tiersY: tiersY.data || [],
    params: p,
    empleadas: empleadas.data || [],
  }
}

export async function loadColumnMapping() {
  const { data } = await supabase
    .from('column_mapping').select('*')
    .order('updated_at', { ascending: false }).limit(1).single()
  return data
}

export async function saveColumnMapping(mapping) {
  const { data: existing } = await supabase
    .from('column_mapping').select('id').limit(1).single()
  if (existing) {
    await supabase.from('column_mapping')
      .update({ ...mapping, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
  } else {
    await supabase.from('column_mapping').insert(mapping)
  }
}

export async function saveVentasMes(mes, ventasPorTienda, tiendas) {
  for (const [nombre, total] of Object.entries(ventasPorTienda)) {
    const tienda = tiendas.find(
      t => t.nombre.trim().toLowerCase() === nombre.trim().toLowerCase()
    )
    if (!tienda) continue
    await supabase.from('ventas_mes').upsert(
      { mes, tienda_id: tienda.id, total_ventas: total },
      { onConflict: 'mes,tienda_id' }
    )
  }
}

export async function loadHorariosMesAnterior(mesActual) {
  const [year, month] = mesActual.split('-').map(Number)
  const prev = month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, '0')}`
  const { data } = await supabase
    .from('horarios')
    .select('*, empleadas(nombre), tiendas(nombre)')
    .eq('mes', prev)
  return data || []
}

export async function saveHorarios(mes, rows) {
  for (const r of rows) {
    await supabase.from('horarios').upsert(
      { mes, empleada_id: r.empleada_id, tienda_id: r.tienda_id, horas: r.horas },
      { onConflict: 'mes,empleada_id,tienda_id' }
    )
  }
}

export async function saveResultados(mes, resultados) {
  for (const r of resultados) {
    await supabase.from('resultados').upsert({
      mes,
      empleada_id: r.empleada_id,
      bono_meta: r.bono_meta,
      bono_yoy: r.bono_yoy,
      bono_combinado: r.bono_combinado,
      pool_grupal: r.pool_grupal,
      bono_reviews: r.bono_reviews,
      total_bono: r.total_bono,
      calculado_at: new Date().toISOString(),
    }, { onConflict: 'mes,empleada_id' })
  }
}
