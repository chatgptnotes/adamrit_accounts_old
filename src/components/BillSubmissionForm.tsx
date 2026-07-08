import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { formatDateOnly } from '@/utils/dateOnly';

export interface BillSubmission {
  id: string;
  visitId: string;
  patientName: string;
  corporate: string;
  billAmount: number;
  submittedBy: string;
  submissionDate: string;
  intimationDate: string;
  expectedPaymentDate: string;
  receivedAmount: number;
  deductionAmount: number;
  tdsAmount: number;
  receivedDate: string;
}

export interface PatientData {
  visitId: string;
  patientName: string;
  corporate: string;
}

interface BillSubmissionFormProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: BillSubmission) => void;
  editData?: BillSubmission | null;
  prefilledPatient?: PatientData | null;
}

const BillSubmissionForm: React.FC<BillSubmissionFormProps> = ({
  open,
  onClose,
  onSave,
  editData,
  prefilledPatient,
}) => {
  const today = formatDateOnly(new Date());
  const [formData, setFormData] = useState<Omit<BillSubmission, 'id'>>({
    visitId: '',
    patientName: '',
    corporate: '',
    billAmount: 0,
    submittedBy: '',
    submissionDate: today,
    intimationDate: '',
    expectedPaymentDate: '',
    receivedAmount: 0,
    deductionAmount: 0,
    tdsAmount: 0,
    receivedDate: '',
  });

  const isPrefilledMode = !!prefilledPatient && !editData;

  useEffect(() => {
    if (editData) {
      setFormData({
        visitId: editData.visitId,
        patientName: editData.patientName,
        corporate: editData.corporate,
        billAmount: editData.billAmount,
        submittedBy: editData.submittedBy,
        submissionDate: editData.submissionDate,
        intimationDate: editData.intimationDate || '',
        expectedPaymentDate: editData.expectedPaymentDate,
        receivedAmount: editData.receivedAmount || 0,
        deductionAmount: editData.deductionAmount || 0,
        tdsAmount: editData.tdsAmount || 0,
        receivedDate: editData.receivedDate || '',
      });
    } else if (prefilledPatient) {
      setFormData({
        visitId: prefilledPatient.visitId,
        patientName: prefilledPatient.patientName,
        corporate: prefilledPatient.corporate,
        billAmount: 0,
        submittedBy: '',
        submissionDate: today,
        intimationDate: '',
        expectedPaymentDate: '',
        receivedAmount: 0,
        deductionAmount: 0,
        tdsAmount: 0,
        receivedDate: '',
      });
    } else {
      setFormData({
        visitId: '',
        patientName: '',
        corporate: '',
        billAmount: 0,
        submittedBy: '',
        submissionDate: today,
        intimationDate: '',
        expectedPaymentDate: '',
        receivedAmount: 0,
        deductionAmount: 0,
        tdsAmount: 0,
        receivedDate: '',
      });
    }
  }, [editData, prefilledPatient, open, today]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const submission: BillSubmission = {
      id: editData?.id || crypto.randomUUID(),
      ...formData,
    };
    onSave(submission);
    onClose();
  };

  const handleChange = (field: keyof Omit<BillSubmission, 'id'>, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const getDialogTitle = () => {
    if (editData) return 'Edit Intimation + Bill Submission';
    if (prefilledPatient) return `Intimation + Bill Submission - ${prefilledPatient.patientName}`;
    return 'Add Intimation + Bill Submission';
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{getDialogTitle()}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="visitId">Visit ID</Label>
              <Input
                id="visitId"
                value={formData.visitId}
                onChange={(e) => handleChange('visitId', e.target.value)}
                readOnly={isPrefilledMode}
                className={isPrefilledMode ? 'bg-gray-100' : ''}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="patientName">Patient Name</Label>
              <Input
                id="patientName"
                value={formData.patientName}
                onChange={(e) => handleChange('patientName', e.target.value)}
                readOnly={isPrefilledMode}
                className={isPrefilledMode ? 'bg-gray-100' : ''}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="corporate">Corporate</Label>
              <Input
                id="corporate"
                value={formData.corporate}
                onChange={(e) => handleChange('corporate', e.target.value)}
                readOnly={isPrefilledMode}
                className={isPrefilledMode ? 'bg-gray-100' : ''}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="billAmount">Bill Amount</Label>
              <Input
                id="billAmount"
                type="number"
                value={formData.billAmount}
                onChange={(e) => handleChange('billAmount', parseFloat(e.target.value) || 0)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="submittedBy">Submitted By</Label>
            <Input
              id="submittedBy"
              value={formData.submittedBy}
              onChange={(e) => handleChange('submittedBy', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="intimationDate">Intimation Date</Label>
              <Input
                id="intimationDate"
                type="date"
                value={formData.intimationDate}
                onChange={(e) => handleChange('intimationDate', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="submissionDate">Date of Bill Submission</Label>
              <Input
                id="submissionDate"
                type="date"
                value={formData.submissionDate}
                onChange={(e) => handleChange('submissionDate', e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expectedPaymentDate">Expected Payment Date</Label>
              <Input
                id="expectedPaymentDate"
                type="date"
                value={formData.expectedPaymentDate}
                onChange={(e) => handleChange('expectedPaymentDate', e.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="receivedAmount">Received Amount</Label>
              <Input
                id="receivedAmount"
                type="number"
                value={formData.receivedAmount}
                onChange={(e) => handleChange('receivedAmount', parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="deductionAmount">Deduction Amount</Label>
              <Input
                id="deductionAmount"
                type="number"
                value={formData.deductionAmount}
                onChange={(e) => handleChange('deductionAmount', parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tdsAmount">TDS Amount</Label>
              <Input
                id="tdsAmount"
                type="number"
                value={formData.tdsAmount}
                onChange={(e) => handleChange('tdsAmount', parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="receivedDate">Amount Received On</Label>
            <Input
              id="receivedDate"
              type="date"
              value={formData.receivedDate}
              onChange={(e) => handleChange('receivedDate', e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              {editData ? 'Update' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default BillSubmissionForm;
