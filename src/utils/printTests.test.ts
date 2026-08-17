/**
 * Tests for print column selection functionality
 */

import { getNestedValue, formatCellValue, clearPrintPreferences } from '@/hooks/usePrintColumns';
import { ReportColumn } from '@/types/print';
import { generateIPDFilterSummary } from '@/config/ipdPrintColumns';

// Mock localStorage
const localStorageMock = (() => {
  let store: { [key: string]: string } = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    }
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

describe('Print Utilities', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('getNestedValue', () => {
    const testObject = {
      name: 'John Doe',
      patient: {
        id: '123',
        details: {
          age: 45
        }
      },
      visits: [
        { date: '2024-01-01', type: 'consultation' }
      ]
    };

    test('should get simple property value', () => {
      expect(getNestedValue(testObject, 'name')).toBe('John Doe');
    });

    test('should get nested property value', () => {
      expect(getNestedValue(testObject, 'patient.id')).toBe('123');
    });

    test('should get deeply nested property value', () => {
      expect(getNestedValue(testObject, 'patient.details.age')).toBe(45);
    });

    test('should return undefined for non-existent property', () => {
      expect(getNestedValue(testObject, 'nonExistent')).toBeUndefined();
    });

    test('should return undefined for nested non-existent property', () => {
      expect(getNestedValue(testObject, 'patient.nonExistent.value')).toBeUndefined();
    });

    test('should handle null/undefined object gracefully', () => {
      expect(getNestedValue(null, 'property')).toBeUndefined();
      expect(getNestedValue(undefined, 'property')).toBeUndefined();
    });
  });

  describe('formatCellValue', () => {
    const mockColumn: ReportColumn = {
      id: 'test',
      label: 'Test Column',
      accessorKey: 'test',
      printable: true
    };

    test('should format null and undefined as em dash', () => {
      expect(formatCellValue(null, mockColumn)).toBe('—');
      expect(formatCellValue(undefined, mockColumn)).toBe('—');
    });

    test('should format boolean values', () => {
      expect(formatCellValue(true, mockColumn)).toBe('Yes');
      expect(formatCellValue(false, mockColumn)).toBe('No');
    });

    test('should format numbers with locale string', () => {
      expect(formatCellValue(1234.56, mockColumn)).toBe('1,234.56');
      expect(formatCellValue(1000000, mockColumn)).toBe('1,000,000');
    });

    test('should format dates', () => {
      const date = new Date('2024-01-01');
      const formatted = formatCellValue(date, mockColumn);
      expect(formatted).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/); // Basic date format check
    });

    test('should use custom formatter if provided', () => {
      const columnWithFormatter: ReportColumn = {
        ...mockColumn,
        format: (value) => `Custom: ${value}`
      };
      expect(formatCellValue('test', columnWithFormatter)).toBe('Custom: test');
    });

    test('should convert other values to string', () => {
      expect(formatCellValue('Hello World', mockColumn)).toBe('Hello World');
      expect(formatCellValue(123, mockColumn)).toBe('123');
      expect(formatCellValue(1234, mockColumn)).toBe('1,234'); // grouped above 999
    });
  });

  describe('localStorage persistence', () => {
    const reportKey = 'test-report';
    const columnIds = ['col1', 'col2', 'col3'];

    test('should save and retrieve column selection', () => {
      const storageKey = `printColumns_${reportKey}`;
      localStorage.setItem(storageKey, JSON.stringify(columnIds));
      
      const retrieved = JSON.parse(localStorage.getItem(storageKey) || '[]');
      expect(retrieved).toEqual(columnIds);
    });

    test('should clear print preferences', () => {
      const columnKey = `printColumns_${reportKey}`;
      const settingsKey = `printSettings_${reportKey}`;
      
      localStorage.setItem(columnKey, JSON.stringify(columnIds));
      localStorage.setItem(settingsKey, JSON.stringify({ orientation: 'landscape' }));
      
      clearPrintPreferences(reportKey);
      
      expect(localStorage.getItem(columnKey)).toBeNull();
      expect(localStorage.getItem(settingsKey)).toBeNull();
    });
  });

  describe('generateIPDFilterSummary', () => {
    test('should generate empty summary for no filters', () => {
      const summary = generateIPDFilterSummary({});
      expect(Object.keys(summary)).toHaveLength(0);
    });

    test('should include search term', () => {
      const filters = { searchTerm: 'John Doe' };
      const summary = generateIPDFilterSummary(filters);
      expect(summary.Search).toBe('John Doe');
    });

    test('should include billing executive filter', () => {
      const filters = { billingExecutiveFilter: 'Dr. Smith' };
      const summary = generateIPDFilterSummary(filters);
      expect(summary['Billing Executive']).toBe('Dr. Smith');
    });

    test('should include array filters', () => {
      const filters = {
        fileStatusFilter: ['available', 'missing'],
        condonationSubmissionFilter: ['present']
      };
      const summary = generateIPDFilterSummary(filters);
      expect(summary['File Status']).toBe('available, missing');
      expect(summary['Condonation Submission']).toBe('present');
    });

    test('should ignore empty strings and arrays', () => {
      const filters = {
        searchTerm: '',
        billingExecutiveFilter: '',
        fileStatusFilter: [],
        condonationSubmissionFilter: ['present']
      };
      const summary = generateIPDFilterSummary(filters);
      expect(summary.Search).toBeUndefined();
      expect(summary['Billing Executive']).toBeUndefined();
      expect(summary['File Status']).toBeUndefined();
      expect(summary['Condonation Submission']).toBe('present');
    });

    test('should handle complex filter combinations', () => {
      const filters = {
        searchTerm: 'test patient',
        billingExecutiveFilter: 'Dr. Brown',
        billingStatusFilter: 'Completed',
        bunchFilter: 'Batch 1',
        daysAdmittedFilter: '7-10',
        fileStatusFilter: ['available'],
        extensionOfStayFilter: ['taken', 'not_taken']
      };
      const summary = generateIPDFilterSummary(filters);
      
      expect(summary.Search).toBe('test patient');
      expect(summary['Billing Executive']).toBe('Dr. Brown');
      expect(summary['Billing Status']).toBe('Completed');
      expect(summary.Bunch).toBe('Batch 1');
      expect(summary['Days Admitted']).toBe('7-10');
      expect(summary['File Status']).toBe('available');
      expect(summary['Extension of Stay']).toBe('taken, not_taken');
    });
  });
});

// Integration test for print workflow
describe('Print Workflow Integration', () => {
  test('should handle complete print column selection workflow', () => {
    const reportKey = 'integration-test';
    const allColumns: ReportColumn[] = [
      { id: 'name', label: 'Name', accessorKey: 'name', printable: true },
      { id: 'age', label: 'Age', accessorKey: 'age', printable: true },
      { id: 'internal', label: 'Internal', accessorKey: 'internal', printable: false }
    ];
    
    // Simulate selecting printable columns
    const printableColumns = allColumns.filter(col => col.printable);
    const selectedIds = printableColumns.map(col => col.id);
    
    // Simulate saving to localStorage
    localStorage.setItem(`printColumns_${reportKey}`, JSON.stringify(selectedIds));
    
    // Simulate retrieving from localStorage
    const saved = JSON.parse(localStorage.getItem(`printColumns_${reportKey}`) || '[]');
    
    // Validate only printable columns are included
    const validIds = saved.filter((id: string) =>
      allColumns.some(col => col.id === id && col.printable)
    );
    
    expect(validIds).toEqual(['name', 'age']);
    expect(validIds).not.toContain('internal');
  });

  test('should format data correctly for print', () => {
    const columns: ReportColumn[] = [
      { 
        id: 'name', 
        label: 'Patient Name', 
        accessorKey: 'patient.name', 
        printable: true 
      },
      { 
        id: 'amount', 
        label: 'Amount', 
        accessorKey: 'bill.amount', 
        printable: true,
        format: (value) => `₹${value?.toLocaleString() || '0'}`
      }
    ];
    
    const sampleData = [
      {
        patient: { name: 'John Doe' },
        bill: { amount: 15000 }
      },
      {
        patient: { name: 'Jane Smith' },
        bill: { amount: null }
      }
    ];
    
    // Simulate formatting data for print
    const formattedData = sampleData.map(row => {
      const formattedRow: any = {};
      columns.forEach(col => {
        const rawValue = getNestedValue(row, col.accessorKey);
        formattedRow[col.id] = formatCellValue(rawValue, col);
      });
      return formattedRow;
    });
    
    expect(formattedData[0].name).toBe('John Doe');
    expect(formattedData[0].amount).toBe('₹15,000');
    expect(formattedData[1].name).toBe('Jane Smith');

    // A null cell prints the em dash and never reaches column.format, so the
    // formatter's own `|| '0'` fallback is dead code. Printed money columns
    // therefore show "—" for a missing amount, not "₹0". Recorded here as the
    // behaviour today — if "₹0" is what the bills should read, formatCellValue
    // must move its null check below the column.format branch, which changes
    // every print report in the app and wants deciding on its own.
    expect(formattedData[1].amount).toBe('—');
  });
});