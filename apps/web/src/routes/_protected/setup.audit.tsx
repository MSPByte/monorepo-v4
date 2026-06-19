import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_protected/setup/audit")({
  component: SetupAuditPage,
})

function SetupAuditPage() {
  return (
    <main className="flex flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">Audit</h1>
        <p className="text-sm text-muted-foreground">
          Review configuration changes and operational history.
        </p>
      </div>
    </main>
  )
}
