import { Button } from "@/components/base/buttons/button";
import { isLegalIdentityComplete } from "@/legal/entity.ts";
import { FOOTER_LINKS } from "@/legal/policy.ts";
import type { LegalBlock, LegalDocument } from "@/legal/document.ts";

export function LegalArticle({ document }: { document: LegalDocument }) {
  return (
    <article className="w-full max-w-3xl py-4 pb-10">
      <p className="text-sm font-semibold text-brand-secondary">Legal</p>
      <h1 className="mt-2 text-display-sm font-semibold tracking-tight text-primary">{document.title}</h1>
      <p className="mt-2 text-sm text-tertiary">
        Effective {document.effective} · Last updated {document.updated} · Version {document.version}
      </p>
      {!isLegalIdentityComplete() ? (
        <p className="mt-4 rounded-lg bg-warning-primary px-3.5 py-3 text-sm text-secondary ring-1 ring-warning-secondary" role="status">
          Draft. Legal entity, contacts, governing law, and Merchant of Record are still
          placeholders. This page describes current product behavior for engineering and counsel.
          It is not a substitute for legal advice and is not a public launch.
        </p>
      ) : null}
      <p className="mt-4 text-md leading-relaxed text-secondary">
        <strong className="font-semibold text-primary">The short version. </strong>
        {document.summary}
      </p>
      {document.counsel_note ? (
        <p className="mt-4 rounded-lg bg-secondary px-3.5 py-3 text-sm text-secondary ring-1 ring-secondary">
          {document.counsel_note}
        </p>
      ) : null}
      <nav className="mt-8 rounded-xl bg-primary_alt p-4 ring-1 ring-secondary" aria-label="On this page">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-secondary">
          {document.sections.map((section) => (
            <li key={section.id}>
              <a className="text-brand-secondary hover:text-brand-secondary_hover" href={`#${section.id}`}>
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {document.sections.map((section) => (
        <section key={section.id} id={section.id} className="mt-8">
          <h2 className="text-lg font-semibold text-primary">{section.title}</h2>
          <div className="mt-3 space-y-3">
            {section.blocks.map((block, index) => (
              <Block key={`${section.id}-${index}`} block={block} />
            ))}
          </div>
        </section>
      ))}
      <nav className="mt-10 flex flex-wrap gap-x-4 gap-y-2" aria-label="Other legal pages">
        {FOOTER_LINKS.map((link) => (
          <Button key={link.href} href={link.href} color="link-gray" size="sm">
            {link.label}
          </Button>
        ))}
        <Button href="/legal/data-residency" color="link-gray" size="sm">
          Data residency
        </Button>
      </nav>
    </article>
  );
}

function Block({ block }: { block: LegalBlock }) {
  if (block.type === "p") {
    return <p className="text-md leading-relaxed text-secondary">{block.text}</p>;
  }
  if (block.type === "ul") {
    return (
      <ul className="list-disc space-y-1.5 pl-5 text-md leading-relaxed text-secondary">
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-secondary">
      <table className="w-full text-left text-sm">
        <thead className="bg-secondary text-tertiary">
          <tr>
            {block.headers.map((header) => (
              <th key={header} className="px-3 py-2 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row) => (
            <tr key={row.join("|")} className="border-t border-secondary">
              {row.map((cell, index) => (
                <td key={`${row[0]}-${index}`} className="px-3 py-2 align-top text-secondary">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
