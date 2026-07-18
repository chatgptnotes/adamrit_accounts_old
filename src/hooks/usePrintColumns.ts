import { useState, useCallback, useEffect } from 'react';
import { ReportColumn, PrintSettings, UsePrintColumnsReturn } from '@/types/print';

const DEFAULT_SETTINGS: PrintSettings = {
  selectedColumnIds: [],
  orientation: 'portrait',
  pageSize: 'A4',
  showFilters: true,
  showDateTime: true,
  showPageNumbers: true,
};

/**
 * Custom hook for managing print column selection and settings
 * 
 * @param reportKey - Unique identifier for the report (used for localStorage)
 * @param allColumns - Array of all available columns for the report
 * @returns Object with state management functions and print utilities
 */
export const usePrintColumns = (
  reportKey: string,
  allColumns: ReportColumn[]
): UsePrintColumnsReturn => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [settings, setSettings] = useState<PrintSettings>(DEFAULT_SETTINGS);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  // Storage keys for persistence
  const STORAGE_KEY_COLUMNS = `printColumns_${reportKey}`;
  const STORAGE_KEY_SETTINGS = `printSettings_${reportKey}`;

  // Load saved selections from localStorage on mount
  useEffect(() => {
    try {
      const savedColumns = localStorage.getItem(STORAGE_KEY_COLUMNS);
      const savedSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);

      let columnsToUse: string[] = [];

      if (savedColumns) {
        const parsedColumns = JSON.parse(savedColumns);
        // Validate that saved columns still exist in current column set
        const validColumns = parsedColumns.filter((id: string) =>
          allColumns.some(col => col.id === id && col.printable)
        );
        columnsToUse = validColumns;
        setSelectedIds(validColumns);
        // CRITICAL: Sync to settings immediately
        setSettings(prev => ({ ...prev, selectedColumnIds: validColumns }));
      } else {
        // Default to meaningful columns for better initial experience
        // Priority order: sr_no, visit_id, patient_name, claim_id, billing_status, corporate
        const priorityColumnIds = ['sr_no', 'visit_id', 'patient_name', 'claim_id', 'billing_status', 'corporate'];
        const defaultColumns = priorityColumnIds
          .filter(id => allColumns.some(col => col.id === id && col.printable))
          .concat(
            allColumns
              .filter(col => col.printable && !priorityColumnIds.includes(col.id))
              .slice(0, Math.max(0, 8 - priorityColumnIds.length))
              .map(col => col.id)
          )
          .slice(0, 8); // Default to 8 columns for better coverage
        columnsToUse = defaultColumns;
        setSelectedIds(defaultColumns);
        // CRITICAL: Sync to settings immediately
        setSettings(prev => ({ ...prev, selectedColumnIds: defaultColumns }));
      }

      if (savedSettings) {
        const parsedSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) };
        // CRITICAL: Ensure selectedColumnIds matches the loaded columns
        setSettings({ ...parsedSettings, selectedColumnIds: columnsToUse });
      }
    } catch (error) {
      console.warn('Failed to load print preferences:', error);
      // Fallback to meaningful columns
      const priorityColumnIds = ['sr_no', 'visit_id', 'patient_name', 'claim_id', 'billing_status', 'corporate'];
      const defaultColumns = priorityColumnIds
        .filter(id => allColumns.some(col => col.id === id && col.printable))
        .concat(
          allColumns
            .filter(col => col.printable && !priorityColumnIds.includes(col.id))
            .slice(0, Math.max(0, 8 - priorityColumnIds.length))
            .map(col => col.id)
        )
        .slice(0, 8);
      setSelectedIds(defaultColumns);
      // CRITICAL: Sync to settings immediately
      setSettings(prev => ({ ...prev, selectedColumnIds: defaultColumns }));
    }
  }, [reportKey, allColumns, STORAGE_KEY_COLUMNS, STORAGE_KEY_SETTINGS]);

  // Save selections to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_COLUMNS, JSON.stringify(selectedIds));
    } catch (error) {
      console.warn('Failed to save column selection:', error);
    }
  }, [selectedIds, STORAGE_KEY_COLUMNS]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(settings));
    } catch (error) {
      console.warn('Failed to save print settings:', error);
    }
  }, [settings, STORAGE_KEY_SETTINGS]);

  const handleSetSelectedIds = useCallback((ids: string[]) => {
    // Validate that all provided IDs exist in printable columns
    const validIds = ids.filter(id =>
      allColumns.some(col => col.id === id && col.printable)
    );
    setSelectedIds(validIds);
    // CRITICAL: Sync selectedIds into settings.selectedColumnIds immediately
    setSettings(prev => ({ ...prev, selectedColumnIds: validIds }));
  }, [allColumns]);

  const handleSetSettings = useCallback((partialSettings: Partial<PrintSettings>) => {
    setSettings(prev => ({ ...prev, ...partialSettings }));
  }, []);

  const openPicker = useCallback(() => {
    setIsPickerOpen(true);
  }, []);

  const printSelected = useCallback(() => {
    if (selectedIds.length === 0) {
      console.warn('No columns selected for printing');
      return;
    }

    // Create print container and trigger print
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      console.error('Failed to open print window');
      return;
    }

    // Focus print window and trigger print dialog
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
  }, [selectedIds]);

  return {
    selectedIds,
    setSelectedIds: handleSetSelectedIds,
    settings,
    setSettings: handleSetSettings,
    openPicker,
    printSelected,
    isPickerOpen,
    setIsPickerOpen,
  };
};

/**
 * Utility function to get value from nested object using dot notation
 * @param obj - The object to extract value from
 * @param path - Dot notation path (e.g., 'patients.name')
 * @returns The value at the specified path or undefined
 */
export const getNestedValue = (obj: any, path: string): any => {
  if (!obj || !path) {
    return undefined;
  }
  
  const keys = path.split('.');
  let current = obj;
  
  for (const key of keys) {
    if (current == null) {
      return undefined;
    }
    current = current[key];
  }
  
  return current;
};

/**
 * Utility function to format cell value based on column configuration
 * @param value - Raw cell value
 * @param column - Column configuration
 * @returns Formatted string value
 */
export const formatCellValue = (value: any, column: ReportColumn, row?: any): string => {
  if (value === null || value === undefined) {
    return '—';
  }

  if (column.format) {
    return column.format(value, row);
  }

  // Default formatting based on value type
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (typeof value === 'number') {
    return value.toLocaleString();
  }

  if (value instanceof Date) {
    return value.toLocaleDateString();
  }

  return String(value);
};

/**
 * Utility function to clear all print preferences for a report
 * @param reportKey - The report key to clear preferences for
 */
export const clearPrintPreferences = (reportKey: string): void => {
  try {
    localStorage.removeItem(`printColumns_${reportKey}`);
    localStorage.removeItem(`printSettings_${reportKey}`);
  } catch (error) {
    console.warn('Failed to clear print preferences:', error);
  }
};
