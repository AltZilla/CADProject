# Wildfire Early Warning Platform

Real-time wildfire detection and spread simulation powered by NASA FIRMS satellite data, rendered on an interactive map with email alert subscriptions.

```
+------------------+       +-------------------+       +------------------+
|   Browser / SPA  |------>|    CloudFront      |------>|   S3 (Frontend)  |
|  (Vite + Maplibre|       |  PriceClass_100    |       |  index.html +    |
|   GL JS)         |       |  HTTPS enforced    |       |  JS/CSS assets   |
+------------------+       +---+---+---+--------+       +------------------+
                               |   |   |
              /hotspots*       |   |   | /simulate-spread*  /alert-zones*
              +-----------+    |   |   +----------+    +----------+
              |           |    |   |              |    |          |
              v           |   N/A  |              v    v          |
   +---------------------+|       |  +---------------------+     |
   | HotspotsFunction    ||       |  | SimulationFunction  |     |
   | arm64, 256 MB       ||       |  | arm64, 1024 MB      |     |
   | Timeout: 15s        ||       |  | Timeout: 60s        |     |
   | Function URL (GET)  ||       |  | Function URL (POST) |     |
   +---------------------+|       |  +---------------------+     |
              |            |       |              |               |
              v            |       |              v               |
   +---------------------+|       |  +---------------------+     |
   | WildfireHotspots    ||       |  | SimulationCache     |     |
   | DynamoDB (PROV)     ||       |  | DynamoDB (PROV)     |     |
   | 5R/5W CU + GSI      ||       |  | 3R/3W CU, TTL       |     |
   | TTL, DDB Streams    ||       |  +---------------------+     |
   +---------------------+|       |                              |
              |            |       |              +---------------+
              | DDB Stream |       |              v
              |            |       |  +---------------------+
              v            |       |  | AlertsFunction      |
   +---------------------+|       |  | arm64, 256 MB       |
   | FirmsIngestionFn    ||       |  | Timeout: 120s       |
   | arm64, 512 MB       ||       |  | Function URL        |
   | Timeout: 300s       ||       |  | + ScheduleV2 30min  |
   | ScheduleV2 3h       ||       |  | + DDB Stream trigger|
   +---------------------+|       |  +---------------------+
              |            |       |              |
              v            |       |              v
   +---------------------+|       |  +---------------------+
   | NASA FIRMS API      ||       |  | AlertZones DynamoDB |
   | (external, free)    ||       |  | AlertDedup DynamoDB |
   +---------------------+|       |  +---------------------+
                           |       |              |
                           |       |              v
                           |       |  +---------------------+
                           |       |  | SNS Email Alerts    |
                           |       |  | (1000/month free)   |
                           |       |  +---------------------+
                           +-------+
```

## Architecture Highlights

| Component | Choice | Rationale |
|-----------|--------|-----------|
| API layer | Lambda Function URLs | Always-free, no 12-month expiry (vs API Gateway) |
| Database | DynamoDB Provisioned 25 RCU/WCU | Always-free tier (vs On-Demand) |
| Alerts | SNS email | Always-free 1000/month (vs SES) |
| Compute | arm64 Graviton2 | 20% cheaper + faster cold starts |
| CDN | CloudFront PriceClass_100 | US/EU/Canada only — minimum cost |
| Satellite data | NASA FIRMS | Free, near-realtime (3h delay) VIIRS/MODIS |

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20 LTS | https://nodejs.org |
| Python | 3.12 | https://python.org |
| AWS SAM CLI | >= 1.120 | https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html |
| Docker Desktop | Latest | https://docker.com (required for `sam local`) |
| AWS CLI | v2 | https://aws.amazon.com/cli/ |

Configure the AWS CLI before deploying:
```bash
aws configure
# Enter: Access Key ID, Secret Access Key, Region (us-east-1), Output (json)
```

## Quick Start (Local Development)

### 1. Clone and install dependencies

```bash
git clone <your-repo-url>
cd wildfire-platform

# Install frontend dependencies
cd frontend
npm install
cd ..

# Install backend dev dependencies (per Lambda)
pip install -r backend/ingestion/requirements.txt
pip install -r backend/hotspots/requirements.txt
pip install -r backend/simulation/requirements.txt
pip install -r backend/alerts/requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and set FIRMS_API_KEY (see below for registration)
```

### 3. Start DynamoDB Local (Docker)

```bash
docker run -d -p 8000:8000 --name dynamodb-local amazon/dynamodb-local
```

### 4. Create local tables

```bash
python scripts/create_local_tables.py
```

### 5. Run SAM local API

```bash
cd infrastructure
sam build
sam local start-api --port 3000 --env-vars ../local-env.json
```

### 6. Run frontend dev server

```bash
cd frontend
npm run dev
# Opens http://localhost:5173
```

## NASA FIRMS API Key Registration

1. Visit https://firms.modaps.eosdis.nasa.gov/api/map_key/
2. Sign in with your NASA Earthdata account (free registration at https://urs.earthdata.nasa.gov/users/new)
3. Click **"Get MAP_KEY"**
4. Your 32-character key appears immediately — copy it
5. Set `FIRMS_API_KEY=<your_key>` in `.env`
6. During `sam deploy --guided`, paste it when prompted for `FirmsApiKey` parameter

The key allows 10,000 API requests per day for the free tier.

## Local Development Commands

```bash
# Build all Lambda functions and layers
cd infrastructure && sam build

# Invoke ingestion function locally with test event
sam local invoke FirmsIngestionFunction \
  --event ../backend/events/scheduled.json \
  --env-vars ../local-env.json

# Invoke hotspots query locally
sam local invoke HotspotsFunction \
  --event ../backend/events/hotspots_request.json \
  --env-vars ../local-env.json

# Invoke simulation locally
sam local invoke SimulationFunction \
  --event ../backend/events/simulate_request.json \
  --env-vars ../local-env.json

# Run all backend tests
pytest backend/ -v --tb=short

# Lint Python
ruff check backend/

# Type check
mypy backend/

# Frontend build
cd frontend && npm run build
```

## Cloud Deployment

### First deployment (interactive)

```bash
cd infrastructure

# Build for arm64 (requires Docker for cross-compilation on non-ARM hosts)
sam build --use-container

# Interactive guided deploy — saves answers to samconfig.toml
sam deploy --guided
```

You will be prompted for:
- **Stack name**: `wildfire-platform`
- **AWS Region**: `us-east-1`
- **FirmsApiKey**: your 32-char NASA key
- **AlertEmail**: your email address for alerts
- **Environment**: `prod`

> **Check your email** after deploy — SNS sends a subscription confirmation. You must click **"Confirm subscription"** before alerts are delivered.

### Subsequent deployments

```bash
# Backend only (Lambda code change)
cd infrastructure
sam build && sam deploy

# Frontend only (no Lambda changes)
cd frontend
npm run build
aws s3 sync dist/ s3://$(aws cloudformation describe-stacks \
  --stack-name wildfire-platform \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" \
  --output text) --delete

# Invalidate CloudFront cache after frontend update
DIST_ID=$(aws cloudformation describe-stacks \
  --stack-name wildfire-platform \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" \
  --output text)
aws cloudfront create-invalidation --distribution-id $DIST_ID --paths "/*"
```

### Get deployment outputs

```bash
aws cloudformation describe-stacks \
  --stack-name wildfire-platform \
  --query "Stacks[0].Outputs" \
  --output table
```

### Tear down (delete all resources)

```bash
# Empty S3 buckets first (required before stack deletion)
aws s3 rm s3://wildfire-frontend-<account_id>-us-east-1 --recursive
aws s3 rm s3://wildfire-geojson-cache-<account_id>-us-east-1 --recursive

cd infrastructure
sam delete --stack-name wildfire-platform
```

## API Reference

All endpoints are accessible via the CloudFront URL. Replace `<CF_URL>` with your `CloudFrontURL` output.

---

### GET /hotspots — Query wildfire hotspots

```http
GET <CF_URL>/hotspots?min_lon=-125&min_lat=30&max_lon=-100&max_lat=50&hours=24
```

**Query Parameters**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `min_lon` | float | Yes | Western bounding longitude (-180 to 180) |
| `min_lat` | float | Yes | Southern bounding latitude (-90 to 90) |
| `max_lon` | float | Yes | Eastern bounding longitude |
| `max_lat` | float | Yes | Northern bounding latitude |
| `hours` | int | No | Lookback window in hours (default: 24, max: 168) |
| `min_confidence` | string | No | Minimum confidence: `low`, `nominal`, `high` |

**Response 200**
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [-121.4567, 39.8123] },
      "properties": {
        "hotspot_id": "2026-08-25_39.8123_-121.4567",
        "brightness": 342.5,
        "frp": 28.4,
        "confidence": "high",
        "satellite": "VIIRS",
        "acq_datetime": "2026-08-25T09:00:00Z",
        "region_key": "us-west"
      }
    }
  ],
  "count": 1,
  "query_time_ms": 45
}
```

---

### POST /simulate-spread — Run fire spread simulation

```http
POST <CF_URL>/simulate-spread
Content-Type: application/json
```

**Request Body**
```json
{
  "origin": {
    "type": "Point",
    "coordinates": [-121.4567, 39.8123]
  },
  "wind_speed_ms": 5.0,
  "wind_direction_deg": 225,
  "slope_deg": 10.0,
  "fuel_type": "SHRUB_CHAPARRAL",
  "hours": 24
}
```

**Fuel Types**: `GRASS_SHORT`, `GRASS_TALL`, `SHRUB_CHAPARRAL`, `SHRUB_SAGE`, `TIMBER_LITTER`, `TIMBER_UNDERSTORY`, `SLASH_LIGHT`, `SLASH_HEAVY`

**Response 200**
```json
{
  "sim_id": "sim_a1b2c3d4",
  "cached": false,
  "origin": [-121.4567, 39.8123],
  "perimeter": {
    "type": "Polygon",
    "coordinates": [[...]]
  },
  "area_km2": 4.7,
  "spread_rate_mpm": 8.3,
  "elapsed_hours": 24,
  "computed_at": "2026-08-25T12:00:05Z"
}
```

---

### GET /alert-zones — List all alert zones

```http
GET <CF_URL>/alert-zones
```

**Response 200**
```json
{
  "zones": [
    {
      "zone_id": "zone_abc123",
      "name": "My Cabin",
      "geometry": {
        "type": "Point",
        "coordinates": [-121.4567, 39.8123]
      },
      "radius_km": 50,
      "email": "user@example.com",
      "created_at": "2026-08-20T10:00:00Z"
    }
  ]
}
```

---

### POST /alert-zones — Create an alert zone

```http
POST <CF_URL>/alert-zones
Content-Type: application/json
```

**Request Body**
```json
{
  "name": "My Cabin",
  "geometry": {
    "type": "Point",
    "coordinates": [-121.4567, 39.8123]
  },
  "radius_km": 50,
  "email": "user@example.com"
}
```

**Response 201**
```json
{
  "zone_id": "zone_abc123",
  "message": "Alert zone created. Check your email to confirm SNS subscription."
}
```

---

### DELETE /alert-zones/{zone_id} — Delete an alert zone

```http
DELETE <CF_URL>/alert-zones/zone_abc123
```

**Response 200**
```json
{ "message": "Alert zone zone_abc123 deleted." }
```

---

## AWS Free Tier Compliance

| Service | Free Tier | Platform Usage | Within Limit? |
|---------|-----------|----------------|---------------|
| Lambda | 1M req/mo + 400,000 GB-s | ~720 invocations/mo scheduled + on-demand | ✅ Yes |
| DynamoDB Provisioned | 25 WCU + 25 RCU forever | 12 WCU + 10 RCU total across all tables | ✅ Yes |
| S3 | 5 GB storage, 20k GET, 2k PUT | < 100 MB assets, low req volume | ✅ Yes |
| CloudFront | 1 TB egress + 10M req/mo | < 10 GB/mo expected | ✅ Yes |
| SNS | 1000 email/mo | Alert-triggered only | ✅ Yes |
| EventBridge Scheduler | 14M invocations/mo | 720/mo (3h) + 1440/mo (30min) | ✅ Yes |
| CloudWatch Logs | 5 GB ingestion/mo | 7-day retention, minimal log volume | ✅ Yes |

> **Important**: DynamoDB Provisioned 25 WCU/25 RCU is the **always-free** tier, not the 12-month trial.
> Lambda Function URLs are free (no API Gateway charges).

## Troubleshooting

### `sam build` fails with "Architecture not supported"
Docker must be running for cross-compilation of arm64 layers on x86 machines:
```bash
sam build --use-container
```

### CloudFront returns 403 for S3 assets
The OAC bucket policy references the CloudFront distribution ARN. If you recreated the distribution, update and redeploy:
```bash
sam deploy  # updates the bucket policy automatically
```

### DynamoDB stream trigger not firing
Check the AlertsFunction event source mapping is enabled:
```bash
aws lambda list-event-source-mappings \
  --function-name wildfire-alerts-prod \
  --query "EventSourceMappings[*].{State:State,UUID:UUID}"
```

### SNS alerts not arriving
1. Check your spam folder for the confirmation email
2. Confirm the subscription state:
```bash
aws sns list-subscriptions-by-topic \
  --topic-arn <WildfireAlertsTopicArn output>
```
Status must be `Confirmed`, not `PendingConfirmation`.

### Lambda Function URL CORS errors in browser
CloudFront adds the `Origin` header via `LambdaOriginRequestPolicy`. If hitting the Function URL directly (not via CloudFront), CORS is handled by the Lambda CORS config on the Function URL itself.

### DynamoDB `ProvisionedThroughputExceededException`
The free tier allows 25 WCU/25 RCU total. This platform uses 12/10. If you see throttling errors, a sudden traffic spike hit the per-table limits. You can temporarily enable auto-scaling or increase provisioned capacity (still within free tier total).

### Checking Lambda logs
```bash
# Tail logs in real time
sam logs -n FirmsIngestionFunction --stack-name wildfire-platform --tail

# Or with AWS CLI
aws logs tail /aws/lambda/wildfire-firms-ingestion-prod --follow
```

## Project Structure

```
wildfire-platform/
├── infrastructure/
│   ├── template.yaml        # AWS SAM / CloudFormation template
│   └── samconfig.toml       # SAM CLI deployment config
├── backend/
│   ├── shared/              # Lambda layer: shared utilities
│   │   └── requirements.txt
│   ├── ingestion/           # FIRMS data fetcher (scheduled)
│   │   ├── handler.py
│   │   └── requirements.txt
│   ├── hotspots/            # Hotspot query API
│   │   ├── handler.py
│   │   └── requirements.txt
│   ├── simulation/          # Fire spread simulation API
│   │   ├── handler.py
│   │   └── requirements.txt
│   ├── alerts/              # Alert zone management + SNS
│   │   ├── handler.py
│   │   └── requirements.txt
│   └── events/              # SAM local test events
│       ├── scheduled.json
│       ├── hotspots_request.json
│       └── simulate_request.json
├── frontend/
│   ├── src/
│   │   ├── main.js
│   │   ├── App.svelte        # or App.jsx / App.vue
│   │   └── components/
│   ├── public/
│   ├── index.html
│   └── package.json
├── .env.example
├── .gitignore
└── README.md
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit with conventional commits: `git commit -m "feat: add heat index overlay"`
4. Push and open a pull request

## License

MIT — see [LICENSE](LICENSE).
