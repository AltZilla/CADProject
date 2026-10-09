export const DEFAULT_MAP_PROJECTION = 'mercator';

export function getProjectionSpecification(projection) {
  return { type: projection };
}
