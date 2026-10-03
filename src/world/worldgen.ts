import * as THREE from 'three';
import { Rng } from '../core/rng';
import { SpatialHash } from './collision';
import { buildTerrain } from './terrain';
import { buildCity, type RoadSegment } from './city';
import { buildProps, type RampDef } from './props';
import { buildSky, type SkyResult } from './sky';

export interface WorldData {
  seed: number;
  root: THREE.Group;
  hash: SpatialHash;
  /** Terrain heightfield (city sits at ~0 elevation). */
  height: ReturnType<typeof buildTerrain>['field'];
  roads: RoadSegment[];
  ramps: RampDef[];
  rings: THREE.Object3D[];
  spawn: THREE.Vector3;
  cityRadius: number;
  /** Soft world boundary radius. */
  bounds: number;
  sky: SkyResult;
}

/**
 * Deterministic world generation. Same seed => same city, terrain, props.
 * Pass `scene` to attach fog to the real scene (sky always parents to world root).
 */
export function generateWorld(seed: number, scene?: THREE.Scene): WorldData {
  const rng = new Rng(seed);
  const root = new THREE.Group();
  root.name = 'world';
  const hash = new SpatialHash(32);

  const terrain = buildTerrain(8192, 256, seed ^ 0x9e3779b9, 40);
  root.add(terrain.mesh);

  const city = buildCity(rng, hash);
  const props = buildProps(rng, hash, city.roads);
  root.add(city.root, props.root);

  const sky = buildSky(root, scene);

  return {
    seed,
    root,
    hash,
    height: terrain.field,
    roads: city.roads,
    ramps: props.ramps,
    rings: props.rings,
    spawn: city.spawn,
    cityRadius: city.cityRadius,
    bounds: 3800,
    sky,
  };
}
