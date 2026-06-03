/**
 * Bottom scrub chart on the map tab (graphOnly mode: no card chrome).
 * Emits bucket `time` on scrub; parent prefers `selectableTime` when present for fetches.
 * EPA-colored line segments use clip paths; marker splits "past" vs "future" styling.
 */
import { useMemo, useId, useRef, useState } from 'react';
import {
  ActivityIndicator,
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { ClipPath, Defs, G, Line, Path, Rect } from 'react-native-svg';
import { AQI_CATEGORY_BANDS, AQI_INDEX_MAX } from '../../lib/shell/airQualityBreakpoints';

/** One scrub bucket: normalized position along the axis plus optional fetch timestamp. */
export type TimeRangePoint = {
  time: string;
  avgAqi: number;
  /** Normalized position along scrub axis [0..1]. */
  position: number;
  /** Time to load for preview/commit; can be null for missing-data buckets. */
  selectableTime?: string | null;
};

/** Axis tick label at a normalized position (defaults to 12a/6a/12p/6p when omitted). */
export type TimeRangeTick = {
  position: number;
  label: string;
};

/** Interactive scrub chart; graphOnly strips card chrome for the map tab bottom bar. */
type TimeRangeModuleProps = {
  points: TimeRangePoint[];
  active: boolean;
  loading?: boolean;
  selectedPosition?: number | null;
  onCommitTime: (timeIso: string) => void;
  onPreviewTime?: (timeIso: string) => void;
  ticks?: TimeRangeTick[];
  compact?: boolean;
  graphOnly?: boolean;
  chartLength?: number;
  orientation?: 'horizontal' | 'vertical';
  topLabel?: string | null;
  markerLabel?: string | null;
  /** Shown above the marker until the user scrubs the timeline for the first time. */
  scrubHintLabel?: string | null;
  /** Fires when the user begins a scrub gesture (e.g. to dismiss an overlay menu). */
  onScrubBegin?: () => void;
};

const CHART_HEIGHT = 72;
const CHART_PADDING_X = 8;
const CHART_PADDING_Y = 8;
const SCRUB_MARKER_COLOR = '#dc2626';
const SCRUB_HINT_LABEL_WIDTH = 200;

/** Scrub chart line coloring: EPA index bands (Hazardous capped at display max). */
const CHART_AQI_BANDS = AQI_CATEGORY_BANDS.map((band, index) => ({
  id: `aqi-band-${index}`,
  lo: band.indexLo,
  hi: band.indexHi ?? AQI_INDEX_MAX,
  color: band.bg,
}));

type ChartScale = {
  paddedMin: number;
  paddedMax: number;
  valueSpan: number;
  usableH: number;
  usableW: number;
};

/** Numeric clamp for scrub axis and AQI scale padding. */
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Maps AQI to SVG y using padded min/max so the line does not hug chart edges. */
function aqiToChartY(aqi: number, scale: ChartScale): number {
  const clamped = clamp(aqi, scale.paddedMin, scale.paddedMax);
  return CHART_PADDING_Y + scale.usableH * (1 - (clamped - scale.paddedMin) / scale.valueSpan);
}

/** Horizontal strip in chart coords for AQI [lo, hi], intersected with the visible y-scale. */
function horizontalBandClipRect(
  lo: number,
  hi: number,
  scale: ChartScale,
  layoutW: number,
): { y: number; height: number; width: number } | null {
  const visibleLo = Math.max(lo, scale.paddedMin);
  const visibleHi = Math.min(hi, scale.paddedMax);
  if (visibleLo > visibleHi) return null;
  const yTop = aqiToChartY(visibleHi, scale);
  const yBottom = aqiToChartY(visibleLo, scale);
  const height = yBottom - yTop;
  if (height <= 0.5) return null;
  return { y: yTop, height, width: Math.max(1, layoutW) };
}

/** Vertical strip for `orientation === 'vertical'` (AQI on x-axis). */
function verticalBandClipRect(
  lo: number,
  hi: number,
  scale: ChartScale,
  layoutH: number,
): { x: number; width: number; height: number } | null {
  const visibleLo = Math.max(lo, scale.paddedMin);
  const visibleHi = Math.min(hi, scale.paddedMax);
  if (visibleLo > visibleHi) return null;
  const usableW = scale.usableW;
  const xLo =
    CHART_PADDING_X + usableW * (1 - (visibleLo - scale.paddedMin) / scale.valueSpan);
  const xHi =
    CHART_PADDING_X + usableW * (1 - (visibleHi - scale.paddedMin) / scale.valueSpan);
  const x = Math.min(xLo, xHi);
  const width = Math.abs(xHi - xLo);
  if (width <= 0.5) return null;
  return { x, width, height: Math.max(1, layoutH) };
}

/** Gray-mix for the "future" side of the series (right of scrub marker). */
function desaturateHex(hex: string, amount01: number): string {
  const amt = clamp(amount01, 0, 1);
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return hex;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const nr = Math.round(r + (gray - r) * amt);
  const ng = Math.round(g + (gray - g) * amt);
  const nb = Math.round(b + (gray - b) * amt);
  return `rgb(${nr},${ng},${nb})`;
}

/** Bottom scrub chart with pan-to-preview/commit; supports horizontal (map tab) and vertical layouts. */
export function TimeRangeModule({
  points,
  active,
  loading = false,
  selectedPosition = null,
  onCommitTime,
  onPreviewTime,
  ticks = [],
  compact = false,
  graphOnly = false,
  chartLength,
  orientation = 'horizontal',
  topLabel = 'now',
  markerLabel = null,
  scrubHintLabel = null,
  onScrubBegin,
}: TimeRangeModuleProps) {
  const svgUid = useId().replace(/:/g, '');
  const [layoutW, setLayoutW] = useState(0);
  const [layoutH, setLayoutH] = useState(0);
  const [dragX, setDragX] = useState<number | null>(null);
  const [showScrubHint, setShowScrubHint] = useState(true);
  const dragXRef = useRef<number | null>(null);
  const lastPreviewTimeRef = useRef<string | null>(null);

  const dismissScrubHint = () => setShowScrubHint(false);

  const normalized = useMemo(() => {
    const clean = points.filter((p) => Number.isFinite(p.avgAqi));
    const usableW = Math.max(1, layoutW - CHART_PADDING_X * 2);
    const usableH = Math.max(1, layoutH - CHART_PADDING_Y * 2);
    if (clean.length === 0) {
      const emptyScale: ChartScale = {
        paddedMin: 0,
        paddedMax: 300,
        valueSpan: 300,
        usableH,
        usableW,
      };
      return {
        values: [] as Array<{
          x: number;
          y: number;
          time: string;
          avgAqi: number;
          selectableTime?: string | null;
        }>,
        scale: emptyScale,
      };
    }
    const minAqi = Math.min(...clean.map((p) => p.avgAqi));
    const maxAqi = Math.max(...clean.map((p) => p.avgAqi));
    const span = Math.max(10, maxAqi - minAqi);
    const paddedMin = Math.max(0, minAqi - span * 0.15);
    const paddedMax = maxAqi + span * 0.15;
    const valueSpan = Math.max(1, paddedMax - paddedMin);
    const scale: ChartScale = { paddedMin, paddedMax, valueSpan, usableH, usableW };
    const values = clean.map((p) => {
      const frac = clamp(p.position, 0, 1);
      if (orientation === 'vertical') {
        const y = CHART_PADDING_Y + usableH * frac;
        const x = CHART_PADDING_X + usableW * (1 - (p.avgAqi - paddedMin) / valueSpan);
        return { ...p, x, y };
      }
      const x = CHART_PADDING_X + usableW * frac;
      const y = CHART_PADDING_Y + usableH * (1 - (p.avgAqi - paddedMin) / valueSpan);
      return { ...p, x, y };
    });
    return { values, scale };
  }, [layoutH, layoutW, orientation, points]);

  const selectedPos = useMemo(() => {
    if (selectedPosition == null || !(layoutW > 0) || !(layoutH > 0)) return null;
    const frac = clamp(selectedPosition, 0, 1);
    if (orientation === 'vertical') {
      const y = CHART_PADDING_Y + Math.max(1, layoutH - CHART_PADDING_Y * 2) * frac;
      return { x: null as number | null, y };
    }
    const x = CHART_PADDING_X + Math.max(1, layoutW - CHART_PADDING_X * 2) * frac;
    return { x, y: null as number | null };
  }, [layoutH, layoutW, orientation, selectedPosition]);

  const linePathD = useMemo(() => {
    const pts = normalized.values;
    if (pts.length < 2) return null;
    const poly = pts.map((p) => `${p.x} ${p.y}`).join(' L ');
    return `M ${pts[0].x} ${pts[0].y} L ${poly}`;
  }, [normalized.values]);

  const aqiBandClips = useMemo(() => {
    if (layoutW <= 0 || layoutH <= 0) return [];
    const { scale } = normalized;
    return CHART_AQI_BANDS.map((band) => {
      const clipId = `${svgUid}-${band.id}`;
      if (orientation === 'vertical') {
        const rect = verticalBandClipRect(band.lo, band.hi, scale, layoutH);
        if (!rect) return null;
        return { ...band, clipId, rect, orientation: 'vertical' as const };
      }
      const rect = horizontalBandClipRect(band.lo, band.hi, scale, layoutW);
      if (!rect) return null;
      return { ...band, clipId, rect, orientation: 'horizontal' as const };
    }).filter((b): b is NonNullable<typeof b> => b != null);
  }, [layoutH, layoutW, normalized, orientation, svgUid]);

  const areaPathD = useMemo(() => {
    const pts = normalized.values;
    if (pts.length < 2) return null;
    if (orientation === 'vertical') {
      const rightX = CHART_PADDING_X + Math.max(1, layoutW - CHART_PADDING_X * 2);
      const poly = pts.map((p) => `${p.x} ${p.y}`).join(' L ');
      return `M ${pts[0].x} ${pts[0].y} L ${poly} L ${rightX} ${pts[pts.length - 1].y} L ${rightX} ${pts[0].y} Z`;
    }
    const bottomY = CHART_HEIGHT - CHART_PADDING_Y;
    const poly = pts.map((p) => `${p.x} ${p.y}`).join(' L ');
    return `M ${pts[0].x} ${pts[0].y} L ${poly} L ${pts[pts.length - 1].x} ${bottomY} L ${pts[0].x} ${bottomY} Z`;
  }, [layoutW, normalized.values, orientation]);

  /** Snap scrub position to nearest chart bucket along the active axis. */
  const nearestPointForMain = (main: number) => {
    if (normalized.values.length === 0) return null;
    let best = normalized.values[0];
    let bestDist = Math.abs((orientation === 'vertical' ? best.y : best.x) - main);
    for (let i = 1; i < normalized.values.length; i += 1) {
      const c = normalized.values[i];
      const d = Math.abs((orientation === 'vertical' ? c.y : c.x) - main);
      if (d < bestDist) {
        best = c;
        bestDist = d;
      }
    }
    return best;
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => active,
        onMoveShouldSetPanResponder: () => active,
        onStartShouldSetPanResponderCapture: () => active,
        onMoveShouldSetPanResponderCapture: () => active,
        onPanResponderGrant: (e) => {
          dismissScrubHint();
          onScrubBegin?.();
          const mainRaw = orientation === 'vertical' ? e.nativeEvent.locationY : e.nativeEvent.locationX;
          const main = clamp(
            mainRaw,
            orientation === 'vertical' ? CHART_PADDING_Y : CHART_PADDING_X,
            Math.max(
              orientation === 'vertical' ? CHART_PADDING_Y : CHART_PADDING_X,
              (orientation === 'vertical' ? layoutH : layoutW) -
                (orientation === 'vertical' ? CHART_PADDING_Y : CHART_PADDING_X),
            ),
          );
          dragXRef.current = main;
          setDragX(main);
          const nearest = nearestPointForMain(main);
          // Prefer reading timestamp for fetch; fall back to bucket time so empty slots stay scrubbable.
          const targetTime = nearest?.selectableTime ?? nearest?.time ?? null;
          if (targetTime && targetTime !== lastPreviewTimeRef.current) {
            lastPreviewTimeRef.current = targetTime;
            onPreviewTime?.(targetTime);
          }
        },
        onPanResponderMove: (e) => {
          const mainRaw = orientation === 'vertical' ? e.nativeEvent.locationY : e.nativeEvent.locationX;
          const main = clamp(
            mainRaw,
            orientation === 'vertical' ? CHART_PADDING_Y : CHART_PADDING_X,
            Math.max(
              orientation === 'vertical' ? CHART_PADDING_Y : CHART_PADDING_X,
              (orientation === 'vertical' ? layoutH : layoutW) -
                (orientation === 'vertical' ? CHART_PADDING_Y : CHART_PADDING_X),
            ),
          );
          dragXRef.current = main;
          setDragX(main);
          const nearest = nearestPointForMain(main);
          const targetTime = nearest?.selectableTime ?? nearest?.time ?? null;
          if (targetTime && targetTime !== lastPreviewTimeRef.current) {
            lastPreviewTimeRef.current = targetTime;
            onPreviewTime?.(targetTime);
          }
        },
        onPanResponderRelease: () => {
          if (!active || dragXRef.current == null) {
            setDragX(null);
            return;
          }
          const nearest = nearestPointForMain(dragXRef.current);
          // Commit uses same time resolution as preview (selectableTime ?? bucket time).
          const targetTime = nearest?.selectableTime ?? nearest?.time ?? null;
          if (targetTime) onCommitTime(targetTime);
          dragXRef.current = null;
          setDragX(null);
          lastPreviewTimeRef.current = null;
        },
        onPanResponderTerminate: () => {
          dragXRef.current = null;
          setDragX(null);
          lastPreviewTimeRef.current = null;
        },
      }),
    [
      active,
      layoutH,
      layoutW,
      normalized.values,
      onCommitTime,
      onPreviewTime,
      onScrubBegin,
      orientation,
    ],
  );

  const markerMain = dragX ?? (orientation === 'vertical' ? selectedPos?.y : selectedPos?.x);
  const markerLabelWidth = 88;
  const markerLabelLeft =
    markerMain == null ? 0 : clamp(markerMain - markerLabelWidth / 2, 0, Math.max(0, layoutW - markerLabelWidth));
  const scrubHintLabelLeft =
    markerMain == null
      ? 0
      : clamp(markerMain - SCRUB_HINT_LABEL_WIDTH / 2, 0, Math.max(0, layoutW - SCRUB_HINT_LABEL_WIDTH));
  const showScrubHintAboveMarker =
    showScrubHint && scrubHintLabel != null && markerMain != null && markerLabel != null;

  const onLayout = (e: LayoutChangeEvent) => {
    const w = chartLength ?? e.nativeEvent.layout.width;
    const h = e.nativeEvent.layout.height;
    if (w > 0 && w !== layoutW) setLayoutW(w);
    if (h > 0 && h !== layoutH) setLayoutH(h);
  };

  const resolvedWidth = chartLength ?? '100%';
  const marks =
    ticks.length > 0
      ? ticks
      : [
          { position: 0, label: '12a' },
          { position: 0.25, label: '6a' },
          { position: 0.5, label: '12p' },
          { position: 0.75, label: '6p' },
        ];

  return (
    <View
      style={[
        graphOnly ? styles.graphOnlyWrap : styles.card,
        compact && !graphOnly && styles.cardCompact,
        !active && !graphOnly && styles.cardDisabled,
      ]}
    >
      {!graphOnly ? (
        <View style={styles.headerRow}>
          <Text style={[styles.title, !active && styles.titleDisabled]}>Time range</Text>
          {loading ? <ActivityIndicator size="small" color="#475569" /> : null}
        </View>
      ) : null}
      {!graphOnly ? (
        <Text style={[styles.subtitle, compact && styles.subtitleCompact, !active && styles.subtitleDisabled]}>
          Avg AQI across sensors
        </Text>
      ) : null}
      <View
        onLayout={onLayout}
        style={[
          styles.chartWrap,
          graphOnly && { width: resolvedWidth },
          orientation === 'vertical' && { width: chartLength ?? '100%', height: '100%' },
        ]}
        {...(active ? panResponder.panHandlers : {})}
      >
        {topLabel ? (
          <Text
            style={[
              styles.nowLabel,
              orientation === 'vertical' && styles.nowLabelVertical,
              !active && styles.nowLabelDisabled,
            ]}
          >
            {topLabel}
          </Text>
        ) : null}
        {showScrubHintAboveMarker ? (
          <Text
            style={[
              styles.scrubHintLabel,
              active && styles.scrubHintLabelActive,
              orientation === 'vertical'
                ? { top: markerMain - 24, left: CHART_PADDING_X + 2, width: SCRUB_HINT_LABEL_WIDTH }
                : { left: scrubHintLabelLeft },
            ]}
            numberOfLines={2}
          >
            {scrubHintLabel}
          </Text>
        ) : null}
        {markerMain != null && markerLabel ? (
          <Text
            style={[
              styles.markerLabel,
              active && styles.markerLabelActive,
              !active && styles.markLabelDisabled,
              orientation === 'vertical'
                ? { top: markerMain - 8, left: CHART_PADDING_X + 2 }
                : { left: markerLabelLeft },
            ]}
            numberOfLines={1}
          >
            {markerLabel}
          </Text>
        ) : null}
        {marks.map((tick) => {
          const xOrY =
            (orientation === 'vertical' ? CHART_PADDING_Y : CHART_PADDING_X) +
            (Math.max(
              1,
              (orientation === 'vertical' ? layoutH : layoutW) -
                (orientation === 'vertical' ? CHART_PADDING_Y : CHART_PADDING_X) * 2,
            ) *
              clamp(tick.position, 0, 1) || 0);
          return (
            <Text
              key={`top-lbl-${tick.label}-${tick.position}`}
              style={[
                styles.topMarkLabel,
                !active && styles.markLabelDisabled,
                {
                  ...(orientation === 'vertical'
                    ? { top: xOrY - 7, left: 2, width: 28 }
                    : { left: xOrY - 12 }),
                },
              ]}
            >
              {tick.label}
            </Text>
          );
        })}
        <Svg width="100%" height="100%">
          {layoutW > 0 && layoutH > 0 ? (
            <Defs>
              {aqiBandClips.map((band) => (
                <ClipPath key={band.clipId} id={band.clipId}>
                  {band.orientation === 'vertical' ? (
                    <Rect x={band.rect.x} y={0} width={band.rect.width} height={band.rect.height} />
                  ) : (
                    <Rect x={0} y={band.rect.y} width={band.rect.width} height={band.rect.height} />
                  )}
                </ClipPath>
              ))}
              {/* Clip to the right/below scrub marker: desaturated "unselected" portion of the series. */}
              {markerMain != null ? (
                <ClipPath id={`${svgUid}-after`}>
                  <Rect
                    x={orientation === 'vertical' ? 0 : markerMain}
                    y={0}
                    width={orientation === 'vertical' ? layoutW : Math.max(0, layoutW - markerMain)}
                    height={orientation === 'vertical' ? Math.max(0, markerMain) : layoutH}
                  />
                </ClipPath>
              ) : null}
            </Defs>
          ) : null}

          {areaPathD ? (
            <Path d={areaPathD} fill={active ? 'rgba(15, 23, 42, 0.28)' : 'rgba(100, 116, 139, 0.22)'} />
          ) : null}

          {marks.map((tick) => {
            const xOrY =
              (orientation === 'vertical' ? CHART_PADDING_Y : CHART_PADDING_X) +
              (Math.max(
                1,
                (orientation === 'vertical' ? layoutH : layoutW) -
                  (orientation === 'vertical' ? CHART_PADDING_Y : CHART_PADDING_X) * 2,
              ) *
                clamp(tick.position, 0, 1) || 0);
            return (
              <Line
                key={`mark-${tick.label}-${tick.position}`}
                x1={orientation === 'vertical' ? CHART_PADDING_X : xOrY}
                x2={orientation === 'vertical' ? layoutW - CHART_PADDING_X : xOrY}
                y1={orientation === 'vertical' ? xOrY : CHART_PADDING_Y}
                y2={orientation === 'vertical' ? xOrY : CHART_HEIGHT - CHART_PADDING_Y}
                stroke={active ? 'rgba(100,116,139,0.32)' : 'rgba(148,163,184,0.45)'}
                strokeWidth={1}
              />
            );
          })}
          {linePathD ? (
            !active ? (
              <Path
                d={linePathD}
                fill="none"
                stroke="#94a3b8"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : (
              <>
                <Path
                  d={linePathD}
                  fill="none"
                  stroke="rgba(2, 6, 23, 0.75)"
                  strokeWidth={6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {aqiBandClips.map((band) => (
                  <G key={`line-${band.clipId}`} clipPath={`url(#${band.clipId})`}>
                    <Path
                      d={linePathD}
                      fill="none"
                      stroke={band.color}
                      strokeWidth={3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </G>
                ))}
              </>
            )
          ) : null}
          {markerMain != null && layoutW > 0 && layoutH > 0 && linePathD && active ? (
            <G clipPath={`url(#${svgUid}-after)`}>
              {areaPathD ? (
                <Path d={areaPathD} fill="rgba(148, 163, 184, 0.26)" />
              ) : null}
              <Path
                d={linePathD}
                fill="none"
                stroke="rgba(15, 23, 42, 0.62)"
                strokeWidth={6}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {aqiBandClips.map((band) => (
                <G key={`line-after-${band.clipId}`} clipPath={`url(#${band.clipId})`}>
                  <Path
                    d={linePathD}
                    fill="none"
                    stroke={desaturateHex(band.color, 0.7)}
                    strokeWidth={3}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </G>
              ))}
            </G>
          ) : null}
          {markerMain != null ? (
            <Line
              x1={orientation === 'vertical' ? CHART_PADDING_X - 1 : markerMain}
              x2={orientation === 'vertical' ? layoutW - CHART_PADDING_X + 1 : markerMain}
              y1={orientation === 'vertical' ? markerMain : CHART_PADDING_Y - 1}
              y2={orientation === 'vertical' ? markerMain : CHART_HEIGHT - CHART_PADDING_Y + 1}
              stroke={active ? SCRUB_MARKER_COLOR : '#94a3b8'}
              strokeWidth={3.5}
              strokeDasharray="3 4"
            />
          ) : null}
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 214,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.35)',
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 8,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
  },
  graphOnlyWrap: {
    backgroundColor: 'transparent',
  },
  cardCompact: {
    width: 198,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 6,
  },
  cardDisabled: {
    backgroundColor: 'rgba(241,245,249,0.95)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  title: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  titleDisabled: {
    color: '#64748b',
  },
  subtitle: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748b',
    marginBottom: 6,
  },
  subtitleCompact: {
    fontSize: 9,
    marginBottom: 4,
  },
  subtitleDisabled: {
    color: '#94a3b8',
  },
  chartWrap: {
    width: '100%',
    height: CHART_HEIGHT,
    position: 'relative',
    overflow: 'visible',
  },
  nowLabel: {
    position: 'absolute',
    top: -2,
    right: 2,
    zIndex: 2,
    fontSize: 10,
    fontWeight: '800',
    color: '#0f172a',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  nowLabelVertical: {
    left: 2,
    right: undefined,
  },
  nowLabelDisabled: {
    color: '#94a3b8',
  },
  topMarkLabel: {
    position: 'absolute',
    top: -2,
    width: 24,
    textAlign: 'center',
    zIndex: 2,
    fontSize: 10,
    fontWeight: '700',
    color: '#334155',
    fontVariant: ['tabular-nums'],
  },
  scrubHintLabel: {
    position: 'absolute',
    top: -38,
    width: SCRUB_HINT_LABEL_WIDTH,
    textAlign: 'center',
    zIndex: 2,
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    lineHeight: 14,
  },
  scrubHintLabelActive: {
    color: SCRUB_MARKER_COLOR,
  },
  markerLabel: {
    position: 'absolute',
    top: -18,
    width: 88,
    textAlign: 'center',
    zIndex: 2,
    fontSize: 10,
    fontWeight: '800',
    color: '#0f172a',
    fontVariant: ['tabular-nums'],
  },
  markerLabelActive: {
    color: SCRUB_MARKER_COLOR,
  },
  markLabelDisabled: {
    color: '#94a3b8',
  },
});
