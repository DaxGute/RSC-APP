<img width="300" height="600" alt="Simulator Screenshot - iPhone 17 Pro - 2026-05-17 at 18 16 29" src="https://github.com/user-attachments/assets/1f34fe67-5d5f-4890-942a-4b293fd33b66" />
<img width="300" height="600" alt="Simulator Screenshot - iPhone 17 Pro - 2026-05-17 at 18 16 40" src="https://github.com/user-attachments/assets/c74ec96e-0a51-4f46-bb36-16552885b342" />
<img width="300" height="600" alt="Simulator Screenshot - iPhone 17 Pro - 2026-05-17 at 18 16 59" src="https://github.com/user-attachments/assets/e599c81f-dfa3-4037-97e8-ac188a7b647b" />


# Rise South City App

Community-centered real-time air quality intelligence for South San Francisco.

Built to make hyperlocal AQI and PM2.5 data accessible, interpretable, and actionable through live sensor ingestion, interpolation, alerts, and mobile-first visualization.

---

## Overview

Rise South City (RSC) is an environmental health platform focused on surfacing neighborhood-level air quality conditions using live sensor networks and geospatial interpolation.

The system ingests air quality data from:
- PurpleAir sensors
- Clarity sensors
- Derived AQI calculations using EPA PM2.5 breakpoints

The app then:
- Normalizes and stores readings
- Interpolates pollution across South San Francisco
- Generates live AQI heatmaps
- Provides health-oriented visualization
- Supports threshold-based push notifications

The goal is to bridge the gap between raw environmental sensor data and meaningful public understanding.

---

## Features

### Live Sensor Ingestion
- Pulls real-time PM2.5 data from distributed sensor networks
- Supports both PurpleAir and Clarity ecosystems
- Automatic normalization of heterogeneous sensor formats

### AQI Mapping
- Converts PM2.5 concentrations into EPA AQI categories
- Health-focused visual encoding
- Continuous interpolation rather than isolated sensor dots

### Geospatial Interpolation
- Ordinary kriging / IDW-based interpolation pipeline
- Produces gridded AQI estimates across South San Francisco
- Generates smooth heatmap overlays from sparse sensor observations

### Interactive Mobile UI
- Real-time AQI visualization
- Predicted AQI lookup by location
- Dynamic map overlays
- Health category legends and contextual information

### Push Notifications
- User-configurable AQI thresholds
- Location-specific alerting
- Notification cooldown system to prevent spam

### Historical Aggregation
- Stores daily AQI summaries
- Maintains rolling live sensor windows
- Supports future trend analysis and longitudinal visualization

---

## Tech Stack

### Frontend
- React Native
- Expo
- TypeScript
- Mapbox
- Expo Notifications

### Backend / Infrastructure
- Supabase
- Supabase Edge Functions
- PostgreSQL
- pg_cron

### Data / Scientific Computing
- Python
- PyKrige
- NumPy
- Pandas

### APIs
- PurpleAir API
- Clarity API

---

## Architecture

```text
Sensors
   ↓
Ingestion Pipeline
   ↓
Normalization Layer
   ↓
Supabase Storage
   ↓
Interpolation Engine
   ↓
currentKriging Table
   ↓
Mobile App Visualization + Alerts<img width="1206" height="2622" alt="Simulator Screenshot - iPhone 17 Pro - 2026-05-17 at 18 16 29" src="https://github.com/user-attachments/assets/b23b40be-e517-4bca-9c22-b07f0361ccc2" />
