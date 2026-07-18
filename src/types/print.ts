/**
 * Print Column Selection System
 * 
 * How to add to a new report:
 * 1. Define your columns with the ReportColumn type
 * 2. Use the usePrintColumns hook with a unique reportKey
 * 3. Add a Print button that calls openPicker()
 * 4. Use the PrintContainer component for the print view
 * 
 * Example:
 * ```typescript
 * const columns: ReportColumn[] = [
 *   { id: 'name', label: 'Patient Name', accessorKey: 'patients.name', printable: true, widthPx: 200 },
 *   { id: 'visit_id', label: 'Visit ID', accessorKey: 'visit_id', printable: true, widthPx: 120 }
 * ];
 * 
 * const { selectedIds, openPicker, printSelected } = usePrintColumns('ipd-dashboard', columns);
 * ```
 */

export type ReportColumn = {
  id: string;
  label: string;
  accessorKey: string;
  printable: boolean;
  widthPx?: number;
  align?: 'left' | 'center' | 'right';
  format?: (value: any, row?: any) => string;
};

export type PrintPreset = {
  id: string;
  label: string;
  columnIds: string[];
};

export type PrintSettings = {
  selectedColumnIds: string[];
  orientation: 'portrait' | 'landscape';
  pageSize: 'A4' | 'Letter';
  showFilters: boolean;
  showDateTime: boolean;
  showPageNumbers: boolean;
};

export type PrintModalProps = {
  isOpen: boolean;
  columns: ReportColumn[];
  selectedIds: string[];
  presets: PrintPreset[];
  settings: PrintSettings;
  onSelectedIdsChange: (ids: string[]) => void;
  onSettingsChange: (settings: Partial<PrintSettings>) => void;
  onClose: () => void;
  onConfirm: () => void;
  onPreview: () => void;
};

export type PrintContainerProps = {
  reportTitle: string;
  columns: ReportColumn[];
  data: any[];
  settings: PrintSettings;
  appliedFilters?: Record<string, any>;
  onPrintComplete?: () => void;
};

export type UsePrintColumnsReturn = {
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  settings: PrintSettings;
  setSettings: (settings: Partial<PrintSettings>) => void;
  openPicker: () => void;
  printSelected: () => void;
  isPickerOpen: boolean;
  setIsPickerOpen: (open: boolean) => void;
};

export type PrintableData = {
  [key: string]: any;
};
