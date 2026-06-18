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
  leaderId: number | null;
};

export type AgentIntent =
  | 'wander'
  | 'forage'
  | 'deliver'
  | 'shelter'
  | 'attack'
  | 'defend'
  | 'claim'
  | 'rally'
  | 'avoid'
  | 'peace';

export type Agent = {
  id: number;
  position: Vector2;
  velocity: Vector2;
  facingAngle: number;
  energy: number;
  age: number;
  dna: Dna;
  generation: number;
  speciesId: string;
  tribeId: string | null;
  isLeader: boolean;
  intent: AgentIntent;
  carryingFood: number;
  reproductionCooldown: number;
  combatCooldown: number;
  memory: Vector2[];
};

export type Food = {
  id: number;
  position: Vector2;
  energy: number;
};

export type Base = {
  id: number;
  position: Vector2;
  speciesId: string;
  radius: number;
  population: number;
  foodStock: number;
  threatLevel: number;
  buildProgress: number;
  expansionLevel: number;
  bornDay: number;
};

export type DiplomaticMessageTone = 'peace' | 'war' | 'rally' | 'warning' | 'trade' | 'strategy';

export type DiplomaticMessage = {
  id: number;
  day: number;
  tick: number;
  fromSpeciesId: string;
  toSpeciesId: string | null;
  tone: DiplomaticMessageTone;
  intent: string;
  text: {
    en: string;
    pt: string;
  };
};

export type LandPatch = {
  id: number;
  position: Vector2;
  radius: number;
  speciesId: string | null;
  claimStrength: number;
  resourceLevel: number;
  createdTick: number;
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

export type VisualEffectType = 'birth' | 'eat' | 'death' | 'combat' | 'build' | 'deposit' | 'peace' | 'rally';

export type VisualEffect = {
  id: number;
  type: VisualEffectType;
  position: Vector2;
  tick: number;
  speciesId?: string;
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
  bases: Base[];
  landPatches: LandPatch[];
  species: Species[];
  diplomaticMessages: DiplomaticMessage[];
  visualEffects: VisualEffect[];
  stats: SimulationStats;
  timeline: TimelineEvent[];
};
