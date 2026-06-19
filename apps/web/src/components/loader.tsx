import { LoaderCircle } from "lucide-react"

export function Loader({
  size = 48,
  children,
}: {
  size?: number
  children?: React.ReactNode
}) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-3">
      <LoaderCircle
        className="animate-spin text-muted-foreground"
        size={size}
      />
      {children}
    </div>
  )
}
