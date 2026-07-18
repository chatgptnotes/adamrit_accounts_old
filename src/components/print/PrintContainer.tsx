import React, { useEffect } from 'react';
import { format } from 'date-fns';
import { PrintContainerProps } from '@/types/print';
import { getNestedValue, formatCellValue } from '@/hooks/usePrintColumns';

export const PrintContainer: React.FC<PrintContainerProps> = ({
  reportTitle,
  columns,
  data,
  settings,
  appliedFilters,
  onPrintComplete
}) => {
  const selectedColumns = columns.filter(col =>
    settings.selectedColumnIds.includes(col.id)
  );

  // Fallback to first 5 printable columns if none selected
  const columnsToDisplay = selectedColumns.length > 0
    ? selectedColumns
    : columns.filter(col => col.printable).slice(0, 5);

  // Inject styles into document HEAD to prevent them from appearing in print output
  useEffect(() => {
    const styleId = 'print-container-dynamic-styles';
    let styleElement = document.getElementById(styleId) as HTMLStyleElement;

    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = styleId;
      document.head.appendChild(styleElement);
    }

    // Inject all print styles into HEAD - OPTIMIZED FOR SINGLE PAGE
    styleElement.textContent = `
      .print-container {
        font-family: 'Arial', sans-serif;
        font-size: 14px;
        line-height: 1.1;
        color: #000;
        background: #fff;
        margin: 0 !important;
        padding: 0 !important;
        width: 100% !important;
        max-width: 100% !important;
        position: relative !important;
        left: 0 !important;
        right: 0 !important;
        text-align: left !important;
        page-break-before: avoid !important;
        page-break-after: avoid !important;
        page-break-inside: avoid !important;
      }

      .print-header {
        display: none !important;
        height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        position: absolute !important;
        visibility: hidden !important;
        border: none !important;
      }

      .report-title,
      .report-title h1 {
        display: none !important;
        height: 0 !important;
        margin: 0 !important;
      }

      .report-date {
        display: none !important;
        height: 0 !important;
        margin: 0 !important;
      }

      .filters-summary {
        display: none !important;
        height: 0 !important;
        min-height: 0 !important;
        max-height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        position: absolute !important;
        visibility: hidden !important;
        line-height: 0 !important;
        font-size: 0 !important;
        opacity: 0 !important;
      }

      .filters-summary *,
      .filters-summary h3,
      .filters-summary p {
        display: none !important;
        height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        line-height: 0 !important;
        font-size: 0 !important;
      }

      .report-stats {
        display: none !important;
        height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        position: absolute !important;
        visibility: hidden !important;
      }

      .report-stats p {
        display: none !important;
      }

      .print-table-container {
        width: 100% !important;
        max-width: 100% !important;
        overflow: visible;
        page-break-before: avoid;
        margin: 0 !important;
        margin-top: 0 !important;
        padding: 0 !important;
        padding-top: 0 !important;
        position: relative !important;
        top: 0 !important;
        display: block !important;
        text-align: left !important;
      }

      /* CRITICAL: Force proper table display - highest priority */
      table.print-table,
      .print-table {
        width: 100% !important;
        border-collapse: collapse !important;
        margin: 0 !important;
        margin-top: 0 !important;
        margin-left: 0 !important;
        margin-right: auto !important;
        font-size: 14px !important;
        display: table !important;
        table-layout: fixed !important;
      }

      table.print-table thead,
      .print-table thead {
        display: table-header-group !important;
      }

      table.print-table tbody,
      .print-table tbody {
        display: table-row-group !important;
      }

      table.print-table tr,
      .print-table tr {
        display: table-row !important;
      }

      table.print-table th,
      table.print-table td,
      .print-th,
      .print-td {
        display: table-cell !important;
      }

      .print-th {
        background-color: #f0f0f0;
        border: 1px solid #000;
        padding: 6px 5px;
        font-weight: bold;
        font-size: 15px;
        vertical-align: middle;
        page-break-inside: avoid;
        text-align: left;
        line-height: 1.1;
      }

      .print-th.center {
        text-align: center;
      }

      .print-th.right {
        text-align: right;
      }

      .print-header-content {
        word-wrap: break-word;
        hyphens: auto;
        line-height: 1.15;
      }

      .print-td {
        border: 1px solid #000;
        padding: 5px 4px;
        vertical-align: top;
        font-size: 14px;
        page-break-inside: avoid;
        text-align: left;
        line-height: 1.1;
      }

      .print-td.center {
        text-align: center;
      }

      .print-td.right {
        text-align: right;
      }

      .print-cell-content {
        word-wrap: break-word;
        hyphens: auto;
        line-height: 1.15;
        max-width: 100%;
      }

      .print-tr {
        page-break-inside: avoid;
      }

      .print-footer {
        display: none !important;
        height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        visibility: hidden !important;
      }

      .page-info {
        display: none !important;
      }

      .report-footer {
        display: none !important;
      }

      @media print {
        [data-print-content="true"] {
          display: block !important;
          visibility: visible !important;
          position: relative !important;
          width: 100% !important;
          max-width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
          left: 0 !important;
          right: 0 !important;
        }

        /* FORCE HIDE header completely */
        .print-header {
          display: none !important;
          height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          overflow: hidden !important;
          position: absolute !important;
          visibility: hidden !important;
          border: none !important;
        }

        .report-title,
        .report-title h1,
        .report-date {
          display: none !important;
          height: 0 !important;
        }

        .print-table-container {
          page-break-before: avoid !important;
          margin: 0 !important;
          margin-top: 0 !important;
          padding: 0 !important;
          padding-top: 0 !important;
          width: 100% !important;
          max-width: 100% !important;
          display: block !important;
          text-align: left !important;
          position: relative !important;
          top: 0 !important;
        }

        /* FORCE HIDE filters and stats */
        .filters-summary,
        .report-stats {
          display: none !important;
          height: 0 !important;
          min-height: 0 !important;
          max-height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          position: absolute !important;
          visibility: hidden !important;
          overflow: hidden !important;
          line-height: 0 !important;
          font-size: 0 !important;
          opacity: 0 !important;
        }

        .filters-summary *,
        .report-stats * {
          display: none !important;
          height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          line-height: 0 !important;
          font-size: 0 !important;
        }

        /* FORCE HIDE footer */
        .print-footer {
          display: none !important;
          height: 0 !important;
          margin: 0 !important;
        }

        /* CRITICAL: Force table display in print mode - MAXIMUM PRIORITY */
        table.print-table,
        .print-table,
        [data-print-content="true"] table {
          display: table !important;
          width: 100% !important;
          border-collapse: collapse !important;
          margin: 0 !important;
          margin-top: 0 !important;
          margin-left: 0 !important;
          margin-right: auto !important;
          page-break-before: avoid !important;
          page-break-after: avoid !important;
          page-break-inside: auto !important;
        }

        table.print-table thead,
        .print-table thead,
        [data-print-content="true"] thead {
          display: table-header-group !important;
        }

        table.print-table tbody,
        .print-table tbody,
        [data-print-content="true"] tbody {
          display: table-row-group !important;
        }

        table.print-table tr,
        .print-table tr,
        [data-print-content="true"] tr {
          display: table-row !important;
        }

        table.print-table th,
        table.print-table td,
        .print-th,
        .print-td,
        [data-print-content="true"] th,
        [data-print-content="true"] td {
          display: table-cell !important;
          border: 1px solid #000 !important;
        }

        /* Preserve table header background color */
        table.print-table th,
        .print-th,
        [data-print-content="true"] th {
          background-color: #f5f5f5 !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }

        body {
          margin: 0 !important;
          padding: 0 !important;
          width: 100% !important;
          page-break-before: avoid !important;
          page-break-after: avoid !important;
          page-break-inside: avoid !important;
        }

        html {
          margin: 0 !important;
          padding: 0 !important;
          page-break-before: avoid !important;
          page-break-after: avoid !important;
        }

        /* Prevent any elements from creating page breaks */
        * {
          page-break-before: avoid !important;
          page-break-after: avoid !important;
        }

        /* Force single page layout */
        @page {
          margin: 0 !important;
          size: auto !important;
        }

        .no-print {
          display: none !important;
        }
      }

      @page {
        size: auto;
        margin: 0;
      }

      thead {
        display: table-header-group;
      }

      tbody {
        display: table-row-group;
      }

      tfoot {
        display: table-footer-group;
      }

      .page-counter::after {
        content: counter(page);
      }

      .total-counter::after {
        content: counter(pages);
      }

      ${settings.orientation === 'landscape' ? `
        .print-table {
          font-size: 13px;
        }
        .print-th {
          padding: 5px 4px;
          font-size: 14px;
        }
        .print-td {
          padding: 4px 3px;
          font-size: 13px;
        }
      ` : ''}

      .print-cell-content {
        word-break: break-word;
        overflow-wrap: break-word;
      }

      * {
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      *::-webkit-scrollbar {
        display: none;
      }
    `;

    return () => {
      // Cleanup on unmount
      const el = document.getElementById(styleId);
      if (el) el.remove();
    };
  }, [settings.pageSize, settings.orientation]);

  const generateFilterSummary = () => {
    if (!appliedFilters || Object.keys(appliedFilters).length === 0) {
      return 'No filters applied - Showing all records';
    }

    const filterParts: string[] = [];
    Object.entries(appliedFilters).forEach(([key, value]) => {
      if (value && value !== '') {
        if (Array.isArray(value) && value.length > 0) {
          filterParts.push(`${key}: ${value.join(', ')}`);
        } else if (typeof value === 'string') {
          filterParts.push(`${key}: ${value}`);
        }
      }
    });

    return filterParts.length > 0 
      ? filterParts.join(' | ') 
      : 'No filters applied - Showing all records';
  };

  return (
    <div id="print-root" className="print-container" data-print-content="true">
      {/* Print Header - Disabled to remove blank space and start table from top */}
      {false && (
        <div className="print-header">
          <div className="report-title">
            <h1>{reportTitle}</h1>
            {settings.showDateTime && (
              <p className="report-date">
                Generated on {format(new Date(), 'EEEE, MMMM do, yyyy \'at\' HH:mm')}
              </p>
            )}
          </div>

          {settings.showFilters && (
            <div className="filters-summary">
              <h3>Applied Filters:</h3>
              <p>{generateFilterSummary()}</p>
            </div>
          )}

          <div className="report-stats">
            <p>
              Showing {data.length} record{data.length !== 1 ? 's' : ''}
              {columnsToDisplay.length > 0 && ` across ${columnsToDisplay.length} column${columnsToDisplay.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>
      )}

      {/* Print Table */}
      <div className="print-table-container">
        <table
          className="print-table"
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            display: 'table',
            tableLayout: 'fixed'
          }}
        >
          <thead style={{ display: 'table-header-group' }}>
            <tr style={{ display: 'table-row' }}>
              {columnsToDisplay.map((column) => (
                <th
                  key={column.id}
                  className={`print-th ${column.align || 'left'}`}
                  style={{
                    width: column.widthPx ? `${column.widthPx}px` : 'auto',
                    display: 'table-cell',
                    border: '1px solid #000',
                    padding: '8px 6px',
                    backgroundColor: '#f5f5f5'
                  }}
                >
                  <div className="print-header-content">
                    {column.label}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody style={{ display: 'table-row-group' }}>
            {data.map((row, rowIndex) => {
              return (
                <tr key={rowIndex} className="print-tr" style={{ display: 'table-row' }}>
                  {columnsToDisplay.map((column) => {
                    const rawValue = getNestedValue(row, column.accessorKey);
                    const formattedValue = formatCellValue(rawValue, column, row);

                    return (
                      <td
                        key={column.id}
                        className={`print-td ${column.align || 'left'}`}
                        style={{
                          display: 'table-cell',
                          border: '1px solid #000',
                          padding: '6px'
                        }}
                      >
                        <div className="print-cell-content">
                          {formattedValue}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Print Footer - Disabled */}
      {false && settings.showPageNumbers && (
        <div className="print-footer">
          <span className="page-info">
            Page <span className="page-counter"></span> of <span className="total-counter"></span>
          </span>
          {' | '}
          <span className="report-footer">
            {reportTitle} - {format(new Date(), 'yyyy-MM-dd HH:mm')}
          </span>
        </div>
      )}
    </div>
  );
};
