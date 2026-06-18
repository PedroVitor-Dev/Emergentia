import type { TimelineEvent } from '../core/types';

type TimelineProps = {
  events: TimelineEvent[];
};

export const Timeline = ({ events }: TimelineProps) => (
  <section className="panel-section timeline-section" aria-label="Living timeline">
    <div className="section-heading">
      <h3>Timeline</h3>
      <span>{events.length}</span>
    </div>
    <div className="timeline-list">
      {events.map((event) => (
        <article className="timeline-item" data-type={event.type} key={event.id}>
          <span>Day {event.day}</span>
          <strong>{event.title}</strong>
          <p>{event.detail}</p>
        </article>
      ))}
    </div>
  </section>
);
