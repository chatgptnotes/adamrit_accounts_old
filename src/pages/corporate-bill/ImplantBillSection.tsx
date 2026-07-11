import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { amountInWords } from '@/lib/amountInWords';
import {
  fetchImplantBillByVisit,
  fetchNextImplantBillNo,
  saveImplantBill,
  type ImplantBillItem,
} from '@/lib/implantBillDb';

interface ImplantBillSectionProps {
  visitId: string;
  patientName: string;
  defaultBillDate: string; // yyyy-MM-dd
  defaultImplantName: string;
}

const VENDOR_NAME = 'M.L. ENTERPRISES';
const VENDOR_ADDRESS = 'B-6, PLOT NO. 3, CHAYA COMPLEX, WATHODA RING ROAD, NAGPUR';
const VENDOR_PHONE = 'TEL. 0712-2715156';
const HOSPITAL_LINE_1 = 'Hope Hospital, 02, Tekanaka, Kamptee Road,';
const HOSPITAL_LINE_2 = 'Nagpur-440017';

const emptyItem = (): ImplantBillItem => ({ description: '', batchNo: '', qty: '', rate: '', amount: '' });

const defaultItems = (implantName: string): ImplantBillItem[] => [
  {
    description: implantName || 'Stainless Steel Plates ( Mandibular Body )',
    batchNo: 'CS0889/465897',
    qty: '02',
    rate: '4500',
    amount: '9000',
  },
  { description: 'Stainless Screws', batchNo: 'CS0790/465774', qty: '08', rate: '150', amount: '1200' },
  { description: 'Distal Radius Plate With 3 Hole', batchNo: 'CS0789/465723', qty: '01', rate: '6000', amount: '6000' },
  { description: 'Stainless Screws', batchNo: 'CS0789/465724', qty: '05', rate: '150', amount: '750' },
];

const numberValue = (value: string) => Number(String(value).replace(/,/g, '')) || 0;
const money = (value: number | string) => `${numberValue(String(value)).toLocaleString('en-IN')}/-`;
const displayDate = (value: string) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-GB');
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

export function ImplantBillSection({
  visitId,
  patientName,
  defaultBillDate,
  defaultImplantName,
}: ImplantBillSectionProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [billNo, setBillNo] = useState(0);
  const [billDate, setBillDate] = useState(defaultBillDate);
  const [billPatientName, setBillPatientName] = useState(patientName);
  const [items, setItems] = useState<ImplantBillItem[]>(() => defaultItems(defaultImplantName));

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const saved = await fetchImplantBillByVisit(visitId);
        if (cancelled) return;
        if (saved) {
          setBillNo(saved.billNo);
          setBillDate(saved.billDate || defaultBillDate);
          setItems(saved.items.length ? saved.items : defaultItems(defaultImplantName));
        } else {
          const nextNo = await fetchNextImplantBillNo();
          if (cancelled) return;
          setBillNo(nextNo || 1244);
          setBillDate(defaultBillDate);
          setItems(defaultItems(defaultImplantName));
        }
        setBillPatientName(patientName || '');
      } catch (error) {
        console.error('Failed to load implant bill:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [visitId, defaultBillDate, defaultImplantName, patientName]);

  const updateItem = (index: number, field: keyof ImplantBillItem, value: string) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      if (field === 'rate' || field === 'qty') {
        const rate = numberValue(field === 'rate' ? value : next[index].rate);
        const qty = numberValue(field === 'qty' ? value : next[index].qty);
        next[index].amount = rate && qty ? String(rate * qty) : '';
      }
      return next;
    });
  };

  const addItem = () => setItems((prev) => [...prev, emptyItem()]);
  const removeItem = (index: number) =>
    setItems((prev) => (prev.length > 1 ? prev.filter((_, itemIndex) => itemIndex !== index) : prev));

  const activeItems = useMemo(
    () => items.filter((item) => item.description || item.batchNo || item.qty || item.rate),
    [items],
  );
  const total = activeItems.reduce((sum, item) => sum + numberValue(item.amount), 0);
  const words = amountInWords(total).replace('Rupees ', '');

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveImplantBill({
        visitId,
        billNo,
        billDate,
        vendorName: VENDOR_NAME,
        vendorAddress: VENDOR_ADDRESS,
        items: activeItems,
        totalAmount: total,
      });
      toast.success('Implant bill saved.');
    } catch (error) {
      console.error('Failed to save implant bill:', error);
      toast.error('Could not save the implant bill.');
    } finally {
      setSaving(false);
    }
  };

  const renderPrintHtml = () => {
    const rows = activeItems
      .map(
        (item, index) => `
          <div class="bill-item">
            <div class="desc">
              <div><span class="serial">${index + 1}.</span><strong>${escapeHtml(item.description)}</strong></div>
              ${item.batchNo ? `<div class="batch">BATCH No: ${escapeHtml(item.batchNo)}</div>` : ''}
            </div>
            <div class="qty"><strong>${escapeHtml(item.qty)}</strong></div>
            <div class="rate"><strong>${item.rate ? money(item.rate) : ''}</strong></div>
            <div class="amount"><strong>${item.amount ? money(item.amount) : ''}</strong></div>
          </div>`,
      )
      .join('');

    return `
      <html>
        <head>
          <title>Implant Bill - ${billNo}</title>
          <style>
            body { margin: 0; background: white; color: #000; font-family: "Times New Roman", serif; }
            .bill-page { width: 190mm; margin: 0 auto; padding: 12mm 0; }
            .title { text-align: center; font-size: 30pt; font-weight: 700; letter-spacing: .01em; }
            .vendor-address { text-align: center; font-size: 14pt; font-weight: 700; margin-top: 8px; }
            .vendor-phone { text-align: center; font-size: 13pt; font-weight: 700; margin-top: 4px; }
            .top-box { display: grid; grid-template-columns: 1.55fr 1fr; border: 1px solid #000; min-height: 116px; margin-top: 6px; }
            .top-left { border-right: 1px solid #000; padding: 10px 12px; font-size: 15pt; line-height: 1.25; }
            .top-right { padding: 10px 12px; font-size: 15pt; line-height: 1.35; }
            .under { display: inline-block; border-bottom: 1px solid #000; min-width: 342px; }
            .wide-line { border-bottom: 2px solid #000; height: 44px; margin-top: 12px; }
            .item-grid { display: grid; grid-template-columns: 1fr 28mm 28mm 32mm; border: 1px solid #000; border-top: 0; min-height: 129mm; }
            .head { display: contents; }
            .head > div { background: #000; color: #fff; text-align: center; padding: 10px 4px; font-size: 14pt; font-weight: 700; border-bottom: 1px solid #000; }
            .col-border { border-left: 1px solid #000; }
            .items { display: contents; }
            .bill-item { display: contents; }
            .bill-item > div { padding: 5px 10px; font-size: 14pt; }
            .desc { padding-left: 22px !important; }
            .serial { display: inline-block; width: 28px; font-weight: 700; }
            .batch { margin-left: 44px; font-size: 9pt; font-family: Arial, sans-serif; font-weight: 700; }
            .qty, .rate, .amount { border-left: 1px solid #000; text-align: center; }
            .total-row { display: grid; grid-template-columns: 1fr 28mm 32mm; border: 1px solid #000; border-top: 0; font-size: 14pt; font-weight: 700; }
            .total-row > div { padding: 9px 8px; }
            .total-label, .total-amount { border-left: 1px solid #000; }
            .tax-box { border: 1px solid #000; margin-top: 18px; }
            .declaration { display: grid; grid-template-columns: 1fr 58mm; padding: 8px 10px; font-size: 10.5pt; border-bottom: 1px solid #000; }
            .terms { padding: 8px 10px 10px; font-size: 9.5pt; min-height: 66px; position: relative; }
            .terms ul { margin: 2px 0 0 48px; padding-left: 14px; }
            .sign { position: absolute; right: 14px; bottom: 10px; font-size: 14pt; font-weight: 700; }
            @page { size: A4 portrait; margin: 10mm; }
          </style>
        </head>
        <body>
          <div class="bill-page">
            <div class="title">${VENDOR_NAME}</div>
            <div class="vendor-address">${VENDOR_ADDRESS}</div>
            <div class="vendor-phone">${VENDOR_PHONE}</div>
            <div class="top-box">
              <div class="top-left">
                <div>M/S&nbsp;&nbsp;&nbsp;<strong>${escapeHtml(billPatientName)}</strong></div>
                <div class="under">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${HOSPITAL_LINE_1}</div>
                <div class="under">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${HOSPITAL_LINE_2}</div>
                <div class="wide-line"></div>
              </div>
              <div class="top-right">
                <div>Bill No.: <strong>${billNo}</strong></div>
                <div style="margin-top: 64px;">Date: ${displayDate(billDate)}</div>
              </div>
            </div>
            <div class="item-grid">
              <div class="head">
                <div>DESCRIPTION</div><div class="col-border">QUANTITY</div><div class="col-border">RATE</div><div class="col-border">AMOUNT</div>
              </div>
              <div class="items">${rows}</div>
            </div>
            <div class="total-row">
              <div>Rupees: ${words}.</div>
              <div class="total-label">Grand Total</div>
              <div class="total-amount" style="text-align:center;">${money(total)}</div>
            </div>
            <div class="tax-box">
              <div class="declaration">
                <div>
                  <div>Declaration:</div>
                  <div>We declare that this invoice shows the actual price of the goods</div>
                  <div>Described and that all particulars are true and correct</div>
                </div>
                <div>
                  <div>B.S.T. No.:4400008/S/2562 Dt. 08/12/99</div>
                  <div>C.S. T. No.:440008/C/2195 Dt. 08/12/99</div>
                </div>
              </div>
              <div class="terms">
                <div>Terms &amp; Conditions</div>
                <ul>
                  <li>This bill is payable immediately on presentation, otherwise interest @ 24% will be charged.</li>
                  <li>Our risk and responsibility creases on goods our premises.</li>
                  <li>Cheques are to be made cross other in favour of&nbsp; the company.</li>
                </ul>
                <div class="sign">For ${VENDOR_NAME}</div>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(renderPrintHtml());
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
    printWindow.close();
  };

  if (loading) {
    return <div className="p-4 text-sm text-gray-500">Loading implant bill...</div>;
  }

  return (
    <div className="w-[210mm] max-w-full shrink-0 bg-white shadow-lg print:hidden">
      <div className="p-6" style={{ fontFamily: '"Times New Roman", serif' }}>
        <div className="mb-3 flex flex-wrap gap-2" style={{ fontFamily: 'Arial, sans-serif' }}>
          <button onClick={handlePrint} className="rounded bg-green-500 px-4 py-2 text-sm font-bold text-white hover:bg-green-600">
            Print Implant Bill
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-blue-500 px-4 py-2 text-sm font-bold text-white hover:bg-blue-600 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Implant Bill'}
          </button>
        </div>

        <div className="mx-auto w-full max-w-[720px] bg-white text-black">
          <div className="text-center text-[40px] font-bold leading-none tracking-wide">{VENDOR_NAME}</div>
          <div className="mt-3 text-center text-[18px] font-bold">{VENDOR_ADDRESS}</div>
          <div className="mt-1 text-center text-[17px] font-bold">{VENDOR_PHONE}</div>

          <div className="mt-2 grid min-h-[116px] grid-cols-[1.55fr_1fr] border border-black">
            <div className="border-r border-black p-3 text-[20px] leading-tight">
              <div className="flex items-baseline gap-4">
                <span>M/S</span>
                <input
                  value={billPatientName}
                  onChange={(event) => setBillPatientName(event.target.value)}
                  className="min-w-0 flex-1 bg-transparent font-bold outline-none"
                />
              </div>
              <div className="ml-[55px] border-b border-black">{HOSPITAL_LINE_1}</div>
              <div className="ml-[55px] border-b border-black">{HOSPITAL_LINE_2}</div>
              <div className="mt-10 border-b-2 border-black" />
            </div>
            <div className="p-3 text-[20px]">
              <label className="flex items-center gap-2">
                <span>Bill No.:</span>
                <input
                  value={billNo}
                  onChange={(event) => setBillNo(Number(event.target.value) || 0)}
                  className="w-28 bg-transparent font-bold outline-none"
                />
              </label>
              <label className="mt-14 flex items-center gap-2">
                <span>Date:</span>
                <input
                  type="date"
                  value={billDate}
                  onChange={(event) => setBillDate(event.target.value)}
                  className="bg-transparent outline-none"
                />
              </label>
            </div>
          </div>

          <div className="mt-7 grid grid-cols-[1fr_105px_105px_115px] border border-black">
            <div className="bg-black py-3 text-center text-[20px] font-bold text-white">DESCRIPTION</div>
            <div className="border-l border-black bg-black py-3 text-center text-[20px] font-bold text-white">QUANTITY</div>
            <div className="border-l border-black bg-black py-3 text-center text-[20px] font-bold text-white">RATE</div>
            <div className="border-l border-black bg-black py-3 text-center text-[20px] font-bold text-white">AMOUNT</div>

            <div className="min-h-[465px] px-8 py-8">
              {items.map((item, index) => (
                <div key={index} className="mb-2">
                  <div className="flex items-baseline gap-3">
                    <span className="w-7 text-right text-[18px] font-bold">{index + 1}.</span>
                    <input
                      value={item.description}
                      onChange={(event) => updateItem(index, 'description', event.target.value)}
                      className="min-w-0 flex-1 bg-transparent text-[18px] font-bold outline-none"
                      placeholder="Implant description"
                    />
                  </div>
                  <input
                    value={item.batchNo}
                    onChange={(event) => updateItem(index, 'batchNo', event.target.value)}
                    className="ml-12 w-[240px] bg-transparent text-[11px] font-bold outline-none"
                    placeholder="BATCH No"
                  />
                </div>
              ))}
              <button onClick={addItem} className="mt-2 text-sm font-bold text-green-700" style={{ fontFamily: 'Arial, sans-serif' }}>
                + Add item
              </button>
            </div>
            <div className="min-h-[465px] border-l border-black px-4 py-8">
              {items.map((item, index) => (
                <input
                  key={index}
                  value={item.qty}
                  onChange={(event) => updateItem(index, 'qty', event.target.value)}
                  className="mb-[30px] block w-full bg-transparent text-center text-[20px] font-bold outline-none"
                  placeholder="0"
                />
              ))}
            </div>
            <div className="min-h-[465px] border-l border-black px-4 py-8">
              {items.map((item, index) => (
                <input
                  key={index}
                  value={item.rate}
                  onChange={(event) => updateItem(index, 'rate', event.target.value)}
                  className="mb-[30px] block w-full bg-transparent text-center text-[20px] font-bold outline-none"
                  placeholder="0"
                />
              ))}
            </div>
            <div className="min-h-[465px] border-l border-black px-4 py-8">
              {items.map((item, index) => (
                <div key={index} className="mb-[30px] flex items-center justify-center gap-1 text-[20px] font-bold">
                  <span>{item.amount ? money(item.amount) : ''}</span>
                  {items.length > 1 && (
                    <button
                      onClick={() => removeItem(index)}
                      className="text-xs font-bold text-red-600"
                      style={{ fontFamily: 'Arial, sans-serif' }}
                    >
                      x
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-[1fr_105px_115px] border-x border-b border-black text-[18px] font-bold">
            <div className="px-3 py-3">Rupees: {words}.</div>
            <div className="border-l border-black px-3 py-3">Grand Total</div>
            <div className="border-l border-black px-3 py-3 text-center">{money(total)}</div>
          </div>

          <div className="mt-7 border border-black text-[14px]">
            <div className="grid grid-cols-[1fr_285px] border-b border-black p-3">
              <div>
                <div>Declaration:</div>
                <div>We declare that this invoice shows the actual price of the goods</div>
                <div>Described and that all particulars are true and correct</div>
              </div>
              <div>
                <div>B.S.T. No.:4400008/S/2562 Dt. 08/12/99</div>
                <div>C.S. T. No.:440008/C/2195 Dt. 08/12/99</div>
              </div>
            </div>
            <div className="relative min-h-[92px] p-3 text-[13px]">
              <div>Terms &amp; Conditions</div>
              <ul className="ml-14 mt-1 list-disc">
                <li>This bill is payable immediately on presentation, otherwise interest @ 24% will be charged.</li>
                <li>Our risk and responsibility creases on goods our premises.</li>
                <li>Cheques are to be made cross other in favour of&nbsp; the company.</li>
              </ul>
              <div className="absolute bottom-3 right-4 text-[20px] font-bold">For {VENDOR_NAME}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ImplantBillSection;
