import { useMemo } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { buildPm25LegendBands } from '../lib/pm25ColorScale';

export type Pm25VerticalScaleProps = {
  /** Top of the scale (µg/m³) — typically max PM2.5 among sensors. */
  maxPm25: number;
  /** Push the scale right when another overlay (e.g. timeline) uses the left edge. */
  leftInset?: number;
};

function abbrevCategory(label: string): string {
  if (label === 'Unhealthy for Sensitive Groups') return 'Sensitive';
  return label;
}

/** Discrete EPA PM2.5 bands (0 → max), category labels, flush right. */
export function Pm25VerticalScale({ maxPm25, leftInset = 0 }: Pm25VerticalScaleProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const barHeight = Math.max(120, Math.round(windowHeight * 0.9) - insets.top);
  const topOffset = Math.round(windowHeight * 0.05) + insets.top;

  const bands = useMemo(() => buildPm25LegendBands(maxPm25), [maxPm25]);

  return (
    <View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          left: leftInset,
          top: topOffset,
          height: barHeight,
          right: -insets.right,
        },
      ]}
    >
      <View style={styles.labelColumn}>
        <View style={styles.labelStack}>
          {bands.map((band, i) => (
            <View
              key={`${band.label}-${i}`}
              style={[styles.labelBand, { flex: Math.max(band.flex, 1e-6) }]}
            >
              <Text
                style={styles.bandLabel}
                numberOfLines={3}
                adjustsFontSizeToFit
                minimumFontScale={0.65}
              >
                {abbrevCategory(band.label)}
              </Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.bar}>
        {bands.map((band, i) => (
          <View
            key={`bar-${band.label}-${i}`}
            style={[
              styles.band,
              {
                flex: Math.max(band.flex, 1e-6),
                backgroundColor: band.bg,
              },
              i < bands.length - 1 && styles.bandDivider,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'stretch',
    zIndex: 1,
  },
  labelColumn: {
    flex: 1,
    minWidth: 0,
    marginLeft: 8,
    marginRight: 4,
  },
  labelStack: {
    flex: 1,
    flexDirection: 'column',
  },
  labelBand: {
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: 2,
    minHeight: 0,
  },
  bandLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#1e293b',
    textAlign: 'right',
    textShadowColor: 'rgba(255,255,255,0.9)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 2,
  },
  bar: {
    width: 14,
    flexDirection: 'column',
  },
  band: {
    minHeight: 0,
  },
  bandDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.5)',
  },
});
