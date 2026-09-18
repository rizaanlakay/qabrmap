import { describe, it, expect } from 'vitest';
import {
  GRAVE_CLUSTER_LAYER,
  GRAVE_POINT_LAYER,
  GRAVES_SOURCE,
  SELECTED_GRAVE_SOURCE,
  graveFeatureCollection,
  graveLayers,
  gravesSourceSpec,
  nearestTappedFeature,
  selectedFeatureCollection,
  syncGraveLayers,
} from '../src/lib/map/graveLayers';
import type { MapGrave } from '../src/types';

const grave = (id: string, overrides: Partial<MapGrave> = {}): MapGrave => ({
  id,
  cemeteryId: 'cem_1',
  latitude: -33.9675,
  longitude: 18.5032,
  status: 'MAPPED',
  graveNumber: id,
  positionConfidence: 'HIGH',
  ...overrides,
});

describe('graveFeatureCollection', () => {
  it('turns graves into points carrying only an id, a status and whether the visitor saved them', () => {
    const collection = graveFeatureCollection([grave('g1', { status: 'LOW_CONFIDENCE', fullName: 'Someone' })], 'cem_1');
    expect(collection).toEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [18.5032, -33.9675] },
          properties: { id: 'g1', status: 'LOW_CONFIDENCE', saved: false },
        },
      ],
    });
  });

  it('leaves out graves of other cemeteries and graves without a usable position', () => {
    const collection = graveFeatureCollection(
      [
        grave('here'),
        grave('elsewhere', { cemeteryId: 'cem_2' }),
        grave('no-lat', { latitude: NaN }),
        grave('no-lng', { longitude: Number('x') }),
      ],
      'cem_1'
    );
    expect(collection.features.map((feature) => feature.properties.id)).toEqual(['here']);
  });

  it('handles ten thousand graves', () => {
    const graves = Array.from({ length: 10000 }, (_, i) => grave(`g${i}`, { latitude: -33.96 - i * 1e-6 }));
    expect(graveFeatureCollection(graves, 'cem_1').features).toHaveLength(10000);
  });
});

describe('saved graves', () => {
  it('marks the graves this visitor has saved', () => {
    const collection = graveFeatureCollection([grave('g1'), grave('g2'), grave('g3')], 'cem_1', (id) => id === 'g2');
    expect(collection.features.map((feature) => feature.properties.saved)).toEqual([false, true, false]);
    expect(selectedFeatureCollection(grave('g2'), (id) => id === 'g2').features[0].properties.saved).toBe(true);
  });

  it('has every cluster count the saved graves inside it, and colours the cluster by that count', () => {
    const spec = gravesSourceSpec(graveFeatureCollection([], 'cem_1'));
    expect(JSON.stringify((spec.clusterProperties as Record<string, unknown>).savedCount)).toContain('saved');
    const cluster = graveLayers().find((layer) => layer.id === GRAVE_CLUSTER_LAYER) as { paint: Record<string, unknown> };
    expect(JSON.stringify(cluster.paint['circle-color'])).toContain('savedCount');
  });
});

describe('selectedFeatureCollection', () => {
  it('is one point for the selected grave and empty without one', () => {
    expect(selectedFeatureCollection(grave('g1')).features).toHaveLength(1);
    expect(selectedFeatureCollection(null).features).toEqual([]);
    expect(selectedFeatureCollection(grave('bad', { latitude: NaN })).features).toEqual([]);
  });
});

describe('layers', () => {
  it('clusters the graves source', () => {
    const spec = gravesSourceSpec(graveFeatureCollection([], 'cem_1'));
    expect(spec.type).toBe('geojson');
    expect(spec.cluster).toBe(true);
    // Points must still be generated one zoom past the last clustered zoom
    expect(spec.maxzoom).toBeGreaterThan(spec.clusterMaxZoom as number);
  });

  it('draws clusters and single graves from the clustered source, and the selected grave on top', () => {
    const layers = graveLayers();
    const ids = layers.map((layer) => layer.id);
    expect(ids[ids.length - 1]).toContain('selected');
    for (const layer of layers) {
      if (layer.id === GRAVE_CLUSTER_LAYER || layer.id === GRAVE_POINT_LAYER) expect((layer as { source: string }).source).toBe(GRAVES_SOURCE);
    }
  });
});

describe('syncGraveLayers', () => {
  function fakeMap() {
    const sources = new Map<string, { data: unknown; setData: (data: unknown) => void }>();
    const layers: string[] = [];
    return {
      sources,
      layers,
      getSource: (id: string) => sources.get(id),
      addSource: (id: string, spec: { data?: unknown }) => {
        const source = { data: spec.data, setData: (data: unknown) => void (source.data = data) };
        sources.set(id, source);
      },
      getLayer: (id: string) => (layers.includes(id) ? { id } : undefined),
      addLayer: (layer: { id: string }) => void layers.push(layer.id),
    };
  }
  const dataFor = (ids: string[]) => ({
    graves: graveFeatureCollection(ids.map((id) => grave(id)), 'cem_1'),
    selected: selectedFeatureCollection(null),
  });

  it('adds the sources and layers once, then only swaps the data', () => {
    const map = fakeMap();
    syncGraveLayers(map, dataFor(['g1']));
    const layerCount = map.layers.length;
    expect(layerCount).toBe(graveLayers().length);

    syncGraveLayers(map, dataFor(['g1', 'g2']));
    expect(map.layers).toHaveLength(layerCount);
    expect((map.sources.get(GRAVES_SOURCE)?.data as { features: unknown[] }).features).toHaveLength(2);
  });

  it('leaves the graves alone when only the selection changes', () => {
    const map = fakeMap();
    const data = dataFor(['g1', 'g2']);
    syncGraveLayers(map, data);
    const gravesSource = map.sources.get(GRAVES_SOURCE)!;
    let writes = 0;
    const setData = gravesSource.setData;
    gravesSource.setData = (next) => {
      writes += 1;
      setData(next);
    };

    syncGraveLayers(map, { ...data, selected: selectedFeatureCollection(grave('g2')) });
    expect(writes).toBe(0);
    expect((map.sources.get(SELECTED_GRAVE_SOURCE)?.data as { features: unknown[] }).features).toHaveLength(1);
  });

  it('puts everything back after a style change wiped the map', () => {
    const map = fakeMap();
    syncGraveLayers(map, dataFor(['g1']));
    map.sources.clear();
    map.layers.length = 0;
    syncGraveLayers(map, dataFor(['g1']));
    expect(map.layers).toHaveLength(graveLayers().length);
    expect(map.sources.size).toBe(2);
  });
});

describe('nearestTappedFeature', () => {
  type Tapped = { layer: { id: string }; properties: Record<string, unknown>; geometry: { type: string; coordinates: number[] } };
  const at = (id: string, x: number, y: number): Tapped => ({
    layer: { id: GRAVE_POINT_LAYER },
    properties: { id },
    geometry: { type: 'Point', coordinates: [x, y] },
  });
  // Pretend longitude and latitude are already screen pixels
  const project = ([x, y]: [number, number]) => ({ x, y });

  it('picks the grave closest to the finger', () => {
    const picked = nearestTappedFeature([at('far', 110, 100), at('near', 102, 101)], { x: 100, y: 100 }, project);
    expect(picked?.properties?.id).toBe('near');
  });

  it('prefers a single grave to a cluster under the same finger', () => {
    const cluster: Tapped = { layer: { id: GRAVE_CLUSTER_LAYER }, properties: { cluster_id: 7 }, geometry: { type: 'Point', coordinates: [100, 100] } };
    const picked = nearestTappedFeature([cluster, at('g1', 108, 100)], { x: 100, y: 100 }, project);
    expect(picked?.properties?.id).toBe('g1');
  });

  it('falls back to the cluster, and to nothing on bare ground', () => {
    const cluster: Tapped = { layer: { id: GRAVE_CLUSTER_LAYER }, properties: { cluster_id: 7 }, geometry: { type: 'Point', coordinates: [100, 100] } };
    expect(nearestTappedFeature([cluster], { x: 100, y: 100 }, project)?.properties?.cluster_id).toBe(7);
    expect(nearestTappedFeature([], { x: 100, y: 100 }, project)).toBeNull();
  });
});
