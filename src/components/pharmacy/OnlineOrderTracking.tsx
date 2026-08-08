import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  ExternalLink,
  MapPin,
  PackageCheck,
  Phone,
  Pill,
  Truck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';

type DeliveryPartner = 'Shadowfax' | 'DTDC';
type OrderStatus = 'Preparing' | 'Out for delivery' | 'Delivered';

interface OnlineOrder {
  id: string;
  patient: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  placedAt: string;
  amount: number;
  payment: string;
  partner: DeliveryPartner;
  trackingId: string;
  status: OrderStatus;
  eta: string;
  medicines: Array<{ name: string; quantity: number; price: number }>;
}

const sampleOrders: OnlineOrder[] = [
  {
    id: 'MB-ONLINE-1048',
    patient: 'Riya Sharma',
    phone: '+91 98765 43210',
    address: '24, Green Park Extension',
    city: 'New Delhi',
    state: 'Delhi',
    placedAt: '08 Aug 2026, 12:48 PM',
    amount: 684,
    payment: 'Paid online',
    partner: 'Shadowfax',
    trackingId: 'SFX-DEL-1048',
    status: 'Out for delivery',
    eta: 'Today, 3:30–4:00 PM',
    medicines: [
      { name: 'Paracetamol 500 mg', quantity: 2, price: 84 },
      { name: 'Azithromycin 500 mg', quantity: 1, price: 210 },
      { name: 'Vitamin D3 capsules', quantity: 1, price: 390 },
    ],
  },
  {
    id: 'MB-ONLINE-1047',
    patient: 'Anil Kumar',
    phone: '+91 98100 11223',
    address: '12, Lake View Road',
    city: 'Jaipur',
    state: 'Rajasthan',
    placedAt: '08 Aug 2026, 10:16 AM',
    amount: 1_248,
    payment: 'Cash on delivery',
    partner: 'DTDC',
    trackingId: 'D1234567890',
    status: 'Preparing',
    eta: 'Expected 10 Aug 2026',
    medicines: [
      { name: 'Insulin Glargine 100 IU', quantity: 1, price: 899 },
      { name: 'Glucometer strips', quantity: 1, price: 349 },
    ],
  },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const statusSteps: OrderStatus[] = ['Preparing', 'Out for delivery', 'Delivered'];

const OnlineOrderTracking: React.FC<Props> = ({ open, onOpenChange }) => {
  const [selectedOrderId, setSelectedOrderId] = useState(sampleOrders[0].id);
  const [filter, setFilter] = useState<'all' | DeliveryPartner>('all');

  const orders = useMemo(
    () => filter === 'all' ? sampleOrders : sampleOrders.filter((order) => order.partner === filter),
    [filter],
  );
  const selectedOrder = orders.find((order) => order.id === selectedOrderId) || orders[0];

  const trackingUrl = selectedOrder?.partner === 'Shadowfax'
    ? `https://tracker.shadowfax.in/track/${selectedOrder.trackingId}`
    : `https://www.dtdc.in/tracking/tracking_results.asp?strCnno=${selectedOrder?.trackingId}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden p-0">
        <DialogHeader className="border-b bg-gradient-to-r from-blue-50 to-white px-6 py-5">
          <DialogTitle className="flex items-center gap-3 text-xl">
            <span className="rounded-xl bg-blue-600 p-2 text-white"><Truck className="h-5 w-5" /></span>
            Online medicine orders
            <Badge variant="secondary">{sampleOrders.length} orders</Badge>
          </DialogTitle>
          <p className="text-sm text-muted-foreground">Track every in-city Shadowfax delivery and other-state DTDC shipment.</p>
        </DialogHeader>

        <div className="grid min-h-0 grid-cols-1 md:grid-cols-[300px_1fr]">
          <aside className="min-h-0 overflow-y-auto border-r bg-slate-50/70 p-4">
            <div className="mb-4 flex gap-2">
              {(['all', 'Shadowfax', 'DTDC'] as const).map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={filter === value ? 'default' : 'outline'}
                  onClick={() => setFilter(value)}
                  className="flex-1 px-2"
                >
                  {value === 'all' ? 'All' : value}
                </Button>
              ))}
            </div>
            <div className="space-y-2">
              {orders.map((order) => (
                <button
                  key={order.id}
                  type="button"
                  onClick={() => setSelectedOrderId(order.id)}
                  className={`w-full rounded-xl border p-3 text-left transition ${selectedOrder?.id === order.id ? 'border-blue-500 bg-white shadow-sm ring-1 ring-blue-500' : 'border-slate-200 bg-white hover:border-blue-300'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-sm">{order.id}</span>
                    <Badge className={order.partner === 'Shadowfax' ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-100'}>{order.partner}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-700">{order.patient}</p>
                  <p className="text-xs text-muted-foreground">{order.city}, {order.state}</p>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-600">₹{order.amount.toLocaleString('en-IN')}</span>
                    <span className="text-blue-600">{order.status}</span>
                  </div>
                </button>
              ))}
            </div>
          </aside>

          {selectedOrder ? (
            <section className="min-h-0 overflow-y-auto p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2"><h2 className="text-lg font-semibold">{selectedOrder.id}</h2><Badge variant="outline">{selectedOrder.status}</Badge></div>
                  <p className="mt-1 text-sm text-muted-foreground">Placed {selectedOrder.placedAt}</p>
                </div>
                <Button asChild variant="outline"><a href={trackingUrl} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Track on {selectedOrder.partner}</a></Button>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <div className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">Customer</p><p className="mt-1 font-semibold">{selectedOrder.patient}</p><p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground"><Phone className="h-3.5 w-3.5" />{selectedOrder.phone}</p></div>
                <div className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">Delivery route</p><p className="mt-1 font-semibold">{selectedOrder.city}, {selectedOrder.state}</p><p className="mt-1 flex items-start gap-1 text-sm text-muted-foreground"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />{selectedOrder.address}</p></div>
                <div className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">Payment & ETA</p><p className="mt-1 font-semibold">₹{selectedOrder.amount.toLocaleString('en-IN')} · {selectedOrder.payment}</p><p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />{selectedOrder.eta}</p></div>
              </div>

              <div className="mt-6 rounded-xl border bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Delivery tracking</h3><span className="text-sm text-muted-foreground">{selectedOrder.partner} · {selectedOrder.trackingId}</span></div>
                <div className="mt-5 grid grid-cols-3 gap-2">
                  {statusSteps.map((step, index) => {
                    const active = statusSteps.indexOf(selectedOrder.status) >= index;
                    return <div key={step} className="relative text-center text-xs"><div className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full ${active ? 'bg-blue-600 text-white' : 'bg-white text-slate-400 ring-1 ring-slate-300'}`}>{active ? <CheckCircle2 className="h-4 w-4" /> : <span>{index + 1}</span>}</div><p className={`mt-2 ${active ? 'font-semibold text-blue-700' : 'text-muted-foreground'}`}>{step}</p>{index < statusSteps.length - 1 && <span className={`absolute left-[calc(50%+18px)] right-[calc(-50%+18px)] top-4 h-0.5 ${statusSteps.indexOf(selectedOrder.status) > index ? 'bg-blue-600' : 'bg-slate-300'}`} />}</div>;
                  })}
                </div>
              </div>

              <div className="mt-6 rounded-xl border p-4"><h3 className="flex items-center gap-2 font-semibold"><Pill className="h-4 w-4 text-blue-600" />Medicine details</h3><div className="mt-3 divide-y">{selectedOrder.medicines.map((medicine) => <div key={medicine.name} className="flex items-center justify-between py-3 text-sm"><span>{medicine.name} <span className="text-muted-foreground">× {medicine.quantity}</span></span><span className="font-medium">₹{(medicine.price * medicine.quantity).toLocaleString('en-IN')}</span></div>)}</div><Separator /><div className="flex justify-between pt-3 font-semibold"><span>Order total</span><span>₹{selectedOrder.amount.toLocaleString('en-IN')}</span></div></div>
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-800"><PackageCheck className="h-4 w-4 shrink-0" />{selectedOrder.partner === 'Shadowfax' ? 'In-city delivery is being handled by Shadowfax.' : 'This other-state order is being shipped through DTDC.'}<ArrowRight className="ml-auto h-4 w-4" /></div>
            </section>
          ) : <div className="flex items-center justify-center p-10 text-muted-foreground">No orders in this filter.</div>}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default OnlineOrderTracking;
