import type { CarSpec } from '../vehicles/physics';

export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  max: number;
  baseCost: number;
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'engine', name: 'Engine', desc: '+8% top speed & accel per level', max: 5, baseCost: 1500 },
  { id: 'grip', name: 'Tyres', desc: '+6% grip per level', max: 5, baseCost: 1200 },
  { id: 'boost', name: 'Boost Tank', desc: '+15% boost capacity per level', max: 5, baseCost: 1000 },
  { id: 'handling', name: 'Suspension', desc: '+5% steering response per level', max: 5, baseCost: 1100 },
];

/** Geometric cost curve: level 0 -> base, each level +80%. */
export function upgradeCost(def: UpgradeDef, currentLevel: number): number {
  return Math.round(def.baseCost * 1.8 ** currentLevel);
}

export interface CarStats {
  topSpeed: number;
  accel: number;
  grip: number;
  handling: number;
  boost: number;
}

/** Effective stats for a car with upgrades applied. */
export function effectiveStats(spec: CarSpec, upgrades: Record<string, number>): CarStats {
  const engine = upgrades['engine'] ?? 0;
  const grip = upgrades['grip'] ?? 0;
  const boost = upgrades['boost'] ?? 0;
  const handling = upgrades['handling'] ?? 0;
  return {
    topSpeed: spec.topSpeed * (1 + engine * 0.08),
    accel: spec.accel * (1 + engine * 0.08),
    grip: spec.grip * (1 + grip * 0.06),
    handling: spec.handling * (1 + handling * 0.05),
    boost: 1 + boost * 0.15,
  };
}
