import { Fragment } from "react";
import { Link } from "@tanstack/react-router";

/**
 * Markdown — a tiny, dependency-free renderer for TRUSTED staff-authored CMS
 * content (Stage 6 P4 policy pages).
 *
 * Renders to React elements (never dangerouslySetInnerHTML), so raw HTML in
 * the source stays inert text by construction. Supported subset — exactly what
 * the Prose-styled policy pages use:
 *
 *   ## / ### headings, paragraphs, - unordered / 1. ordered lists, ---,
 *   **bold**, *italic*, [label](/internal-or-https-url)
 *
 * Links: internal paths ("/faq") render as router <Link>; https URLs open in a
 * new tab with rel="noopener noreferrer"; any other protocol renders as plain
 * text. Unknown syntax degrades to plain paragraphs — the page never breaks.
 */

type Block =
  | { kind: "heading"; level: 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "hr" };

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push(
        list.ordered ? { kind: "ol", items: list.items } : { kind: "ul", items: list.items },
      );
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (trimmed === "") {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{2,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        kind: "heading",
        level: heading[1].length as 2 | 3,
        text: heading[2].trim(),
      });
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "hr" });
      continue;
    }

    const unordered = /^[-*]\s+(.*)$/.exec(trimmed);
    if (unordered) {
      flushParagraph();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(unordered[1].trim());
      continue;
    }

    const ordered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    if (ordered) {
      flushParagraph();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ordered[1].trim());
      continue;
    }

    // Continuation line: attach to the open list item, else to the paragraph.
    if (list) {
      list.items[list.items.length - 1] += ` ${trimmed}`;
    } else {
      paragraph.push(trimmed);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** Inline pass: **bold**, *italic*, [label](url). Everything else is text. */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const pattern = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const key = `${keyPrefix}-${i++}`;
    if (match[2] !== undefined) {
      out.push(<strong key={key}>{renderInline(match[2], key)}</strong>);
    } else if (match[4] !== undefined) {
      out.push(<em key={key}>{renderInline(match[4], key)}</em>);
    } else {
      const label = match[6];
      const url = match[7];
      if (url.startsWith("/")) {
        out.push(
          <Link key={key} to={url as never} className="text-primary underline underline-offset-2">
            {label}
          </Link>,
        );
      } else if (url.startsWith("https://")) {
        out.push(
          <a
            key={key}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2"
          >
            {label}
          </a>,
        );
      } else {
        // Unknown protocol (javascript:, data:, …) — render the label as text.
        out.push(label);
      }
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const blocks = parseBlocks(source);
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "heading":
            return block.level === 2 ? (
              <h2 key={i}>{renderInline(block.text, `h${i}`)}</h2>
            ) : (
              <h3 key={i} className="font-display text-lg text-foreground">
                {renderInline(block.text, `h${i}`)}
              </h3>
            );
          case "paragraph":
            return <p key={i}>{renderInline(block.text, `p${i}`)}</p>;
          case "ul":
            return (
              <ul key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item, `u${i}-${j}`)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={i} className="list-decimal space-y-1.5 pl-5">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item, `o${i}-${j}`)}</li>
                ))}
              </ol>
            );
          case "hr":
            return <Fragment key={i}>{<div className="ornament-divider mx-auto w-40" />}</Fragment>;
        }
      })}
    </>
  );
}
