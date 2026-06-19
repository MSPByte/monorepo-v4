import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_protected/setup/integrations")({
  component: SetupIntegrationsPage,
})

function SetupIntegrationsPage() {
  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          Configure vendor connections and site linking.
        </p>
      </div>
    </main>
  )
}
