import { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';

type InitialLoadSplashProps = {
  visible: boolean;
  progress: number;
};

export function InitialLoadSplash({ visible, progress }: InitialLoadSplashProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      opacity.setValue(0);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 320,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(opacity, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [opacity, visible]);

  if (!mounted) return null;

  const clampedProgress = Math.max(0.08, Math.min(1, progress));

  return (
    <Animated.View style={[styles.overlay, { opacity }]} pointerEvents={visible ? 'auto' : 'none'}>
      <Image source={require('../assets/rise-south-city-logo.png')} style={styles.logo} />
      <Text style={styles.loadingText}>Loading PurpleAir and Clarity data...</Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${clampedProgress * 100}%` }]} />
      </View>
      <Text style={styles.progressText}>{Math.round(progress * 100)}%</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 80,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    backgroundColor: '#f8fafc',
  },
  logo: {
    width: 164,
    height: 164,
    resizeMode: 'contain',
  },
  loadingText: {
    fontSize: 14,
    color: '#334155',
    fontWeight: '700',
  },
  progressTrack: {
    width: 236,
    height: 9,
    borderRadius: 999,
    backgroundColor: '#cbd5e1',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#1e3a8a',
  },
  progressText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '600',
  },
});
