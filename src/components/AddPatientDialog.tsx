
import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { ReferralSelectionDialog, type RegistrationReferral } from '@/components/registration/ReferralSelectionDialog';
import { useAuth } from '@/contexts/AuthContext';

interface AddPatientDialogProps {
  isOpen: boolean;
  onClose: () => void;
  diagnoses?: string[];
}

export const AddPatientDialog: React.FC<AddPatientDialogProps> = ({
  isOpen,
  onClose,
  diagnoses = []
}) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedReferral, setSelectedReferral] = useState<RegistrationReferral | null>(null);

  const [formData, setFormData] = useState({
    patientName: '',
    corporate: 'private',
    age: '',
    gender: '',
    phone: '',
    address: '',
    email: '',
    emergencyContactName: '',
    emergencyContactMobile: '',
    relationshipManager: '',
    marketedBy: '',
    referralSource: ''
  });

  // Fetch marketing staff
  const { data: marketingStaff = [] } = useQuery({
    queryKey: ['marketing-users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('marketing_users')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    staleTime: 60000,
  });

  const referralSources = [
    'Advertisement',
    'Doctor Reference',
    'Friend/Family',
    'Previous Patient',
    'Corporate',
    'Social Media',
    'Walk-in',
    'Other'
  ];

  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.patientName || !formData.corporate || !formData.age ||
        !formData.gender || !formData.phone || !formData.address) {
      toast({
        title: "Error",
        description: "Please fill in all required fields",
        variant: "destructive"
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const { data, error } = await supabase
        .from('patients')
        .insert({
          name: formData.patientName,
          corporate: formData.corporate,
          age: formData.age ? parseInt(formData.age) : null,
          gender: formData.gender,
          phone: formData.phone,
          address: formData.address,
          email: formData.email || null,
          emergency_contact_name: formData.emergencyContactName || null,
          emergency_contact_mobile: formData.emergencyContactMobile || null,
          relationship_manager: formData.relationshipManager || null,
          marketed_by: formData.marketedBy || null,
          referral_source: formData.referralSource || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select();

      if (error) throw error;

      const patientId = data?.[0]?.id;
      if (patientId && selectedReferral) {
        if (selectedReferral.id === 'direct-walk-in') {
          await (supabase as any)
            .from('patients')
            .update({
              is_direct: true,
              direct_marked_by: user?.email || user?.id || null,
              direct_marked_at: new Date().toISOString(),
            })
            .eq('id', patientId);
        } else {
          await (supabase as any)
            .from('incoming_referrals')
            .update({
              status: 'LINKED',
              linked_patient_id: patientId,
              linked_by: user?.email || user?.id || null,
              linked_at: new Date().toISOString(),
            })
            .eq('id', selectedReferral.id)
            .eq('status', 'ANNOUNCED');
        }
      }

      toast({
        title: "Success",
        description: "Patient registered successfully!"
      });

      queryClient.invalidateQueries({ queryKey: ['patients'] });
      setFormData({
        patientName: '',
        corporate: 'private',
        age: '',
        gender: '',
        phone: '',
        address: '',
        email: '',
        emergencyContactName: '',
        emergencyContactMobile: '',
        relationshipManager: '',
        marketedBy: '',
        referralSource: ''
      });
      setSelectedReferral(null);
      onClose();

    } catch (error: any) {
      console.error('Error adding patient:', error);
      toast({
        title: "Error",
        description: error?.message || "Failed to register patient",
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
    <ReferralSelectionDialog
      open={isOpen && !selectedReferral}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onSelect={(referral) => setSelectedReferral(referral)}
    />
    <Dialog open={isOpen && !!selectedReferral} onOpenChange={() => { setSelectedReferral(null); onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Patient</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="patientName" className="text-sm font-medium">
                Patient Name *
              </Label>
              <Input
                id="patientName"
                value={formData.patientName}
                onChange={(e) => handleInputChange('patientName', e.target.value)}
                placeholder="Enter patient name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="corporate" className="text-sm font-medium">
                Corporate *
              </Label>
              <Select value={formData.corporate} onValueChange={(value) => handleInputChange('corporate', value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">Private</SelectItem>
                  <SelectItem value="esic">ESIC</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="age" className="text-sm font-medium">
                Age *
              </Label>
              <Input
                id="age"
                type="number"
                value={formData.age}
                onChange={(e) => handleInputChange('age', e.target.value)}
                placeholder="Enter age"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="gender" className="text-sm font-medium">
                Gender *
              </Label>
              <Select value={formData.gender} onValueChange={(value) => handleInputChange('gender', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone" className="text-sm font-medium">
                Phone *
              </Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => handleInputChange('phone', e.target.value)}
                placeholder="Enter phone number"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => handleInputChange('email', e.target.value)}
                placeholder="Enter email"
              />
            </div>

            <div className="col-span-2 space-y-2">
              <Label htmlFor="address" className="text-sm font-medium">
                Address *
              </Label>
              <Input
                id="address"
                value={formData.address}
                onChange={(e) => handleInputChange('address', e.target.value)}
                placeholder="Enter address"
              />
            </div>
          </div>

          <div className="border-t pt-4">
            <h4 className="text-sm font-semibold text-blue-700 mb-4">Emergency Contact</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="emergencyContactName" className="text-sm font-medium">
                  Contact Name
                </Label>
                <Input
                  id="emergencyContactName"
                  value={formData.emergencyContactName}
                  onChange={(e) => handleInputChange('emergencyContactName', e.target.value)}
                  placeholder="Name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="emergencyContactMobile" className="text-sm font-medium">
                  Contact Mobile
                </Label>
                <Input
                  id="emergencyContactMobile"
                  value={formData.emergencyContactMobile}
                  onChange={(e) => handleInputChange('emergencyContactMobile', e.target.value)}
                  placeholder="Phone"
                />
              </div>
            </div>
          </div>

          <div className="border-t pt-4">
            <h4 className="text-sm font-semibold text-green-700 mb-4">Marketing Information</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="marketedBy" className="text-sm font-medium">
                  Marketed By
                </Label>
                <Select value={formData.marketedBy} onValueChange={(value) => handleInputChange('marketedBy', value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select marketing person..." />
                  </SelectTrigger>
                  <SelectContent>
                    {marketingStaff.map((staff) => (
                      <SelectItem key={staff.id} value={staff.name}>
                        {staff.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="referralSource" className="text-sm font-medium">
                  Referral Source
                </Label>
                <Select value={formData.referralSource} onValueChange={(value) => handleInputChange('referralSource', value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="How did patient find us?" />
                  </SelectTrigger>
                  <SelectContent>
                    {referralSources.map((source) => (
                      <SelectItem key={source} value={source}>
                        {source}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-4 pt-6">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white" disabled={isSubmitting}>
              {isSubmitting ? 'Adding Patient...' : 'Add Patient'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    </>
  );
};
