export type Vector2 = {
  x: number;
  y: number;
};

export type Dna = {
  speed: number;
  vision: number;
  aggression: number;
  curiosity: number;
  fertility: number;
  social: number;
};

export type Species = {
  id: string;
  name: string;
  color: string;
  signature: Dna;
  population: number;
  bornDay: number;
};

export type Agent = {
  id: number;
  position: Vector2;
  velocity: Vector2;
  energy: number;
  age: number;
  dna: Dna;
  generation: number;
  speciesId: string;
  tribeId: string | null;
  reproductionCooldown: number;
  memory: Vector2[];
};

export type Food = {
  id: number;
  position: Vector2;
  energy: number;
};

export type World = {
  width: number;
  height: number;
  day: number;
  tick: number;
  temperature: number;
  waterLevel: number;
};

export type TimelineEventType =
  | 'birth'
  | 'death'
  | 'reproduction'
  | 'species'
  | 'milestone'
  | 'collapse';

export type TimelineEvent = {
  id: number;
  day: number;
  type: TimelineEventType;
  title: string;
  detail: string;
};

export type SimulationStats = {
  population: number;
  food: number;
  births: number;
  deaths: number;
  reproductions: number;
  speciesCount: number;
  averageEnergy: number;
  averageGeneration: number;
  dominantSpecies: Species | null;
};

export type SimulationSnapshot = {
  world: World;
  agents: Agent[];
  food: Food[];
  species: Species[];
  stats: SimulationStats;
  timeline: TimelineEvent[];
};
