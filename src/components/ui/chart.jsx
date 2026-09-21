// shadcn/ui chart primitives, adapted to JSX.
//
// Two deliberate differences from the upstream .tsx source:
//
//  · No TypeScript — this project is plain JSX with no tsconfig.
//  · Series colours are read from the `config` and injected as CSS variables on
//    the container (`--color-<key>`), exactly as upstream does, but each config
//    colour is itself a `var(--chart-*)` reference resolved in AnalyticsScreen.css
//    under .app--light / .app--dark. Upstream ships a {light, dark} pair and a
//    `dark:` variant; routing through the app's own theme scopes means the
//    existing theme toggle drives the chart for free, with no second switch.
//
// Palette note: each theme gets its OWN step (not a lightness flip of one hex),
// both taken from the data-viz reference palette's categorical slots and both
// validated against this app's actual card surfaces — lightness band, chroma
// floor, CVD separation, normal-vision floor, contrast. Do not substitute by eye.

import { createContext, useContext, useId, useMemo } from 'react'
import { ResponsiveContainer } from 'recharts'
import { cn } from '../../lib/utils'

const ChartContext = createContext(null)

export function useChart() {
  const ctx = useContext(ChartContext)
  if (!ctx) throw new Error('useChart must be used within a <ChartContainer />')
  return ctx
}

/**
 * Wraps a Recharts chart: supplies the responsive box, publishes each series'
 * colour as a `--color-<key>` custom property, and applies the recessive
 * grid/axis styling shadcn charts are recognisable for.
 */
export function ChartContainer({ id, className, children, config, style, ...props }) {
  const uniqueId = useId()
  const chartId = `chart-${id || uniqueId.replace(/:/g, '')}`

  const styleVars = useMemo(() => {
    const vars = {}
    for (const [key, item] of Object.entries(config ?? {})) {
      if (item?.color) vars[`--color-${key}`] = item.color
    }
    return vars
  }, [config])

  return (
    <ChartContext.Provider value={{ config: config ?? {} }}>
      <div
        data-chart={chartId}
        // Caller styles merge with, never replace, the series colour variables —
        // spreading a `style` prop over these would silently strip every
        // --color-<key> and leave the marks unpainted.
        style={{ ...styleVars, ...style }}
        className={cn(
          'flex w-full justify-center text-tiny',
          // Recessive chart furniture: hairline grid, muted axis text, no
          // heavy axis lines — the marks carry the chart, not its scaffolding.
          '[&_.recharts-cartesian-grid_line]:stroke-border [&_.recharts-cartesian-grid_line]:opacity-40',
          '[&_.recharts-cartesian-axis-line]:stroke-transparent',
          '[&_.recharts-cartesian-axis-tick_text]:fill-[var(--color-text-muted)]',
          '[&_.recharts-cartesian-axis-tick_line]:stroke-transparent',
          '[&_.recharts-surface]:overflow-visible',
          className,
        )}
        {...props}
      >
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
}

/**
 * The tooltip body. Rendered by Recharts' <Tooltip content={…} />, so it
 * receives `active`, `payload` and `label` from the chart.
 *
 * `formatter` gets (value, name, item) and may return a string or a node, which
 * is how the fuel chart shows cost alongside litres without a second axis.
 */
export function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  formatter,
  hideLabel = false,
  className,
}) {
  const { config } = useChart()
  if (!active || !payload?.length) return null

  return (
    <div
      className={cn(
        'grid min-w-[9rem] gap-1.5 rounded-lg border border-border bg-card px-2.5 py-2 text-tiny shadow-xl',
        className,
      )}
    >
      {!hideLabel && (
        <div className="font-medium text-foreground">
          {labelFormatter ? labelFormatter(label, payload) : label}
        </div>
      )}
      <div className="grid gap-1">
        {payload.map((item, i) => {
          const key = item.dataKey ?? item.name
          const itemConfig = config[key] ?? {}
          const indicatorColor = item.color || itemConfig.color
          return (
            <div key={`${key}-${i}`} className="flex w-full items-center gap-2">
              <span
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{ background: indicatorColor }}
              />
              {/* Labels and values wear TEXT tokens, never the series colour —
                  the swatch beside them carries identity. */}
              <span className="text-muted-foreground">{itemConfig.label ?? key}</span>
              <span className="ml-auto font-mono font-medium tabular-nums text-foreground">
                {formatter ? formatter(item.value, key, item) : item.value}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Legend row. Always rendered for two or more series. */
export function ChartLegendContent({ payload, className }) {
  const { config } = useChart()
  if (!payload?.length) return null

  return (
    <div className={cn('flex items-center justify-center gap-4 pt-3', className)}>
      {payload.map((item) => {
        const key = item.dataKey ?? item.value
        const itemConfig = config[key] ?? {}
        return (
          <div key={key} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-[2px]"
              style={{ background: item.color || itemConfig.color }}
            />
            <span className="text-muted-foreground">{itemConfig.label ?? key}</span>
          </div>
        )
      })}
    </div>
  )
}
