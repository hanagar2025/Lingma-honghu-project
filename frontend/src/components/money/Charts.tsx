import React from 'react'

/**
 * 资金驾驶舱用的 SVG 小图。刻意不引入图表库：图只有线、带和柱三种，
 * 自己画比多背一个依赖更可控。缺失值（null）在线上断开，不补 0。
 */

type Num = number | null

function extent(series: Num[][], pad = 0.04): [number, number] {
  const xs = series.flat().filter((v): v is number => v !== null && Number.isFinite(v))
  if (!xs.length) return [0, 1]
  let lo = Math.min(...xs)
  let hi = Math.max(...xs)
  if (lo === hi) { lo -= 1; hi += 1 }
  const d = (hi - lo) * pad
  return [lo - d, hi + d]
}

function pathOf(xs: Num[], x0: number, y0: number, w: number, h: number, lo: number, hi: number): string {
  let d = ''
  let pen = false
  const n = Math.max(1, xs.length - 1)
  xs.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) { pen = false; return }
    const x = x0 + (i / n) * w
    const y = y0 + h - ((v - lo) / (hi - lo)) * h
    d += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)} `
    pen = true
  })
  return d
}

function bandPath(lo: Num[], hi: Num[], x0: number, y0: number, w: number, h: number, min: number, max: number): string {
  const n = Math.max(1, lo.length - 1)
  const pts: string[] = []
  const back: string[] = []
  lo.forEach((l, i) => {
    const u = hi[i] ?? null
    if (l === null || u === null) return
    const x = x0 + (i / n) * w
    pts.push(`${x.toFixed(1)},${(y0 + h - ((u - min) / (max - min)) * h).toFixed(1)}`)
    back.unshift(`${x.toFixed(1)},${(y0 + h - ((l - min) / (max - min)) * h).toFixed(1)}`)
  })
  return pts.length ? `M${pts.join(' L')} L${back.join(' L')} Z` : ''
}

export const Spark: React.FC<{ data: Num[]; baseline?: Num; color: string; width?: number; height?: number }> = ({
  data, baseline, color, width = 240, height = 56,
}) => {
  const [lo, hi] = extent([data, baseline !== undefined && baseline !== null ? [baseline] : []])
  const y = (v: number) => height - 2 - ((v - lo) / (hi - lo)) * (height - 4)
  return (
    <svg width={width} height={height}>
      {baseline !== undefined && baseline !== null && (
        <line x1={0} x2={width} y1={y(baseline)} y2={y(baseline)} stroke="#5b6573" strokeDasharray="4 3" />
      )}
      <path d={pathOf(data, 0, 2, width, height - 4, lo, hi)} fill="none" stroke={color} strokeWidth={1.8} />
    </svg>
  )
}

export const FlowBars: React.FC<{ data: Num[]; width?: number; height?: number }> = ({ data, width = 300, height = 60 }) => {
  const xs = data.filter((v): v is number => v !== null)
  const m = Math.max(1, ...xs.map(Math.abs))
  const bw = width / Math.max(1, data.length)
  const mid = height / 2
  return (
    <svg width={width} height={height}>
      <line x1={0} x2={width} y1={mid} y2={mid} stroke="#5b6573" />
      {data.map((v, i) => {
        if (v === null) return <rect key={i} x={i * bw + 1} y={mid - 1} width={Math.max(1, bw - 2)} height={2} fill="#3a4452" />
        const hh = (Math.abs(v) / m) * (mid - 2)
        return <rect key={i} x={i * bw + 1} y={v > 0 ? mid - hh : mid} width={Math.max(1, bw - 2)} height={Math.max(1, hh)}
          fill={v > 0 ? '#ff7b72' : '#3fb950'} />
      })}
    </svg>
  )
}

export interface LineDef { data: Num[]; color: string; width?: number; dash?: string; label: string }

/** 多线图：可选水位带、水平参考线、竖线标注 */
export const LinesChart: React.FC<{
  dates: string[]
  lines: LineDef[]
  band?: { lo: Num[]; hi: Num[] }
  refs?: { value: Num; color: string }[]
  right?: LineDef
  width?: number
  height?: number
  unit?: string
}> = ({ dates, lines, band, refs = [], right, width = 960, height = 240, unit = '%' }) => {
  const X = 48
  const Y = 10
  const W = width - X - (right ? 50 : 12)
  const H = height - 34
  const [lo, hi] = extent([...lines.map(l => l.data), band?.lo ?? [], band?.hi ?? [], refs.map(r => r.value)])
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4)
  const [rlo, rhi] = right ? extent([right.data]) : [0, 1]
  const tickIdx = dates.length > 1 ? [0, Math.floor(dates.length / 3), Math.floor((dates.length * 2) / 3), dates.length - 1] : []
  return (
    <svg width={width} height={height}>
      {ticks.map((v, i) => {
        const y = Y + H - ((v - lo) / (hi - lo)) * H
        return (
          <g key={i}>
            <line x1={X} x2={X + W} y1={y} y2={y} stroke="#1f252d" />
            <text x={4} y={y + 4} fill="#8b96a5" fontSize={10}>{v.toFixed(Math.abs(hi - lo) < 1 ? 2 : 1)}{unit}</text>
          </g>
        )
      })}
      {band && <path d={bandPath(band.lo, band.hi, X, Y, W, H, lo, hi)} fill="#3a4452" opacity={0.55} />}
      {refs.map((r, i) => r.value === null ? null : (
        <line key={i} x1={X} x2={X + W} y1={Y + H - ((r.value - lo) / (hi - lo)) * H} y2={Y + H - ((r.value - lo) / (hi - lo)) * H}
          stroke={r.color} strokeDasharray="5 4" opacity={0.6} />
      ))}
      {lines.map((l, i) => (
        <path key={i} d={pathOf(l.data, X, Y, W, H, lo, hi)} fill="none" stroke={l.color} strokeWidth={l.width ?? 2}
          strokeDasharray={l.dash} />
      ))}
      {right && (
        <>
          <path d={pathOf(right.data, X, Y, W, H, rlo, rhi)} fill="none" stroke={right.color} strokeWidth={right.width ?? 1.8} />
          <text x={X + W + 6} y={Y + 10} fill={right.color} fontSize={10}>{right.label}</text>
        </>
      )}
      {tickIdx.map(i => (
        <text key={i} x={X + (i / Math.max(1, dates.length - 1)) * W - 28} y={height - 6} fill="#8b96a5" fontSize={10}>
          {dates[i]}
        </text>
      ))}
    </svg>
  )
}

export const Legend: React.FC<{ items: { color: string; label: string; dash?: boolean; band?: boolean }[] }> = ({ items }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 11, color: '#c9d1d9', margin: '4px 0 6px' }}>
    {items.map((it, i) => (
      <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <i style={{
          display: 'inline-block', width: 18, height: it.band ? 10 : 3,
          background: it.dash ? 'transparent' : it.color,
          borderTop: it.dash ? `2px dashed ${it.color}` : undefined,
        }} />
        {it.label}
      </span>
    ))}
  </div>
)
