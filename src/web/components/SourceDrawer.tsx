import { ExternalLink, FileText, ShieldCheck, X } from 'lucide-react';
import type { Citation } from '../types.js';

export function SourceDrawer({
  citation,
  onClose,
}: {
  citation: Citation | null;
  onClose: () => void;
}) {
  return (
    <div className={`drawer-layer ${citation ? 'open' : ''}`} aria-hidden={!citation}>
      <button className="drawer-scrim" aria-label="Close source" onClick={onClose} />
      <aside className="source-drawer" role="dialog" aria-modal="true" aria-label="Source detail">
        {citation ? (
          <>
            <header>
              <div>
                <span className="eyebrow">CITED SOURCE</span>
                <h2>{citation.section || citation.title}</h2>
              </div>
              <button className="icon-button" aria-label="Close source" onClick={onClose}>
                <X size={18} />
              </button>
            </header>

            <div className="source-type-row">
              <span
                className={`source-type ${citation.sourceType === 'demo_policy' ? 'policy' : ''}`}
              >
                <FileText size={13} />
                {citation.sourceType === 'demo_policy'
                  ? 'Fictional demo store policy'
                  : 'Manufacturer specifications'}
              </span>
              <span className="source-verified">
                <ShieldCheck size={13} /> Retrieved & cited
              </span>
            </div>

            <section className="source-quote">
              <p>{citation.snippet}</p>
            </section>

            <dl className="source-meta">
              <div>
                <dt>Document</dt>
                <dd>{citation.title}</dd>
              </div>
              <div>
                <dt>Chunk ID</dt>
                <dd>
                  <code>{citation.id}</code>
                </dd>
              </div>
              <div>
                <dt>Source type</dt>
                <dd>{citation.sourceType}</dd>
              </div>
            </dl>

            <a className="source-link" href={citation.url} target="_blank" rel="noreferrer">
              Open the original document <ExternalLink size={14} />
            </a>

            <p className="source-disclaimer">
              Product claims come from preserved manufacturer pages. Demo store policies are
              fictional and exist only to exercise the support workflow.
            </p>
          </>
        ) : null}
      </aside>
    </div>
  );
}
