import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { Linking, PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

import {
  AQI_HEALTH_PAPER_URL,
  BMJ_PM25_HOSPITAL_ER_URL,
  INDOOR_FILTER_CI_HI_PCT,
  INDOOR_FILTER_CI_LO_PCT,
  INDOOR_FILTER_EFFICACY_PCT,
  INDOOR_FILTER_PAPER_URL,
  OUTDOOR_MASK_CI_HI_PCT,
  OUTDOOR_MASK_CI_LO_PCT,
  OUTDOOR_MASK_EFFICACY_PCT,
  OUTDOOR_MASK_PAPER_URL,
  erVisitRateFromPm25,
  formatCiPct,
  formatSmallPct,
  mortalityPercentFromInterpolatedPm25,
} from '../lib/aqiHealthStats';
import { EPA_AQI_HEATMAP_GRADIENT, EPA_AQI_INDEX_MAX, aqiCategory, aqiToPm25 } from '../lib/aqiUtils';
import { educationTheme } from '../lib/educationTheme';
import type { EducationHealthExplorerCopy } from '../lib/educationContent';

const THUMB_SIZE = 26;
const TRACK_HEIGHT = 10;
const DEFAULT_AQI = 72;

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

type AqiHealthExplorerProps = {
  copy: EducationHealthExplorerCopy;
};

type StatRowProps = {
  title: string;
  subtitle: string;
  linkLabel: string;
  onLinkPress: () => void;
  children: ReactNode;
  valueTone?: 'risk' | 'benefit' | 'neutral';
};

function StatRow({ title, subtitle, linkLabel, onLinkPress, children, valueTone = 'neutral' }: StatRowProps) {
  return (
    <View style={styles.statRow}>
      <View style={styles.statRowLeft}>
        <Text style={styles.statTitle}>{title}</Text>
        <Text style={styles.statSubtitle}>
          {subtitle}{' '}
          <Text style={styles.statLink} onPress={onLinkPress}>
            {linkLabel}
          </Text>
        </Text>
      </View>
      <View
        style={[
          styles.statRowRight,
          valueTone === 'risk' && styles.statRowRightRisk,
          valueTone === 'benefit' && styles.statRowRightBenefit,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

export function AqiHealthExplorer({ copy }: AqiHealthExplorerProps) {
  const [aqi, setAqi] = useState(DEFAULT_AQI);
  const [trackWidth, setTrackWidth] = useState(0);
  const trackWidthRef = useRef(0);

  const category = useMemo(() => aqiCategory(aqi), [aqi]);
  const pm25 = useMemo(() => aqiToPm25(aqi), [aqi]);
  const mort = useMemo(() => mortalityPercentFromInterpolatedPm25(pm25), [pm25]);
  const erErr = useMemo(() => erVisitRateFromPm25(pm25), [pm25]);

  const thumbLeft =
    trackWidth > 0 ? clamp((aqi / EPA_AQI_INDEX_MAX) * trackWidth - THUMB_SIZE / 2, 0, trackWidth - THUMB_SIZE) : 0;

  const setAqiFromX = useCallback((x: number) => {
    const w = trackWidthRef.current;
    if (w <= 0) return;
    const ratio = clamp(x / w, 0, 1);
    setAqi(Math.round(ratio * EPA_AQI_INDEX_MAX));
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => setAqiFromX(e.nativeEvent.locationX),
        onPanResponderMove: (e) => setAqiFromX(e.nativeEvent.locationX),
      }),
    [setAqiFromX],
  );

  const onTrackLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && w !== trackWidthRef.current) {
      trackWidthRef.current = w;
      setTrackWidth(w);
    }
  }, []);

  const openUrl = useCallback((url: string) => {
    void Linking.openURL(url).catch(() => {
      /* ignore */
    });
  }, []);

  const pm25Label =
    pm25 != null ? copy.pm25Equivalent.replace('{value}', pm25.toFixed(1)) : copy.pm25Unknown;

  return (
    <View style={styles.root}>
      <View style={[styles.hero, { borderColor: `${category.bg}55` }]}>
        <View style={styles.heroTop}>
          <Text style={styles.heroAqiValue}>{aqi}</Text>
          <Text style={styles.heroAqiUnit}>AQI</Text>
          <View style={[styles.categoryBadge, { backgroundColor: category.bg }]}>
            <Text style={[styles.categoryBadgeText, { color: category.fg }]} numberOfLines={2}>
              {category.label}
            </Text>
          </View>
        </View>
        <Text style={styles.heroPm25}>{pm25Label}</Text>
      </View>

      <View style={styles.sliderBlock}>
        <View style={styles.sliderLabels}>
          <Text style={styles.sliderEdgeLabel}>0</Text>
          <Text style={styles.sliderEdgeLabel}>{EPA_AQI_INDEX_MAX}</Text>
        </View>
        <View style={styles.trackHit} onLayout={onTrackLayout} {...panResponder.panHandlers}>
          <LinearGradient
            colors={EPA_AQI_HEATMAP_GRADIENT.colors as [string, string, ...string[]]}
            locations={EPA_AQI_HEATMAP_GRADIENT.startPoints as [number, number, ...number[]]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={styles.trackGradient}
          />
          <View
            style={[
              styles.thumb,
              {
                left: thumbLeft,
                backgroundColor: category.bg,
                borderColor: category.fg === '#FFFFFF' ? 'rgba(255,255,255,0.85)' : '#ffffff',
              },
            ]}
            pointerEvents="none"
          />
        </View>
        <Text style={styles.sliderHint}>{copy.sliderHint}</Text>
      </View>

      <View style={styles.statsCard}>
        <StatRow
          title={copy.mortalityTitle}
          subtitle={copy.mortalitySubtitle}
          linkLabel={copy.sourceLink}
          onLinkPress={() => openUrl(AQI_HEALTH_PAPER_URL)}
          valueTone="risk"
        >
          {mort ? (
            <>
              <Text style={styles.statValueRisk}>{formatSmallPct(mort.pct)}</Text>
              <Text style={styles.statCi}>{formatCiPct(mort.pct - mort.uncPct, mort.pct + mort.uncPct)}</Text>
            </>
          ) : (
            <Text style={styles.statEmDash}>—</Text>
          )}
        </StatRow>
        <View style={styles.statDivider} />
        <StatRow
          title={copy.erTitle}
          subtitle={copy.erSubtitle}
          linkLabel={copy.sourceLink}
          onLinkPress={() => openUrl(BMJ_PM25_HOSPITAL_ER_URL)}
          valueTone="risk"
        >
          {erErr ? (
            <>
              <Text style={styles.statValueRisk}>{formatSmallPct(erErr.mid)}</Text>
              <Text style={styles.statCi}>{formatCiPct(erErr.lo, erErr.hi)}</Text>
            </>
          ) : (
            <Text style={styles.statEmDash}>—</Text>
          )}
        </StatRow>
        <View style={styles.statDivider} />
        <StatRow
          title={copy.outdoorMaskTitle}
          subtitle={copy.outdoorMaskSubtitle}
          linkLabel={copy.sourceLink}
          onLinkPress={() => openUrl(OUTDOOR_MASK_PAPER_URL)}
          valueTone="benefit"
        >
          <Text style={styles.statValueBenefit}>{`${OUTDOOR_MASK_EFFICACY_PCT}%`}</Text>
          <Text style={styles.statCi}>
            {formatCiPct(OUTDOOR_MASK_CI_LO_PCT, OUTDOOR_MASK_CI_HI_PCT)}
          </Text>
        </StatRow>
        <View style={styles.statDivider} />
        <StatRow
          title={copy.indoorFilterTitle}
          subtitle={copy.indoorFilterSubtitle}
          linkLabel={copy.sourceLink}
          onLinkPress={() => openUrl(INDOOR_FILTER_PAPER_URL)}
          valueTone="benefit"
        >
          <Text style={styles.statValueBenefit}>{`${INDOOR_FILTER_EFFICACY_PCT}%`}</Text>
          <Text style={styles.statCi}>
            {formatCiPct(INDOOR_FILTER_CI_LO_PCT, INDOOR_FILTER_CI_HI_PCT)}
          </Text>
        </StatRow>
      </View>

      <Text style={styles.footnote}>{copy.footnote}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 12,
  },
  hero: {
    backgroundColor: educationTheme.innerSurface,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heroAqiValue: {
    fontSize: 36,
    fontWeight: '800',
    color: educationTheme.titleColor,
    letterSpacing: -0.5,
  },
  heroAqiUnit: {
    fontSize: 14,
    fontWeight: '700',
    color: educationTheme.mutedColor,
    marginTop: 10,
  },
  categoryBadge: {
    marginLeft: 'auto',
    maxWidth: '46%',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  categoryBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  heroPm25: {
    fontSize: 12.5,
    fontWeight: '600',
    color: educationTheme.bodyColor,
  },
  sliderBlock: {
    gap: 6,
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sliderEdgeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: educationTheme.mutedColor,
  },
  trackHit: {
    height: Math.max(THUMB_SIZE, TRACK_HEIGHT + 16),
    justifyContent: 'center',
  },
  trackGradient: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    overflow: 'hidden',
  },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    borderWidth: 3,
    ...educationTheme.shadow,
  },
  sliderHint: {
    fontSize: 11.5,
    lineHeight: 16,
    color: educationTheme.mutedColor,
  },
  statsCard: {
    borderWidth: 1,
    borderColor: educationTheme.cardBorderColor,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: educationTheme.innerSurface,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  statRowLeft: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  statTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    color: educationTheme.titleColor,
  },
  statSubtitle: {
    fontSize: 11.5,
    lineHeight: 16,
    color: educationTheme.bodyColor,
  },
  statLink: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#2563eb',
    textDecorationLine: 'underline',
  },
  statRowRight: {
    alignItems: 'flex-end',
    minWidth: 72,
    gap: 2,
  },
  statRowRightRisk: {},
  statRowRightBenefit: {},
  statValueRisk: {
    fontSize: 15,
    fontWeight: '800',
    color: '#dc2626',
  },
  statValueBenefit: {
    fontSize: 15,
    fontWeight: '800',
    color: '#15803d',
  },
  statCi: {
    fontSize: 10.5,
    fontWeight: '600',
    color: educationTheme.mutedColor,
  },
  statEmDash: {
    fontSize: 15,
    fontWeight: '700',
    color: educationTheme.mutedColor,
  },
  statDivider: {
    height: 1,
    backgroundColor: educationTheme.cardBorderColor,
  },
  footnote: {
    fontSize: 11,
    lineHeight: 16,
    color: educationTheme.mutedColor,
  },
});
