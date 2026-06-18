import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_protected/home")({
  component: HomePage,
})

function HomePage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6">
      <h1 className="text-4xl font-semibold tracking-normal sm:text-5xl">
        Welcome to MSPByte
      </h1>
    </main>
  )
}
