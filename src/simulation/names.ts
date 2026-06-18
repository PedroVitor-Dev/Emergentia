const speciesNames = [
  'Auralis',
  'Vireon',
  'Nyxora',
  'Solari',
  'Calyx',
  'Eidra',
  'Nocten',
  'Ilyth',
  'Mirell',
  'Orison',
];

const colors = ['#6ee7f9', '#a7f36b', '#f3cf5a', '#ff7a90', '#b99cff', '#ffae5c', '#59d38c'];

export const getSpeciesName = (index: number) => speciesNames[index % speciesNames.length];

export const getSpeciesColor = (index: number) => colors[index % colors.length];
