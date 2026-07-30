import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AddItemDialogProps, FormField } from './AddItemDialog/types';

export const AddItemDialog: React.FC<AddItemDialogProps> = ({
  isOpen,
  onClose,
  onAdd,
  title,
  fields,
  initialData = {},
  defaultValues = {}
}) => {
  const [formData, setFormData] = useState<Record<string, string>>({});

  // Update formData when dialog opens with initialData or defaultValues
  useEffect(() => {
    if (isOpen) {
      setFormData({ ...initialData, ...defaultValues });
    }
  }, [isOpen]); // Remove initialData and defaultValues from dependencies to prevent form reset

  // Reset form when dialog closes
  useEffect(() => {
    if (!isOpen) {
      setFormData({});
    }
  }, [isOpen]);

  const handleInputChange = (key: string, value: string) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAdd(formData);
    setFormData({});
    onClose();
  };

  const renderField = (field: FormField) => {
    switch (field.type) {
      case 'custom':
        return field.render?.(formData[field.key] || '', (value) =>
          handleInputChange(field.key, value),
        ) ?? null;
      case 'textarea':
        return (
          <Textarea
            id={field.key}
            value={formData[field.key] || ''}
            onChange={(e) => handleInputChange(field.key, e.target.value)}
            placeholder={field.placeholder}
            required={field.required}
          />
        );
      case 'select':
        return (
          <Select
            value={formData[field.key] || ''}
            onValueChange={(value) => handleInputChange(field.key, value)}
            required={field.required}
          >
            <SelectTrigger>
              <SelectValue placeholder={field.placeholder || `Select ${field.label.toLowerCase()}`} />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((option) => {
                // Handle both string arrays and object arrays
                if (typeof option === 'string') {
                  return (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  );
                } else {
                  return (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  );
                }
              })}
            </SelectContent>
          </Select>
        );
      default:
        return (
          <Input
            id={field.key}
            type={field.type}
            value={formData[field.key] || ''}
            onChange={(e) => handleInputChange(field.key, e.target.value)}
            placeholder={field.placeholder}
            required={field.required}
          />
        );
    }
  };

  // Group fields by their group property or create a default group
  const groupedFields = fields.reduce((acc, field) => {
    const group = field.group || 'default';
    if (!acc[group]) acc[group] = [];
    acc[group].push(field);
    return acc;
  }, {} as Record<string, FormField[]>);

  const renderFieldGroup = (groupFields: FormField[], groupName: string) => {
    // Determine if this is a large form (many fields) to use grid layout
    const isLargeForm = fields.length > 10;
    
    if (groupName === 'fullWidth' || !isLargeForm) {
      // Full width fields or small forms - single column
      return (
        <div className="space-y-4">
          {groupFields.map((field) => (
            <div key={field.key} className="space-y-2">
              <Label htmlFor={field.key}>
                {field.label} {field.required && '*'}
              </Label>
              {renderField(field)}
            </div>
          ))}
        </div>
      );
    }

    // Grid layout for large forms
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {groupFields.map((field) => (
          <div 
            key={field.key} 
            className={`space-y-2 ${
              field.colSpan === 2 ? 'md:col-span-2' : 
              field.colSpan === 3 ? 'lg:col-span-3' : 
              ''
            }`}
          >
            <Label htmlFor={field.key}>
              {field.label} {field.required && '*'}
            </Label>
            {renderField(field)}
          </div>
        ))}
      </div>
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`${fields.length > 10 ? 'max-w-4xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto`}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Fill in the form below to {title.toLowerCase().includes('edit') ? 'update' : 'add'} the item.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {Object.entries(groupedFields).map(([groupName, groupFields]) => (
            <div key={groupName}>
              {renderFieldGroup(groupFields, groupName)}
            </div>
          ))}

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              {Object.keys({...initialData, ...defaultValues}).length > 0 ? 'Update' : 'Add'} {title.split(' ').pop()}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
