/**
 * Interactive AQI slider for the Education tab health section.
 *
 * User scrubs 0–500 on an EPA gradient track; shows category badge, PM2.5 equivalent,
 * literature-backed mortality/ER estimates, and fixed mask/filter efficacy with tappable
 * citation links. Assumptions block is collapsible.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Linking,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useAppLanguage } from '../../contexts/LanguageProvider';
import { EPA_AQI_HEATMAP_GRADIENT, EPA_AQI_INDEX_MAX, aqiCategory, aqiToPm25 } from '../../lib/shell/airQualityBreakpoints';
import {
  EDUCATION_HEALTH_CITATION_URLS,
  EDUCATION_HEALTH_EXPLORER_DEFAULT_AQI,
  INDOOR_FILTER_CI_HI_PCT,
  INDOOR_FILTER_CI_LO_PCT,
  INDOOR_FILTER_EFFICACY_PCT,
  OUTDOOR_MASK_CI_HI_PCT,
  OUTDOOR_MASK_CI_LO_PCT,
  OUTDOOR_MASK_EFFICACY_PCT,
  educationAqiCategoryLabel,
  educationTheme,
  erVisitRateFromPm25,
  formatHealthImpactCiPct,
  formatHealthImpactPct,
  mortalityPercentFromInterpolatedPm25,
  type EducationHealthExplorerCopy,
} from '../../lib/education/educationContent';

const THUMB_SIZE = 26;
const TRACK_HEIGHT = 10;
/** Touch target taller than the gradient; thumb stays centered on the 10px bar. */
const TRACK_HIT_HEIGHT = Math.max(THUMB_SIZE, TRACK_HEIGHT + 16) * 2;
const PROTECTION_COLUMN_SHRINK_PX = 5;

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

type AqiHealthExplorerProps = {
  copy: EducationHealthExplorerCopy;
  /** Parent scroll lock while the user scrubs the AQI track. */
  onScrubbingChange?: (scrubbing: boolean) => void;
};

type ImpactRowProps = {
  title: string;
  citationId: number;
  onCitationPress: (id: number) => void;
  children: React.ReactNode;
};

function CitationMarker({ id, onPress }: { id: number; onPress: (id: number) => void }) {
  return (
    <Pressable
      onPress={() => onPress(id)}
      hitSlop={8}
      accessibilityRole="link"
      accessibilityLabel={`Citation ${id}`}
      accessibilityHint="Opens study"
    >
      <Text style={styles.citationMarker}>[{id}]</Text>
    </Pressable>
  );
}

function ImpactColumn({
  heading,
  children,
  style,
}: {
  heading: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.impactColumn, style]}>
      <Text style={styles.sectionHeading} numberOfLines={2}>
        {heading}
      </Text>
      {children}
    </View>
  );
}

function ImpactRow({ title, citationId, onCitationPress, children }: ImpactRowProps) {
  return (
    <View style={styles.impactRow}>
      <View style={styles.impactRowMain}>
        <View style={styles.labelRow}>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {title}
          </Text>
          <CitationMarker id={citationId} onPress={onCitationPress} />
        </View>
        <View style={styles.impactValues}>{children}</View>
      </View>
    </View>
  );
}

function ImpactEstimate({
  children,
  color,
  muted,
}: {
  children: React.ReactNode;
  color: string;
  muted?: boolean;
}) {
  return (
    <Text style={[styles.primaryEstimate, { color }, muted && styles.primaryEstimateMuted]}>{children}</Text>
  );
}

export function AqiHealthExplorer({ copy, onScrubbingChange }: AqiHealthExplorerProps) {
  const { language } = useAppLanguage();
  const [aqi, setAqi] = useState(EDUCATION_HEALTH_EXPLORER_DEFAULT_AQI);
  const [assumptionsExpanded, setAssumptionsExpanded] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const trackWidthRef = useRef(0);
  const trackPageXRef = useRef(0);
  const scrubbingRef = useRef(false);

  const category = useMemo(() => aqiCategory(aqi), [aqi]);
  const categoryLabel = useMemo(() => educationAqiCategoryLabel(aqi, language), [aqi, language]);
  const pm25 = useMemo(() => aqiToPm25(aqi), [aqi]);
  const mort = useMemo(() => mortalityPercentFromInterpolatedPm25(pm25), [pm25]);
  const erErr = useMemo(() => erVisitRateFromPm25(pm25), [pm25]);

  const thumbLeft =
    trackWidth > 0 ? clamp((aqi / EPA_AQI_INDEX_MAX) * trackWidth - THUMB_SIZE / 2, 0, trackWidth - THUMB_SIZE) : 0;

  const setAqiFromPageX = useCallback((pageX: number) => {
    const w = trackWidthRef.current;
    if (w <= 0) return;
    const x = pageX - trackPageXRef.current;
    const ratio = clamp(x / w, 0, 1);
    setAqi(Math.round(ratio * EPA_AQI_INDEX_MAX));
  }, []);

  const endScrub = useCallback(() => {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    onScrubbingChange?.(false);
  }, [onScrubbingChange]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => {
          trackPageXRef.current = e.nativeEvent.pageX - e.nativeEvent.locationX;
          scrubbingRef.current = true;
          onScrubbingChange?.(true);
          setAqiFromPageX(e.nativeEvent.pageX);
        },
        onPanResponderMove: (e) => setAqiFromPageX(e.nativeEvent.pageX),
        onPanResponderRelease: endScrub,
        onPanResponderTerminate: endScrub,
      }),
    [endScrub, onScrubbingChange, setAqiFromPageX],
  );

  const onTrackLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && w !== trackWidthRef.current) {
      trackWidthRef.current = w;
      setTrackWidth(w);
    }
  }, []);

  const onCitationPress = useCallback((id: number) => {
    const url = EDUCATION_HEALTH_CITATION_URLS[id];
    if (!url) return;
    void Linking.openURL(url).catch(() => {
      /* ignore */
    });
  }, []);

  const pm25Label =
    pm25 != null ? copy.pm25Equivalent.replace('{value}', pm25.toFixed(1)) : copy.pm25Unknown;
  const healthColor = educationTheme.healthImpactColor;

  return (
    <View style={styles.root}>
      <View style={[styles.hero, { backgroundColor: `${category.bg}12` }]}>
        <View style={styles.heroTop}>
          <Text style={styles.heroAqiValue}>{aqi}</Text>
          <Text style={styles.heroAqiUnit}>AQI</Text>
          <View style={[styles.categoryBadge, { backgroundColor: category.bg }]}>
            <Text style={[styles.categoryBadgeText, { color: category.fg }]} numberOfLines={2}>
              {categoryLabel}
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

      <View style={styles.impactsColumns}>
        <ImpactColumn heading={copy.healthImpactsHeading} style={styles.healthImpactColumn}>
          <ImpactRow title={copy.mortalityTitle} citationId={1} onCitationPress={onCitationPress}>
            {mort ? (
              <>
                <ImpactEstimate color={healthColor}>{formatHealthImpactPct(mort.pct)}</ImpactEstimate>
                <Text style={styles.confidenceInterval}>
                  {formatHealthImpactCiPct(mort.pct - mort.uncPct, mort.pct + mort.uncPct)}
                </Text>
              </>
            ) : (
              <ImpactEstimate color={healthColor} muted>
                —
              </ImpactEstimate>
            )}
          </ImpactRow>
          <View style={styles.softDivider} />
          <ImpactRow title={copy.erTitle} citationId={2} onCitationPress={onCitationPress}>
            {erErr ? (
              <>
                <ImpactEstimate color={healthColor}>{formatHealthImpactPct(erErr.mid)}</ImpactEstimate>
                <Text style={styles.confidenceInterval}>{formatHealthImpactCiPct(erErr.lo, erErr.hi)}</Text>
              </>
            ) : (
              <ImpactEstimate color={healthColor} muted>
                —
              </ImpactEstimate>
            )}
          </ImpactRow>
        </ImpactColumn>

        <View style={styles.columnDivider} />

        <ImpactColumn heading={copy.protectionEfficacyHeading} style={styles.protectionImpactColumn}>
          <ImpactRow title={copy.outdoorMaskLabel} citationId={3} onCitationPress={onCitationPress}>
            <ImpactEstimate color={educationTheme.protectionImpactColor}>{`${OUTDOOR_MASK_EFFICACY_PCT}%`}</ImpactEstimate>
            <Text style={styles.confidenceInterval}>
              {formatHealthImpactCiPct(OUTDOOR_MASK_CI_LO_PCT, OUTDOOR_MASK_CI_HI_PCT)}
            </Text>
          </ImpactRow>
          <View style={styles.softDivider} />
          <ImpactRow title={copy.indoorFilterLabel} citationId={4} onCitationPress={onCitationPress}>
            <ImpactEstimate color={educationTheme.protectionImpactColor}>{`${INDOOR_FILTER_EFFICACY_PCT}%`}</ImpactEstimate>
            <Text style={styles.confidenceInterval}>
              {formatHealthImpactCiPct(INDOOR_FILTER_CI_LO_PCT, INDOOR_FILTER_CI_HI_PCT)}
            </Text>
          </ImpactRow>
        </ImpactColumn>
      </View>

      <View style={styles.assumptionsBlock}>
        <Pressable
          onPress={() => setAssumptionsExpanded((open) => !open)}
          style={styles.assumptionsHeader}
          accessibilityRole="button"
          accessibilityState={{ expanded: assumptionsExpanded }}
          accessibilityLabel={copy.assumptionsTitle}
        >
          <Text style={styles.assumptionsTitle}>{copy.assumptionsTitle}</Text>
          <View
            style={[
              styles.assumptionsChevron,
              { transform: [{ rotate: assumptionsExpanded ? '180deg' : '0deg' }] },
            ]}
          >
            <Ionicons name="chevron-down" size={12} color={educationTheme.mutedColor} />
          </View>
        </Pressable>
        {assumptionsExpanded ? <Text style={styles.assumptionsBody}>{copy.assumptionsBody}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 16,
  },
  hero: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
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
    fontSize: 12,
    fontWeight: '600',
    color: educationTheme.mutedColor,
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
    height: TRACK_HIT_HEIGHT,
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
    fontSize: 11,
    lineHeight: 15,
    color: educationTheme.mutedColor,
  },
  impactsColumns: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  impactColumn: {
    flex: 1,
    minWidth: 0,
  },
  healthImpactColumn: {
    flexBasis: PROTECTION_COLUMN_SHRINK_PX,
  },
  protectionImpactColumn: {
    flexBasis: -PROTECTION_COLUMN_SHRINK_PX,
  },
  columnDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: educationTheme.cardBorderColor,
    marginVertical: 2,
  },
  sectionHeading: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: educationTheme.mutedColor,
    marginBottom: 8,
    lineHeight: 13,
  },
  impactRow: {
    paddingVertical: 6,
  },
  impactRowMain: {
    gap: 3,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 2,
  },
  rowTitle: {
    flexShrink: 1,
    fontSize: 12.5,
    fontWeight: '800',
    color: educationTheme.titleColor,
    lineHeight: 16,
  },
  citationMarker: {
    fontSize: 10.5,
    fontWeight: '700',
    color: educationTheme.citationAccentColor,
    backgroundColor: 'rgba(37, 99, 235, 0.08)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: 'hidden',
    lineHeight: 14,
  },
  impactValues: {
    marginTop: 4,
    gap: 1,
  },
  primaryEstimate: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  primaryEstimateMuted: {
    opacity: 0.45,
  },
  confidenceInterval: {
    fontSize: 9.5,
    fontWeight: '500',
    lineHeight: 12,
    color: educationTheme.subduedCaptionColor,
  },
  softDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: educationTheme.cardBorderColor,
    marginVertical: 2,
  },
  assumptionsBlock: {
    gap: 6,
    paddingTop: 2,
  },
  assumptionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  assumptionsTitle: {
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: educationTheme.mutedColor,
  },
  assumptionsChevron: {
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assumptionsBody: {
    fontSize: 11,
    lineHeight: 16,
    color: educationTheme.subduedCaptionColor,
  },
});
