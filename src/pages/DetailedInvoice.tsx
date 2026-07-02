import React, { useState, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { useSearchParams, useNavigate, useParams } from 'react-router-dom';
import { X, Printer, FileSpreadsheet } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { useAuth } from '@/contexts/AuthContext';
import { isUuid } from '@/utils/visitId';

const DetailedInvoice = () => {
  const { visitId } = useParams();
  const navigate = useNavigate();
  const { hospitalConfig } = useAuth();
  const hospitalName = hospitalConfig?.fullName || 'Hope Hospital Nagpur';
  const [patientData, setPatientData] = useState(null);
  const printRef = useRef(null);

  // State for selected items in each section (for print selected feature)
  const [selectedLabItems, setSelectedLabItems] = useState<number[]>([]);
  const [selectedRadiologyItems, setSelectedRadiologyItems] = useState<number[]>([]);
  const [selectedSurgeryItems, setSelectedSurgeryItems] = useState<number[]>([]);
  const [selectedAnesthetistItems, setSelectedAnesthetistItems] = useState<number[]>([]);
  const [selectedImplantItems, setSelectedImplantItems] = useState<number[]>([]);

  // Close function that goes back or to a specific page
  const handleClose = () => {
    // Try to go back first, if no history then go to financial summary
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/financial-summary');
    }
  };

  // Alternative print function using window.print()
  const handlePrint = () => {
    console.log('🖨️ Print button clicked');
    console.log('📋 Patient data available:', !!patientData);
    console.log('🖼️ Print ref available:', !!printRef.current);

    if (!patientData) {
      alert('Patient data is not loaded yet. Please wait for the data to load before printing.');
      return;
    }

    if (!printRef.current) {
      alert('Print content is not ready. Please try again.');
      return;
    }

    try {
      // Create a new window with just the invoice content
      const printWindow = window.open('', '_blank', 'width=800,height=600');

      if (!printWindow) {
        alert('Pop-up blocked! Please allow pop-ups for this site and try again.');
        return;
      }

      const printContent = printRef.current.innerHTML;

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Detailed Invoice - ${patientData?.claimId || visitId}</title>
            <style>
              @page {
                size: A4;
                margin: 0.5in;
              }

              body {
                font-family: Arial, sans-serif;
                margin: 0;
                padding: 20px;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }

              .border-gray-400 {
                border: 1px solid #000 !important;
              }

              .border-gray-300 {
                border: 1px solid #666 !important;
              }

              .bg-gray-100 {
                background-color: #f5f5f5 !important;
              }

              .bg-gray-200 {
                background-color: #e5e5e5 !important;
              }

              table {
                border-collapse: collapse;
                width: 100%;
                break-inside: avoid;
              }

              th, td {
                border: 1px solid #000;
                padding: 8px;
                text-align: left;
              }

              .text-center {
                text-align: center;
              }

              .text-right {
                text-align: right;
              }

              .font-bold {
                font-weight: bold;
              }

              .text-lg {
                font-size: 1.125rem;
              }

              .text-base {
                font-size: 1rem;
              }

              .text-sm {
                font-size: 0.875rem;
              }

              .text-xs {
                font-size: 0.75rem;
              }

              .py-3 {
                padding-top: 12px;
                padding-bottom: 12px;
              }

              .p-1 {
                padding: 4px;
              }

              .p-2 {
                padding: 8px;
              }

              .mb-4 {
                margin-bottom: 16px;
              }

              .mt-4 {
                margin-top: 16px;
              }

              .mt-8 {
                margin-top: 32px;
              }

              .pt-4 {
                padding-top: 16px;
              }

              .flex {
                display: flex;
              }

              .justify-between {
                justify-content: space-between;
              }

              .items-end {
                align-items: flex-end;
              }

              .gap-1 {
                gap: 4px;
              }

              .w-12 {
                width: 48px;
              }

              .w-16 {
                width: 64px;
              }

              .w-24 {
                width: 96px;
              }

              .w-32 {
                width: 128px;
              }

              @media print {
                body {
                  margin: 0;
                  padding: 10px;
                }
              }
            </style>
          </head>
          <body>
            ${printContent}
          </body>
        </html>
      `);

      printWindow.document.close();

      // Wait for content to load, then print
      printWindow.focus();

    } catch (error) {
      console.error('❌ Error during print:', error);
      alert('Failed to open print dialog. Please try again.');
    }
  };

  // Excel export function
  const handleExcelExport = () => {
    if (!patientData || !visitData) return;

    const workbook = XLSX.utils.book_new();

    // Patient Info Sheet
    const patientInfo = [
      ['DETAILED INVOICE REPORT', '', '', ''],
      ['', '', '', ''],
      ['Patient Information', '', '', ''],
      ['Bill No:', patientData.billNo, '', ''],
      ['Registration No:', patientData.registrationNo, '', ''],
      ['Patient Name:', patientData.patientName, '', ''],
      ['Age:', patientData.age, '', ''],
      ['Sex:', patientData.sex, '', ''],
      ['Address:', patientData.address, '', ''],
      ['Contact No:', patientData.contactNo, '', ''],
      ['Bed Category:', patientData.bedCategory, '', ''],
      ['Unit Name:', patientData.unitName, '', ''],
      ['Date of Admission:', patientData.dateOfAdmission, '', ''],
      ['Date of Discharge:', patientData.dateOfDischarge, '', ''],
      ['Primary Consultant:', patientData.primaryConsultant, '', ''],
      ['', '', '', ''],
    ];

    // Services breakdown
    const servicesData = [
      ['SERVICE BREAKDOWN', '', '', '', ''],
      ['Sr.No.', 'Item', 'Date & Time', 'Qty/Days', 'Rate'],
      ['', '', '', '', ''],
      ['ACCOMMODATION CHARGES', '', '', '', ''],
    ];

    // Add room tariff data
    serviceData.roomTariff.forEach((item, index) => {
      servicesData.push([index + 1, item.item, item.dateTime, item.qty, item.rate]);
    });

    servicesData.push(['', '', '', '', '']);
    servicesData.push(['SERVICES', '', '', '', '']);

    // Add services data
    serviceData.services.forEach((item, index) => {
      servicesData.push([index + 1, item.item, item.dateTime, item.qty, item.rate]);
    });

    servicesData.push(['', '', '', '', '']);
    servicesData.push(['LABORATORY', '', '', '', '']);

    // Add laboratory data
    if (serviceData.laboratory.length > 0) {
      serviceData.laboratory.forEach((item, index) => {
        servicesData.push([index + 1, item.item, item.dateTime, item.qty, item.rate]);
      });
    } else {
      servicesData.push(['-', 'No laboratory tests ordered', '', '', '']);
    }

    servicesData.push(['', '', '', '', '']);
    servicesData.push(['RADIOLOGY', '', '', '', '']);

    // Add radiology data
    if (serviceData.radiology.length > 0) {
      serviceData.radiology.forEach((item, index) => {
        servicesData.push([index + 1, item.item, item.dateTime, item.qty, item.rate]);
      });
    } else {
      servicesData.push(['-', 'No radiology tests ordered', '', '', '']);
    }

    // SURGERY section
    servicesData.push(['', '', '', '', '']);
    servicesData.push(['SURGERY', '', '', '', '']);
    if (serviceData.surgery.length > 0) {
      serviceData.surgery.forEach((item, index) => {
        servicesData.push([index + 1, item.item, item.dateTime, item.qty, item.rate]);
      });
    } else {
      servicesData.push(['-', 'No surgeries performed', '', '', '']);
    }

    // IMPLANTS section
    servicesData.push(['', '', '', '', '']);
    servicesData.push(['IMPLANTS', '', '', '', '']);
    if (serviceData.implants.length > 0) {
      serviceData.implants.forEach((item, index) => {
        servicesData.push([index + 1, item.item, item.dateTime, item.qty, item.rate]);
      });
    } else {
      servicesData.push(['-', 'No implants used', '', '', '']);
    }

    // MANDATORY SERVICES section
    servicesData.push(['', '', '', '', '']);
    servicesData.push(['MANDATORY SERVICES', '', '', '', '']);
    if (serviceData.mandatory.length > 0) {
      serviceData.mandatory.forEach((item, index) => {
        servicesData.push([index + 1, item.item, item.dateTime, item.qty, item.rate]);
      });
    } else {
      servicesData.push(['-', 'No mandatory services', '', '', '']);
    }

    if (serviceData.pharmacy.length > 0) {
      servicesData.push(['', '', '', '', '']);
      servicesData.push(['PHARMACY', '', '', '', '']);
      serviceData.pharmacy.forEach((item, index) => {
        servicesData.push([index + 1, item.item, item.dateTime, item.qty, item.rate]);
      });
    }

    // Add totals
    servicesData.push(['', '', '', '', '']);
    servicesData.push(['TOTAL AMOUNT', '', '', '', serviceData.totalAmount]);
    servicesData.push(['Amount in Words:', patientData.amountInWords, '', '', '']);

    // Combine all data
    const allData = [...patientInfo, ...servicesData];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(allData);

    // Set column widths
    worksheet['!cols'] = [
      { wch: 20 },  // Column A
      { wch: 30 },  // Column B
      { wch: 20 },  // Column C
      { wch: 15 },  // Column D
      { wch: 15 },  // Column E
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Detailed Invoice');

    // Generate filename
    const fileName = `DetailedInvoice_${patientData.claimId}_${format(new Date(), 'yyyyMMdd')}.xlsx`;

    // Save file
    XLSX.writeFile(workbook, fileName);
  };

  // Print section functions for Laboratory, Radiology, Surgery, Anesthetist, Implants
  const handlePrintSectionAll = (section: 'laboratory' | 'radiology' | 'surgery' | 'anesthetist' | 'implants') => {
    const sectionTitles = {
      laboratory: 'LABORATORY',
      radiology: 'RADIOLOGY',
      surgery: 'SURGERY',
      anesthetist: 'ANESTHETIST',
      implants: 'IMPLANTS'
    };

    const items = serviceData[section] || [];
    if (items.length === 0) {
      alert(`No ${section} items to print.`);
      return;
    }

    // Calculate total as sum of (rate * qty) for each item
    const total = items.reduce((sum, item) => sum + ((parseFloat(item.cghsRate) || item.rate || 0) * (item.qty || 1)), 0);

    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta name="supabase-url" content="${import.meta.env.VITE_SUPABASE_URL || ''}" />
          <meta name="supabase-key" content="${import.meta.env.VITE_SUPABASE_ANON_KEY || ''}" />
          <meta name="visit-id" content="${visitId}" />
          <meta name="hospital-name" content="${hospitalName}" />
          <title>${sectionTitles[section]} Report</title>
          <style>
            @page { size: A4; margin: 0; }
            body { font-family: Arial, sans-serif; margin: 0; padding: 120px 20px 20px 20px; }
            .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #000; padding-bottom: 10px; }
            .header h1 { margin: 0; font-size: 18px; }
            .header h2 { margin: 5px 0; font-size: 14px; color: #666; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #000; padding: 8px; text-align: left; font-size: 12px; }
            th { background-color: #f0f0f0; font-weight: bold; }
            .text-center { text-align: center; }
            .text-right { text-align: right; }
            .total-row { font-weight: bold; background-color: #f0f0f0; }
            .patient-table { width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 12px; }
            .patient-table td { border: 1px solid #ccc; padding: 5px 8px; width: 50%; cursor: text; }
            .toolbar { position: fixed; top: 0; left: 0; right: 0; background: #333; color: white; padding: 8px 20px; display: flex; gap: 10px; align-items: center; z-index: 1000; }
            .toolbar button { padding: 6px 16px; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: bold; }
            .toolbar .print-btn { background: #4CAF50; color: white; }
            .toolbar .print-btn:hover { background: #45a049; }
            .toolbar .close-btn { background: #f44336; color: white; }
            .toolbar .close-btn:hover { background: #d32f2f; }
            .toolbar span { font-size: 12px; color: #ccc; margin-left: 10px; }
            td[contenteditable="true"] { outline: none; background: #fffff0; }
            td[contenteditable="true"]:focus { background: #fff9c4; border: 1px solid #2196F3; }
            @media print { .toolbar { display: none !important; } td[contenteditable="true"] { background: white !important; } }

          </style>
        </head>
        <body>
          <div class="toolbar">
            <button class="print-btn" onclick="window.print()">Print</button>
            <button class="close-btn" onclick="window.close()">Close</button>
            <span>Click any cell to edit before printing</span>
            <button class="print-btn" style="background:#2196F3" onclick="saveBreakup()">Save to Database</button>
            <span id="save-status" style="color:#4CAF50;font-weight:bold"></span>
          </div>

          <div class="header">
            <h1>${hospitalName}</h1>
            <h2>${sectionTitles[section]} REPORT</h2>
          </div>
          <table class="patient-table">
            <tr>
              <td><strong>Patient Name:</strong> ${patientData?.patientName || 'N/A'}</td>
              <td><strong>Age/Sex:</strong> ${patientData?.age || 'N/A'} / ${patientData?.sex || 'N/A'}</td>
            </tr>
            <tr>
              <td><strong>Reg No:</strong> ${patientData?.registrationNo || 'N/A'}</td>
              <td><strong>Contact:</strong> ${patientData?.contactNo || 'N/A'}</td>
            </tr>
            <tr>
              <td><strong>Corporate:</strong> ${patientData?.corporateName || patientData?.address || 'N/A'}</td>
              <td><strong>Date of Admission:</strong> ${patientData?.dateOfAdmission || 'N/A'}</td>
            </tr>
          </table>
          <table>
            <thead>
              <tr>
                <th class="text-center" style="width: 50px;">SR.NO.</th>
                <th>ITEM</th>
                <th class="text-center" style="width: 120px;">DATE & TIME</th>
                <th class="text-center" style="width: 100px;">CGHS NABH RATE</th>
                <th class="text-center" style="width: 80px;">QTY</th>
                <th class="text-right" style="width: 100px;">AMOUNT</th>
              </tr>
            </thead>
            <tbody>
              ${items.map((item, index) => {
                const lineAmount = (parseFloat(item.cghsRate) || item.rate || 0) * (item.qty || 1);
                return `
                <tr>
                  <td class="text-center">${index + 1}</td>
                  <td contenteditable="true">${item.item}</td>
                  <td class="text-center" contenteditable="true">${item.dateTime}</td>
                  <td class="text-center" contenteditable="true">${item.cghsRate || ''}</td>
                  <td class="text-center" contenteditable="true">${item.qty}</td>
                  <td class="text-right" contenteditable="true">${lineAmount}</td>
                </tr>
              `}).join('')}
              <tr class="total-row">
                <td colspan="5" class="text-right">TOTAL:</td>
                <td class="text-right" id="grand-total">${total}</td>
              </tr>
            </tbody>
          </table>
        
          <script>

            function recalcTotal() {
              const rateCells = document.querySelectorAll('tbody tr:not(.total-row) td:last-child');
              let sum = 0;
              rateCells.forEach(cell => {
                const val = parseFloat(cell.textContent.trim()) || 0;
                sum += val;
              });
              const totalEl = document.getElementById('grand-total');
              if (totalEl) totalEl.textContent = sum;
            }
            // focusout bubbles unlike blur - fires when user leaves any editable cell
            document.addEventListener('focusout', function(e) {
              if (e.target && e.target.hasAttribute && e.target.hasAttribute('contenteditable')) {
                recalcTotal();
              }
            });
            // Also recalc on input for real-time update
            document.addEventListener('input', function(e) {
              if (e.target && e.target.hasAttribute && e.target.hasAttribute('contenteditable')) {
                recalcTotal();
              }
            });
            window._supabaseUrl = document.querySelector('meta[name="supabase-url"]')?.content || '';
            window._supabaseKey = document.querySelector('meta[name="supabase-key"]')?.content || '';
            window._visitId = document.querySelector('meta[name="visit-id"]')?.content || '';
            window._hospitalName = document.querySelector('meta[name="hospital-name"]')?.content || 'Hope Hospital Nagpur';

            async function loadSavedData() {
              if (!window._visitId || !window._supabaseUrl) return;
              try {
                const res = await fetch(window._supabaseUrl + '/rest/v1/lab_breakup?visit_id=eq.' + encodeURIComponent(window._visitId) + '&select=items,total_amount', {
                  headers: { 'apikey': window._supabaseKey, 'Authorization': 'Bearer ' + window._supabaseKey }
                });
                const data = await res.json();
                if (!data || data.length === 0) return;
                const saved = data[0];
                if (!saved.items || !Array.isArray(saved.items)) return;

                const rows = document.querySelectorAll('tbody tr:not(.total-row)');
                rows.forEach((row, idx) => {
                  const savedItem = saved.items[idx];
                  if (!savedItem) return;
                  const cells = row.querySelectorAll('td');
                  if (cells[3] && savedItem.cghs_nabh_rate !== undefined) cells[3].textContent = savedItem.cghs_nabh_rate;
                  if (cells[4] && savedItem.qty !== undefined) cells[4].textContent = savedItem.qty;
                  if (cells[5] && savedItem.rate !== undefined) cells[5].textContent = savedItem.rate;
                });

                // Update total
                const totalEl = document.getElementById('grand-total');
                if (totalEl && saved.total_amount) totalEl.textContent = saved.total_amount;

                const statusEl = document.getElementById('save-status');
                if (statusEl) statusEl.textContent = 'Loaded saved data';
                setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
              } catch(e) { console.log('Load error:', e); }
            }

            // Load saved data when page is ready
            window.addEventListener('load', loadSavedData);

            async function saveBreakup() {
              const statusEl = document.getElementById('save-status');
              statusEl.textContent = 'Saving...';
              try {
                const rows = document.querySelectorAll('table:last-of-type tbody tr:not(.total-row)');
                const items = [];
                rows.forEach(row => {
                  const cells = row.querySelectorAll('td');
                  if (cells.length >= 6) {
                    items.push({
                      sr_no: cells[0]?.textContent?.trim(),
                      item: cells[1]?.textContent?.trim(),
                      date_time: cells[2]?.textContent?.trim(),
                      cghs_nabh_rate: cells[3]?.textContent?.trim(),
                      qty: cells[4]?.textContent?.trim(),
                      rate: cells[5]?.textContent?.trim()
                    });
                  }
                });
                const totalRow = document.querySelector('.total-row');
                const totalCells = totalRow?.querySelectorAll('td');
                const total = totalCells?.[1]?.textContent?.trim() || '0';
                const cghsTotal = items.reduce((sum, i) => sum + (parseFloat(i.cghs_nabh_rate) || 0), 0);

                const patientCells = document.querySelectorAll('.patient-table td');
                const patientName = patientCells[0]?.textContent?.replace('Patient Name:', '').trim() || '';
                const regNo = patientCells[2]?.textContent?.replace('Reg No:', '').trim() || '';
                const corporate = patientCells[4]?.textContent?.replace('Corporate:', '').trim() || '';

                const payload = {
                  visit_id: window._visitId,
                  patient_name: patientName,
                  registration_no: regNo,
                  corporate_name: corporate,
                  hospital_name: window._hospitalName,
                  items: items,
                  total_amount: parseFloat(total) || 0,
                  cghs_total: cghsTotal,
                  status: 'saved'
                };

                // Delete any existing entry for this visit, then insert fresh
                await fetch(window._supabaseUrl + '/rest/v1/lab_breakup?visit_id=eq.' + encodeURIComponent(payload.visit_id), {
                  method: 'DELETE',
                  headers: { 'apikey': window._supabaseKey, 'Authorization': 'Bearer ' + window._supabaseKey }
                });
                
                const res = await fetch(window._supabaseUrl + '/rest/v1/lab_breakup', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'apikey': window._supabaseKey,
                    'Authorization': 'Bearer ' + window._supabaseKey,
                    'Prefer': 'return=representation'
                  },
                  body: JSON.stringify(payload)
                });

                if (res.ok) {
                  statusEl.textContent = 'Saved successfully!';
                  statusEl.style.color = '#4CAF50';
                } else {
                  const err = await res.text();
                  statusEl.textContent = 'Error: ' + err;
                  statusEl.style.color = '#f44336';
                }
              } catch(e) {
                statusEl.textContent = 'Error: ' + e.message;
                statusEl.style.color = '#f44336';
              }
            }
          </script>
        </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.focus();
    }
  };

  const handlePrintSectionSelected = (section: 'laboratory' | 'radiology' | 'surgery' | 'anesthetist' | 'implants') => {
    const sectionTitles = {
      laboratory: 'LABORATORY',
      radiology: 'RADIOLOGY',
      surgery: 'SURGERY',
      anesthetist: 'ANESTHETIST',
      implants: 'IMPLANTS'
    };

    const selectedIndices = section === 'laboratory' ? selectedLabItems :
                           section === 'radiology' ? selectedRadiologyItems :
                           section === 'surgery' ? selectedSurgeryItems :
                           section === 'anesthetist' ? selectedAnesthetistItems :
                           selectedImplantItems;

    const allItems = serviceData[section] || [];
    const items = allItems.filter((_, index) => selectedIndices.includes(index));

    if (items.length === 0) {
      alert(`Please select at least one ${section} item to print.`);
      return;
    }

    // Calculate total as sum of (rate * qty) for each item
    const total = items.reduce((sum, item) => sum + ((parseFloat(item.cghsRate) || item.rate || 0) * (item.qty || 1)), 0);

    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta name="supabase-url" content="${import.meta.env.VITE_SUPABASE_URL || ''}" />
          <meta name="supabase-key" content="${import.meta.env.VITE_SUPABASE_ANON_KEY || ''}" />
          <meta name="visit-id" content="${visitId}" />
          <meta name="hospital-name" content="${hospitalName}" />
          <title>${sectionTitles[section]} Report (Selected)</title>
          <style>
            @page { size: A4; margin: 0; }
            body { font-family: Arial, sans-serif; margin: 0; padding: 120px 20px 20px 20px; }
            .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #000; padding-bottom: 10px; }
            .header h1 { margin: 0; font-size: 18px; }
            .header h2 { margin: 5px 0; font-size: 14px; color: #666; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #000; padding: 8px; text-align: left; font-size: 12px; }
            th { background-color: #f0f0f0; font-weight: bold; }
            .text-center { text-align: center; }
            .text-right { text-align: right; }
            .total-row { font-weight: bold; background-color: #f0f0f0; }
            .patient-table { width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 12px; }
            .patient-table td { border: 1px solid #ccc; padding: 5px 8px; width: 50%; cursor: text; }
            .toolbar { position: fixed; top: 0; left: 0; right: 0; background: #333; color: white; padding: 8px 20px; display: flex; gap: 10px; align-items: center; z-index: 1000; }
            .toolbar button { padding: 6px 16px; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: bold; }
            .toolbar .print-btn { background: #4CAF50; color: white; }
            .toolbar .print-btn:hover { background: #45a049; }
            .toolbar .close-btn { background: #f44336; color: white; }
            .toolbar .close-btn:hover { background: #d32f2f; }
            .toolbar span { font-size: 12px; color: #ccc; margin-left: 10px; }
            td[contenteditable="true"] { outline: none; background: #fffff0; }
            td[contenteditable="true"]:focus { background: #fff9c4; border: 1px solid #2196F3; }
            @media print { .toolbar { display: none !important; } td[contenteditable="true"] { background: white !important; } }

          </style>
        </head>
        <body>
          <div class="toolbar">
            <button class="print-btn" onclick="window.print()">Print</button>
            <button class="close-btn" onclick="window.close()">Close</button>
            <span>Click any cell to edit before printing</span>
            <button class="print-btn" style="background:#2196F3" onclick="saveBreakup()">Save to Database</button>
            <span id="save-status" style="color:#4CAF50;font-weight:bold"></span>
          </div>

          <div class="header">
            <h1>${hospitalName}</h1>
            <h2>${sectionTitles[section]} REPORT</h2>
          </div>
          <table class="patient-table">
            <tr>
              <td><strong>Patient Name:</strong> ${patientData?.patientName || 'N/A'}</td>
              <td><strong>Age/Sex:</strong> ${patientData?.age || 'N/A'} / ${patientData?.sex || 'N/A'}</td>
            </tr>
            <tr>
              <td><strong>Reg No:</strong> ${patientData?.registrationNo || 'N/A'}</td>
              <td><strong>Contact:</strong> ${patientData?.contactNo || 'N/A'}</td>
            </tr>
            <tr>
              <td><strong>Corporate:</strong> ${patientData?.corporateName || patientData?.address || 'N/A'}</td>
              <td><strong>Date of Admission:</strong> ${patientData?.dateOfAdmission || 'N/A'}</td>
            </tr>
          </table>
          <table>
            <thead>
              <tr>
                <th class="text-center" style="width: 50px;">SR.NO.</th>
                <th>ITEM</th>
                <th class="text-center" style="width: 120px;">DATE & TIME</th>
                <th class="text-center" style="width: 100px;">CGHS NABH RATE</th>
                <th class="text-center" style="width: 80px;">QTY</th>
                <th class="text-right" style="width: 100px;">AMOUNT</th>
              </tr>
            </thead>
            <tbody>
              ${items.map((item, index) => {
                const lineAmount = (parseFloat(item.cghsRate) || item.rate || 0) * (item.qty || 1);
                return `
                <tr>
                  <td class="text-center">${index + 1}</td>
                  <td contenteditable="true">${item.item}</td>
                  <td class="text-center" contenteditable="true">${item.dateTime}</td>
                  <td class="text-center" contenteditable="true">${item.cghsRate || ''}</td>
                  <td class="text-center" contenteditable="true">${item.qty}</td>
                  <td class="text-right" contenteditable="true">${lineAmount}</td>
                </tr>
              `}).join('')}
              <tr class="total-row">
                <td colspan="5" class="text-right">TOTAL:</td>
                <td class="text-right" id="grand-total">${total}</td>
              </tr>
            </tbody>
          </table>
        
          <script>

            function recalcTotal() {
              const rateCells = document.querySelectorAll('tbody tr:not(.total-row) td:last-child');
              let sum = 0;
              rateCells.forEach(cell => {
                const val = parseFloat(cell.textContent.trim()) || 0;
                sum += val;
              });
              const totalEl = document.getElementById('grand-total');
              if (totalEl) totalEl.textContent = sum;
            }
            // focusout bubbles unlike blur - fires when user leaves any editable cell
            document.addEventListener('focusout', function(e) {
              if (e.target && e.target.hasAttribute && e.target.hasAttribute('contenteditable')) {
                recalcTotal();
              }
            });
            // Also recalc on input for real-time update
            document.addEventListener('input', function(e) {
              if (e.target && e.target.hasAttribute && e.target.hasAttribute('contenteditable')) {
                recalcTotal();
              }
            });
            window._supabaseUrl = document.querySelector('meta[name="supabase-url"]')?.content || '';
            window._supabaseKey = document.querySelector('meta[name="supabase-key"]')?.content || '';
            window._visitId = document.querySelector('meta[name="visit-id"]')?.content || '';
            window._hospitalName = document.querySelector('meta[name="hospital-name"]')?.content || 'Hope Hospital Nagpur';

            async function loadSavedData() {
              if (!window._visitId || !window._supabaseUrl) return;
              try {
                const res = await fetch(window._supabaseUrl + '/rest/v1/lab_breakup?visit_id=eq.' + encodeURIComponent(window._visitId) + '&select=items,total_amount', {
                  headers: { 'apikey': window._supabaseKey, 'Authorization': 'Bearer ' + window._supabaseKey }
                });
                const data = await res.json();
                if (!data || data.length === 0) return;
                const saved = data[0];
                if (!saved.items || !Array.isArray(saved.items)) return;

                const rows = document.querySelectorAll('tbody tr:not(.total-row)');
                rows.forEach((row, idx) => {
                  const savedItem = saved.items[idx];
                  if (!savedItem) return;
                  const cells = row.querySelectorAll('td');
                  if (cells[3] && savedItem.cghs_nabh_rate !== undefined) cells[3].textContent = savedItem.cghs_nabh_rate;
                  if (cells[4] && savedItem.qty !== undefined) cells[4].textContent = savedItem.qty;
                  if (cells[5] && savedItem.rate !== undefined) cells[5].textContent = savedItem.rate;
                });

                // Update total
                const totalEl = document.getElementById('grand-total');
                if (totalEl && saved.total_amount) totalEl.textContent = saved.total_amount;

                const statusEl = document.getElementById('save-status');
                if (statusEl) statusEl.textContent = 'Loaded saved data';
                setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
              } catch(e) { console.log('Load error:', e); }
            }

            // Load saved data when page is ready
            window.addEventListener('load', loadSavedData);

            async function saveBreakup() {
              const statusEl = document.getElementById('save-status');
              statusEl.textContent = 'Saving...';
              try {
                const rows = document.querySelectorAll('table:last-of-type tbody tr:not(.total-row)');
                const items = [];
                rows.forEach(row => {
                  const cells = row.querySelectorAll('td');
                  if (cells.length >= 6) {
                    items.push({
                      sr_no: cells[0]?.textContent?.trim(),
                      item: cells[1]?.textContent?.trim(),
                      date_time: cells[2]?.textContent?.trim(),
                      cghs_nabh_rate: cells[3]?.textContent?.trim(),
                      qty: cells[4]?.textContent?.trim(),
                      rate: cells[5]?.textContent?.trim()
                    });
                  }
                });
                const totalRow = document.querySelector('.total-row');
                const totalCells = totalRow?.querySelectorAll('td');
                const total = totalCells?.[1]?.textContent?.trim() || '0';
                const cghsTotal = items.reduce((sum, i) => sum + (parseFloat(i.cghs_nabh_rate) || 0), 0);

                const patientCells = document.querySelectorAll('.patient-table td');
                const patientName = patientCells[0]?.textContent?.replace('Patient Name:', '').trim() || '';
                const regNo = patientCells[2]?.textContent?.replace('Reg No:', '').trim() || '';
                const corporate = patientCells[4]?.textContent?.replace('Corporate:', '').trim() || '';

                const payload = {
                  visit_id: window._visitId,
                  patient_name: patientName,
                  registration_no: regNo,
                  corporate_name: corporate,
                  hospital_name: window._hospitalName,
                  items: items,
                  total_amount: parseFloat(total) || 0,
                  cghs_total: cghsTotal,
                  status: 'saved'
                };

                // Delete any existing entry for this visit, then insert fresh
                await fetch(window._supabaseUrl + '/rest/v1/lab_breakup?visit_id=eq.' + encodeURIComponent(payload.visit_id), {
                  method: 'DELETE',
                  headers: { 'apikey': window._supabaseKey, 'Authorization': 'Bearer ' + window._supabaseKey }
                });
                
                const res = await fetch(window._supabaseUrl + '/rest/v1/lab_breakup', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'apikey': window._supabaseKey,
                    'Authorization': 'Bearer ' + window._supabaseKey,
                    'Prefer': 'return=representation'
                  },
                  body: JSON.stringify(payload)
                });

                if (res.ok) {
                  statusEl.textContent = 'Saved successfully!';
                  statusEl.style.color = '#4CAF50';
                } else {
                  const err = await res.text();
                  statusEl.textContent = 'Error: ' + err;
                  statusEl.style.color = '#f44336';
                }
              } catch(e) {
                statusEl.textContent = 'Error: ' + e.message;
                statusEl.style.color = '#f44336';
              }
            }
          </script>
        </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.focus();
    }
  };

  const handlePrintSectionSummary = (section: 'laboratory' | 'radiology' | 'surgery' | 'anesthetist' | 'implants') => {
    const sectionTitles = {
      laboratory: 'LABORATORY',
      radiology: 'RADIOLOGY',
      surgery: 'SURGERY',
      anesthetist: 'ANESTHETIST',
      implants: 'IMPLANTS'
    };

    const items = serviceData[section] || [];
    const total = items.reduce((sum, item) => sum + ((parseFloat(item.cghsRate) || item.rate || 0) * (item.qty || 1)), 0);
    const itemCount = items.length;

    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta name="supabase-url" content="${import.meta.env.VITE_SUPABASE_URL || ''}" />
          <meta name="supabase-key" content="${import.meta.env.VITE_SUPABASE_ANON_KEY || ''}" />
          <meta name="visit-id" content="${visitId}" />
          <meta name="hospital-name" content="${hospitalName}" />
          <title>${sectionTitles[section]} Summary</title>
          <style>
            @page { size: A4; margin: 0; }
            body { font-family: Arial, sans-serif; margin: 0; padding: 120px 20px 20px 20px; }
            .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #000; padding-bottom: 10px; }
            .header h1 { margin: 0; font-size: 18px; }
            .header h2 { margin: 5px 0; font-size: 14px; color: #666; }
            .summary-box { border: 1px solid #000; padding: 20px; margin: 20px 0; }
            .summary-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #ccc; }
            .summary-row:last-child { border-bottom: none; font-weight: bold; font-size: 16px; }
            .patient-table { width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 12px; }
            .patient-table td { border: 1px solid #ccc; padding: 5px 8px; width: 50%; cursor: text; }
            .toolbar { position: fixed; top: 0; left: 0; right: 0; background: #333; color: white; padding: 8px 20px; display: flex; gap: 10px; align-items: center; z-index: 1000; }
            .toolbar button { padding: 6px 16px; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: bold; }
            .toolbar .print-btn { background: #4CAF50; color: white; }
            .toolbar .print-btn:hover { background: #45a049; }
            .toolbar .close-btn { background: #f44336; color: white; }
            .toolbar .close-btn:hover { background: #d32f2f; }
            .toolbar span { font-size: 12px; color: #ccc; margin-left: 10px; }
            td[contenteditable="true"] { outline: none; background: #fffff0; }
            td[contenteditable="true"]:focus { background: #fff9c4; border: 1px solid #2196F3; }
            @media print { .toolbar { display: none !important; } td[contenteditable="true"] { background: white !important; } }

          </style>
        </head>
        <body>
          <div class="toolbar">
            <button class="print-btn" onclick="window.print()">Print</button>
            <button class="close-btn" onclick="window.close()">Close</button>
            <span>Click any cell to edit before printing</span>
            <button class="print-btn" style="background:#2196F3" onclick="saveBreakup()">Save to Database</button>
            <span id="save-status" style="color:#4CAF50;font-weight:bold"></span>
          </div>

          <div class="header">
            <h1>${hospitalName}</h1>
            <h2>${sectionTitles[section]} SUMMARY</h2>
          </div>
          <table class="patient-table">
            <tr>
              <td><strong>Patient Name:</strong> ${patientData?.patientName || 'N/A'}</td>
              <td><strong>Age/Sex:</strong> ${patientData?.age || 'N/A'} / ${patientData?.sex || 'N/A'}</td>
            </tr>
            <tr>
              <td><strong>Reg No:</strong> ${patientData?.registrationNo || 'N/A'}</td>
              <td><strong>Contact:</strong> ${patientData?.contactNo || 'N/A'}</td>
            </tr>
            <tr>
              <td><strong>Corporate:</strong> ${patientData?.corporateName || patientData?.address || 'N/A'}</td>
              <td><strong>Date of Admission:</strong> ${patientData?.dateOfAdmission || 'N/A'}</td>
            </tr>
          </table>
          <div class="summary-box">
            <div class="summary-row">
              <span>Section:</span>
              <span>${sectionTitles[section]}</span>
            </div>
            <div class="summary-row">
              <span>Total Items:</span>
              <span>${itemCount}</span>
            </div>
            <div class="summary-row">
              <span>Total Amount:</span>
              <span>Rs. ${total.toLocaleString()}</span>
            </div>
          </div>
        
          <script>
            window._supabaseUrl = document.querySelector('meta[name="supabase-url"]')?.content || '';
            window._supabaseKey = document.querySelector('meta[name="supabase-key"]')?.content || '';
            window._visitId = document.querySelector('meta[name="visit-id"]')?.content || '';
            window._hospitalName = document.querySelector('meta[name="hospital-name"]')?.content || 'Hope Hospital Nagpur';

            async function loadSavedData() {
              if (!window._visitId || !window._supabaseUrl) return;
              try {
                const res = await fetch(window._supabaseUrl + '/rest/v1/lab_breakup?visit_id=eq.' + encodeURIComponent(window._visitId) + '&select=items,total_amount', {
                  headers: { 'apikey': window._supabaseKey, 'Authorization': 'Bearer ' + window._supabaseKey }
                });
                const data = await res.json();
                if (!data || data.length === 0) return;
                const saved = data[0];
                if (!saved.items || !Array.isArray(saved.items)) return;

                const rows = document.querySelectorAll('tbody tr:not(.total-row)');
                rows.forEach((row, idx) => {
                  const savedItem = saved.items[idx];
                  if (!savedItem) return;
                  const cells = row.querySelectorAll('td');
                  if (cells[3] && savedItem.cghs_nabh_rate !== undefined) cells[3].textContent = savedItem.cghs_nabh_rate;
                  if (cells[4] && savedItem.qty !== undefined) cells[4].textContent = savedItem.qty;
                  if (cells[5] && savedItem.rate !== undefined) cells[5].textContent = savedItem.rate;
                });

                // Update total
                const totalEl = document.getElementById('grand-total');
                if (totalEl && saved.total_amount) totalEl.textContent = saved.total_amount;

                const statusEl = document.getElementById('save-status');
                if (statusEl) statusEl.textContent = 'Loaded saved data';
                setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
              } catch(e) { console.log('Load error:', e); }
            }

            // Load saved data when page is ready
            window.addEventListener('load', loadSavedData);

            async function saveBreakup() {
              const statusEl = document.getElementById('save-status');
              statusEl.textContent = 'Saving...';
              try {
                const rows = document.querySelectorAll('table:last-of-type tbody tr:not(.total-row)');
                const items = [];
                rows.forEach(row => {
                  const cells = row.querySelectorAll('td');
                  if (cells.length >= 6) {
                    items.push({
                      sr_no: cells[0]?.textContent?.trim(),
                      item: cells[1]?.textContent?.trim(),
                      date_time: cells[2]?.textContent?.trim(),
                      cghs_nabh_rate: cells[3]?.textContent?.trim(),
                      qty: cells[4]?.textContent?.trim(),
                      rate: cells[5]?.textContent?.trim()
                    });
                  }
                });
                const totalRow = document.querySelector('.total-row');
                const totalCells = totalRow?.querySelectorAll('td');
                const total = totalCells?.[1]?.textContent?.trim() || '0';
                const cghsTotal = items.reduce((sum, i) => sum + (parseFloat(i.cghs_nabh_rate) || 0), 0);

                const patientCells = document.querySelectorAll('.patient-table td');
                const patientName = patientCells[0]?.textContent?.replace('Patient Name:', '').trim() || '';
                const regNo = patientCells[2]?.textContent?.replace('Reg No:', '').trim() || '';
                const corporate = patientCells[4]?.textContent?.replace('Corporate:', '').trim() || '';

                const payload = {
                  visit_id: window._visitId,
                  patient_name: patientName,
                  registration_no: regNo,
                  corporate_name: corporate,
                  hospital_name: window._hospitalName,
                  items: items,
                  total_amount: parseFloat(total) || 0,
                  cghs_total: cghsTotal,
                  status: 'saved'
                };

                // Delete any existing entry for this visit, then insert fresh
                await fetch(window._supabaseUrl + '/rest/v1/lab_breakup?visit_id=eq.' + encodeURIComponent(payload.visit_id), {
                  method: 'DELETE',
                  headers: { 'apikey': window._supabaseKey, 'Authorization': 'Bearer ' + window._supabaseKey }
                });
                
                const res = await fetch(window._supabaseUrl + '/rest/v1/lab_breakup', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'apikey': window._supabaseKey,
                    'Authorization': 'Bearer ' + window._supabaseKey,
                    'Prefer': 'return=representation'
                  },
                  body: JSON.stringify(payload)
                });

                if (res.ok) {
                  statusEl.textContent = 'Saved successfully!';
                  statusEl.style.color = '#4CAF50';
                } else {
                  const err = await res.text();
                  statusEl.textContent = 'Error: ' + err;
                  statusEl.style.color = '#f44336';
                }
              } catch(e) {
                statusEl.textContent = 'Error: ' + e.message;
                statusEl.style.color = '#f44336';
              }
            }
          </script>
        </body>
      </html>
    `;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(printContent);
      printWindow.document.close();
      printWindow.focus();
    }
  };

  // Toggle item selection
  const toggleItemSelection = (section: 'laboratory' | 'radiology' | 'surgery' | 'anesthetist' | 'implants', index: number) => {
    if (section === 'laboratory') {
      setSelectedLabItems(prev =>
        prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
      );
    } else if (section === 'radiology') {
      setSelectedRadiologyItems(prev =>
        prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
      );
    } else if (section === 'surgery') {
      setSelectedSurgeryItems(prev =>
        prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
      );
    } else if (section === 'anesthetist') {
      setSelectedAnesthetistItems(prev =>
        prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
      );
    } else {
      setSelectedImplantItems(prev =>
        prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]
      );
    }
  };

  // Fetch patient data from database
  const { data: visitData, isLoading, error } = useQuery({
    queryKey: ['visit-details', visitId],
    queryFn: async () => {
      if (!visitId) return null;

      console.log('🔍 Fetching visit details for visitId:', visitId);

      // Function to check if string is valid UUID format
      const isValidUUID = isUuid;

      let visit = null;
      let visitError = null;

      // Try different approaches to find the visit
      if (isValidUUID(visitId)) {
        // If visitId is a UUID, search by id
        const result = await supabase
          .from('visits')
          .select(`
            *,
            patients (
              id,
              patients_id,
              name,
              age,
              gender,
              phone,
              address,
              corporate
            )
          `)
          .eq('id', visitId)
          .single();
        visit = result.data;
        visitError = result.error;
      } else {
        // If visitId is not a UUID, try searching by visit_id field
        const result = await supabase
          .from('visits')
          .select(`
            *,
            patients (
              id,
              patients_id,
              name,
              age,
              gender,
              phone,
              address,
              corporate
            )
          `)
          .eq('visit_id', visitId)
          .single();
        visit = result.data;
        visitError = result.error;

        // If still not found, try searching by patients_id in patients table
        if (visitError || !visit) {
          const patientResult = await supabase
            .from('patients')
            .select(`
              *,
              visits (
                *
              )
            `)
            .eq('patients_id', visitId)
            .single();

          if (patientResult.data && patientResult.data.visits && patientResult.data.visits.length > 0) {
            // Get the most recent visit
            const mostRecentVisit = patientResult.data.visits.sort((a, b) =>
              new Date(b.admission_date) - new Date(a.admission_date)
            )[0];

            visit = {
              ...mostRecentVisit,
              patients: patientResult.data
            };
            visitError = null;
          } else {
            visitError = patientResult.error || { message: 'No visits found for this patient' };
          }
        }
      }

      if (visitError) {
        console.error('❌ Error fetching visit:', visitError);
        throw visitError;
      }

      console.log('📋 Visit ID from URL:', visitId);
      console.log('📋 Visit ID field (visit_id):', visit?.visit_id);

      // Debug date and consultant fields
      console.log('📅 Date fields check:', {
        visit_date: visit?.visit_date,
        discharge_date: visit?.discharge_date,
        admission_date: visit?.admission_date,
        admitted_date: visit?.admitted_date,
        discharged_date: visit?.discharged_date
      });
      console.log('👨‍⚕️ Doctor fields check:', {
        appointment_with: visit?.appointment_with,
        consulting_doctor: visit?.consulting_doctor,
        doctor_name: visit?.doctor_name,
        consultant_name: visit?.consultant_name
      });
      console.log('🏨 Accommodation from visits table:', {
        accommodation_id: visit?.accommodation_id,
        accommodations: visit?.accommodations,
        room_type: visit?.accommodations?.room_type
      });
      console.log('🔑 Available visit fields:', Object.keys(visit || {}));

      // Use the actual visit ID (UUID) for related queries
      const actualVisitId = visit?.id;

      // Fetch lab orders for this visit
      let labOrders = [];
      if (actualVisitId) {
        const { data: labData, error: labError } = await supabase
          .from('visit_labs')
          .select(`
            *,
            lab:lab_id (
              name,
              CGHS_code,
              private,
              "NABH_rates_in_rupee",
              "Non-NABH_rates_in_rupee",
              bhopal_nabh_rate,
              bhopal_non_nabh_rate
            )
          `)
          .eq('visit_id', actualVisitId);

        if (labError) {
          console.error('❌ Error fetching lab orders:', labError);
        } else {
          labOrders = labData || [];
        }
      }

      // Fetch radiology orders for this visit
      let radiologyOrders = [];
      if (actualVisitId) {
        console.log('🔍 Fetching radiology for actualVisitId:', actualVisitId);
        console.log('🔍 Query: visit_radiology WHERE visit_id =', actualVisitId);

        const { data: radioData, error: radioError } = await supabase
          .from('visit_radiology')
          .select(`
            *,
            radiology:radiology_id (
              name
            )
          `)
          .eq('visit_id', actualVisitId);

        console.log('📡 Radiology query response:', { data: radioData, error: radioError });

        if (radioError) {
          console.error('❌ Error fetching radiology orders:', radioError);
          console.error('❌ Error details:', JSON.stringify(radioError, null, 2));
        } else {
          radiologyOrders = radioData || [];
          console.log('📊 Radiology data fetched:', radiologyOrders.length, 'records');
          console.log('📋 Radiology raw data:', JSON.stringify(radioData, null, 2));

          if (radiologyOrders.length > 0) {
            console.log('💰 First radiology item cost details:', {
              id: radiologyOrders[0].id,
              radiology_id: radiologyOrders[0].radiology_id,
              radiology_name: radiologyOrders[0].radiology?.name,
              cost: radiologyOrders[0].cost,
              unit_rate: radiologyOrders[0].unit_rate,
              quantity: radiologyOrders[0].quantity,
              visit_id: radiologyOrders[0].visit_id
            });
            console.log('✅ All radiology items:', radiologyOrders.map(r => ({
              name: r.radiology?.name,
              cost: r.cost,
              unit_rate: r.unit_rate,
              quantity: r.quantity
            })));
          } else {
            console.warn('⚠️ NO RADIOLOGY RECORDS FOUND for visit_id:', actualVisitId);
            console.warn('⚠️ This could mean:');
            console.warn('   1. No radiology tests have been added to this visit yet');
            console.warn('   2. The tests are saved with a different visit_id');
            console.warn('   3. React Query cache is stale - try hard refresh (Ctrl+Shift+R)');
          }
        }
      } else {
        console.error('❌ No actualVisitId available for radiology query');
        console.error('❌ Visit object:', visit);
      }

      // Fetch pharmacy orders for this visit
      let pharmacyOrders = [];
      if (actualVisitId) {
        const { data: pharmaData, error: pharmaError } = await supabase
          .from('visit_medications')
          .select(`
            *,
            medications:medication_id (
              name,
              price_per_strip
            )
          `)
          .eq('visit_id', actualVisitId);

        if (pharmaError) {
          console.error('❌ Error fetching pharmacy orders:', pharmaError);
        } else {
          pharmacyOrders = pharmaData || [];
        }
      }

      // Fetch clinical services for this visit
      let clinicalServices = [];
      if (actualVisitId) {
        console.log('🔍 Fetching clinical services for actualVisitId:', actualVisitId);
        const { data: clinicalData, error: clinicalError } = await supabase
          .from('visit_clinical_services')
          .select(`
            id,
            quantity,
            rate_used,
            rate_type,
            amount,
            selected_at,
            clinical_services!clinical_service_id (
              id,
              service_name,
              tpa_rate,
              private_rate,
              nabh_rate,
              non_nabh_rate
            )
          `)
          .eq('visit_id', actualVisitId);

        console.log('📡 Clinical services response:', { data: clinicalData, error: clinicalError });

        if (clinicalError) {
          console.error('❌ Error fetching clinical services:', clinicalError);
        } else {
          clinicalServices = clinicalData || [];
          console.log('📋 Clinical services data:', JSON.stringify(clinicalData, null, 2));
        }
      }

      // Fetch visit accommodations for this visit
      let accommodationOrders = [];
      if (actualVisitId) {
        console.log('🔍 Fetching accommodations for actualVisitId:', actualVisitId);
        const { data: accommodationData, error: accommodationError } = await supabase
          .from('visit_accommodations')
          .select(`
            *,
            accommodation:accommodation_id (
              id,
              room_type,
              private_rate,
              nabh_rate,
              non_nabh_rate,
              tpa_rate
            )
          `)
          .eq('visit_id', actualVisitId)
          .order('start_date', { ascending: false });

        console.log('📡 Accommodation response:', { data: accommodationData, error: accommodationError });

        if (accommodationError) {
          console.error('❌ Error fetching accommodations:', accommodationError);
        } else {
          accommodationOrders = accommodationData || [];
          console.log('📋 Accommodation data:', JSON.stringify(accommodationData, null, 2));
        }
      }

      // Fetch surgery orders for this visit
      let surgeryOrders = [];
      if (actualVisitId) {
        console.log('🔍 Fetching surgeries for actualVisitId:', actualVisitId);
        const { data: surgeryData, error: surgeryError } = await supabase
          .from('visit_surgeries')
          .select(`
            *,
            cghs_surgery:surgery_id (
              id,
              name,
              code,
              NABH_NABL_Rate
            )
          `)
          .eq('visit_id', actualVisitId);

        console.log('📡 Surgery response:', { data: surgeryData, error: surgeryError });

        if (surgeryError) {
          console.error('❌ Error fetching surgery orders:', surgeryError);
        } else {
          surgeryOrders = surgeryData || [];
        }
      }

      // Fetch anesthetist data for this visit
      let anesthetistOrders: any[] = [];
      if (actualVisitId) {
        console.log('🔍 Fetching anesthetists for actualVisitId:', actualVisitId);
        const { data: anesthetistData, error: anesthetistError } = await supabase
          .from('visit_anesthetists')
          .select('*')
          .eq('visit_id', actualVisitId);

        console.log('📡 Anesthetist response:', { data: anesthetistData, error: anesthetistError });

        if (anesthetistError) {
          console.error('❌ Error fetching anesthetists:', anesthetistError);
        } else {
          anesthetistOrders = anesthetistData || [];
        }
      }

      // Fetch implants for this visit
      let implantOrders = [];
      if (actualVisitId) {
        console.log('🔍 Fetching implants for actualVisitId:', actualVisitId);
        const { data: implantData, error: implantError } = await supabase
          .from('visit_implants')
          .select('*')
          .eq('visit_id', actualVisitId)
          .eq('status', 'Active');

        console.log('📡 Implants response:', { data: implantData, error: implantError });

        if (implantError) {
          console.error('❌ Error fetching implants:', implantError);
        } else {
          implantOrders = implantData || [];
        }
      }

      // Fetch mandatory services for this visit
      let mandatoryServices = [];
      if (actualVisitId) {
        console.log('🔍 Fetching mandatory services for actualVisitId:', actualVisitId);
        const { data: mandatoryData, error: mandatoryError } = await supabase
          .from('visit_mandatory_services')
          .select(`
            id,
            quantity,
            rate_used,
            rate_type,
            amount,
            selected_at,
            start_date,
            end_date,
            mandatory_services!mandatory_service_id (
              id,
              service_name,
              tpa_rate,
              private_rate,
              nabh_rate,
              non_nabh_rate
            )
          `)
          .eq('visit_id', actualVisitId);

        console.log('📡 Mandatory services response:', { data: mandatoryData, error: mandatoryError });

        if (mandatoryError) {
          console.error('❌ Error fetching mandatory services:', mandatoryError);
        } else {
          mandatoryServices = mandatoryData || [];
        }
      }

      return {
        visit,
        labOrders,
        radiologyOrders,
        pharmacyOrders,
        clinicalServices,
        accommodationOrders,
        surgeryOrders,
        anesthetistOrders,
        implantOrders,
        mandatoryServices
      };
    },
    enabled: !!visitId
  });

  // Process the fetched data
  useEffect(() => {
    if (visitData?.visit) {
      console.log('🔄 Processing visit data:', visitData);
      const visit = visitData.visit;
      const patient = visit.patients;

      console.log('👤 Patient data:', patient);
      console.log('🏥 Visit data:', visit);
      console.log('🔬 Lab orders:', visitData.labOrders);
      console.log('📸 Radiology orders:', visitData.radiologyOrders);
      console.log('💊 Pharmacy orders:', visitData.pharmacyOrders);
      console.log('🏥 Clinical services:', visitData.clinicalServices);
      console.log('🏥 Surgery orders:', visitData.surgeryOrders);
      console.log('💉 Anesthetist orders:', visitData.anesthetistOrders);
      console.log('🔩 Implant orders:', visitData.implantOrders);

      // Calculate total amount from all services
      const labTotal = visitData.labOrders.filter(order => !order.is_hidden).reduce((sum, order) => sum + (parseFloat(order.cost) || parseFloat(order.unit_rate) || parseFloat(order.lab?.NABH_rates_in_rupee) || 0), 0);
      const radioTotal = visitData.radiologyOrders.reduce((sum, order) => {
        const cost = parseFloat(order.cost) || parseFloat(order.unit_rate) || 0;
        console.log('🔍 Radiology order cost:', { name: order.radiology?.name, cost, raw_cost: order.cost, unit_rate: order.unit_rate });
        return sum + cost;
      }, 0);
      const pharmaTotal = visitData.pharmacyOrders.reduce((sum, order) => sum + (order.medications?.price_per_strip || 0), 0);
      const clinicalTotal = visitData.clinicalServices?.reduce((sum, service) => {
        const amount = parseFloat(service.amount) || parseFloat(service.rate_used) || 0;
        return sum + amount;
      }, 0) || 0;
      const roomTotal = visitData.visit?.room_charges || 0;
      const surgeryTotal = visitData.surgeryOrders?.reduce((sum, order) => {
        // Use stored rate first, fallback to cghs_surgery.NABH_NABL_Rate
        const rate = order.rate && order.rate > 0
          ? Number(order.rate)
          : parseFloat(String(order.cghs_surgery?.NABH_NABL_Rate || '0').replace(/[^\d.]/g, '')) || 0;
        return sum + rate;
      }, 0) || 0;
      const mandatoryTotal = visitData.mandatoryServices?.reduce((sum, service) => {
        const amount = parseFloat(service.amount) || parseFloat(service.rate_used) || 0;
        return sum + amount;
      }, 0) || 0;
      const implantTotal = visitData.implantOrders?.reduce((sum, implant) => {
        const amount = parseFloat(implant.amount) || (implant.quantity * parseFloat(implant.rate)) || 0;
        return sum + amount;
      }, 0) || 0;
      const totalAmount = labTotal + radioTotal + pharmaTotal + clinicalTotal + roomTotal + surgeryTotal + implantTotal + mandatoryTotal;

      console.log('💰 Calculated totals - Lab:', labTotal, 'Radio:', radioTotal, 'Pharma:', pharmaTotal, 'Clinical:', clinicalTotal, 'Room:', roomTotal, 'Surgery:', surgeryTotal, 'Implants:', implantTotal, 'Mandatory:', mandatoryTotal, 'Total:', totalAmount);

      console.log('📝 Processing patient data with fields:', {
        'visit.visit_date': visit.visit_date,
        'visit.discharge_date': visit.discharge_date,
        'visit.appointment_with': visit.appointment_with,
        'Will show as dateOfAdmission': visit.visit_date ? format(new Date(visit.visit_date), 'dd/MM/yyyy') : 'N/A',
        'Will show as dateOfDischarge': visit.discharge_date ? format(new Date(visit.discharge_date), 'dd/MM/yyyy') : 'N/A',
        'Will show as primaryConsultant': visit.appointment_with || 'N/A'
      });

      console.log('🏨 Room type debug:', {
        'visit.accommodation_id': visit.accommodation_id,
        'visit.accommodations': visit.accommodations,
        'visit.accommodations?.room_type': visit.accommodations?.room_type,
        'Will show as unitName': visit.accommodations?.room_type || 'NOT AVAILABLE'
      });

      const processedData = {
        claimId: visit.visit_id || visitId || 'N/A',
        billNo: `BL${visit.visit_id || visitId || 'N/A'}`,
        registrationNo: patient?.patients_id || 'N/A',
        patientName: patient?.name || 'Unknown Patient',
        age: patient?.age ? `${patient.age}Y` : 'N/A',
        sex: patient?.gender || 'N/A',
        address: patient?.address || 'N/A',
        contactNo: patient?.phone || 'NOT AVAILABLE',
        bedCategory: visit.bed_category || 'NOT AVAILABLE',
        unitName: visitData?.accommodationOrders?.[0]?.accommodation?.room_type || 'NOT AVAILABLE',
        dateOfAdmission: visit.visit_date ? format(new Date(visit.visit_date), 'dd/MM/yyyy') : 'N/A',
        dateOfDischarge: visit.discharge_date ? format(new Date(visit.discharge_date), 'dd/MM/yyyy') : 'N/A',
        primaryConsultant: visit.appointment_with || 'N/A',
        totalAmount: totalAmount,
        amountInWords: convertNumberToWords(totalAmount),
        tariff: patient?.corporate || 'Private',
        corporateName: patient?.corporate || 'N/A'
      };

      console.log('📋 Final processed patient data:', processedData);
      setPatientData(processedData);
    }
  }, [visitData, visitId]);

  // Function to convert number to words (simple implementation)
  const convertNumberToWords = (amount) => {
    if (amount === 0) return 'Zero Only';
    if (amount < 1000) return `${amount} Only`;
    if (amount < 100000) return `${Math.floor(amount/1000)} Thousand ${amount%1000} Only`;
    return `${Math.floor(amount/100000)} Lakh ${Math.floor((amount%100000)/1000)} Thousand ${amount%1000} Only`;
  };

  // Debug room charges
  console.log('🏠 Room data:', {
    room_type: visitData?.visit?.room_type,
    room_days: visitData?.visit?.room_days,
    room_charges: visitData?.visit?.room_charges,
    visit_date: visitData?.visit?.visit_date,
    discharge_date: visitData?.visit?.discharge_date
  });

  // Process fetched data into service categories
  const serviceData = {
    roomTariff: visitData?.accommodationOrders?.map((accommodation, index) => ({
      item: accommodation.accommodation?.room_type || 'General Ward',
      dateTime: `${accommodation.start_date ? format(new Date(accommodation.start_date), 'dd/MM/yyyy') : ''} - ${accommodation.end_date ? format(new Date(accommodation.end_date), 'dd/MM/yyyy') : ''}`,
      qty: accommodation.days || 1,
      rate: parseFloat(accommodation.amount) || parseFloat(accommodation.rate_used) || 0
    })) || [],
    services: visitData?.clinicalServices?.map((service, index) => ({
      item: service.clinical_services?.service_name || 'Service',
      dateTime: service.selected_at ? format(new Date(service.selected_at), 'dd/MM/yyyy HH:mm:ss') : '',
      qty: service.quantity || 1,
      rate: parseFloat(service.amount) || parseFloat(service.rate_used) || 0
    })) || [],
    laboratory: visitData?.labOrders?.filter(lab => !lab.is_hidden).map((lab, index) => ({
      item: lab.lab?.name || 'Lab Test',
      dateTime: lab.ordered_date ? format(new Date(lab.ordered_date), 'dd/MM/yyyy HH:mm:ss') : '',
      qty: lab.quantity || 1,
      cghsRate: lab.lab?.NABH_rates_in_rupee || '',
      rate: parseFloat(lab.cost) || parseFloat(lab.unit_rate) || parseFloat(lab.lab?.NABH_rates_in_rupee) || 0
    })) || [],
    radiology: visitData?.radiologyOrders?.map((radio, index) => ({
      item: radio.radiology?.name || 'Radiology Test',
      dateTime: radio.ordered_date ? format(new Date(radio.ordered_date), 'dd/MM/yyyy HH:mm:ss') : '',
      qty: radio.quantity || 1,
      rate: parseFloat(radio.cost) || parseFloat(radio.unit_rate) || 0
    })) || [],
    pharmacy: visitData?.pharmacyOrders?.map((med, index) => ({
      item: med.medications?.name || 'Medication',
      dateTime: med.prescribed_date ? format(new Date(med.prescribed_date), 'dd/MM/yyyy HH:mm:ss') : '',
      qty: med.quantity || 1,
      rate: med.medications?.price_per_strip || 0
    })) || [],
    surgery: visitData?.surgeryOrders?.map((surgery, index) => ({
      item: surgery.cghs_surgery?.name || 'Surgery',
      dateTime: surgery.created_at ? format(new Date(surgery.created_at), 'dd/MM/yyyy HH:mm:ss') : '',
      qty: 1,
      rate: surgery.rate && surgery.rate > 0
        ? Number(surgery.rate)
        : parseFloat(String(surgery.cghs_surgery?.NABH_NABL_Rate || '0').replace(/[^\d.]/g, '')) || 0
    })) || [],
    anesthetist: visitData?.anesthetistOrders?.map((anesthetist: any, index: number) => ({
      item: `${anesthetist.anesthetist_name || 'Anesthetist'} (${anesthetist.anesthetist_type || 'N/A'})`,
      dateTime: anesthetist.created_at ? format(new Date(anesthetist.created_at), 'dd/MM/yyyy HH:mm:ss') : '',
      qty: 1,
      rate: parseFloat(anesthetist.rate) || 0
    })) || [],
    implants: visitData?.implantOrders?.map((implant, index) => ({
      item: implant.implant_name ? `Implant ${implant.implant_name}` : 'Implant',
      dateTime: implant.created_at ? format(new Date(implant.created_at), 'dd/MM/yyyy HH:mm:ss') : '',
      qty: implant.quantity || 1,
      rate: parseFloat(implant.amount) || (implant.quantity * parseFloat(implant.rate)) || 0
    })) || [],
    mandatory: visitData?.mandatoryServices?.map((service, index) => {
      // Calculate days from start_date to end_date
      let days = service.quantity || 1;
      let dateTimeStr = service.selected_at ? format(new Date(service.selected_at), 'dd/MM/yyyy HH:mm:ss') : '';

      if (service.start_date && service.end_date) {
        const start = new Date(service.start_date);
        const end = new Date(service.end_date);
        days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
        dateTimeStr = `${format(start, 'dd/MM/yyyy')} - ${format(end, 'dd/MM/yyyy')}`;
      }

      // Get per-day rate
      const perDayRate = parseFloat(service.rate_used) || 0;
      // Calculate total = rate × days
      const totalAmount = perDayRate * days;

      return {
        item: service.mandatory_services?.service_name || 'Mandatory Service',
        dateTime: dateTimeStr,
        qty: days,
        rate: totalAmount
      };
    }) || [],
    totalAmount: patientData?.totalAmount || 0,
    discount: 0,
    amountPaid: 0,
    balance: patientData?.totalAmount || 0
  };

  // Calculate total from displayed serviceData values (rate * qty for each item)
  const calcLineTotal = (items: { rate?: number; qty?: number; cghsRate?: string | number }[]) =>
    items.reduce((sum, item) => sum + ((parseFloat(String(item.cghsRate)) || item.rate || 0) * (item.qty || 1)), 0);
  const calculatedTotal =
    calcLineTotal(serviceData.roomTariff) +
    calcLineTotal(serviceData.services) +
    calcLineTotal(serviceData.laboratory) +
    calcLineTotal(serviceData.radiology) +
    calcLineTotal(serviceData.surgery) +
    calcLineTotal(serviceData.implants) +
    calcLineTotal(serviceData.mandatory) +
    calcLineTotal(serviceData.pharmacy);

  // Convert to words
  const totalInWords = convertNumberToWords(calculatedTotal);

  console.log('🎯 ServiceData radiology array:', {
    length: serviceData.radiology.length,
    items: serviceData.radiology,
    visitDataRadiologyOrders: visitData?.radiologyOrders
  });


  if (isLoading) {
    return (
      <div className="min-h-screen bg-white p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading patient details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-white p-6 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">Error loading patient details: {error.message}</p>
          <button
            onClick={handleClose}
            className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  if (!patientData) {
    return (
      <div className="min-h-screen bg-white p-6 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">No patient data found for this visit.</p>
          <button
            onClick={handleClose}
            className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }
  // Toggle select all for a section
  const toggleSelectAll = (section: 'laboratory' | 'radiology' | 'surgery' | 'anesthetist' | 'implants') => {
    const items = section === 'laboratory' ? serviceData.laboratory :
                  section === 'radiology' ? serviceData.radiology :
                  section === 'surgery' ? serviceData.surgery :
                  section === 'anesthetist' ? serviceData.anesthetist :
                  serviceData.implants;
    const selected = section === 'laboratory' ? selectedLabItems :
                     section === 'radiology' ? selectedRadiologyItems :
                     section === 'surgery' ? selectedSurgeryItems :
                     section === 'anesthetist' ? selectedAnesthetistItems :
                     selectedImplantItems;
    const setter = section === 'laboratory' ? setSelectedLabItems :
                   section === 'radiology' ? setSelectedRadiologyItems :
                   section === 'surgery' ? setSelectedSurgeryItems :
                   section === 'anesthetist' ? setSelectedAnesthetistItems :
                   setSelectedImplantItems;
    if (selected.length === items.length) {
      setter([]);
    } else {
      setter(items.map((_: any, i: number) => i));
    }
  };

  return (
    <div className="min-h-screen bg-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Action Buttons */}
        <div className="flex justify-between items-center mb-4">
          <button
            onClick={handleClose}
            className="px-4 py-2 bg-gray-500 text-white text-sm rounded hover:bg-gray-600 flex items-center gap-2"
          >
            <X className="h-4 w-4" />
            Close
          </button>
          <div className="flex gap-2">
            <button
              onClick={handlePrint}
              disabled={!patientData}
              className={`px-4 py-2 text-white text-sm rounded flex items-center gap-2 ${
                patientData
                  ? 'bg-blue-600 hover:bg-blue-700 cursor-pointer'
                  : 'bg-gray-400 cursor-not-allowed'
              }`}
            >
              <Printer className="h-4 w-4" />
              {patientData ? 'Print Detailed Invoice' : 'Loading...'}
            </button>
            <button
              onClick={handleExcelExport}
              className="px-4 py-2 bg-green-500 text-white text-sm rounded hover:bg-green-600 flex items-center gap-2"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Generate Excel Report
            </button>
          </div>
        </div>

        {/* Invoice Document */}
        <div ref={printRef} className="border border-gray-400 bg-white">
          {/* Header */}
          <div className="text-center border-b border-gray-400 py-3">
            <h1 className="text-lg font-bold">Final Bill</h1>
            <h2 className="text-base font-semibold">{patientData.tariff}</h2>
            <h3 className="text-sm">CLAIM ID: {patientData.claimId}</h3>
          </div>

          {/* Patient Information */}
          <div className="border-b border-gray-400">
            <table className="w-full text-xs">
              <tbody>
                <tr className="border-b border-gray-300">
                  <td className="font-semibold p-2 w-1/4 border-r border-gray-300">BILL NO:</td>
                  <td className="p-2 w-1/4 border-r border-gray-300">{patientData.billNo}</td>
                  <td className="p-2 w-1/2 text-right font-semibold">Details:</td>
                </tr>
                <tr className="border-b border-gray-300">
                  <td className="font-semibold p-2 border-r border-gray-300">REGISTRATION NO:</td>
                  <td className="p-2 border-r border-gray-300">{patientData.registrationNo}</td>
                  <td></td>
                </tr>
                <tr className="border-b border-gray-300">
                  <td className="font-semibold p-2 border-r border-gray-300">NAME OF PATIENT:</td>
                  <td className="p-2 border-r border-gray-300">{patientData.patientName}</td>
                  <td></td>
                </tr>
                <tr className="border-b border-gray-300">
                  <td className="font-semibold p-2 border-r border-gray-300">AGE:</td>
                  <td className="p-2 border-r border-gray-300">{patientData.age}</td>
                  <td></td>
                </tr>
                <tr className="border-b border-gray-300">
                  <td className="font-semibold p-2 border-r border-gray-300">SEX:</td>
                  <td className="p-2 border-r border-gray-300">{patientData.sex}</td>
                  <td></td>
                </tr>
                <tr className="border-b border-gray-300">
                  <td className="font-semibold p-2 border-r border-gray-300">ADDRESS:</td>
                  <td className="p-2 border-r border-gray-300">{patientData.address}</td>
                  <td></td>
                </tr>
                <tr className="border-b border-gray-300">
                  <td className="font-semibold p-2 border-r border-gray-300">DESIGNATION:</td>
                  <td className="p-2 border-r border-gray-300">-</td>
                  <td></td>
                </tr>
                <tr className="border-b border-gray-300">
                  <td className="font-semibold p-2 border-r border-gray-300">CONTACT NO:</td>
                  <td className="p-2 border-r border-gray-300">{patientData.contactNo}</td>
                  <td></td>
                </tr>
                <tr className="border-b border-gray-300">
                  <td className="font-semibold p-2 border-r border-gray-300">BED CATEGORY:</td>
                  <td className="p-2 border-r border-gray-300">{patientData.bedCategory}</td>
                  <td></td>
                </tr>
                <tr className="border-b border-gray-300">
                  <td className="font-semibold p-2 border-r border-gray-300">UNITS NAME:</td>
                  <td className="p-2 border-r border-gray-300">{patientData.unitName}</td>
                  <td></td>
                </tr>
                <tr className="border-b border-gray-300">
                  <td className="font-semibold p-2 border-r border-gray-300">DATE OF ADMISSION:</td>
                  <td className="p-2 border-r border-gray-300">{patientData.dateOfAdmission}</td>
                  <td></td>
                </tr>
                <tr className="border-b border-gray-300">
                  <td className="font-semibold p-2 border-r border-gray-300">DATE OF DISCHARGE:</td>
                  <td className="p-2 border-r border-gray-300">{patientData.dateOfDischarge}</td>
                  <td></td>
                </tr>
                <tr>
                  <td className="font-semibold p-2 border-r border-gray-300">Primary Consultant:</td>
                  <td className="p-2 border-r border-gray-300" colSpan={2}>{patientData.primaryConsultant}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Services Tables */}

          {/* Service Categories Headers */}
          <table className="w-full border-collapse border border-gray-400 text-xs mb-0">
            <thead>
              <tr>
                <th className="border border-gray-400 p-1 bg-gray-100 font-bold text-center w-12">SR.NO.</th>
                <th className="border border-gray-400 p-1 bg-gray-100 font-bold text-center">ITEM</th>
                <th className="border border-gray-400 p-1 bg-gray-100 font-bold text-center w-32">Date & Time</th>
                <th className="border border-gray-400 p-1 bg-gray-100 font-bold text-center w-16">QTY/DAYS</th>
                <th className="border border-gray-400 p-1 bg-gray-100 font-bold text-center w-24">RATE</th>
              </tr>
            </thead>
          </table>

          {/* ACCOMMODATION CHARGES */}
          <div className="mb-0">
            <div className="bg-gray-200 border border-gray-400 border-t-0 p-1">
              <strong className="text-xs">ACCOMMODATION CHARGES</strong>
            </div>
            <table className="w-full border-collapse border border-gray-400 border-t-0 text-xs">
              <tbody>
                {serviceData.roomTariff.map((item, index) => (
                  <tr key={index}>
                    <td className="border border-gray-400 p-1 text-center w-12">{index + 1}</td>
                    <td className="border border-gray-400 p-1">{item.item}</td>
                    <td className="border border-gray-400 p-1 text-center w-32">{item.dateTime}</td>
                    <td className="border border-gray-400 p-1 text-center w-16">{item.qty}</td>
                    <td className="border border-gray-400 p-1 text-center w-24">{item.rate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* SERVICES */}
          <div className="mb-0">
            <div className="bg-gray-200 border border-gray-400 border-t-0 p-1">
              <strong className="text-xs">SERVICES</strong>
            </div>
            <table className="w-full border-collapse border border-gray-400 border-t-0 text-xs">
              <tbody>
                {serviceData.services.map((item, index) => (
                  <tr key={index}>
                    <td className="border border-gray-400 p-1 text-center w-12">{index + 1}</td>
                    <td className="border border-gray-400 p-1">{item.item}</td>
                    <td className="border border-gray-400 p-1 text-center w-32">{item.dateTime}</td>
                    <td className="border border-gray-400 p-1 text-center w-16">{item.qty}</td>
                    <td className="border border-gray-400 p-1 text-center w-24">{item.rate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* LABORATORY */}
          <div className="mb-0">
            <div className="bg-gray-200 border border-gray-400 border-t-0 p-1 flex justify-between items-center">
              <div className="flex items-center gap-2"><input type="checkbox" checked={selectedLabItems.length === serviceData.laboratory.length && serviceData.laboratory.length > 0} onChange={() => toggleSelectAll('laboratory')} className="cursor-pointer" title="Select All" /><strong className="text-xs">LABORATORY</strong><span className="text-[10px] text-gray-500">({selectedLabItems.length}/{serviceData.laboratory.length})</span></div>
              <div className="flex gap-1">
                <button onClick={() => handlePrintSectionAll('laboratory')} className="text-xs bg-green-100 px-1 hover:bg-green-200 cursor-pointer" title="Print All">📊</button>
                <button onClick={() => handlePrintSectionSelected('laboratory')} className="text-xs bg-blue-100 px-1 hover:bg-blue-200 cursor-pointer" title="Print Selected">🖨️</button>
                <button onClick={() => handlePrintSectionSummary('laboratory')} className="text-xs bg-red-100 px-1 hover:bg-red-200 cursor-pointer" title="Print Summary">📋</button>
              </div>
            </div>
            <table className="w-full border-collapse border border-gray-400 border-t-0 text-xs">
              <tbody>
                {serviceData.laboratory.map((item, index) => (
                  <tr key={index}>
                    <td className="border border-gray-400 p-1 text-center w-8">
                      <input
                        type="checkbox"
                        checked={selectedLabItems.includes(index)}
                        onChange={() => toggleItemSelection('laboratory', index)}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="border border-gray-400 p-1 text-center w-12">{index + 1}</td>
                    <td className="border border-gray-400 p-1">{item.item}</td>
                    <td className="border border-gray-400 p-1 text-center w-32">{item.dateTime}</td>
                    <td className="border border-gray-400 p-1 text-center w-16">{item.qty}</td>
                    <td className="border border-gray-400 p-1 text-center w-24">{item.rate}</td>
                  </tr>
                ))}
                {serviceData.laboratory.length === 0 && (
                  <tr>
                    <td className="border border-gray-400 p-1 text-center" colSpan={6}>No laboratory tests ordered</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* RADIOLOGY */}
          <div className="mb-4">
            <div className="bg-gray-200 border border-gray-400 border-t-0 p-1 flex justify-between items-center">
              <div className="flex items-center gap-2"><input type="checkbox" checked={selectedRadiologyItems.length === serviceData.radiology.length && serviceData.radiology.length > 0} onChange={() => toggleSelectAll('radiology')} className="cursor-pointer" title="Select All" /><strong className="text-xs">RADIOLOGY</strong><span className="text-[10px] text-gray-500">({selectedRadiologyItems.length}/{serviceData.radiology.length})</span></div>
              <div className="flex gap-1">
                <button onClick={() => handlePrintSectionAll('radiology')} className="text-xs bg-green-100 px-1 hover:bg-green-200 cursor-pointer" title="Print All">📊</button>
                <button onClick={() => handlePrintSectionSelected('radiology')} className="text-xs bg-blue-100 px-1 hover:bg-blue-200 cursor-pointer" title="Print Selected">🖨️</button>
                <button onClick={() => handlePrintSectionSummary('radiology')} className="text-xs bg-red-100 px-1 hover:bg-red-200 cursor-pointer" title="Print Summary">📋</button>
              </div>
            </div>
            <table className="w-full border-collapse border border-gray-400 border-t-0 text-xs">
              <tbody>
                {serviceData.radiology.map((item, index) => (
                  <tr key={index}>
                    <td className="border border-gray-400 p-1 text-center w-8">
                      <input
                        type="checkbox"
                        checked={selectedRadiologyItems.includes(index)}
                        onChange={() => toggleItemSelection('radiology', index)}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="border border-gray-400 p-1 text-center w-12">{index + 1}</td>
                    <td className="border border-gray-400 p-1">{item.item}</td>
                    <td className="border border-gray-400 p-1 text-center w-32">{item.dateTime}</td>
                    <td className="border border-gray-400 p-1 text-center w-16">{item.qty}</td>
                    <td className="border border-gray-400 p-1 text-center w-24">{item.rate}</td>
                  </tr>
                ))}
                {serviceData.radiology.length === 0 && (
                  <tr>
                    <td className="border border-gray-400 p-1 text-center" colSpan={6}>No radiology tests ordered</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* SURGERY (includes implants) */}
          <div className="mb-4">
            <div className="bg-gray-200 border border-gray-400 border-t-0 p-1 flex justify-between items-center">
              <div className="flex items-center gap-2"><input type="checkbox" checked={selectedSurgeryItems.length === serviceData.surgery.length && serviceData.surgery.length > 0} onChange={() => toggleSelectAll('surgery')} className="cursor-pointer" title="Select All" /><strong className="text-xs">SURGERY</strong><span className="text-[10px] text-gray-500">({selectedSurgeryItems.length}/{serviceData.surgery.length})</span></div>
              <div className="flex gap-1">
                <button onClick={() => handlePrintSectionAll('surgery')} className="text-xs bg-green-100 px-1 hover:bg-green-200 cursor-pointer" title="Print All">📊</button>
                <button onClick={() => handlePrintSectionSelected('surgery')} className="text-xs bg-blue-100 px-1 hover:bg-blue-200 cursor-pointer" title="Print Selected">🖨️</button>
                <button onClick={() => handlePrintSectionSummary('surgery')} className="text-xs bg-red-100 px-1 hover:bg-red-200 cursor-pointer" title="Print Summary">📋</button>
              </div>
            </div>
            <table className="w-full border-collapse border border-gray-400 border-t-0 text-xs">
              <tbody>
                {/* Render surgery items */}
                {serviceData.surgery.map((item, index) => (
                  <tr key={`surgery-${index}`}>
                    <td className="border border-gray-400 p-1 text-center w-8">
                      <input
                        type="checkbox"
                        checked={selectedSurgeryItems.includes(index)}
                        onChange={() => toggleItemSelection('surgery', index)}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="border border-gray-400 p-1 text-center w-12">{index + 1}</td>
                    <td className="border border-gray-400 p-1">{item.item}</td>
                    <td className="border border-gray-400 p-1 text-center w-32">{item.dateTime}</td>
                    <td className="border border-gray-400 p-1 text-center w-16">{item.qty}</td>
                    <td className="border border-gray-400 p-1 text-center w-24">{item.rate}</td>
                  </tr>
                ))}
                {/* Render implant items (numbering continues from surgery) */}
                {serviceData.implants?.map((item, index) => (
                  <tr key={`implant-${index}`}>
                    <td className="border border-gray-400 p-1 text-center w-8"></td>
                    <td className="border border-gray-400 p-1 text-center w-12">{serviceData.surgery.length + index + 1}</td>
                    <td className="border border-gray-400 p-1">{item.item}</td>
                    <td className="border border-gray-400 p-1 text-center w-32">{item.dateTime}</td>
                    <td className="border border-gray-400 p-1 text-center w-16">{item.qty}</td>
                    <td className="border border-gray-400 p-1 text-center w-24">{item.rate}</td>
                  </tr>
                ))}
                {/* Show "No surgeries performed" only if BOTH are empty */}
                {serviceData.surgery.length === 0 && (!serviceData.implants || serviceData.implants.length === 0) && (
                  <tr>
                    <td className="border border-gray-400 p-1 text-center" colSpan={6}>No surgeries performed</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ANESTHETIST */}
          <div className="mb-4">
            <div className="bg-gray-200 border border-gray-400 border-t-0 p-1 flex justify-between items-center">
              <div className="flex items-center gap-2"><input type="checkbox" checked={selectedAnesthetistItems.length === serviceData.anesthetist.length && serviceData.anesthetist.length > 0} onChange={() => toggleSelectAll('anesthetist')} className="cursor-pointer" title="Select All" /><strong className="text-xs">ANESTHETIST</strong><span className="text-[10px] text-gray-500">({selectedAnesthetistItems.length}/{serviceData.anesthetist.length})</span></div>
              <div className="flex gap-1">
                <button onClick={() => handlePrintSectionAll('anesthetist')} className="text-xs bg-green-100 px-1 hover:bg-green-200 cursor-pointer" title="Print All">📊</button>
                <button onClick={() => handlePrintSectionSelected('anesthetist')} className="text-xs bg-blue-100 px-1 hover:bg-blue-200 cursor-pointer" title="Print Selected">🖨️</button>
                <button onClick={() => handlePrintSectionSummary('anesthetist')} className="text-xs bg-red-100 px-1 hover:bg-red-200 cursor-pointer" title="Print Summary">📋</button>
              </div>
            </div>
            <table className="w-full border-collapse border border-gray-400 border-t-0 text-xs">
              <tbody>
                {serviceData.anesthetist.map((item, index) => (
                  <tr key={index}>
                    <td className="border border-gray-400 p-1 text-center w-8">
                      <input
                        type="checkbox"
                        checked={selectedAnesthetistItems.includes(index)}
                        onChange={() => toggleItemSelection('anesthetist', index)}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="border border-gray-400 p-1 text-center w-12">{index + 1}</td>
                    <td className="border border-gray-400 p-1">{item.item}</td>
                    <td className="border border-gray-400 p-1 text-center w-32">{item.dateTime}</td>
                    <td className="border border-gray-400 p-1 text-center w-16">{item.qty}</td>
                    <td className="border border-gray-400 p-1 text-center w-24">{item.rate}</td>
                  </tr>
                ))}
                {serviceData.anesthetist.length === 0 && (
                  <tr>
                    <td className="border border-gray-400 p-1 text-center" colSpan={6}>No anesthetist charges</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* MANDATORY SERVICES */}
          <div className="mb-4">
            <div className="bg-gray-200 border border-gray-400 border-t-0 p-1 flex justify-between items-center">
              <strong className="text-xs">MANDATORY SERVICES</strong>
            </div>
            <table className="w-full border-collapse border border-gray-400 border-t-0 text-xs">
              <tbody>
                {serviceData.mandatory.map((item, index) => (
                  <tr key={index}>
                    <td className="border border-gray-400 p-1 text-center w-12">{index + 1}</td>
                    <td className="border border-gray-400 p-1">{item.item}</td>
                    <td className="border border-gray-400 p-1 text-center w-32">{item.dateTime}</td>
                    <td className="border border-gray-400 p-1 text-center w-16">{item.qty}</td>
                    <td className="border border-gray-400 p-1 text-center w-24">{item.rate}</td>
                  </tr>
                ))}
                {serviceData.mandatory.length === 0 && (
                  <tr>
                    <td className="border border-gray-400 p-1 text-center" colSpan={5}>No mandatory services</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* PHARMACY */}
          {serviceData.pharmacy.length > 0 && (
            <div className="mb-4">
              <div className="bg-gray-200 border border-gray-400 border-t-0 p-1 flex justify-between items-center">
                <strong className="text-xs">PHARMACY</strong>
                <div className="flex gap-1">
                  <span className="text-xs bg-green-100 px-1">📊</span>
                  <span className="text-xs bg-blue-100 px-1">🖨️</span>
                  <span className="text-xs bg-red-100 px-1">📋</span>
                </div>
              </div>
              <table className="w-full border-collapse border border-gray-400 border-t-0 text-xs">
                <tbody>
                  {serviceData.pharmacy.map((item, index) => (
                    <tr key={index}>
                      <td className="border border-gray-400 p-1 text-center w-12">{index + 1}</td>
                      <td className="border border-gray-400 p-1">{item.item}</td>
                      <td className="border border-gray-400 p-1 text-center w-32">{item.dateTime}</td>
                      <td className="border border-gray-400 p-1 text-center w-16">{item.qty}</td>
                      <td className="border border-gray-400 p-1 text-center w-24">{item.rate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Total Amount Summary */}
          <div className="text-center mt-4 mb-4">
            <table className="w-full border-collapse border border-gray-400 text-xs">
              <tbody>
                <tr>
                  <td className="border border-gray-400 p-2 font-bold text-right">Total Amount</td>
                  <td className="border border-gray-400 p-2 text-center font-bold">{calculatedTotal}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Amount in Words */}
          <div className="text-xs mb-6">
            <strong>In Words:</strong> {totalInWords}
          </div>

          {/* Footer Signatures */}
          <div className="flex justify-between items-end text-xs mt-8 pt-4 border-t border-gray-400">
            <div className="text-center">
              <div className="mb-12"></div>
              <div className="border-t border-gray-400 pt-1">Bill Manager</div>
            </div>
            <div className="text-center">
              <div className="mb-12"></div>
              <div className="border-t border-gray-400 pt-1">Cashier</div>
            </div>
            <div className="text-center">
              <div className="mb-12"></div>
              <div className="border-t border-gray-400 pt-1">Med. Supdt.</div>
            </div>
            <div className="text-center">
              <div className="mb-12"></div>
              <div className="border-t border-gray-400 pt-1">Authorised Signature</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DetailedInvoice;
