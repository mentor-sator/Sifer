import { useEffect, useState } from 'react';
import type { ReadFailure, ReadingKind, ReadingSource, ReadOutcome } from '../../shared/bridge';
import './panel.css';

const failureText: Record<ReadFailure, string> = {
  nothing: 'Nothing readable under the orb.',
  protected: 'That field is protected, so Sifer did not read it.',
  unsupported: 'Reading the screen is not available on this system yet.',
  timeout: 'The app under the orb did not answer in time.',
  failed: 'Sifer could not read that spot.',
};

const sourceText: Record<ReadingSource, string> = {
  dom: 'from the page',
  accessibility: 'from the app',
};

const kindText: Record<ReadingKind, string> = {
  text: 'Paragraph',
  value: 'Field value',
  name: 'Label',
};

const close = (): void => window.sifer.panel.close();
const separator = ` ${String.fromCharCode(183)} `;
const closeMark = String.fromCharCode(215);

export function Panel() {
  const [content, setContent] = useState<ReadOutcome | null>(null);

  useEffect(() => {
    let active = true;
    void window.sifer.panel.current().then((current) => {
      if (active && current) {
        setContent(current);
      }
    });
    const unsubscribe = window.sifer.panel.onContent(setContent);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <main className="panel">
      <header className="panel-header">
        <span className="panel-title">Under the orb</span>
        {content?.ok && (
          <span className="panel-source">
            {kindText[content.reading.kind]}
            {separator}
            {content.reading.control}
          </span>
        )}
        <button type="button" className="panel-close" aria-label="Close" onClick={close}>
          {closeMark}
        </button>
      </header>
      <section className="panel-body" aria-live="polite">
        {content === null && <p className="panel-note">Drop the orb on any text.</p>}
        {content?.ok === false && <p className="panel-note">{failureText[content.reason]}</p>}
        {content?.ok && <p className="panel-text">{content.reading.text}</p>}
      </section>
      {content?.ok && (
        <footer className="panel-footer">
          {content.reading.text.length.toLocaleString()} characters
          {separator}
          {sourceText[content.reading.source]}
        </footer>
      )}
    </main>
  );
}
