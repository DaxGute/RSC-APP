/**
 * Education tab screen (rendered from App.tsx).
 *
 * Scrollable hub: PM2.5 primer, expandable EPA AQI category table, interactive health
 * impacts (AqiHealthExplorer), and tap-to-expand YouTube learning cards. Copy and
 * level metadata come from lib/education/educationContent; resets expanded rows/videos on language change.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { useAppLanguage } from '../../contexts/LanguageProvider';
import {
  buildYouTubeEmbedHtml,
  educationCopy,
  educationHubCardStyle,
  educationTheme,
  youtubeThumbnailUri,
  YOUTUBE_EMBED_ORIGIN,
  type EducationAqiLevel,
  type EducationAqiLevelId,
  type EducationVideoItem,
} from '../../lib/education/educationContent';
import { AqiHealthExplorer } from './AqiHealthExplorer';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

/** Height animation when an AQI table row expands or collapses. */
const EXPAND_DURATION_MS = 280;
/** Collapsed row shows only the colored category bar at this height. */
const COLLAPSED_BAR_HEIGHT = 48;

/** Inline WebView player for an expanded video card (embed HTML from educationContent). */
function YouTubeEmbed({ videoId }: { videoId: string }) {
  return (
    <WebView
      source={{
        html: buildYouTubeEmbedHtml(videoId),
        baseUrl: YOUTUBE_EMBED_ORIGIN,
      }}
      style={styles.videoPlayer}
      allowsFullscreenVideo
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      javaScriptEnabled
      domStorageEnabled
      originWhitelist={['*']}
    />
  );
}

type EducationSectionProps = {
  stepLabel: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
};

/** Numbered section card (PM, AQI table, health explorer, videos). */
function EducationSection({ stepLabel, title, subtitle, children }: EducationSectionProps) {
  return (
    <View style={styles.sectionCard}>
      <Text style={styles.sectionStepLabel}>{stepLabel}</Text>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

type VideoLearningCardProps = {
  video: EducationVideoItem;
  expanded: boolean;
  tapHint: string;
  playingHint: string;
  onPress: () => void;
};

/** Thumbnail row; expands below to show YouTubeEmbed when selected (one video at a time). */
function VideoLearningCard({ video, expanded, tapHint, playingHint, onPress }: VideoLearningCardProps) {
  return (
    <View style={[styles.videoCard, expanded && styles.videoCardExpanded]}>
      <Pressable
        onPress={onPress}
        style={styles.videoCardPressable}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${video.title}. ${expanded ? playingHint : tapHint}`}
      >
        <View style={styles.videoCardRow}>
          <Image source={{ uri: youtubeThumbnailUri(video.videoId) }} style={styles.videoThumbnail} />
          <View style={styles.videoCardText}>
            <Text style={styles.videoTitle} numberOfLines={2}>
              {video.title}
            </Text>
            <Text style={styles.videoHint}>{expanded ? playingHint : tapHint}</Text>
          </View>
          <Ionicons
            name={expanded ? 'chevron-up-circle' : 'play-circle'}
            size={28}
            color={expanded ? educationTheme.mutedColor : educationTheme.accentColor}
          />
        </View>
      </Pressable>
      {expanded ? (
        <View style={styles.videoFrame}>
          <YouTubeEmbed videoId={video.videoId} />
        </View>
      ) : null}
    </View>
  );
}

type AqiLevelBodyProps = {
  level: EducationAqiLevel;
  showSensitiveGroups: boolean;
  sensitiveGroupsTitle: string;
  sensitiveGroups: string[];
};

/** Expanded row content: colored band, advice bullets, optional sensitive groups (USG), action chips. */
function AqiLevelBody({
  level,
  showSensitiveGroups,
  sensitiveGroupsTitle,
  sensitiveGroups,
}: AqiLevelBodyProps) {
  return (
    <View style={styles.levelBody}>
      <View style={[styles.levelLeft, { backgroundColor: level.leftColor }]}>
        <Text style={[styles.levelLabel, { color: level.barFg }]}>{level.label}</Text>
        <Text style={[styles.levelRange, { color: level.barFg }]}>{level.range}</Text>
      </View>
      <View style={styles.levelRight}>
        {level.advice.map((line) => (
          <Text key={`${level.label}-${line}`} style={styles.adviceLine}>
            {'\u2022'} {line}
          </Text>
        ))}
        {showSensitiveGroups ? (
          <View style={styles.sensitiveSection}>
            <Text style={styles.sensitiveTitle}>{sensitiveGroupsTitle}</Text>
            {sensitiveGroups.map((group) => (
              <Text key={group} style={styles.sensitiveItem}>
                {'\u2022'} {group}
              </Text>
            ))}
          </View>
        ) : null}
        <View style={styles.actionWrap}>
          {level.actions.map((action) => (
            <View key={`${level.label}-${action}`} style={styles.actionChip}>
              <Text style={styles.actionChipText}>{action}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

type AqiCategoryRowProps = {
  level: EducationAqiLevel;
  expanded: boolean;
  isLast: boolean;
  showSensitiveGroups: boolean;
  sensitiveGroupsTitle: string;
  sensitiveGroups: string[];
  onToggle: () => void;
};

/**
 * Single accordion row in the AQI table: collapsed colored bar animates to full advice panel.
 * Only one row expanded at a time (controlled by EducationHubScreen).
 */
function AqiCategoryRow({
  level,
  expanded,
  isLast,
  showSensitiveGroups,
  sensitiveGroupsTitle,
  sensitiveGroups,
  onToggle,
}: AqiCategoryRowProps) {
  const levelBody = (
    <AqiLevelBody
      level={level}
      showSensitiveGroups={showSensitiveGroups}
      sensitiveGroupsTitle={sensitiveGroupsTitle}
      sensitiveGroups={sensitiveGroups}
    />
  );
  const progress = useSharedValue(expanded ? 1 : 0);
  /** Measured off-screen so animated height can interpolate collapsed bar → full body. */
  const [bodyHeight, setBodyHeight] = useState(0);

  useEffect(() => {
    progress.value = withTiming(expanded ? 1 : 0, { duration: EXPAND_DURATION_MS });
  }, [expanded, progress]);

  const onBodyLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = Math.ceil(event.nativeEvent.layout.height);
    if (nextHeight > 0) {
      setBodyHeight((prev) => (prev === nextHeight ? prev : nextHeight));
    }
  }, []);

  const containerStyle = useAnimatedStyle(() => {
    const targetHeight =
      bodyHeight > 0
        ? interpolate(progress.value, [0, 1], [COLLAPSED_BAR_HEIGHT, bodyHeight], Extrapolation.CLAMP)
        : COLLAPSED_BAR_HEIGHT;
    return { height: targetHeight, overflow: 'hidden' as const };
  });

  const barStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.45], [1, 0], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(progress.value, [0, 1], [0, -6], Extrapolation.CLAMP),
      },
    ],
  }));

  const bodyRevealStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.2, 1], [0, 1], Extrapolation.CLAMP),
    transform: [
      {
        translateY: interpolate(progress.value, [0, 1], [8, 0], Extrapolation.CLAMP),
      },
    ],
  }));

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [
      {
        rotate: `${interpolate(progress.value, [0, 1], [0, 180], Extrapolation.CLAMP)}deg`,
      },
    ],
  }));

  return (
    <View style={[styles.tableRow, !isLast && styles.tableRowDivider]}>
      <Animated.View style={containerStyle}>
        <Animated.View
          style={[styles.collapsedBar, { backgroundColor: level.leftColor }, barStyle]}
          pointerEvents={expanded ? 'none' : 'auto'}
        >
          <Pressable
            onPress={onToggle}
            style={styles.collapsedPressable}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={`${level.label}, ${level.range}`}
          >
            <Text style={[styles.collapsedTitle, { color: level.barFg }]} numberOfLines={2}>
              {level.label}
            </Text>
            <Animated.View style={chevronStyle}>
              <Ionicons name="chevron-down" size={18} color={level.barFg} />
            </Animated.View>
          </Pressable>
        </Animated.View>

        <Animated.View style={[styles.expandedLayer, bodyRevealStyle]} pointerEvents={expanded ? 'auto' : 'none'}>
          <Pressable
            onPress={onToggle}
            style={styles.expandedPressable}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={`${level.label}, ${level.range}`}
          >
            {levelBody}
            <View style={styles.expandedChevron}>
              <Animated.View style={chevronStyle}>
                <Ionicons name="chevron-down" size={18} color="#475569" />
              </Animated.View>
            </View>
          </Pressable>
        </Animated.View>
      </Animated.View>

      {/* Invisible duplicate of level body — drives height without affecting touch targets. */}
      <View style={styles.measureHost} pointerEvents="none">
        <View onLayout={onBodyLayout}>{levelBody}</View>
      </View>
    </View>
  );
}

export function EducationHubScreen() {
  const { language } = useAppLanguage();
  const [expandedLevelId, setExpandedLevelId] = useState<EducationAqiLevelId | null>(null);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [healthExplorerScrubbing, setHealthExplorerScrubbing] = useState(false);
  const copy = educationCopy[language];

  // Collapse accordion/video state when the display language changes so visible labels update instantly.
  useEffect(() => {
    setActiveVideoId(null);
    setExpandedLevelId(null);
  }, [language]);

  const onToggleRow = useCallback((levelId: EducationAqiLevelId) => {
    setExpandedLevelId((current) => (current === levelId ? null : levelId));
  }, []);

  const onToggleVideo = useCallback((videoId: string) => {
    setActiveVideoId((current) => (current === videoId ? null : videoId));
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!healthExplorerScrubbing}
      >
        <View style={styles.heroCard}>
          <View style={styles.titleRow}>
            <View style={styles.titleIconWrap}>
              <Ionicons name="school" size={22} color={educationTheme.accentColor} />
            </View>
            <Text style={styles.pageTitle}>{copy.pageTitle}</Text>
          </View>
          <Text style={styles.pageSubtitle}>{copy.pageSubtitle}</Text>
        </View>

        <EducationSection stepLabel={copy.pmSectionLabel} title={copy.pmTitle}>
          {copy.pmBody.map((paragraph) => (
            <Text key={paragraph} style={styles.bodyText}>
              {paragraph}
            </Text>
          ))}
        </EducationSection>

        <EducationSection
          stepLabel={copy.aqiSectionLabel}
          title={copy.aqiSectionTitle}
          subtitle={copy.aqiSectionSubtitle}
        >
          <View style={styles.aqiTable}>
            {copy.aqiLevels.map((level, index) => (
              <AqiCategoryRow
                key={level.id}
                level={level}
                expanded={expandedLevelId === level.id}
                isLast={index === copy.aqiLevels.length - 1}
                showSensitiveGroups={level.id === 'usg'}
                sensitiveGroupsTitle={copy.sensitiveGroupsTitle}
                sensitiveGroups={copy.sensitiveGroups}
                onToggle={() => onToggleRow(level.id)}
              />
            ))}
          </View>
        </EducationSection>

        <EducationSection
          stepLabel={copy.healthSectionLabel}
          title={copy.healthSectionTitle}
          subtitle={copy.healthSectionSubtitle}
        >
          <AqiHealthExplorer copy={copy.healthExplorer} onScrubbingChange={setHealthExplorerScrubbing} />
        </EducationSection>

        <EducationSection
          stepLabel={copy.videoSectionLabel}
          title={copy.videoSectionTitle}
          subtitle={copy.videoSectionSubtitle}
        >
          {copy.videos.map((video) => (
            <VideoLearningCard
              key={video.videoId}
              video={video}
              expanded={activeVideoId === video.videoId}
              tapHint={copy.videoTapHint}
              playingHint={copy.videoPlayingHint}
              onPress={() => onToggleVideo(video.videoId)}
            />
          ))}
        </EducationSection>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: educationTheme.screenBackground,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 24,
    gap: educationTheme.sectionGap,
  },
  heroCard: {
    ...educationHubCardStyle,
    gap: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  titleIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: educationTheme.innerSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: educationTheme.titleColor,
    letterSpacing: -0.3,
  },
  pageSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: educationTheme.bodyColor,
  },
  sectionCard: {
    ...educationHubCardStyle,
    gap: 6,
  },
  sectionStepLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: educationTheme.mutedColor,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: educationTheme.titleColor,
  },
  sectionSubtitle: {
    fontSize: 12.5,
    lineHeight: 18,
    color: educationTheme.bodyColor,
    marginBottom: 4,
  },
  sectionBody: {
    gap: 10,
    marginTop: 4,
  },
  bodyText: {
    fontSize: 13,
    lineHeight: 20,
    color: '#374151',
  },
  aqiTable: {
    borderWidth: 1,
    borderColor: educationTheme.cardBorderColor,
    borderRadius: 10,
    overflow: 'hidden',
  },
  tableRow: {
    position: 'relative',
  },
  tableRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: educationTheme.cardBorderColor,
  },
  collapsedBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: COLLAPSED_BAR_HEIGHT,
    zIndex: 2,
  },
  collapsedPressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    minHeight: COLLAPSED_BAR_HEIGHT,
  },
  collapsedTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 17,
    paddingRight: 8,
  },
  expandedLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
  },
  expandedPressable: {
    position: 'relative',
  },
  expandedChevron: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 3,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 999,
    padding: 4,
  },
  measureHost: {
    position: 'absolute',
    opacity: 0,
    left: 0,
    right: 0,
    zIndex: -1,
  },
  levelBody: {
    flexDirection: 'row',
    backgroundColor: educationTheme.cardBackground,
  },
  levelLeft: {
    width: 92,
    minHeight: 120,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  levelLabel: {
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 17,
    textAlign: 'center',
  },
  levelRange: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 4,
    lineHeight: 13,
    textAlign: 'center',
  },
  levelRight: {
    flex: 1,
    paddingTop: 10,
    paddingBottom: 10,
    paddingLeft: 10,
    paddingRight: 36,
    gap: 4,
  },
  adviceLine: {
    fontSize: 12.5,
    color: '#334155',
    lineHeight: 18,
  },
  sensitiveSection: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: educationTheme.cardBorderColor,
    backgroundColor: educationTheme.innerSurface,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingBottom: 6,
  },
  sensitiveTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1f2937',
    marginBottom: 4,
  },
  sensitiveItem: {
    fontSize: 12.5,
    color: '#374151',
    lineHeight: 18,
    marginBottom: 2,
  },
  actionWrap: {
    marginTop: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  actionChip: {
    borderWidth: 1,
    borderColor: educationTheme.cardBorderColor,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    backgroundColor: educationTheme.innerSurface,
  },
  actionChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  videoCard: {
    borderWidth: 1,
    borderColor: educationTheme.cardBorderColor,
    borderRadius: 10,
    backgroundColor: educationTheme.innerSurface,
    overflow: 'hidden',
  },
  videoCardExpanded: {
    borderColor: '#cbd5e1',
    backgroundColor: educationTheme.cardBackground,
  },
  videoCardPressable: {
    padding: 10,
  },
  videoCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  videoThumbnail: {
    width: 112,
    height: 63,
    borderRadius: 6,
    backgroundColor: '#0f172a',
  },
  videoCardText: {
    flex: 1,
    gap: 4,
  },
  videoTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: educationTheme.titleColor,
  },
  videoHint: {
    fontSize: 12,
    fontWeight: '600',
    color: educationTheme.mutedColor,
  },
  videoFrame: {
    marginHorizontal: 10,
    marginBottom: 8,
    borderRadius: 8,
    overflow: 'hidden',
    height: 200,
    backgroundColor: '#000000',
  },
  videoPlayer: {
    flex: 1,
    backgroundColor: '#000000',
  },
});
