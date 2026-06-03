<img width="300" height="150" alt="Screenshot 2026-06-02 at 8 38 32 PM" src="https://github.com/user-attachments/assets/fd490bcb-c0d3-4e34-b17a-897ca9893d3f" />
<img width="300" height="150" alt="Screenshot 2026-06-02 at 8 38 45 PM" src="https://github.com/user-attachments/assets/f0cb79b0-eb9f-418e-9aaa-c8dda2bcb252" />
<img width="300" height="150" alt="Screenshot 2026-06-02 at 8 38 56 PM" src="https://github.com/user-attachments/assets/172d1eb9-4503-424f-9883-603e1b103d20" />
<img width="300" height="150" alt="Screenshot 2026-06-02 at 8 39 09 PM" src="https://github.com/user-attachments/assets/9969a97d-ef61-49d6-9d18-6d1f9b59d09b" />
<img width="300" height="150" alt="Screenshot 2026-06-02 at 8 39 20 PM" src="https://github.com/user-attachments/assets/316e9df7-3e00-4290-95de-8ff95dad277f" />
<img width="300" height="150" alt="Screenshot 2026-06-02 at 8 39 32 PM" src="https://github.com/user-attachments/assets/d2fb0fa0-f2ae-4577-b530-d65d171f7dcc" />
<img width="300" height="150" alt="Screenshot 2026-06-02 at 8 39 43 PM" src="https://github.com/user-attachments/assets/447e21dd-429f-4c28-96aa-e1f3146ee097" />


# Rise South City (RSC-APP)

## Overview

Rise South City is a hyperlocal air-quality monitoring, visualization, education, and forecasting platform focused on South San Francisco and surrounding communities. The project combines community sensor networks, weather forecasting, spatial interpolation, historical analytics, health education, and proactive notifications into a mobile application built with Expo React Native and Supabase.

Core goals:

- Provide neighborhood-scale PM2.5 visibility
- Translate raw sensor measurements into understandable AQI information
- Support historical exploration and trend analysis
- Deliver location-specific AQI alerts
- Explore short-horizon wind-informed PM2.5 projections
- Serve a bilingual (English/Spanish) audience

---

## Major Features

### Live AQI Map
- Real-time PM2.5 visualization
- Sensor overlays from PurpleAir and Clarity
- Continuous interpolated air-quality surface
- Tap-to-inspect AQI and PM2.5 values
- EPA category coloring

### Historical Timeline
- Rolling 24-hour timeline scrubber
- Historical snapshot playback
- Day and month exploration modes
- Historical sensor reconstruction

### Analytics & Graphs
- Rolling 7-day trends
- AQI calendar visualization
- Monthly PM2.5 summaries
- Year-over-year historical views

### AQI Alerts
- User-selected alert location
- Threshold-based notifications
- Configurable cooldown periods
- Expo Push integration

### Education Hub
- AQI education
- PM2.5 health impacts
- Protective actions
- Embedded educational videos
- Bilingual content

### Experimental Projection Model
- Wind-informed PM2.5 projection
- Historical analog matching
- Trend-based forecasting
- Up to +5 hour outlook
- Explicitly labeled experimental

---

## Geographic Coverage

Bounding Box:

Northwest:
- Latitude: 37.7000
- Longitude: -122.5000

Southeast:
- Latitude: 37.6000
- Longitude: -122.3500

Coverage includes:
- South San Francisco
- San Bruno
- Brisbane
- Northern Daly City
- Nearby industrial corridors

---

## Technology Stack

### Frontend
- Expo
- React Native
- TypeScript
- Mapbox
- React Native SVG
- React Native Calendars
- React Native WebView
- AsyncStorage
- Expo Notifications

### Backend
- Supabase PostgreSQL
- Supabase Auth
- Supabase Edge Functions
- PostgREST
- pg_cron

### Data Sources
- PurpleAir
- Clarity
- Open-Meteo

---

## High-Level Architecture

PurpleAir + Clarity sensor networks provide raw PM2.5 measurements.

Hourly ingestion normalizes and stores readings in Supabase.

Daily aggregation creates long-term historical records.

Wind forecasts are ingested separately and stored in a spatial forecast grid.

The mobile app reads sensor data, computes interpolation client-side, generates map visualizations, powers historical exploration, and drives experimental projections.

User notification settings are stored in Supabase and evaluated by scheduled alert logic.

---

## Database Schema

### purple_air

Purpose:
Raw PurpleAir sensor history.

Primary Key:
(sensor_index, time)

Important Fields:
- sensor_index
- name
- latitude
- longitude
- pm25
- aqi
- humidity
- temperature
- time

RLS:
Public read access.

### clarity

Purpose:
Raw Clarity sensor history.

Primary Key:
(sensor_index, time)

Important Fields:
- sensor_index
- name
- latitude
- longitude
- pm25
- aqi
- humidity
- temperature
- time

RLS:
Public read access.

### daily_sensor_aqi

Purpose:
Daily aggregated sensor statistics.

Primary Key:
(source, sensor_index, time)

Fields:
- source
- sensor_index
- name
- latitude
- longitude
- pm25
- aqi
- reading_count
- time

Indexes support time-series queries and historical exploration.

### forecast_wind_grid

Purpose:
Wind forecast support for projection modeling.

Primary Key:
(forecast_time_utc, lat, lon)

Fields:
- forecast_time_utc
- lat
- lon
- wind_speed_mps
- wind_direction_deg
- fetched_at

### user_notification_settings

Purpose:
User-specific alert preferences.

Primary Key:
(user_id)

Fields:
- notification_on
- notification_lat
- notification_lng
- notification_threshold
- notification_cooldown
- expo_push_token
- last_notified_at

RLS:
Users may only access their own row.

---

## Edge Functions

### update-air-data

Schedule:
Hourly

Purpose:
Ingest PurpleAir and Clarity readings.

Responsibilities:
- Fetch sensor measurements
- Normalize sensor formats
- Apply quality controls
- Store readings in purple_air and clarity

Data Quality Filtering:
- Neighbor search within 2 km
- Minimum 3 nearby sensors
- Median computation
- MAD computation
- Modified Z-score filtering
- Reject strong local outliers

Raw retention is approximately seven days.

### update-forecast-wind-grid

Schedule:
Every 10 minutes

Purpose:
Maintain wind forecast data.

Characteristics:
- 20 x 20 grid
- 400 spatial locations
- 5-hour forecast horizon
- Forecast cleanup logic
- Upsert-based refresh

Output:
forecast_wind_grid

### check-aqi-alerts

Schedule:
Backend documentation indicates hourly evaluation.

Purpose:
Evaluate alert thresholds and trigger notifications.

Inputs:
- user_notification_settings
- Current AQI estimation source

Capabilities:
- Threshold detection
- Cooldown enforcement
- Expo Push delivery
- Notification tracking

### aggregate-daily-aqi

Schedule:
Daily

Purpose:
Convert high-frequency measurements into long-term daily summaries.

Outputs:
daily_sensor_aqi

Aggregation:
- Average PM2.5
- Average AQI
- Reading counts
- Sensor metadata

---

## Mobile Application Architecture

### Root Application

App.tsx serves as the application shell.

Responsibilities:
- Tab navigation
- Shared state initialization
- Projection modal management
- Anonymous authentication bootstrap

Tabs:
1. Map
2. Graph
3. Education

### Shared State

useSsfAirQuality is the primary data hook.

Responsibilities:
- Poll sensor data
- Manage timeline state
- Build interpolation inputs
- Manage historical snapshots
- Supply map and graph screens

Polling interval:
30 seconds

---

## Map System

### Live Map

Components:
- SsfAirQualityScreen
- SsfMapMapbox
- KrigingHeatmapLayer
- AqiPanel

Capabilities:
- Sensor visualization
- Heatmap rendering
- AQI inspection
- Historical scrubbing
- Alert placement

### Interpolation

Important note:

The mobile application currently computes interpolation client-side.

Implementation:
Inverse Distance Weighting (IDW)

Characteristics:
- Power = 2
- Nearest-neighbor weighting
- 40 x 40 visualization grid
- Bilinear sampling for tap estimates

Although some files use historical “kriging” terminology, the active implementation is IDW-based interpolation.

### Heatmap Rendering Pipeline

Sensor rows
→ SensorPoint conversion
→ IDW interpolation
→ 40x40 PM2.5 grid
→ d3-contour generation
→ GeoJSON polygons
→ Mapbox Fill Layers

---

## Historical Timeline System

### Timeline Discovery

Pipeline timestamps are collected from:
- PurpleAir
- Clarity

Timeline modes:
- Live
- Rolling 24-hour
- Historical day
- Historical month

### Caching

Historical snapshots are cached in-memory to reduce recomputation and network requests.

### Historical Reconstruction

When viewing historical data:

- Historical sensor rows are loaded
- Interpolation is recomputed
- Historical map state is reconstructed

---

## Graph System

### Rolling Trends

Displays:
- Hourly PM2.5 behavior
- Weekly trends

### AQI Calendar

Color-coded daily AQI history.

### Monthly Analytics

Month-level breakdowns and comparisons.

### Yearly Analysis

Aggregated PM2.5 summaries by month.

---

## Alert System

### User Workflow

1. Enter alert placement mode
2. Select location
3. Choose AQI threshold
4. Choose cooldown period
5. Save settings

### Storage

Preferences are written to:
user_notification_settings

### Notification Logic

Inputs:
- User location
- Threshold
- Cooldown
- Current AQI estimate

Behavior:
- Detect threshold crossings
- Enforce cooldown
- Deliver Expo Push notifications

---

## Projection Model

### Purpose

Provide an experimental short-term PM2.5 outlook.

### Forecast Horizon

0 to +5 hours

### Inputs

- Current interpolated PM2.5 grid
- Historical sensor behavior
- Wind forecasts
- Recent trends

### Historical Analog Library

Built from approximately seven days of recent history.

Characteristics:
- Time subsampling
- Future matching windows
- Delta computation
- Historical priors

### Wind Support

Wind forecasts come from forecast_wind_grid.

Characteristics:
- 20x20 wind lattice
- Hourly forecast samples
- Light advection influence

### Confidence

Projection confidence considers:
- Sensor count
- Historical sample count
- Trend stability
- Horizon length

### Important Disclaimer

The projection system is an experimental research preview and should not be interpreted as an official air-quality forecast.

---

## Education System

The Education Hub provides:

- AQI explanations
- PM2.5 health effects
- Protective actions
- Filter and mask information
- Educational videos
- Bilingual educational resources

---

## Authentication & Security

### Anonymous Auth

Anonymous Supabase sessions are used for:
- Notification registration
- User-specific alert preferences

### Public Data

Public read access:
- purple_air
- clarity
- daily_sensor_aqi
- forecast_wind_grid

### Private Data

Protected:
- user_notification_settings

Users can only access their own notification settings.

---

## Data Lifecycle

PurpleAir API
\
 \
  update-air-data
 /
/
Clarity API

↓

purple_air
clarity

↓

aggregate-daily-aqi

↓

daily_sensor_aqi

Parallel:

Open-Meteo
↓
update-forecast-wind-grid
↓
forecast_wind_grid

Alerts:

user_notification_settings
↓
check-aqi-alerts
↓
Expo Push Notifications

---

## Environment Variables

Required:

EXPO_PUBLIC_SUPABASE_URL

EXPO_PUBLIC_SUPABASE_ANON_KEY

EXPO_PUBLIC_MAPBOX_TOKEN

---

## Local Development

1. Install dependencies
2. Configure environment variables
3. Connect Supabase project
4. Run:

npm install

npm start

For Mapbox:

npx expo prebuild

npx expo run:ios

---

## Production Deployment

Requirements:

- Supabase project
- Edge Functions deployed
- pg_cron schedules enabled
- EAS build configuration
- Mapbox token
- Expo Push configuration

---

## Known Limitations

- Projection system is experimental
- Accuracy depends on sensor density
- Community sensors may fail or go offline
- Historical interpolation is reconstructed from available observations
- Forecast quality depends on available wind and sensor data

---

## Future Work

- Improved forecasting methodology
- Additional pollutants
- Expanded geographic coverage
- Enhanced uncertainty modeling
- More sophisticated analog matching
- Operational monitoring dashboards
- Expanded community education resources

---

## Contributors Documentation Notes

Important architectural clarification:
This README reflects the architecture reconstructed from:
- Frontend repository audit
- Deep architecture audit
- Supabase schema audit
- Backend Edge Function audit
