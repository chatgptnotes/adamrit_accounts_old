import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RefreshCw, PackageCheck, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// Orders placed by an external system through the partner API.
//
// Stock has ALREADY left the shelf by the time an order appears here — placing
// the order moved the quantity from current_stock into reserved_stock. Confirm
// books it as sold; Reject puts it straight back on the shelf.
//
// Everything goes through /api/partner/admin-orders because the underlying RPCs
// are granted to service_role only: the browser talks to Postgres as anon and
// cannot call them directly.

type PartnerOrderItem = {
  medicine_name: string | null;
  batch_number: string | null;
  expiry_date: string | null;
  quantity: number;
  unit_price: number | null;
  line_amount: number | null;
};

type PartnerOrder = {
  id: string;
  order_number: string;
  partner_ref: string | null;
  status: string;
  total_amount: number | null;
  notes: string | null;
  requested_at: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  closed_reason: string | null;
  partner_api_clients: { partner_name: string } | null;
  partner_order_items: PartnerOrderItem[];
};

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  DISPATCHED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-gray-100 text-gray-700',
  REJECTED: 'bg-red-100 text-red-800',
};

const FILTERS = ['PENDING', 'DISPATCHED', 'REJECTED', 'CANCELLED', ''] as const;
const FILTER_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  DISPATCHED: 'Dispatched',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  '': 'All',
};

const PartnerOrders = () => {
  const { toast } = useToast();
  const [orders, setOrders] = useState<PartnerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('PENDING');

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const query = filter ? `?status=${filter}` : '';
      const response = await fetch(`/api/partner/admin-orders${query}`, { credentials: 'include' });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || 'Could not load partner orders');
      setOrders(body.orders || []);
    } catch (error) {
      toast({
        title: 'Could not load partner orders',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [filter, toast]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const act = async (order: PartnerOrder, action: 'confirm' | 'reject') => {
    const reason =
      action === 'reject'
        ? window.prompt(`Why is ${order.order_number} being rejected? (optional)`) ?? undefined
        : undefined;

    setBusyId(order.id);
    try {
      const response = await fetch('/api/partner/admin-orders', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: order.id, action, reason }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error || 'Action failed');

      toast({
        title: action === 'confirm' ? 'Order dispatched' : 'Order rejected',
        description:
          action === 'confirm'
            ? `${order.order_number} is booked as sold.`
            : `${order.order_number} released — the reserved stock is back on the shelf.`,
      });
      loadOrders();
    } catch (error) {
      toast({
        title: 'Action failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Partner Orders</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Orders placed by external systems. The stock is already reserved — confirming books it as
            sold, rejecting returns it to available stock.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadOrders} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex gap-2">
          {FILTERS.map((value) => (
            <Button
              key={value || 'all'}
              size="sm"
              variant={filter === value ? 'default' : 'outline'}
              onClick={() => setFilter(value)}
            >
              {FILTER_LABELS[value]}
            </Button>
          ))}
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            No {FILTER_LABELS[filter].toLowerCase()} partner orders.
          </p>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => (
              <div key={order.id} className="border rounded-md p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{order.order_number}</span>
                      <Badge className={STATUS_STYLES[order.status] || ''}>{order.status}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {order.partner_api_clients?.partner_name || 'Unknown partner'}
                      {order.partner_ref ? ` · their ref ${order.partner_ref}` : ''} ·{' '}
                      {new Date(order.requested_at).toLocaleString('en-IN')}
                    </p>
                    {order.notes && <p className="text-sm mt-1">{order.notes}</p>}
                    {order.closed_reason && (
                      <p className="text-sm text-muted-foreground mt-1">Reason: {order.closed_reason}</p>
                    )}
                    {order.confirmed_by && (
                      <p className="text-xs text-muted-foreground mt-1">Actioned by {order.confirmed_by}</p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="font-semibold">
                      ₹{Number(order.total_amount || 0).toLocaleString('en-IN')}
                    </span>
                    {order.status === 'PENDING' && (
                      <>
                        <Button size="sm" disabled={busyId === order.id} onClick={() => act(order, 'confirm')}>
                          <PackageCheck className="h-4 w-4 mr-1" />
                          Confirm &amp; Dispatch
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={busyId === order.id}
                          onClick={() => act(order, 'reject')}
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          Reject
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Medicine</TableHead>
                      <TableHead>Batch</TableHead>
                      <TableHead>Expiry</TableHead>
                      <TableHead className="text-right">Qty (pieces)</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(order.partner_order_items || []).map((item, index) => (
                      <TableRow key={index}>
                        <TableCell>{item.medicine_name || '—'}</TableCell>
                        <TableCell>{item.batch_number || '—'}</TableCell>
                        <TableCell>
                          {item.expiry_date ? new Date(item.expiry_date).toLocaleDateString('en-IN') : '—'}
                        </TableCell>
                        <TableCell className="text-right">{item.quantity}</TableCell>
                        <TableCell className="text-right">
                          ₹{Number(item.unit_price || 0).toLocaleString('en-IN')}
                        </TableCell>
                        <TableCell className="text-right">
                          ₹{Number(item.line_amount || 0).toLocaleString('en-IN')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default PartnerOrders;
