import * as React from "react"
import { Check, ChevronsUpDown, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
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

export interface SearchableSelectOption {
  value: string
  label: string
  /**
   * Optional text shown in the trigger once this option is selected. When
   * omitted the full `label` is shown. Useful when the dropdown list should be
   * searchable by a rich label (e.g. "Name (code)") but the chosen value
   * should display compactly (e.g. just the code).
   */
  selectedLabel?: string
}

interface SearchableSelectProps {
  options: SearchableSelectOption[]
  value?: string
  onValueChange?: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  className?: string
  /**
   * When provided, typing a value that doesn't match any option shows an
   * "Add <value>" row. Selecting it calls onCreateOption with the typed text
   * so the caller can create the record and select it. Optional — when omitted
   * the component behaves as a plain select (existing behavior).
   */
  onCreateOption?: (label: string) => void | Promise<void>
  createOptionLabel?: (input: string) => string
  /** When true the control is read-only and cannot be opened or changed. */
  disabled?: boolean
}

export function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder = "Select option...",
  searchPlaceholder = "Search...",
  emptyText = "No option found.",
  className,
  onCreateOption,
  createOptionLabel = (input) => `Add "${input}"`,
  disabled = false,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")

  const selectedOption = options.find((option) => option.value === value)

  // Show a "create" row when the typed text matches no existing option label.
  const trimmedSearch = search.trim()
  const canCreate =
    !!onCreateOption &&
    trimmedSearch.length > 0 &&
    !options.some((o) => o.label.toLowerCase() === trimmedSearch.toLowerCase())

  // Filter options based on search
  const filteredOptions = React.useMemo(() => {
    if (!search) return options
    const searchLower = search.toLowerCase()
    return options.filter((option) =>
      option.label.toLowerCase().includes(searchLower) ||
      option.value.toLowerCase().includes(searchLower)
    )
  }, [options, search])

  return (
    <Popover open={open && !disabled} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between text-left", className)}
        >
          <span className="truncate">
            {selectedOption ? (selectedOption.selectedLabel ?? selectedOption.label) : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[400px] p-0 z-[9999]"
        align="start"
        side="bottom"
        sideOffset={4}
        collisionPadding={10}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            className="border-0"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList
            className="max-h-[300px] overflow-y-auto"
            style={{ maxHeight: '300px', overflowY: 'auto' }}
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
          >
            {filteredOptions.length === 0 && !canCreate ? (
              <div className="py-6 text-center text-sm text-muted-foreground">{emptyText}</div>
            ) : (
              <CommandGroup>
                {filteredOptions.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={() => {
                      onValueChange?.(option.value)
                      setSearch("")
                      setOpen(false)
                    }}
                    className="px-3 py-2 hover:bg-gray-100 cursor-pointer rounded-sm"
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === option.value ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {option.label}
                  </CommandItem>
                ))}
                {canCreate && (
                  <CommandItem
                    key="__create__"
                    value={`__create__${trimmedSearch}`}
                    onSelect={async () => {
                      const label = trimmedSearch
                      setSearch("")
                      setOpen(false)
                      await onCreateOption?.(label)
                    }}
                    className="px-3 py-2 hover:bg-gray-100 cursor-pointer rounded-sm text-blue-600 font-medium"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {createOptionLabel(trimmedSearch)}
                  </CommandItem>
                )}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
