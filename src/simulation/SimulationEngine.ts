import type { Agent, Dna, Food, SimulationSnapshot, SimulationStats, Species, TimelineEvent, VisualEffect, World } from '../core/types';
import { clamp, distanceSquared, normalize, randomRange, wrapPosition } from '../core/math';
import { averageDna, blendDna, dnaDistance } from '../genetics/dna';
import { createAgent, createFood, createInitialSpecies, createWorld } from './createWorld';
import { getSpeciesColor, getSpeciesName } from './names';

const initialAgents = 50;
const initialFood = 280;
const dayLength = 58;
const maxTimelineEvents = 24;
const softPopulationLimit = 180;
const maxBirthsPerStep = 6;
const maxVisualEffects = 96;
const visualEffectLifetime = 96;
const collisionRadius = 26;
const combatRadius = 42;

export class SimulationEngine {
  private world: World;
  private agents: Agent[];
  private food: Food[];
  private species: Species[];
  private timeline: TimelineEvent[];
  private nextAgentId = 1;
  private nextFoodId = 1;
  private nextTimelineId = 1;
  private nextVisualEffectId = 1;
  private births = initialAgents;
  private deaths = 0;
  private reproductions = 0;
  private firstDeathLogged = false;
  private firstReproductionLogged = false;
  private firstCombatLogged = false;
  private visualEffects: VisualEffect[] = [];

  constructor() {
    this.world = createWorld();
    const firstSpecies = createInitialSpecies(0);
    const secondSpecies = createInitialSpecies(1);
    this.species = [firstSpecies, secondSpecies];
    this.agents = Array.from({ length: initialAgents }, (_, index) => {
      const species = index % 2 === 0 ? firstSpecies : secondSpecies;
      const agent = createAgent(this.nextAgentId++, this.world, species.id, 1, species.signature);
      const side = index % 2 === 0 ? 0.43 : 0.57;
      agent.position.x = randomRange(this.world.width * (side - 0.08), this.world.width * (side + 0.08));
      agent.position.y = randomRange(this.world.height * 0.34, this.world.height * 0.66);
      return agent;
    });
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
    this.species = fresh.species;
    this.timeline = fresh.timeline;
    this.nextAgentId = fresh.nextAgentId;
    this.nextFoodId = fresh.nextFoodId;
    this.nextTimelineId = fresh.nextTimelineId;
    this.nextVisualEffectId = fresh.nextVisualEffectId;
    this.births = fresh.births;
    this.deaths = fresh.deaths;
    this.reproductions = fresh.reproductions;
    this.firstDeathLogged = false;
    this.firstReproductionLogged = false;
    this.firstCombatLogged = false;
    this.visualEffects = fresh.visualEffects;
  }

  step(iterations = 1) {
    for (let index = 0; index < iterations; index += 1) {
      this.world.tick += 1;

      if (this.world.tick % dayLength === 0) {
        this.world.day += 1;
        this.growFood();
        this.detectSpecies();
        this.logMilestones();
      }

      this.moveAgents();
      this.resolveCollisions();
      this.resolveEating();
      this.resolveCombat();
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
      species: this.species.map((item) => ({ ...item, signature: { ...item.signature } })),
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
      const hunger = clamp((86 - agent.energy) / 86);
      const curiosity = agent.dna.curiosity - 0.5;
      const socialPull = nearestAlly && agent.energy > 34 ? agent.dna.social * 0.34 : 0;
      const enemyPull = nearestEnemy && agent.energy > 38 ? Math.max(0, agent.dna.aggression - 0.24) * 0.72 : 0;
      const foodPull = nearestFood ? hunger * (0.82 + agent.dna.vision) : 0;
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
      const direction = normalize({
        x: toFood.x * foodPull + toAlly.x * socialPull + toEnemy.x * enemyPull + wander.x,
        y: toFood.y * foodPull + toAlly.y * socialPull + toEnemy.y * enemyPull + wander.y,
      });
      const speed = 0.48 + agent.dna.speed * 1.18;

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
      agent.energy -= 0.024 + agent.dna.speed * 0.014 + agent.dna.vision * 0.007;
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

    const targetAngle = Math.atan2(agent.velocity.x, agent.velocity.y);
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
        eaten.add(foodItem.id);
        agent.energy = Math.min(120, agent.energy + foodItem.energy);
        agent.memory = [foodItem.position, ...agent.memory].slice(0, 5);
        this.addVisualEffect('eat', foodItem.position, agent.speciesId);
      }
    });

    if (eaten.size > 0) {
      this.food = this.food.filter((item) => !eaten.has(item.id));
    }
  }

  private resolveReproduction() {
    if (this.agents.length >= softPopulationLimit) {
      return;
    }

    const children: Agent[] = [];
    const readyAgents = this.agents.filter((agent) => agent.energy > 82 && agent.age > 20 && agent.reproductionCooldown === 0);

    readyAgents.forEach((parentA) => {
      if (parentA.energy < 82 || children.length >= maxBirthsPerStep || this.agents.length + children.length >= softPopulationLimit) {
        return;
      }

      const parentB = readyAgents.find(
        (candidate) =>
          candidate.id !== parentA.id &&
          candidate.energy > 70 &&
          distanceSquared(candidate.position, parentA.position) < (38 + parentA.dna.social * 52) ** 2,
      );

      if (!parentB) {
        return;
      }

      const dna = blendDna(parentA.dna, parentB.dna);
      const child = createAgent(this.nextAgentId++, this.world, parentA.speciesId, Math.max(parentA.generation, parentB.generation) + 1, dna);
      child.position = {
        x: (parentA.position.x + parentB.position.x) / 2 + randomRange(-12, 12),
        y: (parentA.position.y + parentB.position.y) / 2 + randomRange(-12, 12),
      };
      child.energy = 48;
      parentA.energy -= 29;
      parentB.energy -= 24;
      parentA.reproductionCooldown = 90 - parentA.dna.fertility * 38;
      parentB.reproductionCooldown = 90 - parentB.dna.fertility * 38;
      children.push(child);
      this.births += 1;
      this.reproductions += 1;
      this.addVisualEffect('birth', child.position, child.speciesId);

      if (!this.firstReproductionLogged) {
        this.firstReproductionLogged = true;
        this.addTimelineEvent('reproduction', 'First reproduction', `Agent #${child.id} was born as generation ${child.generation}.`);
      }
    });

    this.agents.push(...children);
  }

  private resolveCombat() {
    for (let index = 0; index < this.agents.length; index += 1) {
      const attacker = this.agents[index];

      if (attacker.combatCooldown > 0 || attacker.energy < 22 || attacker.dna.aggression < 0.28) {
        continue;
      }

      const target = this.agents.find(
        (candidate) =>
          candidate.id !== attacker.id &&
          candidate.speciesId !== attacker.speciesId &&
          candidate.energy > 0 &&
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
      attacker.facingAngle = Math.atan2(target.position.x - attacker.position.x, target.position.y - attacker.position.y);
      target.facingAngle = Math.atan2(attacker.position.x - target.position.x, attacker.position.y - target.position.y);
      this.addVisualEffect('combat', {
        x: (attacker.position.x + target.position.x) / 2,
        y: (attacker.position.y + target.position.y) / 2,
      }, attacker.speciesId);

      if (!this.firstCombatLogged) {
        this.firstCombatLogged = true;
        this.addTimelineEvent('milestone', 'First clash', `Agent #${attacker.id} attacked agent #${target.id} near an apple grove.`);
      }
    }
  }

  private resolveMortality() {
    const before = this.agents.length;
    this.agents = this.agents.filter((agent) => {
      const maximumAge = 130 + agent.dna.fertility * 45 - agent.dna.speed * 24;
      const survives = agent.energy > 0 && agent.age < maximumAge;

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

  private growFood() {
    const targetFood = 240 + Math.sin(this.world.day * 0.07) * 64;
    const growth = Math.max(4, Math.round((targetFood - this.food.length) * 0.18 + randomRange(6, 18)));

    for (let index = 0; index < growth; index += 1) {
      this.food.push(createFood(this.nextFoodId++, this.world));
    }
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

    unassignedCandidates.slice(0, 18).forEach((agent) => {
      agent.speciesId = newSpecies.id;
    });

    this.species.push(newSpecies);
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
