import * as React from "react"
import { Check, ChevronDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type SingleSelectOption = {
  value: string
  label: string
  disabled?: boolean
}

export function SingleSelect({
  options,
  value,
  onValueChange,
  placeholder = "Select item...",
  searchPlaceholder = "Search...",
  className,
  disabled,
  onSearch,
  loading,
  disableSort,
}: {
  options: SingleSelectOption[]
  value?: string
  onValueChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  className?: string
  disabled?: boolean
  onSearch?: (query: string) => void
  loading?: boolean
  disableSort?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")

  React.useEffect(() => {
    if (!open) setSearch("")
  }, [open])

  React.useEffect(() => {
    onSearch?.(search)
  }, [onSearch, search])

  const filteredOptions = React.useMemo(() => {
    const sort = (items: SingleSelectOption[]) =>
      disableSort ? items : [...items].sort((a, b) => a.label.localeCompare(b.label))

    if (onSearch) return sort(options)

    const current = options.find((option) => option.value === value)
    const matches = sort(options).filter((option) =>
      option.label.toLowerCase().includes(search.toLowerCase()),
    )

    if (!current) return matches
    return [
      current,
      ...matches.filter((option) => option.value !== current.value),
    ]
  }, [disableSort, onSearch, options, search, value])

  const displayText =
    options.find((option) => option.value === value)?.label ?? placeholder

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between overflow-hidden", className)}
          disabled={disabled}
        >
          <span className="truncate">{displayText}</span>
          <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {loading ? "Loading..." : "No results found."}
            </CommandEmpty>
            <CommandGroup className="max-h-64 overflow-auto">
              {loading ? (
                <CommandItem disabled className="cursor-default opacity-50">
                  Loading...
                </CommandItem>
              ) : null}
              {filteredOptions.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  onSelect={() => {
                    if (option.disabled) return
                    onValueChange(value === option.value ? "" : option.value)
                    setOpen(false)
                  }}
                  className={cn(option.disabled && "cursor-not-allowed opacity-50")}
                >
                  <div
                    className={cn(
                      "mr-2 flex size-4 items-center justify-center rounded-full border border-primary",
                      value === option.value
                        ? "bg-primary text-primary-foreground"
                        : "opacity-50 [&_svg]:invisible",
                    )}
                  >
                    <Check className="size-4" />
                  </div>
                  <span>{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
