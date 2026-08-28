# 🔥 Wildfire Early Warning & Spread Simulation Platform

[![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://reactjs.org)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white)](https://tailwindcss.com)
[![AWS Serverless](https://img.shields.io/badge/AWS-Serverless-FF9900?style=flat-square&logo=amazon-aws&logoColor=white)](https://aws.amazon.com)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

An enterprise-grade, serverless **Wildfire Detection, Live Meteorological Analysis, and Physics-Based Spread Simulation Platform**. Powered by near-real-time thermal satellite data from **NASA FIRMS (NOAA-20 / NOAA-21 VIIRS)**, live atmospheric weather from **Open-Meteo**, and a continuous **Rothermel surface fire spread engine**.

---

## 🌟 Key Features

* **🛰️ Real-Time NASA Satellite Ingestion**: Continuously ingests global wildfire thermal anomalies from NASA FIRMS VIIRS sensors, filtering sensor noise and prioritizing high-intensity fires by Fire Radiative Power (FRP).
* **🗺️ Multi-Scale Interactive Map**: Powered by **MapLibre GL JS** and OpenFreeMap. Automatically adapts across zoom levels:
  * **Zoom 0–6 (Global/Continent)**: Smooth thermal density heatmap visualizing global wildfire activity.
  * **Zoom 6+ (Regional/Local)**: Interactive color-coded fire markers detailing FRP, brightness temp, and acquisition timestamps.
* **🌤️ Live Atmospheric Weather Integration**: Instant live weather telemetry (wind speed, wind direction, temperature, and relative humidity) for any fire coordinate on Earth via Open-Meteo.
* **⚡ Rothermel Fire Spread Simulation Engine**: Runs continuous arrival-time fire propagation calculations using Dijkstra's 8-connected grid algorithm, forecasting **6-hour, 12-hour, and 24-hour burned perimeters** based on live wind, terrain slope, and Rothermel fuel models (`GRASS`, `SHRUB_CHAPARRAL`, `TIMBER_LITTER`, etc.).
* **🚨 Early Warning Geofenced Alert Zones**: Allows emergency responders and property owners to draw monitored geographic zones and receive automated notifications when new fires are detected within proximity.
* **💰 100% AWS Free-Tier Compliant**: Built on AWS Lambda Function URLs, DynamoDB Provisioned capacity, S3 Static Website Hosting, and Amazon SNS.

---

## 🏗️ System Architecture

```
                                  +-----------------------------+
                                  |    NASA FIRMS Satellite     |
                                  |    (NOAA-20 / NOAA-21 NRT)  |
                                  +--------------+--------------+
                                                 | (Scheduled / EventBridge)
                                                 v
+------------------------+        +--------------+--------------+
|                        |        |     FirmsIngestionFunction  |
|   Browser Client (SPA) |        |     (AWS Lambda Python 3.12)|
|   React + TypeScript   |        +--------------+--------------+
|   Vite + MapLibre GL   |                       |
|   Tailwind CSS         |                       v
+-----------+------------+        +-----------------------------+
            |                     |   DynamoDB: WildfireHotspots|
            |                     |   (GSI: region-date-index)  |
            |                     +--------------+--------------+
            |                                    |
            |------------------------------------+ (GET /hotspots BBox Query)
            |
            |------------------------------------> [ HotspotsFunction ]
            |                                      (Lambda Function URL)
            |
            |------------------------------------> [ SimulationFunction ]
            |  (POST /simulate-spread)             - Rothermel Fuel Models
            |                                      - Dijkstra 8-Way Grid Engine
            |                                      - DynamoDB SimulationCache
            |
            |------------------------------------> [ AlertsFunction ]
            |  (CRUD /alert-zones)                 - AlertZones & AlertDedup
            |                                      - Amazon SNS Email Delivery
            v
+------------------------+
|  Open-Meteo Live API   |
|  (Wind, Temp, Humidity)|
+------------------------+
```

---

## 📂 Repository Structure

```
wildfire-platform/
├── backend/
│   ├── ingestion/               # NASA FIRMS satellite data ingestion handler
│   │   ├── handler.py
│   │   └── requirements.txt
│   ├── hotspots/                # Spatial bounding box query & clustering handler
│   │   ├── handler.py
│   │   └── requirements.txt
│   ├── simulation/              # Rothermel physics fire spread engine
│   │   ├── handler.py
│   │   ├── fire_engine.py       # Dijkstra continuous arrival-time solver
│   │   ├── rothermel.py         # Rothermel 13 fuel models & ROS equations
│   │   ├── elevation.py         # Bilinear DEM interpolation & terrain slope
│   │   └── weather.py           # Meteorological calculations & fuel moisture
│   ├── alerts/                  # Alert zone geofencing & SNS dispatcher
│   │   ├── handler.py
│   │   └── requirements.txt
│   └── shared/                  # Common DynamoDB access, models & GeoJSON utilities
│       └── python/
│           ├── config.py
│           ├── dynamo.py
│           ├── geo_utils.py
│           └── models.py
├── frontend/
│   ├── src/
│   │   ├── api/                 # API clients (hotspots, simulation, weather)
│   │   ├── components/
│   │   │   ├── Map/             # FireMap, HotspotLayer, SimulationLayer
│   │   │   ├── Panel/           # HotspotInfoPanel, WeatherCard
│   │   │   ├── Sidebar/         # Sidebar, SimulationControls, AlertZoneEditor
│   │   │   └── UI/              # Button, Card, Badge, Slider components
│   │   ├── hooks/               # Custom React Query hooks (useHotspots, useSimulation)
│   │   ├── store/               # Zustand global state management
│   │   ├── types/               # TypeScript interfaces (Hotspot, Simulation, Alerts)
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
├── infrastructure/
│   └── template.yaml            # AWS SAM Infrastructure as Code (IaC)
├── .env.example
├── .gitignore
└── README.md
```

---

## 🚀 Quick Start (Local Development)

### 1. Prerequisites
- **Node.js**: `v18+` or `v20 LTS`
- **Python**: `3.11` or `3.12`
- **NASA FIRMS Map Key**: Free 32-character API key from [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/api/map_key/)

### 2. Clone & Install Dependencies

```bash
# Clone the repository
git clone https://github.com/<YOUR_USERNAME>/wildfire-platform.git
cd wildfire-platform

# Install frontend dependencies
cd frontend
npm install
cd ..

# (Optional) Install backend dependencies for testing
pip install -r backend/shared/requirements.txt
```

### 3. Configure Frontend Environment

Create `frontend/.env`:
```env
# AWS Lambda Function URLs (or local proxy)
VITE_HOTSPOTS_URL=https://<your-hotspots-lambda-url>.lambda-url.ap-south-1.on.aws
VITE_SIMULATION_URL=https://<your-simulation-lambda-url>.lambda-url.ap-south-1.on.aws
VITE_ALERTS_URL=https://<your-alerts-lambda-url>.lambda-url.ap-south-1.on.aws
```

### 4. Run Frontend Development Server

```bash
cd frontend
npm run dev
```
Open **`http://localhost:5173`** to interact with the map locally.

---

## ☁️ AWS Cloud Deployment

### 1. DynamoDB Tables
Create 4 tables in your target region (e.g. `ap-south-1`):
1. **`WildfireHotspots`**:
   - Partition key: `hotspot_id` (String)
   - GSI: `region-date-index` (Partition key: `region_key` (String), Sort key: `acq_datetime` (String))
   - TTL Attribute: `expires_at`
2. **`SimulationCache`**:
   - Partition key: `sim_id` (String)
   - TTL Attribute: `expires_at`
3. **`AlertZones`**:
   - Partition key: `zone_id` (String)
4. **`AlertDedup`**:
   - Partition key: `dedup_key` (String)
   - TTL Attribute: `expires_at`

### 2. Lambda Functions
Deploy the 4 backend services with **Python 3.12**:
* **`FirmsIngestionFunction`**: Upload `backend/ingestion.zip`. Set Handler to `handler.handler`. Add env var `FIRMS_API_KEY`.
* **`HotspotsFunction`**: Upload `backend/hotspots.zip`. Enable Function URL with CORS (`Allow origin: *`, `Allow headers: *`).
* **`SimulationFunction`**: Upload `backend/simulation.zip`. Enable Function URL with CORS (`Allow origin: *`, `Allow headers: *`).
* **`AlertsFunction`**: Upload `backend/alerts.zip`. Enable Function URL with CORS (`Allow origin: *`, `Allow headers: *`).

### 3. Frontend Hosting
```bash
cd frontend
npm run build

# Upload dist/ folder to your S3 bucket or CloudFront distribution
aws s3 sync dist/ s3://<YOUR_FRONTEND_BUCKET_NAME> --delete
```

---

## 🔬 Rothermel Mathematical Spread Engine

The spread engine calculates rate of spread ($R$) using the Rothermel surface fire equations:

$$R = \frac{I_R \cdot \xi \cdot (1 + \phi_w + \phi_s)}{\rho_b \cdot \varepsilon \cdot Q_{ig}}$$

Where:
* $I_R$: Reaction intensity
* $\xi$: Propagating flux ratio
* $\phi_w$: Wind coefficient vector
* $\phi_s$: Slope factor
* $\rho_b$: Bulk fuel density
* $\varepsilon$: Effective heating number
* $Q_{ig}$: Heat of pre-ignition

---

## 🛡️ License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for more information.
