from pydantic import BaseModel, Field
from typing import Literal, Optional
from datetime import datetime

class HotspotRecord(BaseModel):
    lat: float
    lon: float
    brightness: float
    frp: float
    confidence: int
    satellite: str
    instrument: str
    acq_datetime: str
    region_key: str
    hotspot_id: str
    expires_at: int
    daynight: str

class SimulationRequest(BaseModel):
    origin: dict
    wind_speed_ms: float = Field(ge=0, le=30)
    wind_direction_deg: float = Field(ge=0, le=360)
    slope_deg: Optional[float] = None
    fuel_type: Literal['GRASS_SHORT','GRASS_TALL','SHRUB_LOW','SHRUB_CHAPARRAL','TIMBER_LITTER','SLASH_HEAVY']
    hours: Literal[6, 12, 24]

class SimulationResult(BaseModel):
    sim_id: str
    perimeters: dict
    metadata: dict
    created_at: str
    expires_at: int

class AlertZone(BaseModel):
    zone_id: str
    name: str
    geometry: dict
    email: str
    active: bool
    created_at: str
