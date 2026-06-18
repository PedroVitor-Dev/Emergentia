import type { Agent, Food, Species, World } from '../core/types';
import { randomRange } from '../core/math';
import { createRandomDna } from '../genetics/dna';
import { getSpeciesColor, getSpeciesName } from './names';

export const createWorld = (): World => ({
  width: 2000,
  height: 2000,
  day: 1,
  tick: 0,
  temperature: 0.62,
  waterLevel: 0.58,
});

export const createInitialSpecies = (): Species => ({
  id: 'species-0',
  name: getSpeciesName(0),
  color: getSpeciesColor(0),
  signature: createRandomDna(),
  population: 0,
  bornDay: 1,
});

export const createAgent = (
  id: number,
  world: World,
  speciesId: string,
  generation = 1,
  dna = createRandomDna(),
): Agent => ({
  id,
  position: {
    x: randomRange(0, world.width),
    y: randomRange(0, world.height),
  },
  velocity: {
    x: randomRange(-1, 1),
    y: randomRange(-1, 1),
  },
  energy: randomRange(58, 92),
  age: randomRange(1, 18),
  dna,
  generation,
  speciesId,
  tribeId: null,
  reproductionCooldown: randomRange(0, 70),
  memory: [],
});

export const createFood = (id: number, world: World): Food => ({
  id,
  position: {
    x: randomRange(0, world.width),
    y: randomRange(0, world.height),
  },
  energy: randomRange(12, 24),
});
