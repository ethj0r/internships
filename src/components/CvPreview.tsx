import { Fragment, type ReactNode } from "react";
import { parseRich, plain, latexToRich, type CvDoc, type RichNode } from "../../shared/cv";

function renderNodes(nodes: RichNode[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.t) {
      case "text":
        return <Fragment key={i}>{n.v}</Fragment>;
      case "b":
        return <strong key={i}>{renderNodes(n.c)}</strong>;
      case "i":
        return <em key={i}>{renderNodes(n.c)}</em>;
      case "a":
        return /^(https?:|mailto:)/i.test(n.href) ? (
          <a key={i} href={n.href} target="_blank" rel="noopener noreferrer">
            {renderNodes(n.c)}
          </a>
        ) : (
          <Fragment key={i}>{renderNodes(n.c)}</Fragment>
        );
      case "sup":
        return <sup key={i}>{n.v}</sup>;
      case "sub":
        return <sub key={i}>{n.v}</sub>;
      case "br":
        return <br key={i} />;
    }
  });
}

export function Rich({ text }: { text: string }) {
  return <>{renderNodes(parseRich(text))}</>;
}

function Bullets({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="cv-bullets">
      {items.map((b, i) => (
        <li key={i}>
          <Rich text={b} />
        </li>
      ))}
    </ul>
  );
}

/** HTML rendering that mirrors the LaTeX résumé template, for preview and printing. */
export function CvPreview({ doc }: { doc: CvDoc }) {
  return (
    <article className="cv" aria-label={`CV of ${doc.header.name}`}>
      <header className="cv-header">
        <h1 className="cv-name">{doc.header.name}</h1>
        <p className="cv-contacts">
          {doc.header.contacts.map((c, i) => (
            <Fragment key={i}>
              {i > 0 && <span className="cv-sep">|</span>}
              {c.url ? (
                <a href={c.url} target="_blank" rel="noopener noreferrer">
                  {c.text}
                </a>
              ) : (
                c.text
              )}
            </Fragment>
          ))}
        </p>
      </header>

      {doc.sections.map((s) => (
        <section key={s.key} className="cv-section">
          <h2 className="cv-section-title">
            <span>{s.title}</span>
            {s.note && (
              <span className="cv-section-note">
                <Rich text={s.note} />
              </span>
            )}
          </h2>
          <div className={`cv-section-body${s.type === "items" && s.variant === "plain" ? " compact" : ""}`}>
            {s.type === "entries" &&
              s.entries.map((e) => (
                <div key={e.id} className="cv-entry">
                  <div className="cv-row">
                    <strong>
                      <Rich text={e.title} />
                    </strong>
                    <span>
                      <Rich text={e.titleRight} />
                    </span>
                  </div>
                  <div className="cv-row cv-sub">
                    <em>
                      <Rich text={e.subtitle} />
                    </em>
                    <em>
                      <Rich text={e.subtitleRight} />
                    </em>
                  </div>
                  <Bullets items={e.bullets} />
                </div>
              ))}
            {s.type === "items" &&
              s.items.map((it) => (
                <div key={it.id} className="cv-entry">
                  <div className="cv-row">
                    <span className="cv-heading">
                      <Rich text={it.heading} />
                    </span>
                    <span className="cv-date">
                      <Rich text={it.date} />
                    </span>
                  </div>
                  <Bullets items={it.bullets} />
                </div>
              ))}
            {s.type === "skills" &&
              s.lines.map((l) => (
                <p key={l.label} className="cv-skill">
                  <strong>{l.label}</strong>:{" "}
                  {l.items.map((item, i) => (
                    <Fragment key={i}>
                      {i > 0 && ", "}
                      <Rich text={item} />
                    </Fragment>
                  ))}
                </p>
              ))}
            {s.type === "raw" && <p className="cv-skill">{plain(latexToRich(s.latex))}</p>}
          </div>
        </section>
      ))}
    </article>
  );
}
