import type {
  Agent,
  AgentIntent,
  Base,
  DiplomaticMessage,
  DiplomaticMessageTone,
  Dna,
  Food,
  GoldMine,
  LandPatch,
  SimulationSnapshot,
  SimulationStats,
  Species,
  TimelineEvent,
  VisualEffect,
  World,
} from '../core/types';
import { clamp, distanceSquared, normalize, randomRange, wrapPosition } from '../core/math';
import { averageDna, blendDna, dnaDistance } from '../genetics/dna';
import { createAgent, createFood, createInitialSpecies, createWorld } from './createWorld';
import { getSpeciesColor, getSpeciesName } from './names';

const initialAgents = 50;
const initialFood = 440;
const dayLength = 58;
const maxTimelineEvents = 24;
const maxDiplomaticMessages = 18;
const softPopulationLimit = 180;
const maxBirthsPerStep = 6;
const maxVisualEffects = 96;
const visualEffectLifetime = 96;
const collisionRadius = 26;
const combatRadius = 42;
const maxBases = 7;
const maxLandPatches = 42;
const foodCarryThreshold = 48;
const maxCarryFood = 32;
const initialTerritories = 14;
const initialGoldMines = 8;
const storedFoodSpoilageRate = 0.035;
const territoryClaimRadius = 92;
const maxCarryGold = 18;
const castleInnerRadius = 96;
const survivalEnergy = 34;
const phagogenesisDistance = 0.24;
const phagogenesisChance = 0.18;

type SpeciesRelation = {
  tension: number;
  truceUntil: number;
  lastMessageTick: number;
};

type LeaderPlan = 'forage' | 'expand' | 'fortify' | 'negotiate' | 'threaten' | 'war' | 'recover';

type LeaderMemory = {
  plan: LeaderPlan;
  targetSpeciesId: string | null;
  targetTerritoryId: number | null;
  urgency: number;
  lastUpdatedTick: number;
};

type LeaderReport = {
  species: Species;
  leader: Agent | null;
  base: Base | null;
  population: number;
  averageEnergy: number;
  foodStock: number;
  hunger: number;
  threat: number;
  ownedTerritories: number;
  contestedTerritories: number;
  resourcePressure: number;
  military: number;
  ambition: number;
};

export class SimulationEngine {
  private world: World;
  private agents: Agent[];
  private food: Food[];
  private goldMines: GoldMine[] = [];
  private bases: Base[] = [];
  private landPatches: LandPatch[] = [];
  private species: Species[];
  private timeline: TimelineEvent[];
  private diplomaticMessages: DiplomaticMessage[] = [];
  private nextAgentId = 1;
  private nextFoodId = 1;
  private nextGoldMineId = 1;
  private nextBaseId = 1;
  private nextLandPatchId = 1;
  private nextTimelineId = 1;
  private nextDiplomaticMessageId = 1;
  private nextVisualEffectId = 1;
  private births = initialAgents;
  private deaths = 0;
  private reproductions = 0;
  private firstDeathLogged = false;
  private firstReproductionLogged = false;
  private firstCombatLogged = false;
  private firstBaseLogged = false;
  private firstExpansionLogged = false;
  private firstDepositLogged = false;
  private firstPeaceLogged = false;
  private firstRallyLogged = false;
  private visualEffects: VisualEffect[] = [];
  private relations = new Map<string, SpeciesRelation>();
  private leaderMemories = new Map<string, LeaderMemory>();

  constructor() {
    this.world = createWorld();
    const firstSpecies = createInitialSpecies(0);
    const secondSpecies = createInitialSpecies(1);
    this.species = [firstSpecies, secondSpecies];
    this.agents = Array.from({ length: initialAgents }, (_, index) => {
      const species = index % 2 === 0 ? firstSpecies : secondSpecies;
      const agent = createAgent(this.nextAgentId++, this.world, species.id, 1, species.signature);
      const isFirstOfSpecies = !this.species.find((item) => item.id === species.id)?.leaderId;

      if (isFirstOfSpecies) {
        agent.isLeader = true;
        agent.energy = 118;
        agent.age = 22;
        species.leaderId = agent.id;
        agent.role = 'leader';
      }

      const side = index % 2 === 0 ? 0.14 : 0.86;
      agent.position.x = randomRange(this.world.width * (side - 0.035), this.world.width * (side + 0.035));
      agent.position.y = randomRange(this.world.height * 0.38, this.world.height * 0.62);
      return agent;
    });
    this.foundInitialCastles();
    this.seedGoldMines();
    this.seedNeutralTerritories();
    this.food = Array.from({ length: initialFood }, () => createFood(this.nextFoodId++, this.world));
    this.timeline = [
      {
        id: this.nextTimelineId++,
        day: 1,
        type: 'birth',
        title: 'Genesis event',
        detail: '50 agents from two species released onto a tropical island.',
      },
    ];
    this.agents.forEach((agent) => this.addVisualEffect('birth', agent.position, agent.speciesId));
    this.updateSpeciesPopulation();
  }

  reset() {
    const fresh = new SimulationEngine();
    this.world = fresh.world;
    this.agents = fresh.agents;
    this.food = fresh.food;
    this.goldMines = fresh.goldMines;
    this.bases = fresh.bases;
    this.landPatches = fresh.landPatches;
    this.species = fresh.species;
    this.timeline = fresh.timeline;
    this.diplomaticMessages = fresh.diplomaticMessages;
    this.nextAgentId = fresh.nextAgentId;
    this.nextFoodId = fresh.nextFoodId;
    this.nextGoldMineId = fresh.nextGoldMineId;
    this.nextBaseId = fresh.nextBaseId;
    this.nextLandPatchId = fresh.nextLandPatchId;
    this.nextTimelineId = fresh.nextTimelineId;
    this.nextDiplomaticMessageId = fresh.nextDiplomaticMessageId;
    this.nextVisualEffectId = fresh.nextVisualEffectId;
    this.births = fresh.births;
    this.deaths = fresh.deaths;
    this.reproductions = fresh.reproductions;
    this.firstDeathLogged = false;
    this.firstReproductionLogged = false;
    this.firstCombatLogged = false;
    this.firstBaseLogged = false;
    this.firstExpansionLogged = false;
    this.firstDepositLogged = false;
    this.firstPeaceLogged = false;
    this.firstRallyLogged = false;
    this.visualEffects = fresh.visualEffects;
    this.relations = fresh.relations;
    this.leaderMemories = fresh.leaderMemories;
  }

  step(iterations = 1) {
    for (let index = 0; index < iterations; index += 1) {
      this.world.tick += 1;

      if (this.world.tick % dayLength === 0) {
        this.world.day += 1;
        this.growFood();
        this.decayStoredFood();
        this.coolDiplomacy();
        this.resolveLeaderDiplomacy();
        this.detectSpecies();
        this.logMilestones();
      }

      this.moveAgents();
      this.resolveCollisions();
      this.resolveEating();
      this.resolveMining();
      this.resolveCombat();
      this.resolveBases();
      this.resolveTerritories();
      this.resolveReproduction();
      this.resolveMortality();
      this.pruneVisualEffects();
      this.updateSpeciesPopulation();
    }
  }

  getSnapshot(): SimulationSnapshot {
    return {
      world: { ...this.world },
      agents: this.agents.map((agent) => ({ ...agent, position: { ...agent.position }, velocity: { ...agent.velocity } })),
      food: this.food.map((item) => ({ ...item, position: { ...item.position } })),
      goldMines: this.goldMines.map((mine) => ({ ...mine, position: { ...mine.position } })),
      bases: this.bases.map((base) => ({ ...base, position: { ...base.position } })),
      landPatches: this.landPatches.map((patch) => ({ ...patch, position: { ...patch.position } })),
      species: this.species.map((item) => ({ ...item, signature: { ...item.signature } })),
      diplomaticMessages: this.diplomaticMessages.map((message) => ({ ...message, text: { ...message.text } })),
      visualEffects: this.visualEffects.map((effect) => ({ ...effect, position: { ...effect.position } })),
      stats: this.getStats(),
      timeline: [...this.timeline],
    };
  }

  private moveAgents() {
    const center = { x: this.world.width / 2, y: this.world.height / 2 };

    this.agents.forEach((agent) => {
      const nearestFood = this.findNearestFood(agent);
      const nearestAlly = this.findNearestAlly(agent);
      const nearestEnemy = this.findNearestEnemy(agent);
      const nearestBase = this.findNearestBase(agent);
      const nearestTerritory = this.findNearestClaimableTerritory(agent);
      const nearestGoldMine = this.findNearestGoldMine(agent);
      const nearestMate = this.findNearestMate(agent);
      const speciesLeader = this.findSpeciesLeader(agent.speciesId);
      const localAllies = this.countNearbyAgents(agent, true, 128);
      const localEnemies = this.countNearbyAgents(agent, false, 128);
      const hunger = clamp((86 - agent.energy) / 86);
      const curiosity = agent.dna.curiosity - 0.5;
      const intent = this.chooseIntent(agent, nearestBase, nearestFood, nearestEnemy, nearestTerritory, nearestGoldMine, nearestMate, localAllies, localEnemies);
      const socialPull = nearestAlly && agent.energy > 34 && !['claim', 'forage', 'mine', 'mate'].includes(intent) ? agent.dna.social * 0.22 : 0;
      const basePull = nearestBase && ['deliver', 'deliverGold', 'defend', 'rally'].includes(intent) ? 0.72 + agent.dna.social * 0.42 : 0;
      const enemyPull = nearestEnemy && (intent === 'attack' || intent === 'defend') ? Math.max(0.1, agent.dna.aggression - 0.18) * 0.9 : 0;
      const enemyRepel = nearestEnemy && (intent === 'avoid' || intent === 'peace') ? 0.72 + (1 - agent.dna.aggression) * 0.35 : 0;
      const foodPull = nearestFood && intent === 'forage' ? (0.72 + hunger) * (0.72 + agent.dna.vision) : 0;
      const territoryPull = nearestTerritory && intent === 'claim' ? 0.76 + agent.dna.curiosity * 0.44 + agent.dna.social * 0.28 : 0;
      const goldPull = nearestGoldMine && intent === 'mine' ? 0.8 + agent.dna.curiosity * 0.3 : 0;
      const matePull = nearestMate && intent === 'mate' ? 0.65 + agent.dna.social * 0.4 + agent.dna.fertility * 0.3 : 0;
      const leaderPull =
        speciesLeader && !agent.isLeader && agent.dna.social > 0.48 && !['claim', 'forage', 'mine', 'mate'].includes(intent)
          ? 0.12 + agent.dna.social * 0.24
          : 0;
      agent.intent = intent;
      const wander = {
        x: Math.sin((this.world.tick + agent.id * 7) * 0.018) * curiosity,
        y: Math.cos((this.world.tick + agent.id * 11) * 0.016) * curiosity,
      };
      const target = nearestFood?.position ?? center;
      const toFood = normalize({
        x: target.x - agent.position.x,
        y: target.y - agent.position.y,
      });
      const toAlly = nearestAlly
        ? normalize({
            x: nearestAlly.position.x - agent.position.x,
            y: nearestAlly.position.y - agent.position.y,
          })
        : { x: 0, y: 0 };
      const toEnemy = nearestEnemy
        ? normalize({
            x: nearestEnemy.position.x - agent.position.x,
            y: nearestEnemy.position.y - agent.position.y,
          })
        : { x: 0, y: 0 };
      const toBase = nearestBase
        ? normalize({
            x: nearestBase.position.x - agent.position.x,
            y: nearestBase.position.y - agent.position.y,
          })
        : { x: 0, y: 0 };
      const toLeader = speciesLeader
        ? normalize({
            x: speciesLeader.position.x - agent.position.x,
            y: speciesLeader.position.y - agent.position.y,
          })
        : { x: 0, y: 0 };
      const toTerritory = nearestTerritory
        ? normalize({
            x: nearestTerritory.position.x - agent.position.x,
            y: nearestTerritory.position.y - agent.position.y,
          })
        : { x: 0, y: 0 };
      const toGold = nearestGoldMine
        ? normalize({
            x: nearestGoldMine.position.x - agent.position.x,
            y: nearestGoldMine.position.y - agent.position.y,
          })
        : { x: 0, y: 0 };
      const toMate = nearestMate
        ? normalize({
            x: nearestMate.position.x - agent.position.x,
            y: nearestMate.position.y - agent.position.y,
          })
        : { x: 0, y: 0 };
      const direction = normalize({
        x:
          toFood.x * foodPull +
          toGold.x * goldPull +
          toMate.x * matePull +
          toTerritory.x * territoryPull +
          toAlly.x * socialPull +
          toLeader.x * leaderPull +
          toEnemy.x * (enemyPull - enemyRepel) +
          toBase.x * basePull +
          wander.x,
        y:
          toFood.y * foodPull +
          toGold.y * goldPull +
          toMate.y * matePull +
          toTerritory.y * territoryPull +
          toAlly.y * socialPull +
          toLeader.y * leaderPull +
          toEnemy.y * (enemyPull - enemyRepel) +
          toBase.y * basePull +
          wander.y,
      });
      const speed = (agent.isLeader ? 0.42 : 0.48) + agent.dna.speed * 1.12;

      agent.velocity = {
        x: agent.velocity.x * 0.9 + direction.x * speed * 0.1,
        y: agent.velocity.y * 0.9 + direction.y * speed * 0.1,
      };
      this.updateFacing(agent);
      agent.position = wrapPosition(
        {
          x: agent.position.x + agent.velocity.x,
          y: agent.position.y + agent.velocity.y,
        },
        this.world.width,
        this.world.height,
      );
      this.enforceCastleAccess(agent);
      const hungerPressure = agent.energy < 54 ? 0.026 : agent.energy < 72 ? 0.014 : 0;
      agent.energy -= 0.034 + agent.dna.speed * 0.018 + agent.dna.vision * 0.009 + hungerPressure;
      agent.age += 1 / dayLength;
      agent.reproductionCooldown = Math.max(0, agent.reproductionCooldown - 1);
      agent.combatCooldown = Math.max(0, agent.combatCooldown - 1);
    });
  }

  private updateFacing(agent: Agent) {
    const speed = Math.hypot(agent.velocity.x, agent.velocity.y);

    if (speed < 0.04) {
      return;
    }

    const targetAngle = Math.atan2(-agent.velocity.x, -agent.velocity.y);
    const difference = Math.atan2(Math.sin(targetAngle - agent.facingAngle), Math.cos(targetAngle - agent.facingAngle));
    agent.facingAngle += difference * 0.14;
  }

  private resolveCollisions() {
    for (let index = 0; index < this.agents.length; index += 1) {
      const agentA = this.agents[index];

      for (let next = index + 1; next < this.agents.length; next += 1) {
        const agentB = this.agents[next];
        const dx = agentA.position.x - agentB.position.x;
        const dy = agentA.position.y - agentB.position.y;
        const distance = Math.hypot(dx, dy);

        if (distance <= 0 || distance >= collisionRadius) {
          continue;
        }

        const push = (collisionRadius - distance) * 0.46;
        const nx = dx / distance;
        const ny = dy / distance;

        agentA.position.x += nx * push;
        agentA.position.y += ny * push;
        agentB.position.x -= nx * push;
        agentB.position.y -= ny * push;
        agentA.velocity.x += nx * 0.025;
        agentA.velocity.y += ny * 0.025;
        agentB.velocity.x -= nx * 0.025;
        agentB.velocity.y -= ny * 0.025;
        agentA.position = wrapPosition(agentA.position, this.world.width, this.world.height);
        agentB.position = wrapPosition(agentB.position, this.world.width, this.world.height);
      }
    }
  }

  private resolveEating() {
    const eaten = new Set<number>();

    this.agents.forEach((agent) => {
      const biteRadius = 13 + agent.dna.vision * 8;
      const foodItem = this.food.find((item) => !eaten.has(item.id) && distanceSquared(agent.position, item.position) < biteRadius ** 2);

      if (foodItem) {
        const nearestBase = this.findNearestBase(agent);
        const shouldCarryToBase =
          nearestBase &&
          agent.energy > foodCarryThreshold + 8 &&
          agent.dna.social > 0.42 &&
          agent.carryingFood < maxCarryFood &&
          nearestBase.foodStock < Math.max(34, nearestBase.population * 7);

        eaten.add(foodItem.id);
        if (shouldCarryToBase) {
          agent.carryingFood = Math.min(maxCarryFood, agent.carryingFood + foodItem.energy);
          agent.energy = Math.min(120, agent.energy + foodItem.energy * 0.18);
          agent.intent = 'deliver';
        } else {
          agent.energy = Math.min(120, agent.energy + foodItem.energy);
        }
        agent.memory = [foodItem.position, ...agent.memory].slice(0, 5);
        this.addVisualEffect('eat', foodItem.position, agent.speciesId);
      }
    });

    if (eaten.size > 0) {
      this.food = this.food.filter((item) => !eaten.has(item.id));
    }
  }

  private resolveMining() {
    this.agents.forEach((agent) => {
      if (agent.carryingGold > 0) {
        const base = this.findNearestBase(agent);

        if (base && distanceSquared(agent.position, base.position) < (base.radius + 24) ** 2) {
          base.goldStock += agent.carryingGold;
          agent.carryingGold = 0;
          agent.intent = 'deliverGold';
          this.addVisualEffect('deposit', base.position, agent.speciesId);
        }

        return;
      }

      if (agent.role !== 'worker' || agent.energy < 38) {
        return;
      }

      const mine = this.goldMines.find((item) => item.gold > 0 && distanceSquared(agent.position, item.position) < 34 ** 2);

      if (!mine) {
        return;
      }

      const mined = Math.min(maxCarryGold, mine.gold, 8 + Math.round(agent.dna.curiosity * 9));
      mine.gold -= mined;
      mine.claimedBySpeciesId = agent.speciesId;
      agent.carryingGold = mined;
      agent.energy = Math.max(8, agent.energy - 2.2);
      agent.intent = 'deliverGold';
      this.addVisualEffect('build', mine.position, agent.speciesId);
    });
  }

  private enforceCastleAccess(agent: Agent) {
    this.bases.forEach((base) => {
      const isCastleLeader = agent.isLeader && agent.speciesId === base.speciesId;

      if (isCastleLeader) {
        return;
      }

      const dx = agent.position.x - base.position.x;
      const dy = agent.position.y - base.position.y;
      const distance = Math.hypot(dx, dy);
      const minimumDistance = castleInnerRadius + base.fenceLevel * 12;

      if (distance >= minimumDistance) {
        return;
      }

      const fallbackAngle = (agent.id * 2.399 + this.world.tick * 0.01) % (Math.PI * 2);
      const nx = distance > 0.001 ? dx / distance : Math.cos(fallbackAngle);
      const ny = distance > 0.001 ? dy / distance : Math.sin(fallbackAngle);
      agent.position.x = clamp(base.position.x + nx * (minimumDistance + 10), 0, this.world.width);
      agent.position.y = clamp(base.position.y + ny * (minimumDistance + 10), 0, this.world.height);
      agent.velocity.x += nx * 0.42;
      agent.velocity.y += ny * 0.42;
    });
  }

  private resolveReproduction() {
    if (this.agents.length >= softPopulationLimit) {
      return;
    }

    const children: Agent[] = [];
    const readyAgents = this.agents.filter(
      (agent) => agent.energy > 76 && agent.age > 18 && agent.reproductionCooldown === 0 && !agent.isLeader && agent.role !== 'warrior',
    );

    readyAgents.forEach((parentA) => {
      if (parentA.energy < 76 || children.length >= maxBirthsPerStep || this.agents.length + children.length >= softPopulationLimit) {
        return;
      }

      const parentB = readyAgents.find(
        (candidate) =>
          candidate.id !== parentA.id &&
          candidate.speciesId === parentA.speciesId &&
          candidate.energy > 72 &&
          candidate.role !== 'warrior' &&
          this.getRomanceCompatibility(parentA, candidate) > 0.56 &&
          distanceSquared(candidate.position, parentA.position) < (42 + parentA.dna.social * 58 + parentA.dna.fertility * 40) ** 2,
      );

      if (!parentB) {
        return;
      }

      const localEnemies = this.countNearbyAgents(parentA, false, 150);

      if (localEnemies > 0 && parentA.energy < 96) {
        return;
      }

      const compatibility = this.getRomanceCompatibility(parentA, parentB);
      const dna = this.createPhagogeneticDna(parentA, parentB, compatibility);
      const phagogenesis = this.shouldTriggerPhagogenesis(parentA, parentB, dna, compatibility);
      const newSpecies = phagogenesis ? this.createPhagogenesisSpecies(dna, parentA, parentB) : null;
      const speciesId = newSpecies?.id ?? parentA.speciesId;
      const child = createAgent(this.nextAgentId++, this.world, speciesId, Math.max(parentA.generation, parentB.generation) + 1, dna);
      child.position = {
        x: (parentA.position.x + parentB.position.x) / 2 + randomRange(-12, 12),
        y: (parentA.position.y + parentB.position.y) / 2 + randomRange(-12, 12),
      };
      child.energy = phagogenesis ? 58 : 50;
      child.isLeader = false;
      child.role = 'worker';
      if (newSpecies && !newSpecies.leaderId) {
        child.isLeader = true;
        child.role = 'leader';
        child.energy = 118;
        child.age = Math.max(child.age, 22);
        newSpecies.leaderId = child.id;
        this.foundCastleForSpecies(newSpecies, child.position);
      }
      parentA.energy -= 29;
      parentB.energy -= 24;
      parentA.reproductionCooldown = 110 - parentA.dna.fertility * 46;
      parentB.reproductionCooldown = 110 - parentB.dna.fertility * 46;
      children.push(child);
      this.births += 1;
      this.reproductions += 1;
      this.addVisualEffect('birth', child.position, child.speciesId);

      if (!this.firstReproductionLogged) {
        this.firstReproductionLogged = true;
        this.addTimelineEvent('reproduction', 'First bonded birth', `Agent #${child.id} was born after two compatible agents stayed together.`);
      }

      if (phagogenesis) {
        this.addTimelineEvent('species', 'Phagogenesis birth', `Agent #${child.id} founded ${this.getSpeciesLabel(speciesId)} with unusual mixed traits.`);
      }
    });

    this.agents.push(...children);
  }

  private createPhagogeneticDna(parentA: Agent, parentB: Agent, compatibility: number): Dna {
    const dna = blendDna(parentA.dna, parentB.dna);
    const novelty = dnaDistance(parentA.dna, parentB.dna);
    const mutationScale = novelty > 0.16 || compatibility > 0.78 ? 0.08 : 0.035;

    return {
      speed: clamp(dna.speed + randomRange(-mutationScale, mutationScale), 0.02, 0.98),
      vision: clamp(dna.vision + randomRange(-mutationScale, mutationScale), 0.02, 0.98),
      aggression: clamp(dna.aggression + randomRange(-mutationScale * 0.8, mutationScale * 1.1), 0.02, 0.98),
      curiosity: clamp(dna.curiosity + randomRange(-mutationScale * 0.7, mutationScale * 1.25), 0.02, 0.98),
      fertility: clamp(dna.fertility + randomRange(-mutationScale, mutationScale), 0.02, 0.98),
      social: clamp(dna.social + randomRange(-mutationScale * 0.8, mutationScale * 1.1), 0.02, 0.98),
    };
  }

  private shouldTriggerPhagogenesis(parentA: Agent, parentB: Agent, childDna: Dna, compatibility: number) {
    const parentNovelty = dnaDistance(parentA.dna, parentB.dna);
    const species = this.species.find((item) => item.id === parentA.speciesId);
    const speciesNovelty = species ? dnaDistance(childDna, species.signature) : 0;
    const chance = phagogenesisChance + Math.max(0, parentNovelty - 0.13) * 0.9 + Math.max(0, compatibility - 0.72) * 0.35;

    return (parentNovelty > phagogenesisDistance || speciesNovelty > 0.2) && Math.random() < chance && this.species.length < 9;
  }

  private createPhagogenesisSpecies(signature: Dna, parentA: Agent, parentB: Agent) {
    const existing = this.species.find((species) => dnaDistance(signature, species.signature) < 0.11);

    if (existing) {
      return existing;
    }

    const species = this.createSpecies(signature);
    this.species.push(species);
    this.addLeaderMessage(
      parentA.speciesId,
      parentB.speciesId,
      'strategy',
      `${species.name} emerged from phagogenesis. The bloodline changed shape to survive.`,
      `${species.name} surgiu por fagogênese. A linhagem mudou de forma para sobreviver.`,
      'phagogenesis',
    );
    return species;
  }

  private resolveCombat() {
    for (let index = 0; index < this.agents.length; index += 1) {
      const attacker = this.agents[index];

      if (
        attacker.combatCooldown > 0 ||
        attacker.energy < 22 ||
        attacker.dna.aggression < 0.28 ||
        (!['attack', 'defend'].includes(attacker.intent) && attacker.dna.aggression < 0.72)
      ) {
        continue;
      }

      const target = this.agents.find(
        (candidate) =>
          candidate.id !== attacker.id &&
          candidate.speciesId !== attacker.speciesId &&
          candidate.energy > 0 &&
          !this.isTruceActive(attacker.speciesId, candidate.speciesId) &&
          distanceSquared(attacker.position, candidate.position) < combatRadius ** 2,
      );

      if (!target) {
        continue;
      }

      const damage = 2.6 + attacker.dna.aggression * 7.4;
      target.energy -= damage;
      attacker.energy -= 0.8 + attacker.dna.aggression * 1.2;
      attacker.combatCooldown = 46 - attacker.dna.aggression * 18;
      target.combatCooldown = Math.max(target.combatCooldown, 24);
      const push = normalize({
        x: target.position.x - attacker.position.x,
        y: target.position.y - attacker.position.y,
      });
      target.velocity.x += push.x * (0.72 + attacker.dna.aggression * 0.82);
      target.velocity.y += push.y * (0.72 + attacker.dna.aggression * 0.82);
      attacker.velocity.x += push.x * 0.18;
      attacker.velocity.y += push.y * 0.18;
      attacker.facingAngle = Math.atan2(-(target.position.x - attacker.position.x), -(target.position.y - attacker.position.y));
      target.facingAngle = Math.atan2(-(attacker.position.x - target.position.x), -(attacker.position.y - target.position.y));
      this.adjustTension(attacker.speciesId, target.speciesId, 2.6 + attacker.dna.aggression * 2.4);
      this.addVisualEffect('combat', {
        x: (attacker.position.x + target.position.x) / 2,
        y: (attacker.position.y + target.position.y) / 2,
      }, attacker.speciesId);

      if (!this.firstCombatLogged) {
        this.firstCombatLogged = true;
        this.addTimelineEvent('milestone', 'First clash', `Agent #${attacker.id} attacked agent #${target.id} near an apple grove.`);
        this.addLeaderMessage(attacker.speciesId, target.speciesId, 'war', 'Our border has teeth. Step back.', 'Nossa fronteira tem dentes. Recuem.');
      }
    }
  }

  private resolveBases() {
    this.resolveFoodDeposits();
    this.tryFoundBases();
    this.updateBases();
  }

  private resolveFoodDeposits() {
    this.agents.forEach((agent) => {
      if (agent.carryingFood <= 0) {
        return;
      }

      const base = this.findNearestBase(agent);

      if (!base || distanceSquared(agent.position, base.position) > (base.radius + 18) ** 2) {
        return;
      }

      base.foodStock += agent.carryingFood;
      agent.energy = Math.min(120, agent.energy + Math.min(10, agent.carryingFood * 0.24));
      agent.carryingFood = 0;
      agent.intent = 'shelter';
      this.addVisualEffect('deposit', base.position, agent.speciesId);

      if (!this.firstDepositLogged) {
        this.firstDepositLogged = true;
        this.addTimelineEvent('milestone', 'First food stockpile', `${this.getSpeciesLabel(agent.speciesId)} workers started carrying apples back to shelter.`);
      }
    });
  }

  private seedNeutralTerritories() {
    for (let index = 0; index < initialTerritories; index += 1) {
      const angle = index * 2.399;
      const ring = 360 + (index % 5) * 185;
      const position = {
        x: clamp(this.world.width / 2 + Math.cos(angle) * ring + randomRange(-80, 80), 140, this.world.width - 140),
        y: clamp(this.world.height / 2 + Math.sin(angle) * ring * 0.78 + randomRange(-80, 80), 140, this.world.height - 140),
      };

      this.landPatches.push({
        id: this.nextLandPatchId++,
        position,
        radius: randomRange(88, 142),
        speciesId: null,
        claimStrength: 0,
        resourceLevel: randomRange(0.35, 0.95),
        createdTick: this.world.tick,
      });
    }
  }

  private seedGoldMines() {
    for (let index = 0; index < initialGoldMines; index += 1) {
      const sideBias = index % 2 === 0 ? 0.28 : 0.72;
      const angle = index * 2.111;
      const position = {
        x: clamp(this.world.width * sideBias + Math.cos(angle) * randomRange(120, 520), 120, this.world.width - 120),
        y: clamp(this.world.height * 0.5 + Math.sin(angle) * randomRange(220, 900), 120, this.world.height - 120),
      };
      const maxGold = randomRange(420, 840);

      this.goldMines.push({
        id: this.nextGoldMineId++,
        position,
        gold: maxGold,
        maxGold,
        claimedBySpeciesId: null,
      });
    }
  }

  private foundInitialCastles() {
    this.species.forEach((species, index) => {
      const members = this.agents.filter((agent) => agent.speciesId === species.id);

      if (members.length === 0) {
        return;
      }

      const side = index % 2 === 0 ? 0.12 : 0.88;
      const position = {
        x: this.world.width * side,
        y: this.world.height * (0.5 + (index % 2 === 0 ? -0.08 : 0.08)),
      };
      this.foundCastleForSpecies(species, position);
      this.addLeaderMessage(
        species.id,
        null,
        'rally',
        `${species.name} gathers at the first castle.`,
        `${species.name} se reune no primeiro castelo.`,
      );
    });
  }

  private foundCastleForSpecies(species: Species, position: Agent['position']) {
    if (this.bases.some((base) => base.speciesId === species.id) || this.bases.length >= maxBases) {
      return;
    }

    const base: Base = {
      id: this.nextBaseId++,
      position: { ...position },
      speciesId: species.id,
      radius: 118,
      population: this.agents.filter((agent) => agent.speciesId === species.id).length,
      foodStock: 28,
      goldStock: 34,
      granaryLevel: 0,
      fenceLevel: 0,
      warriorCount: 0,
      threatLevel: 0,
      buildProgress: 64,
      expansionLevel: 0,
      bornDay: this.world.day,
    };

    this.bases.push(base);
    this.addVisualEffect('build', position, species.id);
  }

  private tryFoundBases() {
    if (this.bases.length >= maxBases) {
      return;
    }

    this.agents.forEach((founder) => {
      if (this.bases.length >= maxBases || founder.energy < 68 || founder.age < 8 || founder.dna.social < 0.58) {
        return;
      }

      const sameSpeciesNearby = this.agents.filter(
        (agent) =>
          agent.id !== founder.id &&
          agent.speciesId === founder.speciesId &&
          distanceSquared(agent.position, founder.position) < 125 ** 2,
      );
      const existingBase = this.bases.some((base) => base.speciesId === founder.speciesId);

      if (sameSpeciesNearby.length < 4 || existingBase) {
        return;
      }

      const cluster = [founder, ...sameSpeciesNearby.slice(0, 10)];
      const position = {
        x: cluster.reduce((sum, agent) => sum + agent.position.x, 0) / cluster.length,
        y: cluster.reduce((sum, agent) => sum + agent.position.y, 0) / cluster.length,
      };
      const base: Base = {
        id: this.nextBaseId++,
        position,
        speciesId: founder.speciesId,
        radius: 92,
        population: cluster.length,
        foodStock: 0,
        goldStock: 0,
        granaryLevel: 0,
        fenceLevel: 0,
        warriorCount: 0,
        threatLevel: 0,
        buildProgress: 22,
        expansionLevel: 0,
        bornDay: this.world.day,
      };

      this.bases.push(base);
      cluster.forEach((agent) => {
        agent.energy = Math.max(18, agent.energy - 5);
      });
      this.addVisualEffect('build', position, founder.speciesId);

      if (!this.firstBaseLogged) {
        this.firstBaseLogged = true;
        this.addTimelineEvent('milestone', 'First castle founded', `${this.getSpeciesLabel(founder.speciesId)} raised a single castle for its territory.`);
      }
    });
  }

  private updateBases() {
    this.bases.forEach((base) => {
      const workers = this.agents.filter(
        (agent) => agent.speciesId === base.speciesId && distanceSquared(agent.position, base.position) < (base.radius + 56) ** 2,
      );
      const nearbyEnemies = this.agents.filter(
        (agent) => agent.speciesId !== base.speciesId && distanceSquared(agent.position, base.position) < (base.radius + 96) ** 2,
      );

      base.population = workers.length;
      base.threatLevel = nearbyEnemies.length;
      base.foodStock = Math.max(0, base.foodStock - 0.006 * Math.max(1, base.population));
      base.warriorCount = this.agents.filter((agent) => agent.speciesId === base.speciesId && agent.role === 'warrior').length;

      if (workers.length < 3) {
        base.buildProgress = Math.max(0, base.buildProgress - 0.015);
        return;
      }

      workers
        .filter((agent) => agent.energy < 42 && base.foodStock >= 6)
        .slice(0, 3)
        .forEach((agent) => {
          const ration = Math.min(agent.energy < 28 ? 12 : 8, base.foodStock);
          base.foodStock -= ration;
          agent.energy = Math.min(120, agent.energy + ration * 1.25);
        });

      const socialPower = workers.reduce((sum, agent) => sum + agent.dna.social, 0) / workers.length;
      const storedFoodBoost = Math.min(1.6, base.foodStock / Math.max(30, workers.length * 12));
      const economyBoost = Math.min(0.9, base.goldStock / 160 + base.granaryLevel * 0.12);
      const defenseDrag = nearbyEnemies.length > workers.length ? 0.64 : 1;
      base.buildProgress += workers.length * socialPower * (0.04 + storedFoodBoost * 0.018 + economyBoost * 0.014) * defenseDrag;

      this.updateCastleEconomy(base, workers);

      if (this.world.tick % 18 === 0) {
        this.addVisualEffect('build', base.position, base.speciesId);
      }

      if (base.buildProgress < 70 || this.landPatches.length >= maxLandPatches) {
        return;
      }

      base.buildProgress = 0;
      base.expansionLevel += 1;
      base.radius = Math.min(180, base.radius + 9);
      this.expandLand(base);
    });
  }

  private updateCastleEconomy(base: Base, workers: Agent[]) {
    const workerCount = workers.filter((agent) => agent.role === 'worker').length;

    if (base.goldStock >= 42 && base.foodStock >= 18 && base.granaryLevel < 4) {
      base.goldStock -= 42;
      base.foodStock -= 10;
      base.granaryLevel += 1;
      this.addVisualEffect('build', {
        x: base.position.x + randomRange(-base.radius * 0.75, base.radius * 0.75),
        y: base.position.y + randomRange(-base.radius * 0.75, base.radius * 0.75),
      }, base.speciesId);
    }

    if (base.goldStock >= 58 && base.fenceLevel < 4 && (base.threatLevel > 0 || base.population > 12)) {
      base.goldStock -= 58;
      base.fenceLevel += 1;
      this.addVisualEffect('build', base.position, base.speciesId);
    }

    const targetWarriors = Math.min(18, Math.ceil(base.population * (base.threatLevel > 0 ? 0.34 : 0.18)) + base.fenceLevel);

    if (base.goldStock >= 36 && base.foodStock >= 8 && base.warriorCount < targetWarriors && workerCount > 3) {
      const recruit = workers
        .filter((agent) => agent.role === 'worker' && !agent.isLeader)
        .sort((a, b) => b.dna.aggression + b.energy / 160 - (a.dna.aggression + a.energy / 160))[0];

      if (recruit) {
        base.goldStock -= 36;
        base.foodStock -= 8;
        recruit.role = 'warrior';
        recruit.dna.aggression = Math.min(1, recruit.dna.aggression + 0.12);
        recruit.energy = Math.min(120, recruit.energy + 12);
        base.warriorCount += 1;
        this.addVisualEffect('rally', recruit.position, recruit.speciesId);
      }
    }
  }

  private resolveTerritories() {
    this.landPatches.forEach((patch) => {
      const localAgents = this.agents.filter((agent) => distanceSquared(agent.position, patch.position) < (patch.radius + territoryClaimRadius) ** 2);

      if (localAgents.length === 0) {
        patch.claimStrength = Math.max(0, patch.claimStrength - 0.008);
        patch.resourceLevel = Math.min(1, patch.resourceLevel + 0.0009);
        return;
      }

      const influence = new Map<string, number>();
      localAgents.forEach((agent) => {
        const leaderBonus = agent.isLeader ? 2.4 : 1;
        const hungerPenalty = agent.energy < 34 ? 0.55 : 1;
        influence.set(agent.speciesId, (influence.get(agent.speciesId) ?? 0) + (0.8 + agent.dna.social) * leaderBonus * hungerPenalty);
      });

      const strongest = [...influence.entries()].sort((a, b) => b[1] - a[1])[0];

      if (!strongest) {
        return;
      }

      const [speciesId, power] = strongest;
      const contested = influence.size > 1;
      const previousOwner = patch.speciesId;

      if (!patch.speciesId || patch.speciesId === speciesId) {
        patch.speciesId = speciesId;
        patch.claimStrength = clamp(patch.claimStrength + power * 0.015, 0, 1);
      } else {
        patch.claimStrength = clamp(patch.claimStrength - power * 0.018, 0, 1);

        if (patch.claimStrength <= 0.08) {
          patch.speciesId = speciesId;
          patch.claimStrength = 0.22;
          if (previousOwner) {
            this.adjustTension(previousOwner, speciesId, contested ? 3.5 : 1.8);
          }
          this.addVisualEffect('rally', patch.position, speciesId);
          this.addLeaderMessage(
            speciesId,
            previousOwner,
            'warning',
            'We have taken ground. Respect the new border.',
            'Tomamos este territorio. Respeitem a nova fronteira.',
          );
        }
      }

      if (patch.speciesId && patch.resourceLevel > 0.16 && this.world.tick % 46 === patch.id % 46) {
        const base = this.bases.find((item) => item.speciesId === patch.speciesId);
        const territoryFoodCap = base ? 540 : 480;

        if (this.food.length < territoryFoodCap) {
          this.food.push({
            id: this.nextFoodId++,
            position: {
              x: clamp(patch.position.x + randomRange(-patch.radius, patch.radius), 0, this.world.width),
              y: clamp(patch.position.y + randomRange(-patch.radius, patch.radius), 0, this.world.height),
            },
            energy: randomRange(11, 21),
          });
          patch.resourceLevel = Math.max(0, patch.resourceLevel - 0.035);
        }
      }
    });
  }

  private expandLand(base: Base) {
    const angle = base.expansionLevel * 2.399 + (base.speciesId === 'species-0' ? 0.4 : -0.4);
    const distance = 120 + base.expansionLevel * 32;
    const position = {
      x: clamp(base.position.x + Math.cos(angle) * distance, 80, this.world.width - 80),
      y: clamp(base.position.y + Math.sin(angle) * distance, 80, this.world.height - 80),
    };
    const patch: LandPatch = {
      id: this.nextLandPatchId++,
      position,
      radius: randomRange(64, 112),
      speciesId: base.speciesId,
      claimStrength: 1,
      resourceLevel: randomRange(0.55, 1),
      createdTick: this.world.tick,
    };

    this.landPatches.push(patch);
    this.addVisualEffect('build', position, base.speciesId);

    for (let index = 0; index < 18; index += 1) {
      this.food.push({
        id: this.nextFoodId++,
        position: {
          x: clamp(position.x + randomRange(-patch.radius, patch.radius), 0, this.world.width),
          y: clamp(position.y + randomRange(-patch.radius, patch.radius), 0, this.world.height),
        },
        energy: randomRange(14, 26),
      });
    }

    if (!this.firstExpansionLogged) {
      this.firstExpansionLogged = true;
      this.addTimelineEvent('milestone', 'Land expanded', `${this.getSpeciesLabel(base.speciesId)} workers raised new ground around their base.`);
    }
  }

  private resolveMortality() {
    const before = this.agents.length;
    this.agents = this.agents.filter((agent) => {
      const maximumAge = 130 + agent.dna.fertility * 45 - agent.dna.speed * 24;
      const protectedInCastle = this.isProtectedInsideCastle(agent);
      const survives = protectedInCastle || (agent.energy > 0 && agent.age < maximumAge);

      if (!survives && !this.firstDeathLogged) {
        this.firstDeathLogged = true;
        this.addTimelineEvent('death', 'First death', `Agent #${agent.id} left the population on day ${this.world.day}.`);
      }

      if (!survives) {
        this.addVisualEffect('death', agent.position, agent.speciesId);
      }

      return survives;
    });
    this.deaths += before - this.agents.length;
  }

  private isProtectedInsideCastle(agent: Agent) {
    if (!agent.isLeader) {
      return false;
    }

    const base = this.bases.find((item) => item.speciesId === agent.speciesId);

    return Boolean(base && distanceSquared(agent.position, base.position) < castleInnerRadius ** 2);
  }

  private growFood() {
    const ownedTerritories = this.landPatches.filter((patch) => patch.speciesId).length;
    const targetFood = 360 + ownedTerritories * 9 + Math.sin(this.world.day * 0.07) * 80;
    const growth = Math.max(4, Math.round((targetFood - this.food.length) * 0.18 + randomRange(6, 18)));

    for (let index = 0; index < growth; index += 1) {
      this.food.push(createFood(this.nextFoodId++, this.world));
    }
  }

  private decayStoredFood() {
    this.bases.forEach((base) => {
      const populationConsumption = base.population * 0.42;
      const spoilage = base.foodStock * storedFoodSpoilageRate;
      base.foodStock = Math.max(0, base.foodStock - populationConsumption - spoilage);
    });
  }

  private findNearestFood(agent: Agent): Food | null {
    const vision = (72 + agent.dna.vision * 230) ** 2;
    let nearest: Food | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    this.food.forEach((foodItem) => {
      const distance = distanceSquared(agent.position, foodItem.position);

      if (distance < vision && distance < nearestDistance) {
        nearest = foodItem;
        nearestDistance = distance;
      }
    });

    return nearest;
  }

  private findNearestGoldMine(agent: Agent): GoldMine | null {
    if (agent.role !== 'worker' || agent.carryingGold > 0) {
      return null;
    }

    const base = this.bases.find((item) => item.speciesId === agent.speciesId);
    const needsGold = !base || base.goldStock < 120 || base.granaryLevel < 3 || base.fenceLevel < 3;

    if (!needsGold || agent.energy < 42) {
      return null;
    }

    let nearest: GoldMine | null = null;
    let nearestScore = Number.POSITIVE_INFINITY;

    this.goldMines.forEach((mine) => {
      if (mine.gold <= 0) {
        return;
      }

      const distance = Math.sqrt(distanceSquared(agent.position, mine.position));
      const ownerPenalty = mine.claimedBySpeciesId && mine.claimedBySpeciesId !== agent.speciesId ? 160 * (1 - agent.dna.aggression) : 0;
      const score = distance + ownerPenalty - (mine.gold / mine.maxGold) * 120;

      if (score < nearestScore && distance < 850 + agent.dna.vision * 420) {
        nearest = mine;
        nearestScore = score;
      }
    });

    return nearest;
  }

  private findNearestAlly(agent: Agent): Agent | null {
    const radius = (58 + agent.dna.social * 160) ** 2;
    let nearest: Agent | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    this.agents.forEach((candidate) => {
      if (candidate.id === agent.id || candidate.speciesId !== agent.speciesId) {
        return;
      }

      const distance = distanceSquared(agent.position, candidate.position);

      if (distance < radius && distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    });

    return nearest;
  }

  private findNearestMate(agent: Agent): Agent | null {
    if (agent.isLeader || agent.role === 'warrior' || agent.energy < 74 || agent.age < 18 || agent.reproductionCooldown > 0) {
      return null;
    }

    const radius = (72 + agent.dna.social * 130 + agent.dna.fertility * 80) ** 2;
    let nearest: Agent | null = null;
    let nearestScore = Number.POSITIVE_INFINITY;

    this.agents.forEach((candidate) => {
      if (
        candidate.id === agent.id ||
        candidate.isLeader ||
        candidate.role === 'warrior' ||
        candidate.speciesId !== agent.speciesId ||
        candidate.energy < 70 ||
        candidate.age < 18 ||
        candidate.reproductionCooldown > 0
      ) {
        return;
      }

      const distance = distanceSquared(agent.position, candidate.position);

      if (distance > radius) {
        return;
      }

      const compatibility = this.getRomanceCompatibility(agent, candidate);
      const score = distance - compatibility * 18000;

      if (score < nearestScore) {
        nearest = candidate;
        nearestScore = score;
      }
    });

    return nearest;
  }

  private getRomanceCompatibility(agentA: Agent, agentB: Agent) {
    const geneticNovelty = dnaDistance(agentA.dna, agentB.dna);
    const temperament =
      1 -
      (Math.abs(agentA.dna.aggression - agentB.dna.aggression) * 0.28 +
        Math.abs(agentA.dna.social - agentB.dna.social) * 0.34 +
        Math.abs(agentA.dna.curiosity - agentB.dna.curiosity) * 0.2);
    const fertility = (agentA.dna.fertility + agentB.dna.fertility) / 2;

    return clamp(temperament * 0.52 + fertility * 0.36 + Math.min(0.22, geneticNovelty) * 0.8, 0, 1);
  }

  private findNearestEnemy(agent: Agent): Agent | null {
    const radius = (64 + agent.dna.aggression * 170) ** 2;
    let nearest: Agent | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    this.agents.forEach((candidate) => {
      if (candidate.id === agent.id || candidate.speciesId === agent.speciesId) {
        return;
      }

      const distance = distanceSquared(agent.position, candidate.position);

      if (distance < radius && distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    });

    return nearest;
  }

  private findNearestBase(agent: Agent): Base | null {
    let nearest: Base | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    this.bases.forEach((base) => {
      if (base.speciesId !== agent.speciesId) {
        return;
      }

      const distance = distanceSquared(agent.position, base.position);

      if (distance < nearestDistance && distance < 420 ** 2) {
        nearest = base;
        nearestDistance = distance;
      }
    });

    return nearest;
  }

  private findNearestClaimableTerritory(agent: Agent): LandPatch | null {
    const base = this.bases.find((item) => item.speciesId === agent.speciesId);
    const ownedCount = this.landPatches.filter((patch) => patch.speciesId === agent.speciesId).length;
    const shouldExpand = agent.energy > 48 && (agent.isLeader || agent.dna.curiosity > 0.46 || agent.dna.social > 0.58);

    if (!shouldExpand) {
      return null;
    }

    let nearest: LandPatch | null = null;
    let nearestScore = Number.POSITIVE_INFINITY;

    this.landPatches.forEach((patch) => {
      const isOwn = patch.speciesId === agent.speciesId;

      if (isOwn && patch.claimStrength > 0.75 && ownedCount > 2) {
        return;
      }

      if (patch.speciesId && !isOwn && agent.energy < 64 && agent.dna.aggression < 0.48) {
        return;
      }

      const agentDistance = Math.sqrt(distanceSquared(agent.position, patch.position));
      const baseDistance = base ? Math.sqrt(distanceSquared(base.position, patch.position)) : 0;
      const ownerPenalty = patch.speciesId && !isOwn ? 90 * (1 - agent.dna.aggression) : 0;
      const ownPenalty = isOwn ? 120 + patch.claimStrength * 160 : 0;
      const score = agentDistance + baseDistance * 0.24 + ownerPenalty + ownPenalty - patch.resourceLevel * 120;

      if (score < nearestScore && agentDistance < 620 + agent.dna.vision * 360) {
        nearest = patch;
        nearestScore = score;
      }
    });

    return nearest;
  }

  private findSpeciesLeader(speciesId: string): Agent | null {
    const leaderId = this.species.find((species) => species.id === speciesId)?.leaderId;
    const leader = leaderId ? this.agents.find((agent) => agent.id === leaderId && agent.energy > 0) : null;

    return leader ?? this.agents.find((agent) => agent.speciesId === speciesId && agent.isLeader && agent.energy > 0) ?? null;
  }

  private countNearbyAgents(agent: Agent, allies: boolean, radius: number) {
    const radiusSquared = radius ** 2;
    let count = 0;

    this.agents.forEach((candidate) => {
      if (candidate.id === agent.id) {
        return;
      }

      const isAlly = candidate.speciesId === agent.speciesId;

      if (isAlly !== allies) {
        return;
      }

      if (distanceSquared(agent.position, candidate.position) < radiusSquared) {
        count += 1;
      }
    });

    return count;
  }

  private chooseIntent(
    agent: Agent,
    base: Base | null,
    food: Food | null,
    enemy: Agent | null,
    territory: LandPatch | null,
    goldMine: GoldMine | null,
    mate: Agent | null,
    localAllies: number,
    localEnemies: number,
  ): AgentIntent {
    const outnumbered = enemy && localEnemies > localAllies + 1;
    const supported = localAllies + 1 >= Math.max(1, localEnemies);
    const nearThreatenedBase = base && base.threatLevel > 0 && distanceSquared(agent.position, base.position) < (base.radius + 190) ** 2;

    if (agent.carryingGold > 0 && base) {
      return 'deliverGold';
    }

    if (agent.carryingFood > 0 && base) {
      return 'deliver';
    }

    if (agent.energy < survivalEnergy && enemy) {
      return supported && agent.role === 'warrior' ? 'defend' : 'avoid';
    }

    if (agent.energy < 58 && food) {
      return 'forage';
    }

    if (agent.energy < 42 && base && base.foodStock > 0 && agent.isLeader) {
      return 'shelter';
    }

    if (enemy && outnumbered && agent.role !== 'warrior') {
      return 'avoid';
    }

    if (enemy && this.isTruceActive(agent.speciesId, enemy.speciesId)) {
      return agent.dna.social > 0.5 ? 'peace' : 'avoid';
    }

    if (enemy && this.tryMakePeace(agent, enemy, localAllies, localEnemies)) {
      return 'peace';
    }

    if (outnumbered && agent.dna.social > 0.44) {
      if (this.world.tick % 96 === agent.id % 96) {
        this.addVisualEffect('rally', agent.position, agent.speciesId);
      }

      if (!this.firstRallyLogged) {
        this.firstRallyLogged = true;
        this.addTimelineEvent('milestone', 'First rally', `${this.getSpeciesLabel(agent.speciesId)} agents started grouping against a larger force.`);
        this.addLeaderMessage(agent.speciesId, enemy.speciesId, 'rally', 'Gather close. We survive as one body.', 'Juntem-se. Sobrevivemos como um corpo so.');
      }

      return base ? 'rally' : 'avoid';
    }

    if (enemy && agent.energy > 46 && (nearThreatenedBase || (supported && agent.dna.aggression > 0.42) || (agent.role === 'warrior' && supported))) {
      return nearThreatenedBase ? 'defend' : 'attack';
    }

    if (agent.role === 'warrior' && enemy && agent.energy > 42 && supported) {
      return base?.threatLevel ? 'defend' : 'attack';
    }

    if (mate && agent.energy > 74 && agent.reproductionCooldown === 0 && !enemy) {
      return 'mate';
    }

    if (goldMine && agent.energy > 46 && (!base || base.foodStock > 6 || agent.dna.curiosity > 0.55)) {
      return 'mine';
    }

    if (territory && agent.energy > 50 && (!base || base.foodStock > 10 || agent.dna.curiosity > 0.62)) {
      return 'claim';
    }

    if (base && agent.energy < 42 && base.foodStock > 0 && agent.isLeader) {
      return 'shelter';
    }

    if (food && (agent.energy < 94 || (base && base.foodStock < Math.max(36, base.population * 7)))) {
      return 'forage';
    }

    if (base && agent.dna.social > 0.78 && base.foodStock > 24 && !territory) {
      return 'shelter';
    }

    return 'wander';
  }

  private tryMakePeace(agent: Agent, enemy: Agent, localAllies: number, localEnemies: number) {
    const relation = this.getRelation(agent.speciesId, enemy.speciesId);

    if (relation.truceUntil > this.world.tick || relation.tension < 7) {
      return false;
    }

    const outnumbered = localEnemies > localAllies + 1;
    const peaceDrive = agent.dna.social * 0.7 + (1 - agent.dna.aggression) * 0.5 + (outnumbered ? 0.3 : 0);

    if (peaceDrive < 0.82 || distanceSquared(agent.position, enemy.position) > 92 ** 2) {
      return false;
    }

    relation.tension = Math.max(0, relation.tension - 8);
    relation.truceUntil = this.world.tick + Math.round(dayLength * (2.2 + agent.dna.social * 3.6));
    this.addVisualEffect('peace', {
      x: (agent.position.x + enemy.position.x) / 2,
      y: (agent.position.y + enemy.position.y) / 2,
    }, agent.speciesId);

    if (!this.firstPeaceLogged) {
      this.firstPeaceLogged = true;
      this.addTimelineEvent(
        'milestone',
        'First fragile peace',
        `${this.getSpeciesLabel(agent.speciesId)} and ${this.getSpeciesLabel(enemy.speciesId)} paused a conflict instead of escalating it.`,
      );
      this.addLeaderMessage(agent.speciesId, enemy.speciesId, 'peace', 'We lower our fists for now.', 'Baixamos os punhos por enquanto.');
    }

    return true;
  }

  private getRelationKey(speciesA: string, speciesB: string) {
    return [speciesA, speciesB].sort().join(':');
  }

  private getRelation(speciesA: string, speciesB: string) {
    const key = this.getRelationKey(speciesA, speciesB);
    const existing = this.relations.get(key);

    if (existing) {
      return existing;
    }

    const relation: SpeciesRelation = { tension: 0, truceUntil: 0, lastMessageTick: -9999 };
    this.relations.set(key, relation);
    return relation;
  }

  private adjustTension(speciesA: string, speciesB: string, amount: number) {
    const relation = this.getRelation(speciesA, speciesB);
    relation.tension = clamp(relation.tension + amount, 0, 40);
  }

  private isTruceActive(speciesA: string, speciesB: string) {
    return this.getRelation(speciesA, speciesB).truceUntil > this.world.tick;
  }

  private coolDiplomacy() {
    this.relations.forEach((relation) => {
      relation.tension = Math.max(0, relation.tension - 0.42);

      if (relation.truceUntil <= this.world.tick) {
        relation.truceUntil = 0;
      }
    });
  }

  private resolveLeaderDiplomacy() {
    const reports = new Map(this.species.map((species) => [species.id, this.createLeaderReport(species)]));

    reports.forEach((report) => {
      const plan = this.chooseLeaderPlan(report, reports);
      const previous = this.leaderMemories.get(report.species.id);
      this.leaderMemories.set(report.species.id, { ...plan, lastUpdatedTick: this.world.tick });

      if (previous?.plan !== plan.plan || this.world.tick - (previous?.lastUpdatedTick ?? -9999) > dayLength * 4) {
        this.broadcastLeaderPlan(report, plan);
      }

      this.applyLeaderPlan(report, plan);
    });

    this.relations.forEach((relation, key) => {
      if (this.world.tick - relation.lastMessageTick < dayLength * 2.5) {
        return;
      }

      const [speciesA, speciesB] = key.split(':');
      const reportA = reports.get(speciesA);
      const reportB = reports.get(speciesB);

      if (!reportA?.leader || !reportB?.leader) {
        return;
      }

      const planA = this.leaderMemories.get(speciesA);
      const planB = this.leaderMemories.get(speciesB);
      const shouldBargain = (reportA.hunger > 0.62 && reportB.ownedTerritories > reportA.ownedTerritories) || relation.truceUntil > this.world.tick;

      if (shouldBargain && relation.tension < 13 && planA?.plan !== 'war') {
        relation.lastMessageTick = this.world.tick;
        this.addLeaderMessage(
          speciesA,
          speciesB,
          'trade',
          'Food is low. Leave the groves open and our claws stay closed.',
          'A comida esta baixa. Deixem os pomares abertos e nossas garras ficam fechadas.',
          'resource pact',
        );
        return;
      }

      if (relation.tension > 21 || planA?.plan === 'war') {
        relation.lastMessageTick = this.world.tick;
        this.addLeaderMessage(
          speciesA,
          speciesB,
          'war',
          'The map remembers every bite you stole. Return the ground or meet us under the torches.',
          'O mapa lembra cada mordida que voces roubaram. Devolvam o chao ou nos encontrem sob as tochas.',
          'war demand',
        );
        return;
      }

      if (reportA.threat > 0.3 && planB?.plan !== 'negotiate') {
        relation.lastMessageTick = this.world.tick;
        this.addLeaderMessage(
          speciesA,
          speciesB,
          'warning',
          'Your shadows are inside our castle wind. Pull back before the small ones learn fear.',
          'Suas sombras ja entram no vento do nosso castelo. Recuem antes que os pequenos aprendam o medo.',
          'border warning',
        );
      }
    });
  }

  private createLeaderReport(species: Species): LeaderReport {
    const members = this.agents.filter((agent) => agent.speciesId === species.id);
    const base = this.bases.find((item) => item.speciesId === species.id) ?? null;
    const leader = this.findSpeciesLeader(species.id);
    const totalEnergy = members.reduce((sum, agent) => sum + agent.energy, 0);
    const averageEnergy = members.length ? totalEnergy / members.length : 0;
    const ownedTerritories = this.landPatches.filter((patch) => patch.speciesId === species.id).length;
    const contestedTerritories = this.landPatches.filter((patch) => {
      if (patch.speciesId !== species.id) {
        return false;
      }

      return this.agents.some(
        (agent) => agent.speciesId !== species.id && distanceSquared(agent.position, patch.position) < (patch.radius + territoryClaimRadius) ** 2,
      );
    }).length;
    const aggression = members.length ? members.reduce((sum, agent) => sum + agent.dna.aggression, 0) / members.length : species.signature.aggression;
    const social = members.length ? members.reduce((sum, agent) => sum + agent.dna.social, 0) / members.length : species.signature.social;
    const curiosity = members.length ? members.reduce((sum, agent) => sum + agent.dna.curiosity, 0) / members.length : species.signature.curiosity;
    const foodStock = base?.foodStock ?? 0;
    const hunger = clamp((74 - averageEnergy) / 48 + Math.max(0, members.length * 4 - foodStock) / Math.max(24, members.length * 10), 0, 1);
    const threat = base ? clamp(base.threatLevel / Math.max(3, members.length * 0.35), 0, 1) : 0;
    const resourcePressure = clamp(1 - (ownedTerritories * 0.18 + foodStock / Math.max(60, members.length * 8)), 0, 1);
    const military = clamp((members.length / Math.max(1, this.agents.length)) * 0.45 + aggression * 0.35 + averageEnergy / 300, 0, 1);
    const ambition = clamp(curiosity * 0.45 + aggression * 0.28 + social * 0.2 + resourcePressure * 0.35, 0, 1);

    return {
      species,
      leader,
      base,
      population: members.length,
      averageEnergy,
      foodStock,
      hunger,
      threat,
      ownedTerritories,
      contestedTerritories,
      resourcePressure,
      military,
      ambition,
    };
  }

  private chooseLeaderPlan(report: LeaderReport, reports: Map<string, LeaderReport>): Omit<LeaderMemory, 'lastUpdatedTick'> {
    const rivals = [...reports.values()].filter((item) => item.species.id !== report.species.id);
    const strongestRival = rivals.sort((a, b) => b.military + b.ownedTerritories * 0.03 - (a.military + a.ownedTerritories * 0.03))[0] ?? null;
    const weakestRival = rivals.sort((a, b) => a.military - b.military)[0] ?? strongestRival;
    const targetTerritory = this.findStrategicTerritory(report);

    if (report.population <= 4 || report.averageEnergy < 34) {
      return { plan: 'recover', targetSpeciesId: null, targetTerritoryId: targetTerritory?.id ?? null, urgency: 0.92 };
    }

    if (report.hunger > 0.72 || report.foodStock < Math.max(8, report.population * 1.8)) {
      return { plan: 'forage', targetSpeciesId: strongestRival?.species.id ?? null, targetTerritoryId: targetTerritory?.id ?? null, urgency: report.hunger };
    }

    if (report.threat > 0.42 || report.contestedTerritories > 1) {
      return { plan: 'fortify', targetSpeciesId: strongestRival?.species.id ?? null, targetTerritoryId: null, urgency: Math.max(report.threat, 0.65) };
    }

    if (strongestRival && report.military < strongestRival.military * 0.78 && report.species.signature.social > 0.45) {
      return { plan: 'negotiate', targetSpeciesId: strongestRival.species.id, targetTerritoryId: null, urgency: 0.56 };
    }

    if (weakestRival && report.military > weakestRival.military * 1.22 && report.ambition > 0.62) {
      return { plan: 'war', targetSpeciesId: weakestRival.species.id, targetTerritoryId: targetTerritory?.id ?? null, urgency: report.ambition };
    }

    if (targetTerritory && (report.resourcePressure > 0.35 || report.ambition > 0.52)) {
      return { plan: 'expand', targetSpeciesId: targetTerritory.speciesId, targetTerritoryId: targetTerritory.id, urgency: Math.max(report.resourcePressure, report.ambition) };
    }

    return { plan: 'negotiate', targetSpeciesId: strongestRival?.species.id ?? null, targetTerritoryId: null, urgency: 0.34 };
  }

  private broadcastLeaderPlan(report: LeaderReport, plan: Omit<LeaderMemory, 'lastUpdatedTick'>) {
    const targetSpecies = plan.targetSpeciesId ? this.getSpeciesLabel(plan.targetSpeciesId) : null;
    const territory = plan.targetTerritoryId ? this.landPatches.find((patch) => patch.id === plan.targetTerritoryId) : null;

    if (plan.plan === 'forage') {
      this.addLeaderMessage(
        report.species.id,
        plan.targetSpeciesId,
        'strategy',
        `No feasts until the cellars breathe again. Spread out, mark fruit, carry it home.`,
        `Sem banquete ate os celeiros respirarem de novo. Espalhem-se, marquem frutas, tragam para casa.`,
        'forage order',
      );
      return;
    }

    if (plan.plan === 'expand') {
      this.addLeaderMessage(
        report.species.id,
        territory?.speciesId ?? null,
        'rally',
        `The ${targetSpecies ? `${targetSpecies} border` : 'silent ground'} is soft. We take it with feet before teeth.`,
        `${targetSpecies ? `A fronteira de ${targetSpecies}` : 'O chao silencioso'} esta mole. Tomamos com os pes antes dos dentes.`,
        'expansion order',
      );
      return;
    }

    if (plan.plan === 'fortify') {
      this.addLeaderMessage(
        report.species.id,
        plan.targetSpeciesId,
        'warning',
        `Close the rings around the castle. Nobody crosses hungry, nobody crosses armed.`,
        `Fechem os aneis ao redor do castelo. Ninguem cruza com fome, ninguem cruza armado.`,
        'fortify order',
      );
      return;
    }

    if (plan.plan === 'war') {
      this.addLeaderMessage(
        report.species.id,
        plan.targetSpeciesId,
        'war',
        `Tonight we count courage, not apples. ${targetSpecies ?? 'The rival'} will learn where our map ends.`,
        `Hoje contamos coragem, nao macas. ${targetSpecies ?? 'O rival'} vai aprender onde nosso mapa termina.`,
        'war council',
      );
      return;
    }

    if (plan.plan === 'recover') {
      this.addLeaderMessage(
        report.species.id,
        null,
        'peace',
        `Small steps. No raids. Feed the weak first and let the wounded sleep near the fire.`,
        `Passos pequenos. Sem invasoes. Alimentem os fracos primeiro e deixem os feridos dormir perto do fogo.`,
        'recovery order',
      );
      return;
    }

    this.addLeaderMessage(
      report.species.id,
      plan.targetSpeciesId,
      'peace',
      `We can share silence for a while. A quiet border grows more food than a loud one.`,
      `Podemos dividir o silencio por um tempo. Uma fronteira calma cria mais comida que uma barulhenta.`,
      'peace offer',
    );
  }

  private applyLeaderPlan(report: LeaderReport, plan: Omit<LeaderMemory, 'lastUpdatedTick'>) {
    if (plan.plan === 'war' && plan.targetSpeciesId) {
      this.adjustTension(report.species.id, plan.targetSpeciesId, 1.7 + plan.urgency);
    }

    if (plan.plan === 'negotiate' && plan.targetSpeciesId) {
      const relation = this.getRelation(report.species.id, plan.targetSpeciesId);
      relation.tension = Math.max(0, relation.tension - 1.2);
      if (report.hunger < 0.5 && relation.tension < 9) {
        relation.truceUntil = Math.max(relation.truceUntil, this.world.tick + dayLength * 3);
      }
    }

    if (plan.plan === 'forage' && report.base && report.foodStock < report.population * 2) {
      report.base.buildProgress = Math.max(0, report.base.buildProgress - 0.025);
    }

    if (plan.plan === 'fortify' && report.base) {
      report.base.buildProgress += 0.12 + report.population * 0.004;
    }
  }

  private findStrategicTerritory(report: LeaderReport): LandPatch | null {
    let best: LandPatch | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    this.landPatches.forEach((patch) => {
      const isOwn = patch.speciesId === report.species.id;
      if (isOwn && patch.claimStrength > 0.8) {
        return;
      }

      const baseDistance = report.base ? Math.sqrt(distanceSquared(report.base.position, patch.position)) : 400;
      const enemyPenalty = patch.speciesId && !isOwn ? (report.military > 0.55 ? 20 : 150) : 0;
      const claimOpportunity = isOwn ? 0.4 - patch.claimStrength : 1 - patch.claimStrength;
      const score = patch.resourceLevel * 90 + claimOpportunity * 80 - baseDistance * 0.06 - enemyPenalty;

      if (score > bestScore) {
        best = patch;
        bestScore = score;
      }
    });

    return best;
  }

  private addLeaderMessage(
    fromSpeciesId: string,
    toSpeciesId: string | null,
    tone: DiplomaticMessageTone,
    en: string,
    pt: string,
    intent = 'signal',
  ) {
    const fromLeader = this.findSpeciesLeader(fromSpeciesId);

    if (!fromLeader && this.agents.length > 0) {
      return;
    }

    const recentDuplicate = this.diplomaticMessages.some(
      (message) =>
        message.fromSpeciesId === fromSpeciesId &&
        message.toSpeciesId === toSpeciesId &&
        message.tone === tone &&
        this.world.tick - message.tick < dayLength,
    );

    if (recentDuplicate) {
      return;
    }

    this.diplomaticMessages = [
      {
        id: this.nextDiplomaticMessageId++,
        day: this.world.day,
        tick: this.world.tick,
        fromSpeciesId,
        toSpeciesId,
        tone,
        intent,
        text: { en, pt },
      },
      ...this.diplomaticMessages,
    ].slice(0, maxDiplomaticMessages);
  }

  private getSpeciesLabel(speciesId: string) {
    return this.species.find((species) => species.id === speciesId)?.name ?? 'unknown';
  }

  private detectSpecies() {
    const unassignedCandidates = this.agents.filter((agent) => {
      const currentSpecies = this.species.find((species) => species.id === agent.speciesId);
      return currentSpecies ? dnaDistance(agent.dna, currentSpecies.signature) > 0.21 : false;
    });

    if (unassignedCandidates.length < 7 || this.species.length >= 7) {
      return;
    }

    const signature = averageDna(unassignedCandidates.slice(0, 14).map((agent) => agent.dna));
    const newSpecies = this.createSpecies(signature);
    const leader = unassignedCandidates[0];

    unassignedCandidates.slice(0, 18).forEach((agent) => {
      agent.speciesId = newSpecies.id;
      agent.isLeader = false;
    });
    leader.isLeader = true;
    leader.role = 'leader';
    leader.energy = Math.max(leader.energy, 110);
    newSpecies.leaderId = leader.id;

    this.species.push(newSpecies);
    this.foundCastleForSpecies(newSpecies, leader.position);
    this.addTimelineEvent('species', 'New species detected', `${newSpecies.name} diverged after accumulated mutations.`);
  }

  private createSpecies(signature: Dna): Species {
    const index = this.species.length;

    return {
      id: `species-${index}`,
      name: getSpeciesName(index),
      color: getSpeciesColor(index),
      signature,
      population: 0,
      bornDay: this.world.day,
      leaderId: null,
    };
  }

  private updateSpeciesPopulation() {
    this.species.forEach((species) => {
      species.population = this.agents.filter((agent) => agent.speciesId === species.id).length;
    });
  }

  private logMilestones() {
    if (this.agents.length === 0) {
      this.addTimelineEvent('collapse', 'World collapse', 'The last agent died. Reset the lab to start another lineage.');
      return;
    }

    if (this.world.day === 37) {
      this.addTimelineEvent('milestone', 'Social clustering observed', 'Agents with similar DNA are spending more time near each other.');
    }

    const dominant = this.getStats().dominantSpecies;
    if (dominant && dominant.population / this.agents.length > 0.72) {
      this.addTimelineEvent('milestone', 'Dominant species', `${dominant.name} controls ${Math.round((dominant.population / this.agents.length) * 100)}% of the world.`);
    }
  }

  private addTimelineEvent(type: TimelineEvent['type'], title: string, detail: string) {
    const last = this.timeline[0];

    if (last?.day === this.world.day && last.title === title) {
      return;
    }

    this.timeline = [
      {
        id: this.nextTimelineId++,
        day: this.world.day,
        type,
        title,
        detail,
      },
      ...this.timeline,
    ].slice(0, maxTimelineEvents);
  }

  private addVisualEffect(type: VisualEffect['type'], position: Agent['position'], speciesId?: string) {
    this.visualEffects = [
      {
        id: this.nextVisualEffectId++,
        type,
        position: { ...position },
        tick: this.world.tick,
        speciesId,
      },
      ...this.visualEffects,
    ].slice(0, maxVisualEffects);
  }

  private pruneVisualEffects() {
    this.visualEffects = this.visualEffects.filter((effect) => this.world.tick - effect.tick < visualEffectLifetime);
  }

  private getStats(): SimulationStats {
    const totalEnergy = this.agents.reduce((sum, agent) => sum + agent.energy, 0);
    const totalGeneration = this.agents.reduce((sum, agent) => sum + agent.generation, 0);
    const livingSpecies = this.species.filter((species) => species.population > 0);
    const dominantSpecies = livingSpecies.reduce<Species | null>(
      (dominant, species) => (!dominant || species.population > dominant.population ? species : dominant),
      null,
    );

    return {
      population: this.agents.length,
      food: this.food.length,
      gold: Math.round(this.bases.reduce((sum, base) => sum + base.goldStock, 0) + this.goldMines.reduce((sum, mine) => sum + mine.gold, 0)),
      births: this.births,
      deaths: this.deaths,
      reproductions: this.reproductions,
      speciesCount: livingSpecies.length,
      averageEnergy: this.agents.length ? totalEnergy / this.agents.length : 0,
      averageGeneration: this.agents.length ? totalGeneration / this.agents.length : 0,
      dominantSpecies,
    };
  }
}
