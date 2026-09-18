// Grave dots on the cemetery map, drawn by MapLibre on the GPU from GeoJSON sources.
// One HTML marker per grave stops working at a few hundred graves; a circle layer pans smoothly with tens of
// thousands. Far out the graves gather into counted clusters, and split into single dots as the map zooms in.

import type { GeoJSONSourceSpecification, LayerSpecification } from 'maplibre-gl';
import type { MapGrave } from '@/types';

export const GRAVES_SOURCE = 'graves-src';
// The selected grave has a source of its own, unclustered, so it stays visible at every zoom
export const SELECTED_GRAVE_SOURCE = 'grave-selected-src';

export const GRAVE_CLUSTER_LAYER = 'graves-cluster';
export const GRAVE_CLUSTER_COUNT_LAYER = 'graves-cluster-count';
export const GRAVE_POINT_LAYER = 'graves-point';
export const GRAVE_SELECTED_HALO_LAYER = 'grave-selected-halo';
export const GRAVE_SELECTED_LAYER = 'grave-selected';

// Layers a tap can land on
export const GRAVE_TAP_LAYERS = [GRAVE_CLUSTER_LAYER, GRAVE_POINT_LAYER];
// A fingertip covers far more than a dot, so a tap looks this many pixels around itself
export const GRAVE_TAP_RADIUS_PX = 14;

// Digits for the cluster counts, served from public/map-fonts so the map needs no outside font server
export const MAP_FONT = 'open-sans-semibold';
export const MAP_GLYPHS_PATH = '/map-fonts/{fontstack}/{range}.pbf';

// Neighbouring graves are 1 to 2.5 m apart, which is about 16 px at zoom 19. Below that they overlap, so they cluster.
const CLUSTER_MAX_ZOOM = 18;
// Wide enough that a full cemetery shows a few dozen bubbles on a phone, not a screen packed with them
const CLUSTER_RADIUS_PX = 50;
// Two or three graves close together read fine as dots, and a sparsely mapped cemetery stays a map of dots
const CLUSTER_MIN_POINTS = 4;

const MAPPED_COLOR = '#10B981';
const LOW_CONFIDENCE_COLOR = '#FBBF24';
const UNMAPPED_COLOR = '#94A3B8';
// Graves the visitor saved under My cemeteries, in the rose of the heart they were saved with
export const SAVED_COLOR = '#F43F5E';
const SAVED_CLUSTER_COLOR = '#BE123C';

const IS_SAVED = ['==', ['get', 'saved'], true];
const STATUS_COLOR = ['match', ['get', 'status'], 'LOW_CONFIDENCE', LOW_CONFIDENCE_COLOR, 'UNMAPPED', UNMAPPED_COLOR, MAPPED_COLOR];
const GRAVE_COLOR = ['case', IS_SAVED, SAVED_COLOR, STATUS_COLOR];
// A cluster counts the saved graves inside it, so it can show that one of the visitor's own is in there
const HOLDS_SAVED = ['>', ['get', 'savedCount'], 0];

export interface GraveFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: { id: string; status: MapGrave['status']; saved: boolean };
}

export interface GraveFeatureCollection {
  type: 'FeatureCollection';
  features: GraveFeature[];
}

const hasPosition = (grave: MapGrave) => Number.isFinite(grave.latitude) && Number.isFinite(grave.longitude);

function toFeature(grave: MapGrave, saved: boolean): GraveFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [grave.longitude, grave.latitude] },
    // Names stay out of the map source: it is copied to a worker on every change, and only the tapped grave needs one
    properties: { id: grave.id, status: grave.status, saved },
  };
}

type IsSaved = (graveId: string) => boolean;
const noneSaved: IsSaved = () => false;

export function graveFeatureCollection(graves: MapGrave[], cemeteryId: string, isSaved: IsSaved = noneSaved): GraveFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: graves
      .filter((grave) => (!grave.cemeteryId || grave.cemeteryId === cemeteryId) && hasPosition(grave))
      .map((grave) => toFeature(grave, isSaved(grave.id))),
  };
}

export function selectedFeatureCollection(grave: MapGrave | null, isSaved: IsSaved = noneSaved): GraveFeatureCollection {
  return { type: 'FeatureCollection', features: grave && hasPosition(grave) ? [toFeature(grave, isSaved(grave.id))] : [] };
}

export function gravesSourceSpec(data: GraveFeatureCollection): GeoJSONSourceSpecification {
  return {
    type: 'geojson',
    data,
    cluster: true,
    clusterMaxZoom: CLUSTER_MAX_ZOOM,
    clusterRadius: CLUSTER_RADIUS_PX,
    clusterMinPoints: CLUSTER_MIN_POINTS,
    clusterProperties: { savedCount: ['+', ['case', IS_SAVED, 1, 0]] },
    // Single graves are generated from the zoom after the last clustered one
    maxzoom: CLUSTER_MAX_ZOOM + 1,
  };
}

export function plainSourceSpec(data: GraveFeatureCollection): GeoJSONSourceSpecification {
  return { type: 'geojson', data };
}

// In drawing order, bottom first
export function graveLayers(): LayerSpecification[] {
  return [
    {
      id: GRAVE_CLUSTER_LAYER,
      type: 'circle',
      source: GRAVES_SOURCE,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': ['case', HOLDS_SAVED, SAVED_CLUSTER_COLOR, '#047857'] as never,
        'circle-opacity': 0.92,
        'circle-radius': ['step', ['get', 'point_count'], 13, 25, 16, 100, 19, 1000, 23],
        'circle-stroke-color': ['case', HOLDS_SAVED, '#FECDD3', '#A7F3D0'] as never,
        'circle-stroke-width': 2,
      },
    },
    {
      id: GRAVE_CLUSTER_COUNT_LAYER,
      type: 'symbol',
      source: GRAVES_SOURCE,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': [MAP_FONT],
        'text-size': 12,
        'text-allow-overlap': true,
      },
      paint: { 'text-color': '#FFFFFF' },
    },
    {
      id: GRAVE_POINT_LAYER,
      type: 'circle',
      source: GRAVES_SOURCE,
      filter: ['!', ['has', 'point_count']],
      // Saved graves are drawn last, so a neighbour never covers one
      layout: { 'circle-sort-key': ['case', IS_SAVED, 1, 0] as never },
      paint: {
        'circle-color': GRAVE_COLOR as never,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 6, 19, 8, 22, 10],
        'circle-stroke-color': '#FFFFFF',
        'circle-stroke-width': 2,
        'circle-stroke-opacity': 0.9,
      },
    },
    {
      id: GRAVE_SELECTED_HALO_LAYER,
      type: 'circle',
      source: SELECTED_GRAVE_SOURCE,
      paint: { 'circle-color': '#FFFFFF', 'circle-opacity': 0.95, 'circle-radius': 16 },
    },
    {
      id: GRAVE_SELECTED_LAYER,
      type: 'circle',
      source: SELECTED_GRAVE_SOURCE,
      paint: { 'circle-color': GRAVE_COLOR as never, 'circle-radius': 10 },
    },
  ];
}

export interface GraveMapData {
  graves: GraveFeatureCollection;
  selected: GraveFeatureCollection;
}

// The little of a MapLibre map this file touches
interface LayerHost {
  getSource(id: string): unknown;
  addSource(id: string, source: GeoJSONSourceSpecification): unknown;
  getLayer(id: string): unknown;
  addLayer(layer: LayerSpecification): unknown;
}

// What each source was last given. Selecting a grave must not send thousands of unchanged graves to be clustered again.
const dataInSource = new WeakMap<object, GraveFeatureCollection>();

function putSource(map: LayerHost, id: string, spec: GeoJSONSourceSpecification, data: GraveFeatureCollection) {
  let source = map.getSource(id) as { setData?: (data: GraveFeatureCollection) => void } | undefined;
  if (source?.setData) {
    if (dataInSource.get(source) === data) return;
    source.setData(data);
  } else {
    map.addSource(id, spec);
    source = map.getSource(id) as typeof source;
  }
  if (source) dataInSource.set(source, data);
}

// Safe to call again and again: new data goes into the sources already there, and whatever a style change
// wiped out is added back
export function syncGraveLayers(map: LayerHost, data: GraveMapData) {
  putSource(map, GRAVES_SOURCE, gravesSourceSpec(data.graves), data.graves);
  putSource(map, SELECTED_GRAVE_SOURCE, plainSourceSpec(data.selected), data.selected);
  for (const layer of graveLayers()) {
    if (!map.getLayer(layer.id)) map.addLayer(layer);
  }
}

interface TappedFeature {
  layer: { id: string };
  properties: Record<string, unknown> | null;
  geometry: { type: string; coordinates?: unknown };
}

// Of everything under the finger, the single grave nearest to it; a cluster only when no single grave is there
export function nearestTappedFeature<Feature extends TappedFeature>(
  features: Feature[],
  tap: { x: number; y: number },
  project: (lngLat: [number, number]) => { x: number; y: number }
): Feature | null {
  let best: Feature | null = null;
  let bestDistance = Infinity;
  let cluster: Feature | null = null;
  for (const feature of features) {
    if (feature.layer.id === GRAVE_CLUSTER_LAYER) {
      cluster = cluster ?? feature;
      continue;
    }
    if (feature.geometry.type !== 'Point' || !Array.isArray(feature.geometry.coordinates)) continue;
    const point = project(feature.geometry.coordinates as [number, number]);
    const distance = Math.hypot(point.x - tap.x, point.y - tap.y);
    if (distance < bestDistance) {
      best = feature;
      bestDistance = distance;
    }
  }
  return best ?? cluster;
}
