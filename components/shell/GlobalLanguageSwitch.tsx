/**
 * Root-shell EN/ES toggle: fixed to the left edge above the tab bar, rendered outside tab panes
 * so language persists across map, graph, and education.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useAppLanguage } from '../../contexts/LanguageProvider';
import {
  GLOBAL_LANGUAGE_SWITCH_BOTTOM_OFFSET,
  GLOBAL_LANGUAGE_SWITCH_HOST_LIFT,
  GLOBAL_LANGUAGE_SWITCH_TRACK_EXTENSION,
} from '../../lib/constants/appLayout';
import { type AppLanguage, appLanguageToggleLabels } from '../../lib/appLanguage';

type Segment = {
  language: AppLanguage;
  flag: string;
  code: string;
};

/** Vertical track labels (flag + code) for each supported locale. */
const segments: Segment[] = [
  { language: 'en', flag: '🇺🇸', code: 'EN' },
  { language: 'es', flag: '🇲🇽', code: 'ES' },
];

const TRACK_PADDING = 2;
const TRACK_CORNER_RADIUS = 10;

/** Flush the track against the screen edge; only the right side is rounded. */
const flushLeftCorners = {
  borderTopLeftRadius: 0,
  borderBottomLeftRadius: 0,
  borderTopRightRadius: TRACK_CORNER_RADIUS,
  borderBottomRightRadius: 0,
};

/** Tap-to-toggle vertical switch; hidden until persisted language preference is loaded. */
export function GlobalLanguageSwitch() {
  const { language, setLanguage, isReady } = useAppLanguage();
  const [segmentHeight, setSegmentHeight] = useState(0);
  const selectedIndex = language === 'en' ? 0 : 1;
  const slideY = useSharedValue(0);

  const onTrackLayout = useCallback((height: number) => {
    const innerHeight = height - TRACK_PADDING * 2;
    const nextSegmentHeight = innerHeight / segments.length;
    if (nextSegmentHeight > 0) {
      setSegmentHeight(nextSegmentHeight);
    }
  }, []);

  useEffect(() => {
    slideY.value = withTiming(selectedIndex * segmentHeight, { duration: 200 });
  }, [selectedIndex, segmentHeight, slideY]);

  const highlightStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: slideY.value }],
    opacity: segmentHeight > 0 ? 1 : 0,
  }));

  const toggleLanguage = useCallback(() => {
    setLanguage(language === 'en' ? 'es' : 'en');
  }, [language, setLanguage]);

  if (!isReady) {
    return null;
  }

  return (
    <View
      style={[
        styles.host,
        { bottom: GLOBAL_LANGUAGE_SWITCH_BOTTOM_OFFSET + GLOBAL_LANGUAGE_SWITCH_HOST_LIFT },
      ]}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={toggleLanguage}
        style={styles.touchShield}
        accessibilityRole="button"
        accessibilityLabel={`${appLanguageToggleLabels[language]}. Tap to switch language.`}
        accessibilityHint="Switches between English and Español"
      >
        <View
          style={[
            styles.trackExtension,
            { height: GLOBAL_LANGUAGE_SWITCH_TRACK_EXTENSION },
          ]}
          pointerEvents="none"
        />
        <View
          style={styles.track}
          onLayout={(event) => onTrackLayout(event.nativeEvent.layout.height)}
        >
          {segmentHeight > 0 ? (
            <Animated.View
              style={[
                styles.highlight,
                { height: segmentHeight },
                highlightStyle,
              ]}
              pointerEvents="none"
            />
          ) : null}
          {segments.map((segment) => {
            const selected = language === segment.language;
            return (
              <View
                key={segment.language}
                style={[styles.segment, !selected && styles.segmentUnselected]}
                pointerEvents="none"
              >
                <Text style={[styles.flag, selected && styles.flagSelected]}>
                  {segment.flag}
                </Text>
                <Text style={[styles.code, selected && styles.codeSelected]}>
                  {segment.code}
                </Text>
              </View>
            );
          })}
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    zIndex: 190,
  },
  touchShield: {
    width: 32,
    position: 'relative',
  },
  trackExtension: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -GLOBAL_LANGUAGE_SWITCH_TRACK_EXTENSION,
    backgroundColor: '#e2e8f0',
    borderRightWidth: 1,
    borderColor: '#94a3b8',
    borderBottomRightRadius: 0,
    zIndex: 0,
  },
  track: {
    width: 32,
    borderWidth: 1,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
    borderColor: '#94a3b8',
    backgroundColor: '#e2e8f0',
    padding: TRACK_PADDING,
    ...flushLeftCorners,
    shadowColor: '#0f172a',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
    zIndex: 1,
  },
  highlight: {
    position: 'absolute',
    left: TRACK_PADDING,
    right: TRACK_PADDING,
    top: TRACK_PADDING,
    borderRadius: 6,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#0f172a',
    shadowColor: '#0f172a',
    shadowOpacity: 0.14,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  segment: {
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    zIndex: 1,
  },
  segmentUnselected: {
    opacity: 0.38,
  },
  flag: {
    fontSize: 13,
    lineHeight: 15,
  },
  flagSelected: {
    transform: [{ scale: 1.08 }],
  },
  code: {
    fontSize: 9,
    fontWeight: '600',
    color: '#64748b',
    letterSpacing: 0.3,
  },
  codeSelected: {
    color: '#0f172a',
    fontWeight: '900',
  },
});
