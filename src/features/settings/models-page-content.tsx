import { Link } from '@tanstack/react-router'
import { ChevronLeft, Construction } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// Placeholder for the unified model-management screen (catalog browsing,
// per-provider enable/disable, custom slugs). The full UX is tracked under
// "Openrouter - selecting models" / "free models from open router" in
// docs/tasks.md.
export function ModelsPageContent() {
  return (
    <div className="p-6 md:p-10">
      <Link
        className="mb-4 inline-flex items-center gap-1 text-small font-medium text-ink-muted transition hover:text-ink"
        to="/settings/providers"
      >
        <ChevronLeft className="size-4" /> Back to providers
      </Link>

      <CardHeader className="px-0 pt-0">
        <Badge>Models</Badge>
        <CardTitle className="text-3xl">Manage models</CardTitle>
        <CardDescription className="max-w-3xl text-base">
          Browse, enable, and curate the models that show up in your composer
          picker — across every connected provider.
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-6 px-0 pb-0">
        <div className="rounded-md border border-dashed border-line bg-surface-muted px-6 py-10 text-center">
          <Construction className="mx-auto size-8 text-warn" />
          <p className="mt-4 text-body font-semibold text-ink">
            Coming soon
          </p>
          <p className="mx-auto mt-2 max-w-md text-small leading-6 text-ink-muted">
            The unified model catalog is on the roadmap. For now, your composer
            picker shows the bundled defaults of every connected provider.
          </p>
          <p className="mx-auto mt-4 max-w-md font-mono text-meta text-ink-dim">
            Tracked in <code>docs/tasks.md</code> under
            <span className="ml-1 text-ink-muted">
              &ldquo;Openrouter — selecting models&rdquo;
            </span>
            .
          </p>
        </div>
      </CardContent>
    </div>
  )
}
