import { Pressable, StyleSheet, Text, View } from 'react-native';

import { educationTheme } from '../lib/educationTheme';
import { type AppLanguage, appLanguageToggleLabels } from '../lib/appLanguage';

type LanguageSegment = {
  language: AppLanguage;
  flag: string;
  code: string;
};

const segments: LanguageSegment[] = [
  { language: 'en', flag: '🇺🇸', code: 'en' },
  { language: 'es', flag: '🇲🇽', code: 'es' },
];

type LanguageToggleProps = {
  value: AppLanguage;
  onChange: (language: AppLanguage) => void;
};

export function LanguageToggle({ value, onChange }: LanguageToggleProps) {
  return (
    <View style={styles.container} accessibilityRole="tablist">
      {segments.map((segment, index) => (
        <View key={segment.language} style={styles.segmentWrap}>
          {index > 0 ? <Text style={styles.divider}>/</Text> : null}
          <Pressable
            onPress={() => onChange(segment.language)}
            style={[styles.segment, value === segment.language && styles.segmentSelected]}
            accessibilityRole="tab"
            accessibilityState={{ selected: value === segment.language }}
            accessibilityLabel={appLanguageToggleLabels[segment.language]}
          >
            <Text style={styles.flag}>{segment.flag}</Text>
            <Text style={[styles.code, value === segment.language && styles.codeSelected]}>
              {segment.code}
            </Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: educationTheme.cardBorderColor,
    backgroundColor: educationTheme.innerSurface,
    paddingHorizontal: 4,
    paddingVertical: 3,
  },
  segmentWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  divider: {
    fontSize: 12,
    fontWeight: '600',
    color: '#94a3b8',
    marginHorizontal: 2,
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  segmentSelected: {
    backgroundColor: educationTheme.cardBackground,
    ...educationTheme.shadow,
  },
  flag: {
    fontSize: 16,
  },
  code: {
    fontSize: 12,
    fontWeight: '700',
    color: educationTheme.mutedColor,
    textTransform: 'lowercase',
  },
  codeSelected: {
    color: educationTheme.titleColor,
    fontWeight: '800',
  },
});
