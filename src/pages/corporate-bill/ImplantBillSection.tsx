import { useEffect, useState } from 'react';
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
  hospitalName: string;
  hospitalAddress: string;
  defaultBillDate: string; // yyyy-MM-dd
  defaultImplantName: string;
}

const emptyItem = (): ImplantBillItem => ({ description: '', batchNo: '', qty: '', rate: '', amount: '' });

export function ImplantBillSection({
  visitId,
  hospitalName,
  hospitalAddress,
  defaultBillDate,
  defaultImplantName,
}: ImplantBillSectionProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [billNo, setBillNo] = useState(0);
  const [billDate, setBillDate] = useState(defaultBillDate);
  const [vendorName, setVendorName] = useState('');
  const [vendorAddress, setVendorAddress] = useState('');
  const [items, setItems] = useState<ImplantBillItem[]>([emptyItem()]);

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
          setVendorName(saved.vendorName);
          setVendorAddress(saved.vendorAddress);
          setItems(saved.items.length ? saved.items : [emptyItem()]);
        } else {
          const nextNo = await fetchNextImplantBillNo();
          if (cancelled) return;
          setBillNo(nextNo);
          setBillDate(defaultBillDate);
          if (defaultImplantName) {
            setItems([{ ...emptyItem(), description: defaultImplantName }]);
          }
        }
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
  }, [visitId, defaultBillDate, defaultImplantName]);

  const updateItem = (index: number, field: keyof ImplantBillItem, value: string) => {
    setItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      if (field === 'rate' || field === 'qty') {
        const rate = parseFloat(field === 'rate' ? value : next[index].rate) || 0;
        const qty = parseFloat(field === 'qty' ? value : next[index].qty) || 0;
        next[index].amount = rate && qty ? (rate * qty).toString() : '';
      }
      return next;
    });
  };

  const addItem = () => setItems((prev) => [...prev, emptyItem()]);
  const removeItem = (index: number) =>
    setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));

  const total = items.reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveImplantBill({
        visitId,
        billNo,
        billDate,
        vendorName,
        vendorAddress,
        items: items.filter((item) => item.description || item.batchNo),
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

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const rowsHtml = items
      .filter((item) => item.description || item.batchNo)
      .map(
        (item, index) => `
          <tr>
            <td style="text-align:center">${index + 1}</td>
            <td>${item.description}${item.batchNo ? `<br/><span style="font-size:10px">BATCH No: ${item.batchNo}</span>` : ''}</td>
            <td style="text-align:center">${item.qty || '-'}</td>
            <td style="text-align:center">${item.rate ? `${item.rate}/-` : '-'}</td>
            <td style="text-align:center">${item.amount ? `${item.amount}/-` : '-'}</td>
          </tr>`,
      )
      .join('');

    printWindow.document.write(`
      <html>
        <head>
          <title>Implant Bill - ${billNo}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; font-size: 13px; }
            h1 { text-align: center; margin: 0; font-size: 22px; }
            .sub { text-align: center; margin: 4px 0; }
            .header-box { display: flex; justify-content: space-between; border: 1px solid #000; margin-top: 16px; }
            .header-box > div { padding: 8px 12px; }
            .header-box .bill-to { flex: 1; border-right: 1px solid #000; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            th, td { border: 1px solid #000; padding: 6px 8px; }
            th { background: #000; color: #fff; }
            .totals { display: flex; justify-content: space-between; border: 1px solid #000; border-top: none; font-weight: bold; }
            .totals > div { padding: 8px 12px; }
            .totals .amount-words { flex: 1; border-right: 1px solid #000; }
            .terms { margin-top: 20px; font-size: 11px; }
            .terms ul { margin: 4px 0; padding-left: 18px; }
            .sign { margin-top: 40px; text-align: right; font-weight: bold; }
            @media print { @page { margin: 0.6in; } }
          </style>
        </head>
        <body>
          <h1>${vendorName || 'Vendor Name'}</h1>
          <p class="sub">${vendorAddress || ''}</p>
          <div class="header-box">
            <div class="bill-to">
              <strong>M/S</strong> ${hospitalName}<br/>
              ${hospitalAddress}
            </div>
            <div>
              <strong>Bill No.:</strong> ${billNo}<br/>
              <strong>Date:</strong> ${billDate ? new Date(billDate).toLocaleDateString('en-IN') : ''}
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th style="width:40px">Sr.</th>
                <th>Description</th>
                <th style="width:70px">Qty</th>
                <th style="width:90px">Rate</th>
                <th style="width:100px">Amount</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
          <div class="totals">
            <div class="amount-words">Rupees: ${amountInWords(total)} Only.</div>
            <div>Grand Total: ${total.toLocaleString('en-IN')}/-</div>
          </div>
          <div class="terms">
            <strong>Terms &amp; Conditions</strong>
            <ul>
              <li>This bill is payable immediately on presentation, otherwise interest @ 24% will be charged.</li>
              <li>Our risk and responsibility ceases on goods leaving our premises.</li>
              <li>Cheques are to be made in favour of the company.</li>
            </ul>
          </div>
          <div class="sign">For ${vendorName || 'Vendor Name'}</div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
    printWindow.close();
  };

  if (loading) {
    return <div className="p-4 text-sm text-gray-500">Loading implant bill…</div>;
  }

  return (
    <div className="w-[210mm] max-w-full shrink-0 bg-white shadow-lg print:hidden">
      <div className="p-6" style={{ fontFamily: 'Arial, sans-serif' }}>
        <div className="mb-3 flex flex-wrap gap-2">
          <button onClick={handlePrint} className="px-4 py-2 bg-green-500 text-white rounded font-bold hover:bg-green-600 text-sm">
            Print Implant Bill
          </button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-blue-500 text-white rounded font-bold hover:bg-blue-600 text-sm disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Implant Bill'}
          </button>
        </div>

        <div className="text-center border-b-2 border-black pb-2 mb-2">
          <h2 className="text-lg font-bold tracking-wide">Implant Bill</h2>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm mb-3">
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-500">Vendor name</label>
            <input value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="e.g. M.L. Enterprises"
              className="w-full border border-gray-300 rounded px-2 py-1" />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-500">Vendor address</label>
            <input value={vendorAddress} onChange={(e) => setVendorAddress(e.target.value)} placeholder="Vendor address"
              className="w-full border border-gray-300 rounded px-2 py-1" />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-500">Bill No. (sequential)</label>
            <input value={billNo} onChange={(e) => setBillNo(Number(e.target.value) || 0)}
              className="w-full border border-gray-300 rounded px-2 py-1" />
          </div>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-gray-500">Date (surgery date)</label>
            <input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)}
              className="w-full border border-gray-300 rounded px-2 py-1" />
          </div>
        </div>

        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-800 text-white">
              <th className="border px-2 py-1 w-[40px]">Sr.</th>
              <th className="border px-2 py-1">Description / Batch No.</th>
              <th className="border px-2 py-1 w-[70px]">Qty</th>
              <th className="border px-2 py-1 w-[80px]">Rate</th>
              <th className="border px-2 py-1 w-[90px]">Amount</th>
              <th className="border px-2 py-1 w-[40px]"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={index}>
                <td className="border px-1 py-1 text-center">{index + 1}</td>
                <td className="border px-1 py-1 space-y-1">
                  <input value={item.description} onChange={(e) => updateItem(index, 'description', e.target.value)}
                    placeholder="Item description" className="w-full text-sm outline-none border-none bg-transparent" />
                  <input value={item.batchNo} onChange={(e) => updateItem(index, 'batchNo', e.target.value)}
                    placeholder="Batch No." className="w-full text-xs text-gray-500 outline-none border-none bg-transparent" />
                </td>
                <td className="border px-1 py-1">
                  <input value={item.qty} onChange={(e) => updateItem(index, 'qty', e.target.value)}
                    className="w-full text-center text-sm outline-none border-none bg-transparent" placeholder="0" />
                </td>
                <td className="border px-1 py-1">
                  <input value={item.rate} onChange={(e) => updateItem(index, 'rate', e.target.value)}
                    className="w-full text-center text-sm outline-none border-none bg-transparent" placeholder="0" />
                </td>
                <td className="border px-2 py-1 text-center font-bold">{item.amount || ''}</td>
                <td className="border px-1 py-1 text-center whitespace-nowrap">
                  <button onClick={addItem} className="text-green-600 hover:text-green-800 font-bold text-sm mr-1">+</button>
                  {items.length > 1 && (
                    <button onClick={() => removeItem(index)} className="text-red-500 hover:text-red-700 font-bold text-sm">-</button>
                  )}
                </td>
              </tr>
            ))}
            <tr className="font-bold">
              <td className="border px-2 py-1 text-center" colSpan={4}>Total</td>
              <td className="border px-2 py-1 text-center">{total || ''}</td>
              <td className="border"></td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-xs text-gray-500">Rupees: {amountInWords(total)} Only.</p>
      </div>
    </div>
  );
}

export default ImplantBillSection;
