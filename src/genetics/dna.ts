import type { Dna } from '../core/types';
import { clamp, randomRange } from '../core/math';

const traits = ['speed', 'vision', 'aggression', 'curiosity', 'fertility', 'social'] as const;

export const createRandomDna = (): Dna => ({
  speed: randomRange(0.32, 0.88),
  vision: randomRange(0.25, 0.86),
  aggression: randomRange(0.05, 0.55),
  curiosity: randomRange(0.25, 0.95),
  fertility: randomRange(0.28, 0.85),
  social: randomRange(0.2, 0.9),
});

export const blendDna = (parentA: Dna, parentB: Dna): Dna =>
  traits.reduce((child, trait) => {
    const inherited = Math.random() > 0.5 ? parentA[trait] : parentB[trait];
    const drift = randomRange(-0.045, 0.045);

    return {
      ...child,
      [trait]: clamp(inherited + drift, 0.02, 0.98),
    };
  }, {} as Dna);

export const dnaDistance = (a: Dna, b: Dna) => {
  const sum = traits.reduce((total, trait) => total + Math.abs(a[trait] - b[trait]), 0);
  return sum / traits.length;
};

export const averageDna = (dnaList: Dna[]): Dna => {
  if (dnaList.length === 0) {
    return createRandomDna();
  }

  return traits.reduce((average, trait) => {
    const total = dnaList.reduce((sum, dna) => sum + dna[trait], 0);

    return {
      ...average,
      [trait]: total / dnaList.length,
    };
  }, {} as Dna);
};
