import { Link, createFileRoute } from "@tanstack/react-router"

import { Button } from "@/components/ui/button"

export const Route = createFileRoute("/_protected/sites/$siteId")({
  component: SiteDetailPage,
})

function SiteDetailPage() {
  const { siteId } = Route.useParams()

  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">Site</h1>
        <p className="text-sm text-muted-foreground">{siteId}</p>
      </div>
      <div className="rounded-lg border bg-background p-6 text-sm text-muted-foreground">
        Site detail is ready for the next pass. The Sites table links here for
        row actions and direct navigation.
      </div>
      <Button asChild variant="outline" className="w-fit">
        <Link to="/sites">Back to sites</Link>
      </Button>
    </main>
  )
}
