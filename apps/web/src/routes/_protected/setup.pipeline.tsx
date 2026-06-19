import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_protected/setup/pipeline")({
  component: SetupPipelinePage,
})

function SetupPipelinePage() {
  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">Pipeline</h1>
        <p className="text-sm text-muted-foreground">
          Inspect ingestion, normalization, and projection settings.
        </p>
      </div>
    </main>
  )
}
