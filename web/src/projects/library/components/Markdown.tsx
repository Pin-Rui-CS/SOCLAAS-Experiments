"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Stored forecast files rendered as markdown. Duplicated from apiagent on
 * purpose — projects never import each other.
 *
 * No raw HTML plugin is enabled, so model output cannot inject markup — the
 * text is untrusted and treated as such.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        // Single tildes are "approximately" in forecasting text (~$200B … ~$0.8T), not
        // strikethrough; GFM's default struck out everything between two of them.
        remarkPlugins={[[remarkGfm, { singleTilde: false }]]}
        components={{
          code({ className, children, ...props }) {
            const isBlock = /language-/.test(className ?? "");
            if (isBlock) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code
                style={{
                  background: "var(--bg-hover)",
                  borderRadius: 4,
                  padding: "1px 5px",
                  fontSize: "0.9em",
                  fontFamily: "var(--font-mono)",
                }}
                {...props}
              >
                {children}
              </code>
            );
          },
          a({ children, ...props }) {
            return (
              <a
                {...props}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--accent)", textDecoration: "underline" }}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>

      <style>{`
        .md > :first-child { margin-top: 0; }
        .md > :last-child { margin-bottom: 0; }
        .md p, .md ul, .md ol, .md blockquote { margin: 0 0 12px; }
        .md ul, .md ol { padding-left: 22px; }
        .md li { margin: 3px 0; }
        .md h1, .md h2, .md h3, .md h4 {
          margin: 20px 0 8px; font-weight: 600; line-height: 1.3;
        }
        .md h1 { font-size: 1.35em; }
        .md h2 { font-size: 1.2em; }
        .md h3 { font-size: 1.05em; }
        .md pre {
          background: var(--bg-subtle);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 12px 14px;
          margin: 0 0 12px;
          overflow-x: auto;
        }
        .md pre code {
          font-family: var(--font-mono);
          font-size: 12.5px;
          line-height: 1.6;
          background: none;
          padding: 0;
        }
        .md blockquote {
          border-left: 3px solid var(--border-strong);
          padding-left: 12px;
          color: var(--text-muted);
        }
        /* Tables must scroll in their own box, never widen the page. */
        .md table {
          border-collapse: collapse;
          display: block;
          overflow-x: auto;
          max-width: 100%;
          margin: 0 0 12px;
        }
        .md th, .md td {
          border: 1px solid var(--border);
          padding: 6px 10px;
          text-align: left;
        }
        .md th { background: var(--bg-subtle); font-weight: 600; }
        .md hr { border: none; border-top: 1px solid var(--border); margin: 20px 0; }
      `}</style>
    </div>
  );
}
