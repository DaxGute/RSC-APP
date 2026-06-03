/**
 * Root shell: three bottom tabs (map, graph, education) over shared SSF air-quality data.
 * Tabs stay mounted but hidden so map/graph state survives tab switches.
 */

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { AqiGraphScreen } from './components/graph/AqiGraphScreen';
import { EducationHubScreen } from './components/education/EducationHubScreen';
import { GlobalLanguageSwitch } from './components/shell/GlobalLanguageSwitch';
import { InitialLoadSplash } from './components/shell/InitialLoadSplash';
import { ModelProjectionMap } from './components/map/projection/ModelProjectionMap';
import { SsfAirQualityScreen } from './components/map/SsfAirQualityScreen';
import { regionFromSensorData } from './lib/map/mapRegionFromData';
import { LanguageProvider } from './contexts/LanguageProvider';
import { useSsfAirQuality } from './hooks/useSsfAirQuality';
import { ensureAnonymousSession } from './lib/shell/supabase';

/** Space reserved above the floating root tab bar (tab pane bottom inset). */
const ROOT_TAB_BAR_RESERVED_HEIGHT = 78;
/** Top corner radius on the floating root tab bar. */
const ROOT_TAB_BAR_TOP_RADIUS = 16;

/** Bottom navigation destinations. */
type RootTab = 'map' | 'graph' | 'education';

/** Tab screens, overlay map modal, and tab bar. Requires SafeAreaProvider ancestor. */
function AppContent() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<RootTab>('map');
  const {
    sensors,
    kriging,
    loading,
    error,
    timelineTimesAsc,
    timelineIndex,
    setTimelineIndex,
    selectRecordedTime,
    viewingLive,
    timelineLoading,
    insufficientData,
    liveAverageAqi,
    averageAqiTimeseries,
    purpleAir,
    clarity,
  } = useSsfAirQuality();
  // Splash only on the map tab so graph/education stay usable while data loads.
  const showMapLoadSplash = activeTab === 'map' && (loading || timelineLoading);
  const [modelProjectionOpen, setModelProjectionOpen] = useState(false);
  const mapRegion = useMemo(() => regionFromSensorData(sensors, kriging), [sensors, kriging]);
  const handleModelProjectionOpenChange = useCallback((open: boolean) => {
    setModelProjectionOpen(open);
  }, []);

  // Full-screen projection map is map-tab UI; close it when leaving that context.
  useEffect(() => {
    setModelProjectionOpen(false);
  }, [activeTab]);

  return (
    <View style={styles.appRoot}>
      <View style={styles.screenContainer}>
        {/* Stacked panes: hidden tabs keep opacity 0 and ignore touches but stay mounted. */}
        <View
          style={[styles.tabPane, activeTab === 'map' ? styles.tabPaneVisible : styles.tabPaneHidden]}
          pointerEvents={activeTab === 'map' ? 'auto' : 'none'}
        >
          <SsfAirQualityScreen
            sensors={sensors}
            kriging={kriging}
            loading={loading}
            error={error}
            timelineTimesAsc={timelineTimesAsc}
            timelineIndex={timelineIndex}
            onTimelineIndexChange={setTimelineIndex}
            onSelectRecordedTime={selectRecordedTime}
            viewingLive={viewingLive}
            timelineLoading={timelineLoading}
            insufficientData={insufficientData}
            averageAqiTimeseries={averageAqiTimeseries}
            modelProjectionOpen={modelProjectionOpen}
            onModelProjectionOpenChange={handleModelProjectionOpenChange}
          />
        </View>
        <View
          style={[styles.tabPane, activeTab === 'graph' ? styles.tabPaneVisible : styles.tabPaneHidden]}
          pointerEvents={activeTab === 'graph' ? 'auto' : 'none'}
        >
          <AqiGraphScreen
            purpleAir={purpleAir}
            clarity={clarity}
            timelineTimesAsc={timelineTimesAsc}
            timelineIndex={timelineIndex}
            liveAverageAqi={liveAverageAqi}
            loading={timelineLoading}
          />
        </View>
        <View
          style={[styles.tabPane, activeTab === 'education' ? styles.tabPaneVisible : styles.tabPaneHidden]}
          pointerEvents={activeTab === 'education' ? 'auto' : 'none'}
        >
          <EducationHubScreen />
        </View>
      </View>
      <ModelProjectionMap
        visible={modelProjectionOpen}
        onClose={() => setModelProjectionOpen(false)}
        mapKriging={kriging}
        mapSensors={sensors}
        mapRegion={mapRegion}
        timelineTimesAsc={timelineTimesAsc}
        viewingLive={viewingLive}
      />
      <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <Pressable
          onPress={() => setActiveTab('map')}
          style={({ pressed }) => [styles.tabButton, pressed && styles.tabButtonPressed]}
          accessibilityRole="button"
          accessibilityLabel="Open map tab"
        >
          <Ionicons name={activeTab === 'map' ? 'map' : 'map-outline'} size={20} color={activeTab === 'map' ? '#0f172a' : '#64748b'} />
          <Text style={[styles.tabLabel, activeTab === 'map' && styles.tabLabelActive]}>Map</Text>
        </Pressable>
        <Pressable
          onPress={() => setActiveTab('graph')}
          style={({ pressed }) => [styles.tabButton, pressed && styles.tabButtonPressed]}
          accessibilityRole="button"
          accessibilityLabel="Open graph tab"
        >
          <Ionicons
            name={activeTab === 'graph' ? 'bar-chart' : 'bar-chart-outline'}
            size={20}
            color={activeTab === 'graph' ? '#0f172a' : '#64748b'}
          />
          <Text style={[styles.tabLabel, activeTab === 'graph' && styles.tabLabelActive]}>Graph</Text>
        </Pressable>
        <Pressable
          onPress={() => setActiveTab('education')}
          style={({ pressed }) => [styles.tabButton, pressed && styles.tabButtonPressed]}
          accessibilityRole="button"
          accessibilityLabel="Open education tab"
        >
          <Ionicons
            name={activeTab === 'education' ? 'school' : 'school-outline'}
            size={20}
            color={activeTab === 'education' ? '#0f172a' : '#64748b'}
          />
          <Text style={[styles.tabLabel, activeTab === 'education' && styles.tabLabelActive]}>Education</Text>
        </Pressable>
      </View>
      <InitialLoadSplash visible={showMapLoadSplash} />
    </View>
  );
}

/** Providers, Supabase anonymous auth, and native splash teardown. */
export default function App() {
  const splashHiddenRef = useRef(false);

  useEffect(() => {
    void ensureAnonymousSession().catch((err) => {
      console.error('[ensureAnonymousSession]', err);
    });
  }, []);

  // Hide Expo splash once on mount (Strict Mode-safe via ref).
  useEffect(() => {
    if (splashHiddenRef.current) return;
    splashHiddenRef.current = true;
    void SplashScreen.hideAsync().catch((err) => {
      console.error('[SplashScreen.hideAsync]', err);
    });
  }, []);

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <SafeAreaProvider>
        <LanguageProvider>
          <AppContent />
          <GlobalLanguageSwitch />
          <StatusBar style="dark" />
        </LanguageProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  gestureRoot: { flex: 1 },
  appRoot: { flex: 1, position: 'relative' },
  screenContainer: {
    flex: 1,
    position: 'relative',
  },
  // Absolute stack leaves room for the floating tab bar at the bottom.
  tabPane: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: ROOT_TAB_BAR_RESERVED_HEIGHT,
  },
  tabPaneVisible: {
    opacity: 1,
    zIndex: 1,
  },
  tabPaneHidden: {
    opacity: 0,
    zIndex: 0,
  },
  tabBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 200,
    borderTopLeftRadius: ROOT_TAB_BAR_TOP_RADIUS,
    borderTopRightRadius: ROOT_TAB_BAR_TOP_RADIUS,
    paddingTop: 8,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 200,
  },
  tabButton: {
    minWidth: 92,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 12,
  },
  tabButtonPressed: {
    opacity: 0.86,
  },
  tabLabel: {
    marginTop: 2,
    fontSize: 12,
    color: '#64748b',
    fontWeight: '700',
  },
  tabLabelActive: {
    color: '#0f172a',
  },
});
