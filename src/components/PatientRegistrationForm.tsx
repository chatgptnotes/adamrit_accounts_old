
import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PatientInfoSection } from './PatientRegistrationForm/PatientInfoSection';
import { EmergencyContactSection } from './PatientRegistrationForm/EmergencyContactSection';
import { AdditionalInfoSection } from './PatientRegistrationForm/AdditionalInfoSection';
import { FormActions } from './PatientRegistrationForm/FormActions';
import { usePatientRegistration } from './PatientRegistrationForm/usePatientRegistration';
import { PatientRegistrationFormProps } from './PatientRegistrationForm/types';

export const PatientRegistrationForm: React.FC<PatientRegistrationFormProps> = ({
  isOpen,
  onClose
}) => {
  const {
    formData,
    dateOfBirth,
    isSubmitting,
    handleInputChange,
    setDateOfBirth,
    handlePatientPhotoSelect,
    registrationDocuments,
    handleRegistrationDocumentSelect,
    handleRegistrationDocumentRemove,
    handleSubmit,
    handleCancel
  } = usePatientRegistration(onClose);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-gray-600">
            Register a new patient in the ESIC system
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          <PatientInfoSection 
            formData={formData}
            dateOfBirth={dateOfBirth}
            registrationDocuments={registrationDocuments}
            onInputChange={handleInputChange}
            onDateChange={setDateOfBirth}
            onPatientPhotoSelect={handlePatientPhotoSelect}
            onRegistrationDocumentSelect={handleRegistrationDocumentSelect}
            onRegistrationDocumentRemove={handleRegistrationDocumentRemove}
          />
          
          <EmergencyContactSection 
            formData={formData}
            onInputChange={handleInputChange}
          />
          
          <AdditionalInfoSection 
            formData={formData}
            onInputChange={handleInputChange}
          />
          
          <FormActions 
            formData={formData}
            onInputChange={handleInputChange}
            isSubmitting={isSubmitting}
            onCancel={handleCancel}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
};
