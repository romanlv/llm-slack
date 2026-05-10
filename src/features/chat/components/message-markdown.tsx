import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const components: Components = {
  p: (props) => <p className="whitespace-pre-wrap" {...props} />,
  h1: (props) => <h2 className="mt-2 text-heading font-bold tracking-tight first:mt-0" {...props} />,
  h2: (props) => (
    <h3 className="mt-2 text-heading font-bold tracking-tight first:mt-0" {...props} />
  ),
  h3: (props) => (
    <h4 className="mt-2 text-heading font-semibold tracking-tight first:mt-0" {...props} />
  ),
  h4: (props) => <h5 className="mt-2 text-body font-semibold first:mt-0" {...props} />,
  h5: (props) => <h6 className="mt-2 text-body font-semibold first:mt-0" {...props} />,
  h6: (props) => <p className="mt-2 text-body font-semibold first:mt-0" {...props} />,
  ul: (props) => <ul className="list-disc space-y-0.5 pl-5" {...props} />,
  ol: (props) => <ol className="list-decimal space-y-0.5 pl-5" {...props} />,
  li: (props) => <li className="marker:text-ink-dim" {...props} />,
  a: (props) => (
    <a
      className="text-accent underline underline-offset-2 hover:opacity-80"
      rel="noreferrer noopener"
      target="_blank"
      {...props}
    />
  ),
  blockquote: (props) => (
    <blockquote className="border-l-2 border-line-strong pl-3 italic text-ink-muted" {...props} />
  ),
  hr: (props) => <hr className="my-3 border-line" {...props} />,
  strong: (props) => <strong className="font-semibold" {...props} />,
  em: (props) => <em className="italic" {...props} />,
  del: (props) => <del className="text-ink-muted line-through" {...props} />,
  // Inline code lacks a `language-X` class; only fenced blocks have one.
  code: ({ className, ...props }) =>
    className?.includes('language-') ? (
      <code className={className} {...props} />
    ) : (
      <code
        className="rounded-xs bg-surface-muted px-1 py-0.5 font-mono text-[12px]"
        {...props}
      />
    ),
  pre: (props) => (
    <pre
      className="overflow-x-auto rounded-sm border border-line bg-surface-muted p-2 font-mono text-[12px] leading-relaxed"
      {...props}
    />
  ),
  table: (props) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left" {...props} />
    </div>
  ),
  th: (props) => <th className="border border-line px-2 py-1 font-semibold" {...props} />,
  td: (props) => <td className="border border-line px-2 py-1 align-top" {...props} />,
}

export const MessageMarkdown = memo(function MessageMarkdown({
  content,
}: {
  content: string
}) {
  return (
    <div className="min-w-0 max-w-full space-y-1.5 overflow-hidden break-words text-body [overflow-wrap:anywhere]">
      <ReactMarkdown components={components} remarkPlugins={[remarkGfm]} skipHtml>
        {content}
      </ReactMarkdown>
    </div>
  )
})
