export type SensorSource = 'purple_air' | 'clarity' | string;

export type SensorPoint = {
  /** PurpleAir numeric ids; Clarity alphanumeric ids (PostgREST may return either as strings). */
  sensorIndex: number | string;
  name?: string | null;
  latitude: number;
  longitude: number;
  pm25: number;
  source: SensorSource;
  time: string;
};
