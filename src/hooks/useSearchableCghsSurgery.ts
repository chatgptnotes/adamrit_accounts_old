
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

// Helper: check if patient is Maharashtra Yojana (MJPJY / Ayushman Bharat MH)
const isMaharashtraYojana = (corp: string) => {
  const c = (corp || '').toLowerCase().trim();
  return c.includes('yojana') || c.includes('mjpjy') || c.includes('ayushman') ||
    c.includes('mahatma jyotiba') || c.includes('pmjay') || c.includes('ab-pmjay') ||
    c.includes('ab pmjay') || c.includes('maharashtra yojana');
};

export const useSearchableCghsSurgery = (patientCorporate?: string) => {
  const [searchTerm, setSearchTerm] = useState('');

  const { data: surgeries = [], isLoading } = useQuery({
    queryKey: ['cghs-surgery', searchTerm, patientCorporate],
    queryFn: async () => {
      const corporate = (patientCorporate || '').toLowerCase().trim();
      const isYojana = isMaharashtraYojana(corporate);

      // For Maharashtra Yojana patients, search only from the package master.
      if (isYojana) {
        let query = supabase
          .from('pmjay_mjpjay_packages')
          .select('id, treatment_code, treatment_plan, category, package_price, diagnosis, anaesthesia_type, remark')
          .order('treatment_plan');

        if (searchTerm) {
          query = query.or(`treatment_plan.ilike.%${searchTerm}%,treatment_code.ilike.%${searchTerm}%,category.ilike.%${searchTerm}%,diagnosis.ilike.%${searchTerm}%,anaesthesia_type.ilike.%${searchTerm}%`);
        }

        const { data, error } = await query;
        if (error) {
          console.error('Error fetching Yojana package master rows:', error);
          throw error;
        }

        return (data || []).map(proc => ({
          id: proc.id,
          name: proc.treatment_plan || '',
          code: proc.treatment_code || '',
          category: proc.category || '',
          description: [proc.diagnosis, proc.anaesthesia_type, proc.remark].filter(Boolean).join(' | '),
          private: proc.package_price || 0,
          NABH_NABL_Rate: proc.package_price || 0,
          selectedRate: proc.package_price || 0,
          rateSource: 'pmjay_mjpjay_package_price',
          is_yojana: true
        }));
      }

      // Standard CGHS surgery search
      let query = supabase
        .from('cghs_surgery')
        .select('*')
        .eq('is_active', true)
        .order('name');

      if (searchTerm) {
        query = query.or(`name.ilike.%${searchTerm}%,code.ilike.%${searchTerm}%,category.ilike.%${searchTerm}%`);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching CGHS surgeries:', error);
        throw error;
      }

      // Apply corporate-based rate selection
      const usesBhopaliRate =
        corporate.includes('mp police') ||
        corporate.includes('ordnance factory') ||
        corporate.includes('ordnance factory itarsi');

      const surgeriesWithSelectedRate = data?.map(surgery => {
        let selectedRate = surgery.private || surgery.NABH_NABL_Rate || 0;
        let rateSource = 'private/nabh_nabl';

        if (usesBhopaliRate && surgery.bhopal_nabh_rate && surgery.bhopal_nabh_rate > 0) {
          selectedRate = surgery.bhopal_nabh_rate;
          rateSource = 'bhopal_nabh';
        }

        return {
          ...surgery,
          selectedRate,
          NABH_NABL_Rate: selectedRate,
          rateSource
        };
      }) || [];

      return surgeriesWithSelectedRate;
    }
  });

  return {
    surgeries,
    isLoading,
    searchTerm,
    setSearchTerm
  };
};
