
// @ts-nocheck
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DoctorLedgerField } from '@/components/DoctorLedgerField';

interface EsicSurgeon {
  id: string;
  name: string;
  specialty?: string;
  department?: string;
  contact_info?: string;
}

interface EditSurgeonDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onEdit: (id: string, formData: Record<string, string>) => void;
  surgeon: EsicSurgeon | null;
}

export const EditSurgeonDialog: React.FC<EditSurgeonDialogProps> = ({
  isOpen,
  onClose,
  onEdit,
  surgeon
}) => {
  const [formData, setFormData] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen && surgeon) {
      setFormData({
        name: surgeon.name || '',
        specialty: surgeon.specialty || '',
        department: surgeon.department || '',
        contact_info: surgeon.contact_info || ''
      });
    }
  }, [isOpen, surgeon]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!surgeon || !formData.name?.trim()) {
      return;
    }

    onEdit(surgeon.id, formData);
    onClose();
  };

  const handleFieldChange = (key: string, value: string) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  if (!surgeon) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit ESIC Surgeon</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={formData.name || ''}
              onChange={(e) => handleFieldChange('name', e.target.value)}
              placeholder="Enter surgeon name"
              required
            />
          </div>

          <div>
            <Label htmlFor="specialty">Specialty</Label>
            <Input
              id="specialty"
              value={formData.specialty || ''}
              onChange={(e) => handleFieldChange('specialty', e.target.value)}
              placeholder="Enter specialty"
            />
          </div>

          <div>
            <Label htmlFor="department">Department</Label>
            <Input
              id="department"
              value={formData.department || ''}
              onChange={(e) => handleFieldChange('department', e.target.value)}
              placeholder="Enter department"
            />
          </div>

          <div>
            <Label htmlFor="contact_info">Contact Info</Label>
            <Input
              id="contact_info"
              value={formData.contact_info || ''}
              onChange={(e) => handleFieldChange('contact_info', e.target.value)}
              placeholder="Enter contact information"
            />
          </div>

          <div>
            <Label>Accounting Ledger (search — saves as soon as you pick)</Label>
            {/* Mapped against the saved name, not the one being typed above,
                so renaming and remapping stay two deliberate steps. */}
            <DoctorLedgerField doctorName={surgeon.name || ''} />
          </div>

          <div className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Update</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
