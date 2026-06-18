import type { Species } from '../core/types';

type SpeciesListProps = {
  species: Species[];
};

export const SpeciesList = ({ species }: SpeciesListProps) => (
  <section className="panel-section" aria-label="Living species">
    <div className="section-heading">
      <h3>Species</h3>
      <span>{species.filter((item) => item.population > 0).length}</span>
    </div>
    <div className="species-list">
      {species.map((item) => (
        <article className="species-row" key={item.id}>
          <span className="species-dot" style={{ background: item.color }} />
          <div>
            <strong>{item.name}</strong>
            <small>born day {item.bornDay}</small>
          </div>
          <b>{item.population}</b>
        </article>
      ))}
    </div>
  </section>
);
