import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { fetchHotspots } from '@/api/hotspots';
import { useAppStore } from '@/store/appStore';
import { useRef, useMemo } from 'react';
import type { HotspotFeatureCollection } from '../types/hotspot';

// Global in-memory cache across all components and viewport queries
// Hotspots once loaded are permanently retained so zooming/panning NEVER causes dots to disappear!
const globalHotspotCache = new Map<string, any>();

export function useHotspots() {
  const mapBbox = useAppStore(s => s.mapBbox);

  // Round bounding box to nearest 2 degrees so small pans/zooms reuse cache instantly
  const roundedBbox = useMemo(() => {
    if (!mapBbox) return null;
    const [w, s, e, n] = mapBbox;
    // Add generous 1-degree buffer around the view so edges don't pop in/out
    const min_lon = Math.floor((Math.min(w, e) - 1.0) / 2) * 2;
    const max_lon = Math.ceil((Math.max(w, e) + 1.0) / 2) * 2;
    const min_lat = Math.max(-85, Math.floor((Math.min(s, n) - 1.0) / 2) * 2);
    const max_lat = Math.min(85, Math.ceil((Math.max(s, n) + 1.0) / 2) * 2);
    return [min_lon, min_lat, max_lon, max_lat] as [number, number, number, number];
  }, [mapBbox]);

  const query = useQuery({
    queryKey: ['hotspots', roundedBbox],
    queryFn: async () => {
      if (!roundedBbox) return { type: 'FeatureCollection' as const, features: [] };
      const [min_lon, min_lat, max_lon, max_lat] = roundedBbox;
      return fetchHotspots({ min_lon, min_lat, max_lon, max_lat });
    },
    enabled: roundedBbox !== null,
    placeholderData: keepPreviousData, // NEVER wipe existing dots during network fetches!
    staleTime: 5 * 60 * 1000,          // Keep data fresh for 5 minutes
    refetchOnWindowFocus: false,
  });

  const mergedData: HotspotFeatureCollection = useMemo(() => {
    if (query.data?.features) {
      // If incoming data has individual unclustered points, purge coarse cluster items so they never linger
      const hasUnclustered = query.data.features.some((f: any) => !f.properties?.clustered);
      if (hasUnclustered) {
        for (const [id, cached] of globalHotspotCache.entries()) {
          if (cached.properties?.clustered) {
            globalHotspotCache.delete(id);
          }
        }
      }

      query.data.features.forEach((f: any) => {
        const id = f.properties?.hotspot_id || `${f.geometry?.coordinates?.[0]},${f.geometry?.coordinates?.[1]}`;
        globalHotspotCache.set(id, f);
      });
    }
    const allFeatures = Array.from(globalHotspotCache.values());
    return {
      type: 'FeatureCollection' as const,
      features: allFeatures.length > 0 ? allFeatures : (query.data?.features || [])
    };
  }, [query.data]);

  return {
    ...query,
    data: mergedData,
  };
}
