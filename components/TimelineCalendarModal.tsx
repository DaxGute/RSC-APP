import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { AqiColoredCalendar } from './AqiColoredCalendar';

export type TimelineCalendarModalProps = {
  visible: boolean;
  onClose: () => void;
  timelineTimesAsc: string[];
  timelineIndex: number;
  onPickRecordedTime: (recordedTime: string) => void;
  liveAverageAqi: number | null;
};

export function TimelineCalendarModal({
  visible,
  onClose,
  timelineTimesAsc,
  timelineIndex,
  onPickRecordedTime,
  liveAverageAqi,
}: TimelineCalendarModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.calendarModalRoot}>
        <Pressable
          style={styles.calendarModalBackdrop}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close calendar"
        />
        <View style={styles.calendarModalCard}>
          <View style={styles.calendarModalHead}>
            <Text style={styles.calendarModalTitle}>Select date</Text>
            <Pressable onPress={onClose} style={styles.calendarCloseBtn} accessibilityRole="button">
              <Ionicons name="close" size={18} color="#334155" />
            </Pressable>
          </View>
          <Text style={styles.calendarModalHint}>Only dates with data are selectable.</Text>
          <AqiColoredCalendar
            timelineTimesAsc={timelineTimesAsc}
            timelineIndex={timelineIndex}
            liveAverageAqi={liveAverageAqi}
            onPickRecordedTime={(recordedTime) => {
              onPickRecordedTime(recordedTime);
              onClose();
            }}
            height={380}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  calendarModalRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  calendarModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.35)',
  },
  calendarModalCard: {
    width: '100%',
    maxWidth: 620,
    maxHeight: '82%',
    borderRadius: 16,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbe5f2',
    padding: 16,
    zIndex: 2,
  },
  calendarModalHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  calendarModalTitle: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  calendarModalHint: { fontSize: 12, color: '#64748b', marginBottom: 10 },
  calendarCloseBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eff6ff',
  },
});
