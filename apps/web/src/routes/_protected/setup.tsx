import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_protected/setup")({
  component: SetupPage,
})

function SetupPage() {
  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">Setup</h1>
        <p className="text-sm text-muted-foreground">
          Manage organization settings, integrations, users, and pipeline
          behavior.
        </p>
      </div>
    </main>
  )
}
