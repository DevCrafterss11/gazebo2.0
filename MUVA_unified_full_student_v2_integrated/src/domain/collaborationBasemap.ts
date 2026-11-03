import type { StyleSpecification } from 'maplibre-gl';

export type CollaborationBasemapMode = 'vector' | 'satellite' | 'coordinates';
export const collaborationBasemapSourceId = 'collaboration-basemap';

/** Experiment 3 owns this copy of experiment 2's 2D MapLibre basemap setup.
 * Do not import SwarmMap/geographicMap here: delivery configuration is independent.
 * Vector geometry stays crisp at metre scale; imagery is reference, not survey data.
 */
export function collaborationBasemapStyle(mode: Exclude<CollaborationBasemapMode, 'coordinates'>): StyleSpecification {
  if (mode === 'satellite') return {
    version: 8,
    sources: {
      [collaborationBasemapSourceId]: {
        type: 'raster',
        tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256, maxzoom: 19,
        attribution: 'Imagery © <a href="https://www.esri.com/">Esri</a>, Vantor, Earthstar Geographics, GIS User Community',
      },
    },
    layers: [
      { id: 'collaboration-background', type: 'background', paint: { 'background-color': '#142d38' } },
      { id: collaborationBasemapSourceId, type: 'raster', source: collaborationBasemapSourceId,
        paint: { 'raster-fade-duration': 180, 'raster-saturation': 0.08, 'raster-contrast': 0.05 } },
    ],
  };
  return {
    version: 8,
    sources: {
      [collaborationBasemapSourceId]: {
        type: 'vector', url: 'https://tiles.openfreemap.org/planet',
        attribution: '<a href="https://openfreemap.org/">OpenFreeMap</a> © <a href="https://openmaptiles.org/">OpenMapTiles</a> · Data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    // Deliberately flat 2D: no terrain, perspective, raster scaling or invented buildings.
    layers: [
      { id: 'collaboration-background', type: 'background', paint: { 'background-color': '#e5eceb' } },
      { id: 'landcover', source: collaborationBasemapSourceId, 'source-layer': 'landcover', type: 'fill', paint: { 'fill-color': '#c2d6c7', 'fill-opacity': 0.65 } },
      { id: 'landuse', source: collaborationBasemapSourceId, 'source-layer': 'landuse', type: 'fill', paint: { 'fill-color': ['match', ['get', 'class'], 'residential', '#dce3e4', 'industrial', '#d0d7dc', 'cemetery', '#bed1c1', '#d0dfd1'], 'fill-opacity': 0.8 } },
      { id: 'park', source: collaborationBasemapSourceId, 'source-layer': 'park', type: 'fill', paint: { 'fill-color': '#b8d1bf', 'fill-opacity': 0.7 } },
      { id: 'water', source: collaborationBasemapSourceId, 'source-layer': 'water', type: 'fill', paint: { 'fill-color': '#91beca' } },
      { id: 'waterway', source: collaborationBasemapSourceId, 'source-layer': 'waterway', type: 'line', paint: { 'line-color': '#91beca', 'line-width': 2 } },
      { id: 'road-casing', source: collaborationBasemapSourceId, 'source-layer': 'transportation', type: 'line', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#9bafb4', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 2, 20, 18] } },
      { id: 'road', source: collaborationBasemapSourceId, 'source-layer': 'transportation', type: 'line', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1, 20, 14] } },
      { id: 'building', source: collaborationBasemapSourceId, 'source-layer': 'building', type: 'fill', minzoom: 13, paint: { 'fill-color': '#acbec7', 'fill-outline-color': '#7d98a7' } },
    ],
  };
}
