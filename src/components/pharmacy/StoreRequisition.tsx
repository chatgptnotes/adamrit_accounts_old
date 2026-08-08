import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Package, 
  FileText, 
  ShoppingCart, 
  BarChart3,
  ArrowLeft
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const StoreRequisition: React.FC = () => {
  const [selectedTab, setSelectedTab] = useState('add-order');
  const [requisitionDropdownOpen, setRequisitionDropdownOpen] = useState(false);
  const [supplierDropdownOpen, setSupplierDropdownOpen] = useState(false);
  const [reportsDropdownOpen, setReportsDropdownOpen] = useState(false);
  const [selectedSupplierTab, setSelectedSupplierTab] = useState('suppliers');
  const [showCurrentStock, setShowCurrentStock] = useState(false);
  const [department, setDepartment] = useState('');
  const [itemName, setItemName] = useState('');
  const navigate = useNavigate();

  // Dummy data for table
  const currentStockData = [
    { sno: 1, itemName: 'Paracetamol 500mg', curStock: 120, totalCurStock: 120, batchNo: 'B123', expiryDate: '2025-12-31', reorderLevel: 20, purPrice: 12.5, mrp: 20, totalPrice: 1500, totalSale: 1000 },
    { sno: 2, itemName: 'Ibuprofen 400mg', curStock: 80, totalCurStock: 80, batchNo: 'B456', expiryDate: '2025-10-15', reorderLevel: 15, purPrice: 10, mrp: 18, totalPrice: 800, totalSale: 600 },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => navigate('/pharmacy')}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Pharmacy
          </Button>
          <Package className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Store Requisition</h1>
            <p className="text-muted-foreground">
              Manage store requisitions and related operations
            </p>
          </div>
        </div>
      </div>

      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-6">
        <TabsList className="flex h-auto w-full flex-wrap items-center justify-start gap-x-4 gap-y-1 bg-blue-50 rounded-md">
            <div
              className="relative flex items-center group"
              onMouseEnter={() => setRequisitionDropdownOpen(true)}
              onMouseLeave={() => setRequisitionDropdownOpen(false)}
              tabIndex={0}
              data-state={requisitionDropdownOpen ? 'active' : undefined}
            >
              <button
                className={
                  `inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm ${requisitionDropdownOpen ? 'bg-white text-black shadow-sm' : 'text-blue-900 bg-transparent hover:bg-blue-100'}`
                }
                type="button"
                tabIndex={-1}
              >
                Purchase Orders
                <svg className="ml-2 w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
              </button>
              {requisitionDropdownOpen && (
                <div className="absolute left-0 top-full z-10 min-w-[220px] bg-white text-blue-900 rounded-b shadow-lg border border-blue-200 mt-1">
                  <ul className="flex flex-col divide-y divide-blue-100">
                    <li><button className="w-full text-left px-4 py-2 hover:bg-blue-50" onClick={() => navigate('/pharmacy/purchase-orders/add')}>Add Order</button></li>
                    <li><button className="w-full text-left px-4 py-2 hover:bg-blue-50" onClick={() => navigate('/pharmacy/purchase-orders/list')}>Orders list</button></li>
                    <li><button className="w-full text-left px-4 py-2 hover:bg-blue-50" onClick={() => navigate('/pharmacy/goods-received-note')}>Goods Received Note</button></li>
                    <li><button className="w-full text-left px-4 py-2 hover:bg-blue-50" onClick={() => navigate('/pharmacy/product-purchase-report')}>Product Purchase Report</button></li>
                    <li><button className="w-full text-left px-4 py-2 hover:bg-blue-50" onClick={() => navigate('/pharmacy/inventory-tracking')}>Inventory Tracking</button></li>
                  </ul>
                </div>
              )}
            </div>
            <div
              className="relative flex items-center group"
              onMouseEnter={() => setSupplierDropdownOpen(true)}
              onMouseLeave={() => setSupplierDropdownOpen(false)}
              tabIndex={0}
              data-state={supplierDropdownOpen ? 'active' : undefined}
            >
              <button
                className={
                  `inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm ${supplierDropdownOpen || selectedSupplierTab === 'suppliers' || selectedSupplierTab === 'manufacturer' ? 'bg-white text-black shadow-sm' : 'text-blue-900 bg-transparent hover:bg-blue-100'}`
                }
                type="button"
                tabIndex={-1}
              >
                Suppliers
                <svg className="ml-2 w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
              </button>
              {supplierDropdownOpen && (
                <div className="absolute left-0 top-full z-10 min-w-[180px] bg-white text-blue-900 rounded-b shadow-lg border border-blue-200 mt-1">
                  <ul className="flex flex-col divide-y divide-blue-100">
                    <li><button className={`w-full text-left px-4 py-2 hover:bg-blue-50 font-bold ${selectedSupplierTab === 'suppliers' ? 'bg-blue-100' : ''}`} onClick={() => { setSelectedSupplierTab('suppliers'); setSupplierDropdownOpen(false); }}>Supplier</button></li>
                    <li><button className={`w-full text-left px-4 py-2 hover:bg-blue-50 font-bold ${selectedSupplierTab === 'manufacturer' ? 'bg-blue-100' : ''}`} onClick={() => { setSelectedSupplierTab('manufacturer'); setSupplierDropdownOpen(false); }}>Manufacturer</button></li>
                  </ul>
                </div>
              )}
            </div>
            <div
              className="relative flex items-center group"
              onMouseEnter={() => setReportsDropdownOpen(true)}
              onMouseLeave={() => setReportsDropdownOpen(false)}
              tabIndex={0}
              data-state={reportsDropdownOpen ? 'active' : undefined}
            >
              <button
                className={
                  `inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm ${reportsDropdownOpen ? 'bg-white text-black shadow-sm' : 'text-blue-900 bg-transparent hover:bg-blue-100'}`
                }
                type="button"
                tabIndex={-1}
                data-state={reportsDropdownOpen ? 'active' : undefined}
              >
                Reports
                <svg className="ml-2 w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
              </button>
              {reportsDropdownOpen && (
                <div className="absolute left-0 top-full z-10 min-w-[220px] bg-white text-blue-900 rounded-b shadow-lg border border-blue-200 mt-1">
                  <ul className="flex flex-col divide-y divide-blue-100">
                    <li><button className="w-full text-left px-4 py-2 hover:bg-blue-50" onClick={() => { setShowCurrentStock(true); setReportsDropdownOpen(false); }}>Current stock</button></li>
                    <li><button className="w-full text-left px-4 py-2 hover:bg-blue-50" onClick={() => { setShowCurrentStock(false); }}>Stock register</button></li>
                    <li><button className="w-full text-left px-4 py-2 hover:bg-blue-50" onClick={() => { setShowCurrentStock(false); }}>Non-Movable Products</button></li>
                    <li><button className="w-full text-left px-4 py-2 hover:bg-blue-50" onClick={() => { setShowCurrentStock(false); }}>Opening Closing Stock</button></li>
                  </ul>
                </div>
              )}
            </div>
        </TabsList>

        <TabsContent value="add-order" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" />
                Add Purchase Order
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                This will redirect to the Add Purchase Order form. Click the "Add Order" option in the dropdown above.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="orders-list" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Purchase Orders List
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                This will redirect to the Purchase Orders list. Click the "Orders list" option in the dropdown above.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="goods-received" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Goods Received Note
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                This will redirect to the Goods Received Note page. Click the "Goods Received Note" option in the dropdown above.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="purchase-report" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Product Purchase Report
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                This will redirect to the Product Purchase Report. Click the "Product Purchase Report" option in the dropdown above.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inventory-tracking" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                Inventory Tracking
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">
                This will redirect to the Inventory Tracking page. Click the "Inventory Tracking" option in the dropdown above.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Current Stock Section */}
        {showCurrentStock && (
          <div className="bg-white rounded shadow p-4 mt-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-bold text-cyan-700" style={{background: 'linear-gradient(90deg, #4fd1c5, #805ad5, #4299e1, #38b2ac, #3182ce)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'}}>Current Stock</h2>
              <button className="bg-blue-500 text-white px-4 py-1 rounded float-right" onClick={() => setShowCurrentStock(false)}>Back</button>
            </div>
            <div className="h-1 w-full mb-4" style={{background: 'linear-gradient(90deg, #4fd1c5, #805ad5, #4299e1, #38b2ac, #3182ce)'}}></div>
            <div className="flex flex-wrap items-center gap-4 mb-4">
              <label className="font-medium">Department :</label>
              <select className="border px-2 py-1 rounded" value={department} onChange={e => setDepartment(e.target.value)}>
                <option value="">Please select</option>
                <option value="pharmacy">Pharmacy</option>
                <option value="lab">Lab</option>
              </select>
              <label className="font-medium">Item Name :</label>
              <input className="border px-2 py-1 rounded min-w-[200px]" value={itemName} onChange={e => setItemName(e.target.value)} />
              <button className="bg-blue-500 text-white px-4 py-1 rounded">Search</button>
              <button className="bg-blue-500 text-white px-4 py-1 rounded">Generate Excel</button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full border border-gray-200">
                <thead>
                  <tr className="bg-cyan-100 text-cyan-900">
                    <th className="px-2 py-1 text-left">SNo.</th>
                    <th className="px-2 py-1 text-left">Item Name</th>
                    <th className="px-2 py-1 text-left">Cur.Stock</th>
                    <th className="px-2 py-1 text-left">ToatalCur.Stock</th>
                    <th className="px-2 py-1 text-left">BatchNo.</th>
                    <th className="px-2 py-1 text-left">ExpiryDate</th>
                    <th className="px-2 py-1 text-left">ReOrderLevel</th>
                    <th className="px-2 py-1 text-left">PurPrice</th>
                    <th className="px-2 py-1 text-left">MRP</th>
                    <th className="px-2 py-1 text-left">TotalPrice</th>
                    <th className="px-2 py-1 text-left">TotalSale</th>
                  </tr>
                </thead>
                <tbody>
                  {currentStockData.map(row => (
                    <tr key={row.sno} className="border-b">
                      <td className="px-2 py-1">{row.sno}</td>
                      <td className="px-2 py-1">{row.itemName}</td>
                      <td className="px-2 py-1">{row.curStock}</td>
                      <td className="px-2 py-1">{row.totalCurStock}</td>
                      <td className="px-2 py-1">{row.batchNo}</td>
                      <td className="px-2 py-1">{row.expiryDate}</td>
                      <td className="px-2 py-1">{row.reorderLevel}</td>
                      <td className="px-2 py-1">{row.purPrice}</td>
                      <td className="px-2 py-1">{row.mrp}</td>
                      <td className="px-2 py-1">{row.totalPrice}</td>
                      <td className="px-2 py-1">{row.totalSale}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Tabs>
    </div>
  );
};

export default StoreRequisition; 