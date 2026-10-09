export type MapProjection = 'globe' | 'mercator';

export const DEFAULT_MAP_PROJECTION: MapProjection;

export function getProjectionSpecification(projection: MapProjection): {
  type: MapProjection;
};
