import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { createFileRoute, Link } from "@tanstack/react-router"
import { LayoutDashboard, Plug, Settings, Zap } from "lucide-react"

const features = [
  {
    icon: Plug,
    title: "Integration Hub",
    description:
      "Connect Microsoft 365, RMM, PSA, and more from a single dashboard.",
  },
  {
    icon: LayoutDashboard,
    title: "Configuration Tracking",
    description:
      "See the current configuration state of every integration across clients.",
  },
  {
    icon: Zap,
    title: "Workflow Automation",
    description:
      "Automate repetitive configuration work so changes roll out consistently.",
  },
  {
    icon: Settings,
    title: "Multi-Tenant Management",
    description:
      "Manage settings and integration configs per client site with clear access.",
  },
]

export const Route = createFileRoute("/")({ component: LandingPage })

function LandingPage() {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <nav className="sticky top-0 z-10 flex h-14 min-h-14 w-full items-center justify-between border-b bg-background/80 px-6 backdrop-blur-sm">
        <span className="text-lg font-semibold tracking-tight">MSPByte</span>
        <Button asChild>
          <Link to="/auth/login" search={{ error: undefined }}>
            Sign In
          </Link>
        </Button>
      </nav>

      <main className="flex flex-1 flex-col">
        <section className="flex flex-col items-center justify-center gap-6 px-6 py-24 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary">
            MSP Management Platform
          </div>
          <h1 className="max-w-2xl text-4xl font-bold tracking-normal sm:text-5xl">
            Keep your integrations configured and consistent
          </h1>
          <p className="max-w-xl text-lg text-muted-foreground">
            MSPByte connects to your Microsoft 365, RMM, PSA, and other tools
            so you can track and manage their configuration across every client
            from one place.
          </p>
          <Button asChild size="lg">
            <Link to="/auth/login" search={{ error: undefined }}>
              Get Started
            </Link>
          </Button>
        </section>

        <section className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 px-6 pb-24 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <Card key={feature.title} className="rounded-lg bg-card/50">
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex size-9 items-center justify-center rounded-md bg-primary/10">
                  <feature.icon className="size-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{feature.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {feature.description}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      </main>

      <footer className="border-t py-6 text-center text-sm text-muted-foreground">
        &copy; {new Date().getFullYear()} MSPByte. All rights reserved.
      </footer>
    </div>
  )
}
