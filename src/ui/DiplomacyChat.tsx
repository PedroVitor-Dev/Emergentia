import type { DiplomaticMessage, Species } from '../core/types';

type DiplomacyChatProps = {
  language: 'pt' | 'en';
  messages: DiplomaticMessage[];
  onLanguageChange: (language: 'pt' | 'en') => void;
  species: Species[];
};

export const DiplomacyChat = ({ language, messages, onLanguageChange, species }: DiplomacyChatProps) => {
  const speciesById = new Map(species.map((item) => [item.id, item]));

  return (
    <section className="panel-section diplomacy-chat" aria-label="Leader diplomacy chat">
      <div className="section-heading">
        <h3>{language === 'pt' ? 'Chat dos lideres' : 'Leader chat'}</h3>
        <div className="language-toggle" aria-label="Chat language">
          <button className={language === 'pt' ? 'is-active' : ''} type="button" onClick={() => onLanguageChange('pt')}>
            PT
          </button>
          <button className={language === 'en' ? 'is-active' : ''} type="button" onClick={() => onLanguageChange('en')}>
            EN
          </button>
        </div>
      </div>

      <div className="chat-list">
        {messages.length === 0 ? (
          <p className="empty-chat">{language === 'pt' ? 'Os lideres ainda estao observando.' : 'The leaders are still watching.'}</p>
        ) : (
          messages.map((message) => {
            const from = speciesById.get(message.fromSpeciesId);
            const to = message.toSpeciesId ? speciesById.get(message.toSpeciesId) : null;

            return (
              <article className="chat-message" data-tone={message.tone} key={message.id}>
                <div className="chat-meta">
                  <span className="species-dot" style={{ background: from?.color ?? '#edf5ef' }} />
                  <strong>{from?.name ?? 'Unknown'}</strong>
                  {to ? <small>{language === 'pt' ? `para ${to.name}` : `to ${to.name}`}</small> : <small>{language === 'pt' ? 'publico' : 'public'}</small>}
                </div>
                <p>{message.text[language]}</p>
                <span className="chat-day">Day {message.day}</span>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
};
