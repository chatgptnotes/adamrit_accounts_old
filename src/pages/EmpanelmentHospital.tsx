import React, { useMemo, useState } from 'react';
import { Building2, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface EmpanelmentCorporate {
  name: string;
  totalPayment: number;
  receivedPayment: number;
}

const empanelmentCorporates: EmpanelmentCorporate[] = [
  { name: 'Mahatma Jyotirao Phule Jan Arogya Yojana (MJPJAY)', totalPayment: 0, receivedPayment: 0 },
  { name: 'Ayushman Bharat - Pradhan Mantri Jan Arogya Yojna (PM-JAY)', totalPayment: 0, receivedPayment: 0 },
  { name: 'Central Government Health Scheme (CGHS)', totalPayment: 0, receivedPayment: 0 },
  { name: 'Ex Serviceman Contributory Health Scheme (ECHS)', totalPayment: 0, receivedPayment: 0 },
  { name: 'Maharashtra Police Kutumb Arogya Yojana (MPKAY)', totalPayment: 0, receivedPayment: 0 },
  { name: 'Coal India Limited (CIL)', totalPayment: 0, receivedPayment: 0 },
  { name: 'Central Railways (C.Rly)', totalPayment: 0, receivedPayment: 0 },
  { name: 'South Eastern Central Railway (SECR)', totalPayment: 0, receivedPayment: 0 },
  { name: 'Western Coalfield Limited (WCL)', totalPayment: 0, receivedPayment: 0 },
  { name: 'MP State Government Employees - OST empanelled hospital', totalPayment: 0, receivedPayment: 0 },
  { name: 'MP Police (Swasthya Suraksha Nyas)', totalPayment: 0, receivedPayment: 0 },
  { name: 'Ordnance Factories (Ambazari, Chanda, Jawaher Nagar (Bhandara), Itarsi)', totalPayment: 0, receivedPayment: 0 },
  { name: 'Maharashtra Metro Rail Corporation', totalPayment: 0, receivedPayment: 0 },
  { name: 'ITD Cementation Ltd (Nagpur Metro Work)', totalPayment: 0, receivedPayment: 0 },
  { name: 'AFCON Ltd (Nagpur Metro Work)', totalPayment: 0, receivedPayment: 0 },
  { name: 'MKSSKAY - Maharashtra Karagrush Va Sudhar Sevabal Kutumb Arogya Yojana - Maharashtra Prison Department', totalPayment: 0, receivedPayment: 0 },
  { name: 'Maharashtra Dharmadaya Karmachari Kutumbe Seashya Yojana (MDKKSY)', totalPayment: 0, receivedPayment: 0 },
  { name: 'Gun Factory', totalPayment: 0, receivedPayment: 0 },
  { name: 'RBI (Reserve Bank of India)', totalPayment: 0, receivedPayment: 0 },
  { name: 'MECL (Mineral Exploration Corporation Ltd)', totalPayment: 0, receivedPayment: 0 },
  { name: 'Maharashtra State Electricity Board (MSEB)', totalPayment: 0, receivedPayment: 0 },
];

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);

const EmpanelmentHospital: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredCorporates = useMemo(
    () =>
      empanelmentCorporates.filter((corporate) =>
        corporate.name.toLowerCase().includes(searchTerm.toLowerCase())
      ),
    [searchTerm]
  );

  const totals = useMemo(
    () =>
      filteredCorporates.reduce(
        (acc, corporate) => {
          acc.totalPayment += corporate.totalPayment;
          acc.receivedPayment += corporate.receivedPayment;
          return acc;
        },
        { totalPayment: 0, receivedPayment: 0 }
      ),
    [filteredCorporates]
  );

  const outstandingPayment = totals.totalPayment - totals.receivedPayment;

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Building2 className="h-8 w-8" />
          Empanelment Hospital
        </h1>
        <p className="text-gray-600 mt-2">
          Corporate payment summary for empanelled hospital schemes and organizations.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">Total Payment</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totals.totalPayment)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">Received Payment</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-700">{formatCurrency(totals.receivedPayment)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">Outstanding Payment</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-700">{formatCurrency(outstandingPayment)}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search corporate name..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Corporate List</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Sr No.</TableHead>
                <TableHead>Name of Corporate</TableHead>
                <TableHead className="text-right">Total Payment</TableHead>
                <TableHead className="text-right">Received Payment</TableHead>
                <TableHead className="text-right">Outstanding Payment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCorporates.map((corporate, index) => {
                const corporateOutstanding = corporate.totalPayment - corporate.receivedPayment;
                return (
                  <TableRow key={corporate.name}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell className="font-medium">{corporate.name}</TableCell>
                    <TableCell className="text-right">{formatCurrency(corporate.totalPayment)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(corporate.receivedPayment)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(corporateOutstanding)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default EmpanelmentHospital;
