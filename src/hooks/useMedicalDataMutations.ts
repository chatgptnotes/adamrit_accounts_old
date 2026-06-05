import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  bridgeApprovedMedicationToPharmacy,
  cancelBridgedItemIfPending,
} from '@/lib/ward-prescription-bridge';

export const useMedicalDataMutations = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const addLabsMutation = useMutation({
    mutationFn: async ({ visitId, labIds }: { visitId: string; labIds: string[] }) => {
      const labEntries = labIds.map(labId => ({
        visit_id: visitId,
        lab_id: labId,
        status: 'ordered',
        ordered_date: new Date().toISOString()
      }));

      const { data, error } = await supabase
        .from('visit_labs')
        .insert(labEntries)
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, { visitId }) => {
      queryClient.invalidateQueries({ queryKey: ['visit-labs-custom', visitId] });
      toast({
        title: "Success",
        description: "Lab tests added successfully",
      });
    },
    onError: (error) => {
      console.error('Error adding labs:', error);
      toast({
        title: "Error",
        description: "Failed to add lab tests",
        variant: "destructive"
      });
    }
  });

  const addRadiologyMutation = useMutation({
    mutationFn: async ({ visitId, radiologyIds }: { visitId: string; radiologyIds: string[] }) => {
      const radiologyEntries = radiologyIds.map(radiologyId => ({
        visit_id: visitId,
        radiology_id: radiologyId,
        status: 'ordered',
        ordered_date: new Date().toISOString()
      }));

      const { data, error } = await supabase
        .from('visit_radiology')
        .insert(radiologyEntries)
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, { visitId }) => {
      queryClient.invalidateQueries({ queryKey: ['visit-radiology-custom', visitId] });
      toast({
        title: "Success",
        description: "Radiology studies added successfully",
      });
    },
    onError: (error) => {
      console.error('Error adding radiology:', error);
      toast({
        title: "Error",
        description: "Failed to add radiology studies",
        variant: "destructive"
      });
    }
  });

  const addMedicationsMutation = useMutation({
    mutationFn: async ({ 
      visitId, 
      medications 
    }: { 
      visitId: string; 
      medications: Array<{
        medication_id?: string;
        medication_type: string;
        custom_medication_name?: string;
        dosage?: string;
        frequency?: string;
        duration?: string;
        route?: string;
        start_date?: string; // when this order starts (YYYY-MM-DD); defaults to today
      }>;
    }) => {
      // Only columns that exist on visit_medications — `medication_type` and
      // `status` are NOT real columns (insert 400s PGRST204 if sent). Undefined
      // fields are dropped from the request body, so optional ones stay optional.
      const today = new Date().toISOString().slice(0, 10);
      const medicationEntries = medications.map(med => ({
        visit_id: visitId,
        medication_id: med.medication_id,
        custom_medication_name: med.custom_medication_name,
        dosage: med.dosage,
        frequency: med.frequency,
        duration: med.duration,
        route: med.route,
        start_date: med.start_date || today, // active order starts today
        prescribed_date: new Date().toISOString()
      }));

      const { data, error } = await supabase
        .from('visit_medications')
        .insert(medicationEntries)
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, { visitId }) => {
      queryClient.invalidateQueries({ queryKey: ['visit-medications-custom', visitId] });
      toast({
        title: "Success",
        description: "Medications added successfully",
      });
    },
    onError: (error) => {
      console.error('Error adding medications:', error);
      toast({
        title: "Error",
        description: "Failed to add medications",
        variant: "destructive"
      });
    }
  });

  const deleteMedicationMutation = useMutation({
    mutationFn: async ({ rowId }: { rowId: string }) => {
      const { error } = await supabase
        .from('visit_medications')
        .delete()
        .eq('id', rowId);

      if (error) throw error;
      // Pull it back out of the pharmacy queue if it was bridged & not dispensed.
      await cancelBridgedItemIfPending(rowId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visit-medications-custom'] });
      toast({
        title: "Removed",
        description: "Medication removed",
      });
    },
    onError: (error) => {
      console.error('Error deleting medication:', error);
      toast({
        title: "Error",
        description: "Failed to remove medication",
        variant: "destructive"
      });
    }
  });

  // Stop an active medicine: set its end_date (and optional reason). The row
  // stays in the chart's history — active vs past is decided by end_date.
  const discontinueMedicationMutation = useMutation({
    mutationFn: async ({
      rowId,
      notes,
    }: {
      rowId: string;
      notes?: string;
    }) => {
      const today = new Date().toISOString().slice(0, 10);
      const { error } = await supabase
        .from('visit_medications')
        .update({ end_date: today, ...(notes ? { notes } : {}) })
        .eq('id', rowId);
      if (error) throw error;
      // Stopping before dispensing pulls it back out of the pharmacy queue.
      await cancelBridgedItemIfPending(rowId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visit-medications-custom'] });
      toast({ title: "Stopped", description: "Medicine stopped" });
    },
    onError: (error) => {
      console.error('Error stopping medication:', error);
      toast({ title: "Error", description: "Failed to stop medicine", variant: "destructive" });
    }
  });

  // Change a medicine's dose/frequency/route: end the current order today and
  // start a new active order today. Preserves the full history (one row per order).
  const changeMedicationMutation = useMutation({
    mutationFn: async ({
      rowId,
      visitId,
      name,
      dosage,
      frequency,
      duration,
      route,
    }: {
      rowId: string;
      visitId: string;
      name: string;
      dosage?: string;
      frequency?: string;
      duration?: string;
      route?: string;
    }) => {
      const today = new Date().toISOString().slice(0, 10);
      const { error: endErr } = await supabase
        .from('visit_medications')
        .update({ end_date: today })
        .eq('id', rowId);
      if (endErr) throw endErr;
      // The old order is replaced — remove its pharmacy item if still pending.
      // The new row starts unapproved, so it won't bridge until re-approved.
      await cancelBridgedItemIfPending(rowId);
      const { error: addErr } = await supabase
        .from('visit_medications')
        .insert({
          visit_id: visitId,
          custom_medication_name: name,
          dosage,
          frequency,
          duration,
          route,
          start_date: today,
          prescribed_date: new Date().toISOString(),
        });
      if (addErr) throw addErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visit-medications-custom'] });
      toast({ title: "Updated", description: "Medicine updated" });
    },
    onError: (error) => {
      console.error('Error changing medication:', error);
      toast({ title: "Error", description: "Failed to update medicine", variant: "destructive" });
    }
  });

  const approveMedicationMutation = useMutation({
    mutationFn: async ({ rowId }: { rowId: string }) => {
      const { error } = await supabase
        .from('visit_medications')
        .update({ is_approved: true, approved_at: new Date().toISOString() })
        .eq('id', rowId);

      if (error) throw error;

      // Approving a med "sends it to the pharmacy": create a normal ward
      // prescription so it flows through the existing desktop pharmacy queue +
      // billing. Best-effort — never let a bridge hiccup fail the approval.
      await bridgeApprovedMedicationToPharmacy(rowId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visit-medications-custom'] });
      toast({
        title: "Approved",
        description: "Medication approved",
      });
    },
    onError: (error) => {
      console.error('Error approving medication:', error);
      toast({
        title: "Error",
        description: "Failed to approve medication",
        variant: "destructive"
      });
    }
  });

  const updateLabStatusMutation = useMutation({
    mutationFn: async ({ 
      visitLabId, 
      status, 
      resultValue, 
      normalRange, 
      notes 
    }: {
      visitLabId: string;
      status: string;
      resultValue?: string;
      normalRange?: string;
      notes?: string;
    }) => {
      const updateData: any = { status };
      
      if (status === 'collected') {
        updateData.collected_date = new Date().toISOString();
      } else if (status === 'completed') {
        updateData.completed_date = new Date().toISOString();
        if (resultValue) updateData.result_value = resultValue;
        if (normalRange) updateData.normal_range = normalRange;
        if (notes) updateData.notes = notes;
      }

      const { data, error } = await supabase
        .from('visit_labs')
        .update(updateData)
        .eq('id', visitLabId)
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visit-labs-custom'] });
      toast({
        title: "Success",
        description: "Lab status updated successfully",
      });
    },
    onError: (error) => {
      console.error('Error updating lab status:', error);
      toast({
        title: "Error",
        description: "Failed to update lab status",
        variant: "destructive"
      });
    }
  });

  const updateRadiologyStatusMutation = useMutation({
    mutationFn: async ({ 
      visitRadiologyId, 
      status, 
      findings, 
      impression, 
      notes 
    }: {
      visitRadiologyId: string;
      status: string;
      findings?: string;
      impression?: string;
      notes?: string;
    }) => {
      const updateData: any = { status };
      
      if (status === 'scheduled') {
        updateData.scheduled_date = new Date().toISOString();
      } else if (status === 'completed') {
        updateData.completed_date = new Date().toISOString();
        if (findings) updateData.findings = findings;
        if (impression) updateData.impression = impression;
        if (notes) updateData.notes = notes;
      }

      const { data, error } = await supabase
        .from('visit_radiology')
        .update(updateData)
        .eq('id', visitRadiologyId)
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['visit-radiology-custom'] });
      toast({
        title: "Success",
        description: "Radiology status updated successfully",
      });
    },
    onError: (error) => {
      console.error('Error updating radiology status:', error);
      toast({
        title: "Error",
        description: "Failed to update radiology status",
        variant: "destructive"
      });
    }
  });

  return {
    addLabs: addLabsMutation.mutate,
    addRadiology: addRadiologyMutation.mutate,
    addMedications: addMedicationsMutation.mutate,
    deleteMedication: deleteMedicationMutation.mutate,
    discontinueMedication: discontinueMedicationMutation.mutate,
    changeMedication: changeMedicationMutation.mutate,
    approveMedication: approveMedicationMutation.mutate,
    updateLabStatus: updateLabStatusMutation.mutate,
    updateRadiologyStatus: updateRadiologyStatusMutation.mutate,
    isAddingLabs: addLabsMutation.isPending,
    isAddingRadiology: addRadiologyMutation.isPending,
    isAddingMedications: addMedicationsMutation.isPending,
    isDeletingMedication: deleteMedicationMutation.isPending,
    isDiscontinuingMedication: discontinueMedicationMutation.isPending,
    isChangingMedication: changeMedicationMutation.isPending,
    isApprovingMedication: approveMedicationMutation.isPending,
  };
};