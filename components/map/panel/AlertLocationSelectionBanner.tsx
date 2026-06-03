/** Shown while the user is picking a map coordinate for their air-quality reminder (alert flow). */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppLanguage } from '../../../contexts/LanguageProvider';
import { mapScreenContent } from '../../../lib/map/mapScreenContent';

/** Off-screen start/end for slide-in/out (px above safe area). */
const BANNER_SLIDE_OFFSET = -64;

export type AlertLocationSelectionBannerProps = {
  visible: boolean;
  onCancel: () => void;
};

/** Slides down from the top while alert-location picking is active; cancel exits the flow. */
export function AlertLocationSelectionBanner({ visible, onCancel }: AlertLocationSelectionBannerProps) {
  const { language } = useAppLanguage();
  const content = mapScreenContent[language];
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(BANNER_SLIDE_OFFSET)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);
  const runningAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      translateY.setValue(BANNER_SLIDE_OFFSET);
      opacity.setValue(0);
      runningAnimRef.current?.stop();
      runningAnimRef.current = Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: 320,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]);
      runningAnimRef.current.start();
      return;
    }

    if (!mounted) return;
    runningAnimRef.current?.stop();
    runningAnimRef.current = Animated.parallel([
      Animated.timing(translateY, {
        toValue: BANNER_SLIDE_OFFSET,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    runningAnimRef.current.start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [visible, mounted, opacity, translateY]);

  if (!mounted) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          paddingTop: Math.max(insets.top, 8) + 4,
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={styles.card}>
        <Text style={styles.message}>{content.alertLocationBanner}</Text>
        <Pressable
          onPress={onCancel}
          style={({ pressed }) => [styles.closeBtn, pressed && styles.closeBtnPressed]}
          accessibilityRole="button"
          accessibilityLabel={content.cancelAlertLocationSelection}
          hitSlop={8}
        >
          <Ionicons name="close" size={18} color="#334155" />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 70,
    paddingHorizontal: 12,
    alignItems: 'stretch',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    shadowColor: '#0f172a',
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  message: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: '#1e293b',
    letterSpacing: 0.1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  closeBtnPressed: {
    opacity: 0.85,
    backgroundColor: '#e2e8f0',
  },
});
