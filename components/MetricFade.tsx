import { useEffect, type ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

type MetricFadeProps = {
  /** Changes when metric or displayed values update — triggers a short crossfade. */
  contentKey: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

const FADE_OUT_MS = 100;
const FADE_IN_MS = 180;

/** Brief opacity pulse when map metric figures switch between PM2.5 and AQI. */
export function MetricFade({ contentKey, children, style }: MetricFadeProps) {
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withSequence(
      withTiming(0.35, { duration: FADE_OUT_MS, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: FADE_IN_MS, easing: Easing.out(Easing.cubic) }),
    );
  }, [contentKey, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[styles.wrap, style, animatedStyle]}>{children}</Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minWidth: 0,
  },
});
