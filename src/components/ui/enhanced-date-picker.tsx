import * as React from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface EnhancedDatePickerProps {
  value?: Date;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  label?: string;
  className?: string;
  isDOB?: boolean; // Special handling for Date of Birth
  disabled?: boolean; // Add disabled prop support
  defaultOpen?: boolean; // Open the calendar immediately on mount
  openRequest?: number; // Increment to open the calendar from an external shortcut
  buttonClassName?: string;
  calendarButtonClassName?: string;
  manualInput?: boolean;
}

type ViewMode = 'year' | 'month' | 'day';

export const EnhancedDatePicker: React.FC<EnhancedDatePickerProps> = ({
  value,
  onChange,
  placeholder = "Select date",
  label,
  className,
  isDOB = false,
  disabled = false,
  defaultOpen = false,
  openRequest,
  buttonClassName,
  calendarButtonClassName,
  manualInput = false,
}) => {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);
  const [manualValue, setManualValue] = React.useState(value ? format(value, 'dd/MM/yyyy') : '');
  const [viewMode, setViewMode] = React.useState<ViewMode>(isDOB ? 'year' : 'day');
  const [selectedYear, setSelectedYear] = React.useState<number>(value?.getFullYear() || (isDOB ? 1990 : new Date().getFullYear()));
  const [selectedMonth, setSelectedMonth] = React.useState<number>(value?.getMonth() || 0);
  const [yearInput, setYearInput] = React.useState<string>('');
  const previousOpenRequest = React.useRef(openRequest);

  // Update internal state when value prop changes
  React.useEffect(() => {
    if (value) {
      setSelectedYear(value.getFullYear());
      setSelectedMonth(value.getMonth());
      setManualValue(format(value, 'dd/MM/yyyy'));
    }
  }, [value]);

  React.useEffect(() => {
    if (openRequest !== undefined && previousOpenRequest.current !== openRequest) {
      setIsOpen(true);
    }
    previousOpenRequest.current = openRequest;
  }, [openRequest]);

  // Generate year range (1900 to current year + 10)
  const currentYear = new Date().getFullYear();
  const startYear = 1900;
  const endYear = currentYear + 10;
  // For DOB, show years in descending order (recent first), for other dates show ascending
  const years = Array.from({ length: endYear - startYear + 1 }, (_, i) => startYear + i);
  if (isDOB) {
    years.reverse(); // Most recent years first for DOB
  }

  // Generate months
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Generate days for selected month/year
  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const handleYearSelect = (year: number) => {
    setSelectedYear(year);
    setViewMode('month');
  };

  const handleMonthSelect = (month: number) => {
    setSelectedMonth(month);
    setViewMode('day');
  };

  const handleDaySelect = (day: number) => {
    const newDate = new Date(selectedYear, selectedMonth, day);
    onChange(newDate);
    setIsOpen(false);
    setViewMode(isDOB ? 'year' : 'day');
  };

  const commitManualValue = () => {
    const match = manualValue.trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
    const resetToValue = () => setManualValue(value ? format(value, 'dd/MM/yyyy') : '');
    if (!match) {
      resetToValue();
      return;
    }
    const day = Number(match[1]);
    const month = Number(match[2]) - 1;
    const year = Number(match[3]);
    const next = new Date(year, month, day);
    if (next.getFullYear() !== year || next.getMonth() !== month || next.getDate() !== day) {
      resetToValue();
      return;
    }
    onChange(next);
    setSelectedYear(year);
    setSelectedMonth(month);
  };

  const handleYearInputSubmit = () => {
    const year = parseInt(yearInput);
    if (year >= startYear && year <= endYear) {
      handleYearSelect(year);
      setYearInput('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleYearInputSubmit();
    }
  };

  const renderYearView = () => (
    <div className="p-4 space-y-4">
      <div className="flex flex-col space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{isDOB ? 'Select Birth Year' : 'Select Year'}</h3>
          <div className="flex items-center gap-2">
          <Input
            type="number"
            placeholder="Type year"
            value={yearInput}
            onChange={(e) => setYearInput(e.target.value)}
            onKeyPress={handleKeyPress}
            className="w-24 h-8 text-sm"
            min={startYear}
            max={endYear}
          />
          <Button
            size="sm"
            onClick={handleYearInputSubmit}
            disabled={!yearInput}
            className="h-8 px-2"
          >
            Go
          </Button>
          </div>
        </div>
        {isDOB && <p className="text-xs text-muted-foreground">Step 1 of 3: Choose year, then month, then day</p>}
      </div>
      
      <div className="grid grid-cols-4 gap-2 max-h-64 overflow-y-auto">
        {years.map((year) => (
          <Button
            key={year}
            variant={year === selectedYear ? "default" : "outline"}
            size="sm"
            onClick={() => handleYearSelect(year)}
            className="h-8 text-xs"
          >
            {year}
          </Button>
        ))}
      </div>
    </div>
  );

  const renderMonthView = () => (
    <div className="p-4 space-y-4">
      <div className="flex flex-col space-y-2">
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setViewMode('year')}
            className="flex items-center gap-1"
          >
            <ChevronLeft className="h-4 w-4" />
            {selectedYear}
          </Button>
          <h3 className="font-semibold">Select Month</h3>
        </div>
        {isDOB && <p className="text-xs text-muted-foreground">Step 2 of 3: Choose month</p>}
      </div>
      
      <div className="grid grid-cols-3 gap-2">
        {months.map((month, index) => (
          <Button
            key={month}
            variant={index === selectedMonth ? "default" : "outline"}
            size="sm"
            onClick={() => handleMonthSelect(index)}
            className="h-10 text-xs"
          >
            {month.slice(0, 3)}
          </Button>
        ))}
      </div>
    </div>
  );

  const renderDayView = () => {
    const daysInMonth = getDaysInMonth(selectedYear, selectedMonth);
    const firstDayOfMonth = new Date(selectedYear, selectedMonth, 1).getDay();
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const emptyDays = Array.from({ length: firstDayOfMonth }, (_, i) => null);

    // Add trailing empty cells to complete the last row (fixes 31st day click issue)
    const totalCells = emptyDays.length + days.length;
    const remainingCells = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    const trailingEmptyDays = Array.from({ length: remainingCells }, (_, i) => null);

    return (
      <div className="p-4 space-y-4">
        <div className="flex flex-col space-y-2">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setViewMode('month')}
              className="flex items-center gap-1"
            >
              <ChevronLeft className="h-4 w-4" />
              {months[selectedMonth]} {selectedYear}
            </Button>
            <h3 className="font-semibold">Select Day</h3>
          </div>
          {isDOB && <p className="text-xs text-muted-foreground">Step 3 of 3: Choose day</p>}
        </div>
        
        <div className="space-y-1">
          {/* Header row - separate grid */}
          <div className="grid grid-cols-7 gap-1 text-center">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((dayName) => (
              <div key={dayName} className="h-8 flex items-center justify-center text-xs font-medium text-muted-foreground">
                {dayName}
              </div>
            ))}
          </div>

          {/* Days grid - separate from header */}
          <div className="grid grid-cols-7 gap-1 text-center">
            {[...emptyDays, ...days, ...trailingEmptyDays].map((day, index) => (
              <div key={index} className="h-8 flex items-center justify-center">
                {day !== null && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleDaySelect(day);
                    }}
                    className={cn(
                      "h-7 w-7 rounded-md text-xs font-medium transition-colors cursor-pointer",
                      "hover:bg-accent hover:text-accent-foreground",
                      "focus:outline-none focus:ring-2 focus:ring-ring",
                      value &&
                      value.getDate() === day &&
                      value.getMonth() === selectedMonth &&
                      value.getFullYear() === selectedYear
                        ? "bg-primary text-primary-foreground"
                        : "bg-transparent"
                    )}
                  >
                    {day}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const getCurrentView = () => {
    switch (viewMode) {
      case 'year':
        return renderYearView();
      case 'month':
        return renderMonthView();
      case 'day':
        return renderDayView();
      default:
        return renderDayView();
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      {label && <label className="text-sm font-medium">{label}</label>}
      <Popover open={isOpen && !disabled} onOpenChange={setIsOpen}>
        {manualInput ? (
          <div className="flex items-center gap-1">
            <Input
              value={manualValue}
              placeholder={placeholder}
              disabled={disabled}
              onChange={(event) => setManualValue(event.target.value)}
              onBlur={commitManualValue}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitManualValue();
                }
              }}
              className={cn('h-10 min-w-0 flex-1 text-left font-normal', buttonClassName)}
            />
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                disabled={disabled}
                aria-label="Open calendar"
                className={cn('h-10 w-9 shrink-0 px-0', calendarButtonClassName)}
              >
                <CalendarIcon className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
          </div>
        ) : (
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "h-10 w-full justify-start text-left font-normal",
                !value && "text-muted-foreground",
                disabled && "opacity-50 cursor-not-allowed",
                buttonClassName,
              )}
              disabled={disabled}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {value ? format(value, "dd/MM/yyyy") : <span>{placeholder}</span>}
            </Button>
          </PopoverTrigger>
        )}
        <PopoverContent
          className="w-auto p-0 z-[9999] bg-white border-2 border-gray-400"
          align="start"
          avoidCollisions={false}
          side="bottom"
          sideOffset={5}
        >
          {getCurrentView()}
        </PopoverContent>
      </Popover>
    </div>
  );
};
