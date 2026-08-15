import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  LabOrder,
  LabTest,
  TestPanel,
  TestCategory,
  LabDepartment,
  LabSample,
  TestResult,
  LabEquipment,
  QualityControl,
  LabReport
} from '@/types/lab';

// Lab Orders Hook
export function useLabOrders() {
  const { hospitalConfig } = useAuth();
  const [orders, setOrders] = useState<LabOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // 🏥 EXPLICIT HOSPITAL FILTERING - If-Else Condition
      let hospitalFilter = '';
      if (hospitalConfig.name === 'hope') {
        hospitalFilter = 'hope';
        console.log('🏥 HOPE Hospital login detected - fetching hope lab orders');
      } else if (hospitalConfig.name === 'ayushman') {
        hospitalFilter = 'ayushman';
        console.log('🏥 AYUSHMAN Hospital login detected - fetching ayushman lab orders');
      } else {
        hospitalFilter = 'hope'; // default fallback
        console.log('🏥 Unknown hospital type, defaulting to hope lab orders');
        console.log('🚨 DEBUG: hospitalConfig.name was:', hospitalConfig.name);
      }

      const { data, error: supabaseError } = await supabase
        .from('lab_orders')
        .select(`
          *,
          patients!inner (
            id,
            patients_id,
            name,
            hospital_name
          ),
          order_test_items (
            *,
            lab_tests (
              test_name,
              test_code
            ),
            test_panels (
              panel_name,
              panel_code
            )
          ),
          lab_samples (
            *
          )
        `)
        .eq('patients.hospital_name', hospitalFilter)
        .order('order_date', { ascending: false });

      if (supabaseError) {
        throw supabaseError;
      }

      // Map the database data to our LabOrder interface
      const mappedOrders: LabOrder[] = (data || []).map(order => ({
        id: order.id,
        order_number: order.order_number,
        patient_name: order.patient_name,
        patient_id: order.patient_id,
        patient_age: order.patient_age,
        patient_gender: order.patient_gender,
        patient_phone: order.patient_phone,
        ordering_doctor: order.ordering_doctor,
        doctor_id: order.doctor_id,
        order_date: order.order_date,
        order_time: order.order_time,
        order_status: order.order_status || 'Created',
        order_type: order.order_type || 'Routine',
        priority: order.priority || 'Normal',
        priority_level: 2, // Default medium priority
        clinical_history: order.clinical_history,
        provisional_diagnosis: order.provisional_diagnosis,
        collection_date: order.collection_date,
        collection_time: order.collection_time,
        collection_location: order.collection_location,
        collected_by: order.collected_by,
        sample_collection_datetime: order.sample_collection_datetime,
        sample_received_datetime: order.sample_received_datetime,
        results_ready_datetime: order.results_ready_datetime,
        report_dispatch_datetime: order.report_dispatch_datetime,
        total_amount: order.total_amount || 0,
        final_amount: order.final_amount || 0,
        discount_amount: order.discount_amount || 0,
        payment_status: order.payment_status || 'Pending',
        payment_method: order.payment_method,
        special_instructions: order.special_instructions,
        internal_notes: order.internal_notes,
        icd_codes: order.icd_codes,
        referring_facility: order.referring_facility,
        cancellation_reason: order.cancellation_reason,
        created_at: order.created_at,
        updated_at: order.updated_at,
        created_by: order.created_by,
        updated_by: order.updated_by,
        // Computed properties
        status: order.order_status || 'Created',
        completed_tests: 0, // Would be calculated from test results
        test_count: order.order_test_items?.length || 0,
        paid_amount: order.final_amount || 0
      }));

      setOrders(mappedOrders);
    } catch (err) {
      console.error('Error fetching lab orders:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch lab orders');
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const createOrder = useCallback(async (orderData: Partial<LabOrder>) => {
    try {
      // 🏥 EXPLICIT HOSPITAL FILTERING - If-Else Condition
      let hospitalFilter = '';
      if (hospitalConfig.name === 'hope') {
        hospitalFilter = 'hope';
        console.log('🏥 HOPE Hospital login detected - creating hope lab order');
      } else if (hospitalConfig.name === 'ayushman') {
        hospitalFilter = 'ayushman';
        console.log('🏥 AYUSHMAN Hospital login detected - creating ayushman lab order');
      } else {
        hospitalFilter = 'hope'; // default fallback
        console.log('🏥 Unknown hospital type, defaulting to hope lab order');
        console.log('🚨 DEBUG: hospitalConfig.name was:', hospitalConfig.name);
      }

      const { data, error: supabaseError } = await supabase
        .from('lab_orders')
        .insert({
          order_number: `LAB-${Date.now()}`, // Generate order number
          patient_name: orderData.patient_name || '',
          ordering_doctor: orderData.ordering_doctor || '',
          patient_id: orderData.patient_id,
          order_date: orderData.order_date,
          order_type: orderData.order_type,
          clinical_history: orderData.clinical_history,
          provisional_diagnosis: orderData.provisional_diagnosis,
          priority: orderData.priority,
          special_instructions: orderData.special_instructions
          // 🏥 No hospital_name needed - will use patient's hospital through patient_id
        })
        .select()
        .single();

      if (supabaseError) {
        throw supabaseError;
      }

      await fetchOrders(); // Refresh the list
      return data;
    } catch (err) {
      console.error('Error creating lab order:', err);
      throw err;
    }
  }, [fetchOrders]);

  const updateOrder = useCallback(async (orderId: string, updates: Partial<LabOrder>) => {
    try {
      const { data, error: supabaseError } = await supabase
        .from('lab_orders')
        .update({
          patient_name: updates.patient_name,
          ordering_doctor: updates.ordering_doctor,
          order_status: updates.order_status,
          priority: updates.priority,
          clinical_history: updates.clinical_history,
          provisional_diagnosis: updates.provisional_diagnosis,
          special_instructions: updates.special_instructions,
          updated_at: new Date().toISOString()
        })
        .eq('id', orderId)
        .select()
        .single();

      if (supabaseError) {
        throw supabaseError;
      }

      await fetchOrders(); // Refresh the list
      return data;
    } catch (err) {
      console.error('Error updating lab order:', err);
      throw err;
    }
  }, [fetchOrders]);

  return {
    orders,
    loading,
    error,
    refetch: fetchOrders,
    createOrder,
    updateOrder
  };
}

// Lab Tests Hook
export function useLabTests() {
  const { hospitalConfig } = useAuth();
  const [tests, setTests] = useState<LabTest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTests = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // 🏥 EXPLICIT HOSPITAL FILTERING - If-Else Condition
      let hospitalFilter = '';
      if (hospitalConfig.name === 'hope') {
        hospitalFilter = 'hope';
        console.log('🏥 HOPE Hospital login detected - fetching hope lab tests');
      } else if (hospitalConfig.name === 'ayushman') {
        hospitalFilter = 'ayushman';
        console.log('🏥 AYUSHMAN Hospital login detected - fetching ayushman lab tests');
      } else {
        hospitalFilter = 'hope'; // default fallback
        console.log('🏥 Unknown hospital type, defaulting to hope lab tests');
        console.log('🚨 DEBUG: hospitalConfig.name was:', hospitalConfig.name);
      }

      const { data, error: supabaseError } = await supabase
        .from('lab_tests')
        .select(`
          *,
          test_categories (
            category_name,
            category_code
          ),
          lab_departments (
            department_name,
            department_code
          )
        `)
        .eq('is_active', true)
        .order('test_name');

      // 🏥 Lab tests can be shared across hospitals - no hospital filtering needed

      if (supabaseError) {
        throw supabaseError;
      }

      // Map the database data to our LabTest interface
      const mappedTests: LabTest[] = (data || []).map(test => ({
        ...test,
        outsourced: test.is_outsourced || false,
        decimal_places: 2 // Default value
      }));

      setTests(mappedTests);
    } catch (err) {
      console.error('Error fetching lab tests:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch lab tests');
      setTests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTests();
  }, [fetchTests]);

  const createTest = useCallback(async (testData: Partial<LabTest>) => {
    try {
      const { data, error: supabaseError } = await supabase
        .from('lab_tests')
        .insert({
          test_code: testData.test_code || `TEST-${Date.now()}`,
          test_name: testData.test_name || '',
          test_type: testData.test_type,
          category_id: testData.category_id,
          department_id: testData.department_id,
          test_price: testData.test_price || 0,
          sample_type: testData.sample_type,
          container_type: testData.container_type,
          method: testData.method,
          analyzer: testData.analyzer,
          processing_time_hours: testData.processing_time_hours || 24,
          is_outsourced: testData.is_outsourced || false,
          outsourced_lab: testData.outsourced_lab,
          is_active: true
        })
        .select()
        .single();

      if (supabaseError) {
        throw supabaseError;
      }

      await fetchTests(); // Refresh the list
      return data;
    } catch (err) {
      console.error('Error creating lab test:', err);
      throw err;
    }
  }, [fetchTests]);

  const updateTest = useCallback(async (testId: string, updates: Partial<LabTest>) => {
    try {
      const { data, error: supabaseError } = await supabase
        .from('lab_tests')
        .update({
          test_name: updates.test_name,
          test_type: updates.test_type,
          test_price: updates.test_price,
          sample_type: updates.sample_type,
          container_type: updates.container_type,
          method: updates.method,
          analyzer: updates.analyzer,
          processing_time_hours: updates.processing_time_hours,
          is_outsourced: updates.is_outsourced,
          outsourced_lab: updates.outsourced_lab,
          is_active: updates.is_active,
          updated_at: new Date().toISOString()
        })
        .eq('id', testId)
        .select()
        .single();

      if (supabaseError) {
        throw supabaseError;
      }

      await fetchTests(); // Refresh the list
      return data;
    } catch (err) {
      console.error('Error updating lab test:', err);
      throw err;
    }
  }, [fetchTests]);

  return {
    tests,
    loading,
    error,
    refetch: fetchTests,
    createTest,
    updateTest
  };
}

// Test Panels Hook
export function useTestPanels() {
  const { hospitalConfig } = useAuth();
  const [panels, setPanels] = useState<TestPanel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPanels = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // 🏥 EXPLICIT HOSPITAL FILTERING - If-Else Condition
      let hospitalFilter = '';
      if (hospitalConfig.name === 'hope') {
        hospitalFilter = 'hope';
        console.log('🏥 HOPE Hospital login detected - fetching hope lab panels');
      } else if (hospitalConfig.name === 'ayushman') {
        hospitalFilter = 'ayushman';
        console.log('🏥 AYUSHMAN Hospital login detected - fetching ayushman lab panels');
      } else {
        hospitalFilter = 'hope'; // default fallback
        console.log('🏥 Unknown hospital type, defaulting to hope lab panels');
        console.log('🚨 DEBUG: hospitalConfig.name was:', hospitalConfig.name);
      }

      const { data, error: supabaseError } = await supabase
        .from('lab')
        .select('*')
        .order('name');

      // 🏥 Lab tests/panels can be shared across hospitals - no hospital filtering needed

      if (supabaseError) {
        throw supabaseError;
      }

      console.log('📋 [useTestPanels] Fetched panels:', data?.length, 'Total panels from lab table');
      console.log('📋 [useTestPanels] Panel names:', data?.slice(0, 20).map(p => p.name).join(', '));
      setPanels(data || []);
    } catch (err) {
      console.error('Error fetching lab panels:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch lab panels');
      setPanels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPanels();
  }, [fetchPanels]);

  const createPanel = useCallback(async (panelData: {
    panel_name: string;
    panel_code: string;
    description?: string;
    category?: string;
    panel_price?: number;
    test_method?: string;
    // Add all form fields
    icd_10_code?: string;
    CGHS_code?: string;
    rsby_code?: string;
    loinc_code?: string;
    cpt_code?: string;
    machine_name?: string;
    title_machine_name?: string;
    sample_type?: string;
    sub_specialty?: string;
    short_form?: string;
    preparation_time?: string;
    specific_instruction_for_preparation?: string;
    attach_file?: boolean;
    service_group?: string;
    map_test_to_service?: string;
    parameter_panel_test?: string;
    test_result_help?: string;
    default_result?: string;
    note_opinion_template?: string;
    speciality?: string;
    'Non-NABH_rates_in_rupee'?: number; // Added Non-NABH rates field
    'NABH_rates_in_rupee'?: number; // Added NABH rates field
    private?: number; // Added private rates field
    bhopal_nabh_rate?: number; // Bhopal NABH rate
    bhopal_non_nabh_rate?: number; // Bhopal Non-NABH rate
    attributes?: any; // JSON field for test attributes
  }) => {
    try {
      // 🏥 EXPLICIT HOSPITAL FILTERING - If-Else Condition
      let hospitalFilter = '';
      if (hospitalConfig.name === 'hope') {
        hospitalFilter = 'hope';
        console.log('🏥 HOPE Hospital login detected - creating hope lab panel');
      } else if (hospitalConfig.name === 'ayushman') {
        hospitalFilter = 'ayushman';
        console.log('🏥 AYUSHMAN Hospital login detected - creating ayushman lab panel');
      } else {
        hospitalFilter = 'hope'; // default fallback
        console.log('🏥 Unknown hospital type, defaulting to hope lab panel');
        console.log('🚨 DEBUG: hospitalConfig.name was:', hospitalConfig.name);
      }

      // Now saving to 'lab' table instead of 'test_panels'
      const { data, error: supabaseError } = await supabase
        .from('lab')
        .insert({
          name: panelData.panel_name,
          category: panelData.category || 'General',
          description: panelData.description,
          test_method: panelData.test_method,
          // 🏥 Lab tests are shared across hospitals - no hospital assignment needed
          // Add all form fields to database insert
          icd_10_code: panelData.icd_10_code,
          CGHS_code: panelData.CGHS_code,
          rsby_code: panelData.rsby_code,
          loinc_code: panelData.loinc_code,
          cpt_code: panelData.cpt_code,
          machine_name: panelData.machine_name,
          title_machine_name: panelData.title_machine_name,
          sample_type: panelData.sample_type,
          sub_specialty: panelData.sub_specialty,
          short_form: panelData.short_form,
          preparation_time: panelData.preparation_time,
          specific_instruction_for_preparation: panelData.specific_instruction_for_preparation,
          attach_file: panelData.attach_file,
          service_group: panelData.service_group,
          map_test_to_service: panelData.map_test_to_service,
          parameter_panel_test: panelData.parameter_panel_test,
          test_result_help: panelData.test_result_help,
          default_result: panelData.default_result,
          note_opinion_template: panelData.note_opinion_template,
          speciality: panelData.speciality,
          'Non-NABH_rates_in_rupee': panelData['Non-NABH_rates_in_rupee'], // Save Non-NABH rates
          'NABH_rates_in_rupee': panelData['NABH_rates_in_rupee'], // Save NABH rates
          private: panelData.private, // Save private rates
          bhopal_nabh_rate: panelData.bhopal_nabh_rate, // Save Bhopal NABH rates
          bhopal_non_nabh_rate: panelData.bhopal_non_nabh_rate, // Save Bhopal Non-NABH rates
          attributes: panelData.attributes // Save attributes to database
        })
        .select()
        .single();

      if (supabaseError) {
        // If it's a uniqueness constraint error, try with a timestamp suffix
        if (supabaseError.code === '23505' || supabaseError.message?.includes('duplicate key')) {
          const timestampName = `${panelData.panel_name}_${Date.now()}`;
          const { data: retryData, error: retryError } = await supabase
            .from('lab')
            .insert({
              name: timestampName,
              category: panelData.category || 'General',
              description: panelData.description,
              test_method: panelData.test_method,
              // 🏥 Lab tests are shared across hospitals - no hospital assignment needed
              // Add all form fields to retry insert
              icd_10_code: panelData.icd_10_code,
              CGHS_code: panelData.CGHS_code,
              rsby_code: panelData.rsby_code,
              loinc_code: panelData.loinc_code,
              cpt_code: panelData.cpt_code,
              machine_name: panelData.machine_name,
              title_machine_name: panelData.title_machine_name,
              sample_type: panelData.sample_type,
              sub_specialty: panelData.sub_specialty,
              short_form: panelData.short_form,
              preparation_time: panelData.preparation_time,
              specific_instruction_for_preparation: panelData.specific_instruction_for_preparation,
              attach_file: panelData.attach_file,
              service_group: panelData.service_group,
              map_test_to_service: panelData.map_test_to_service,
              parameter_panel_test: panelData.parameter_panel_test,
              test_result_help: panelData.test_result_help,
              default_result: panelData.default_result,
              note_opinion_template: panelData.note_opinion_template,
              speciality: panelData.speciality,
              non_nabh_rates_in_rupee: panelData.non_nabh_rates_in_rupee, // Save Non-NABH rates
              nabh_rates_in_rupee: panelData.nabh_rates_in_rupee, // Save NABH rates
              private: panelData.private, // Save private rates
              bhopal_nabh_rate: panelData.bhopal_nabh_rate, // Save Bhopal NABH rates
              bhopal_non_nabh_rate: panelData.bhopal_non_nabh_rate, // Save Bhopal Non-NABH rates
              attributes: panelData.attributes // Save attributes to database
            })
            .select()
            .single();

          if (retryError) {
            throw retryError;
          }
          
          await fetchPanels(); // Refresh the list
          return retryData;
        }
        throw supabaseError;
      }

      await fetchPanels(); // Refresh the list
      return data;
    } catch (err) {
      console.error('Error creating lab panel:', err);
      throw err;
    }
  }, [fetchPanels]);

  const updatePanel = useCallback(async (panelId: string, updates: {
    name?: string;
    category?: string;
    description?: string;
    test_method?: string;
    // Add all form fields for update
    icd_10_code?: string;
    CGHS_code?: string;
    rsby_code?: string;
    loinc_code?: string;
    cpt_code?: string;
    machine_name?: string;
    title_machine_name?: string;
    sample_type?: string;
    sub_specialty?: string;
    short_form?: string;
    preparation_time?: string;
    specific_instruction_for_preparation?: string;
    attach_file?: boolean;
    service_group?: string;
    map_test_to_service?: string;
    parameter_panel_test?: string;
    test_result_help?: string;
    default_result?: string;
    note_opinion_template?: string;
    speciality?: string;
    'Non-NABH_rates_in_rupee'?: number; // Added Non-NABH rates field
    'NABH_rates_in_rupee'?: number; // Added NABH rates field
    private?: number; // Added private rates field
    bhopal_nabh_rate?: number; // Bhopal NABH rate
    bhopal_non_nabh_rate?: number; // Bhopal Non-NABH rate
    attributes?: any; // JSON field for test attributes
  }) => {
    try {
      const { data, error: supabaseError } = await supabase
        .from('lab')
        .update(updates)
        .eq('id', panelId)
        .select()
        .single();

      if (supabaseError) {
        throw supabaseError;
      }

      await fetchPanels(); // Refresh the list
      return data;
    } catch (err) {
      console.error('Error updating lab panel:', err);
      throw err;
    }
  }, [fetchPanels]);

  const deletePanel = useCallback(async (panelId: string) => {
    try {
      const { error: supabaseError } = await supabase
        .from('lab')
        .delete()
        .eq('id', panelId);

      if (supabaseError) {
        throw supabaseError;
      }

      await fetchPanels(); // Refresh the list
      return true;
    } catch (err) {
      console.error('Error deleting lab panel:', err);
      throw err;
    }
  }, [fetchPanels]);

  return {
    panels,
    loading,
    error,
    refetch: fetchPanels,
    createPanel,
    updatePanel,
    deletePanel
  };
}

// Test Categories Hook
export function useTestCategories() {
  const [categories, setCategories] = useState<TestCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCategories = async () => {
      setLoading(true);
      setError(null);

      try {
        const { data, error: supabaseError } = await supabase
          .from('test_categories')
          .select('*')
          .eq('is_active', true)
          .order('category_name');

        if (supabaseError) {
          throw supabaseError;
        }

        setCategories(data || []);
      } catch (err) {
        console.error('Error fetching test categories:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch test categories');
        setCategories([]);
      } finally {
        setLoading(false);
      }
    };

    fetchCategories();
  }, []);

  return { categories, loading, error };
}

// Lab Departments Hook
export function useLabDepartments() {
  const [departments, setDepartments] = useState<LabDepartment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDepartments = async () => {
      setLoading(true);
      setError(null);

      try {
        const { data, error: supabaseError } = await supabase
          .from('lab_departments')
          .select('*')
          .eq('is_active', true)
          .order('department_name');

        if (supabaseError) {
          throw supabaseError;
        }

        setDepartments(data || []);
      } catch (err) {
        console.error('Error fetching lab departments:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch lab departments');
        setDepartments([]);
      } finally {
        setLoading(false);
      }
    };

    fetchDepartments();
  }, []);

  return { departments, loading, error };
}

// Lab Samples Hook
export function useLabSamples() {
  const { hospitalConfig } = useAuth();
  const [samples, setSamples] = useState<LabSample[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSamples = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // 🏥 EXPLICIT HOSPITAL FILTERING - If-Else Condition
      let hospitalFilter = '';
      if (hospitalConfig.name === 'hope') {
        hospitalFilter = 'hope';
        console.log('🏥 HOPE Hospital login detected - fetching hope lab samples');
      } else if (hospitalConfig.name === 'ayushman') {
        hospitalFilter = 'ayushman';
        console.log('🏥 AYUSHMAN Hospital login detected - fetching ayushman lab samples');
      } else {
        hospitalFilter = 'hope'; // default fallback
        console.log('🏥 Unknown hospital type, defaulting to hope lab samples');
        console.log('🚨 DEBUG: hospitalConfig.name was:', hospitalConfig.name);
      }

      const { data, error: supabaseError } = await supabase
        .from('lab_samples')
        .select(`
          *,
          lab_orders!inner (
            order_number,
            patient_name,
            ordering_doctor,
            patient_id,
            patients!inner (
              hospital_name
            )
          )
        `)
        .eq('lab_orders.patients.hospital_name', hospitalFilter)
        .order('received_datetime', { ascending: false });

      if (supabaseError) {
        throw supabaseError;
      }

      setSamples(data || []);
    } catch (err) {
      console.error('Error fetching lab samples:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch lab samples');
      setSamples([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSamples();
  }, [fetchSamples]);

  const updateSample = useCallback(async (sampleId: string, updates: Partial<LabSample>) => {
    try {
      const { data, error: supabaseError } = await supabase
        .from('lab_samples')
        .update(updates)
        .eq('id', sampleId)
        .select()
        .single();

      if (supabaseError) {
        throw supabaseError;
      }

      await fetchSamples(); // Refresh the list
      return data;
    } catch (err) {
      console.error('Error updating lab sample:', err);
      throw err;
    }
  }, [fetchSamples]);

  return {
    samples,
    loading,
    error,
    refetch: fetchSamples,
    updateSample
  };
}

// Test Results Hook
export function useTestResults() {
  const { hospitalConfig } = useAuth();
  const [results, setResults] = useState<TestResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchResults = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // 🏥 EXPLICIT HOSPITAL FILTERING - If-Else Condition
      let hospitalFilter = '';
      if (hospitalConfig.name === 'hope') {
        hospitalFilter = 'hope';
        console.log('🏥 HOPE Hospital login detected - fetching hope test results');
      } else if (hospitalConfig.name === 'ayushman') {
        hospitalFilter = 'ayushman';
        console.log('🏥 AYUSHMAN Hospital login detected - fetching ayushman test results');
      } else {
        hospitalFilter = 'hope'; // default fallback
        console.log('🏥 Unknown hospital type, defaulting to hope test results');
        console.log('🚨 DEBUG: hospitalConfig.name was:', hospitalConfig.name);
      }

      const { data, error: supabaseError } = await supabase
        .from('test_results')
        .select(`
          *,
          lab_orders!inner (
            order_number,
            patient_name,
            patient_id,
            patients!inner (
              hospital_name
            )
          ),
          lab_tests (
            test_name,
            test_code
          ),
          lab_samples (
            sample_barcode
          )
        `)
        .eq('lab_orders.patients.hospital_name', hospitalFilter)
        .order('result_datetime', { ascending: false });

      if (supabaseError) {
        throw supabaseError;
      }

      setResults(data || []);
    } catch (err) {
      console.error('Error fetching test results:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch test results');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  const createResult = useCallback(async (resultData: Partial<TestResult>) => {
    try {
      const { data, error: supabaseError } = await supabase
        .from('test_results')
        .insert(resultData)
        .select()
        .single();

      if (supabaseError) {
        throw supabaseError;
      }

      await fetchResults(); // Refresh the list
      return data;
    } catch (err) {
      console.error('Error creating test result:', err);
      throw err;
    }
  }, [fetchResults]);

  const updateResult = useCallback(async (resultId: string, updates: Partial<TestResult>) => {
    try {
      const { data, error: supabaseError } = await supabase
        .from('test_results')
        .update(updates)
        .eq('id', resultId)
        .select()
        .single();

      if (supabaseError) {
        throw supabaseError;
      }

      await fetchResults(); // Refresh the list
      return data;
    } catch (err) {
      console.error('Error updating test result:', err);
      throw err;
    }
  }, [fetchResults]);

  return {
    results,
    loading,
    error,
    refetch: fetchResults,
    createResult,
    updateResult
  };
}

// Lab Equipment Hook
export function useLabEquipment() {
  const [equipment, setEquipment] = useState<LabEquipment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchEquipment = async () => {
      setLoading(true);
      setError(null);

      try {
        const { data, error: supabaseError } = await supabase
          .from('lab_equipment')
          .select(`
            *,
            lab_departments (
              department_name,
              department_code
            )
          `)
          .order('equipment_name');

        if (supabaseError) {
          throw supabaseError;
        }

        setEquipment(data || []);
      } catch (err) {
        console.error('Error fetching lab equipment:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch lab equipment');
        setEquipment([]);
      } finally {
        setLoading(false);
      }
    };

    fetchEquipment();
  }, []);

  return { equipment, loading, error };
}

// Quality Control Hook - Fixed with correct field mapping and required fields
export function useQualityControl() {
  const [qcRecords, setQcRecords] = useState<QualityControl[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchQC = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: supabaseError } = await supabase
        .from('quality_controls')
        .select(`
          *,
          lab_equipment (
            equipment_name,
            equipment_code
          ),
          lab_tests (
            test_name,
            test_code
          )
        `)
        .order('performed_datetime', { ascending: false });

      if (supabaseError) {
        throw supabaseError;
      }

      // Map the database data to our QualityControl interface
      const mappedQC: QualityControl[] = (data || []).map(qc => ({
        id: qc.id,
        equipment_id: qc.equipment_id,
        test_id: qc.test_id,
        qc_lot_number: qc.lot_number,
        qc_level: qc.level,
        expected_value: qc.expected_value?.toString(),
        actual_value: qc.actual_value?.toString(),
        qc_status: qc.qc_status,
        performed_datetime: qc.performed_datetime,
        performed_by: qc.performed_by,
        qc_notes: qc.corrective_action, // Use corrective_action field from database
        created_at: qc.created_at,
        updated_at: qc.updated_at
      }));

      setQcRecords(mappedQC);
    } catch (err) {
      console.error('Error fetching quality control records:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch quality control records');
      setQcRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQC();
  }, [fetchQC]);

  const createQC = useCallback(async (qcData: Partial<QualityControl>) => {
    try {
      const { data, error: supabaseError } = await supabase
        .from('quality_controls')
        .insert({
          lab_equipment_id: qcData.equipment_id, // Use correct field name
          test_id: qcData.test_id,
          lot_number: qcData.qc_lot_number,
          level: qcData.qc_level,
          expected_value: parseFloat(qcData.expected_value || '0'),
          actual_value: parseFloat(qcData.actual_value || '0'),
          qc_status: qcData.qc_status || 'Pass',
          qc_type: 'Internal', // Add required field
          performed_datetime: qcData.performed_datetime || new Date().toISOString(),
          performed_by: qcData.performed_by,
          corrective_action: qcData.qc_notes
        })
        .select()
        .single();

      if (supabaseError) {
        throw supabaseError;
      }

      await fetchQC(); // Refresh the list
      return data;
    } catch (err) {
      console.error('Error creating quality control record:', err);
      throw err;
    }
  }, [fetchQC]);

  return {
    qcRecords,
    loading,
    error,
    refetch: fetchQC,
    createQC
  };
}

// Lab Reports Hook
export function useLabReports() {
  const { hospitalConfig } = useAuth();
  const [reports, setReports] = useState<LabReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // 🏥 EXPLICIT HOSPITAL FILTERING - If-Else Condition
      let hospitalFilter = '';
      if (hospitalConfig.name === 'hope') {
        hospitalFilter = 'hope';
        console.log('🏥 HOPE Hospital login detected - fetching hope lab reports');
      } else if (hospitalConfig.name === 'ayushman') {
        hospitalFilter = 'ayushman';
        console.log('🏥 AYUSHMAN Hospital login detected - fetching ayushman lab reports');
      } else {
        hospitalFilter = 'hope'; // default fallback
        console.log('🏥 Unknown hospital type, defaulting to hope lab reports');
        console.log('🚨 DEBUG: hospitalConfig.name was:', hospitalConfig.name);
      }

      const { data, error: supabaseError } = await supabase
        .from('lab_reports')
        .select(`
          *,
          lab_orders!inner (
            order_number,
            patient_name,
            ordering_doctor,
            patient_id,
            patients!inner (
              hospital_name
            )
          )
        `)
        .eq('lab_orders.patients.hospital_name', hospitalFilter)
        .order('prepared_datetime', { ascending: false });

      if (supabaseError) {
        throw supabaseError;
      }

      setReports(data || []);
    } catch (err) {
      console.error('Error fetching lab reports:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch lab reports');
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  return {
    reports,
    loading,
    error,
    refetch: fetchReports
  };
}

// Lab Test Form Builder Hook
export function useLabTestForms() {
  const [forms, setForms] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchForms = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: supabaseError } = await supabase
        .from('lab_tests')
        .select(`
          *,
          test_categories (
            category_name,
            category_code
          )
        `)
        .order('created_at', { ascending: false });

      if (supabaseError) {
        throw supabaseError;
      }

      setForms(data || []);
    } catch (err) {
      console.error('Error fetching lab test forms:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch lab test forms');
      setForms([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchForms();
  }, [fetchForms]);

  const saveTestForm = useCallback(async (formData: {
    categoryName: string;
    parameters: any[];
  }) => {
    try {
      setLoading(true);

      // First, create or get the test category
      let categoryId = null;

      // Check if category exists
      const { data: existingCategory } = await supabase
        .from('test_categories')
        .select('id')
        .eq('category_name', formData.categoryName)
        .single();

      if (existingCategory) {
        categoryId = existingCategory.id;
      } else {
        // Create new category
        const { data: newCategory, error: categoryError } = await supabase
          .from('test_categories')
          .insert({
            category_name: formData.categoryName,
            category_code: formData.categoryName.toUpperCase().replace(/\s+/g, '_'),
            description: `Category for ${formData.categoryName} tests`
          })
          .select('id')
          .single();

        if (categoryError) throw categoryError;
        categoryId = newCategory.id;
      }

      // Save each parameter as a test
      const testInserts = formData.parameters
        .filter(param => param.attributeName.trim() && !param.isCategory)
        .map(param => ({
          test_name: param.attributeName,
          test_code: `${param.attributeName.toUpperCase().replace(/\s+/g, '_')}_${Date.now()}`,
          short_name: param.attributeName.substring(0, 50),
          category_id: categoryId,
          test_type: param.type === 'Numeric' ? 'QUANTITATIVE' : 'QUALITATIVE',
          analyzer: param.machineName || null,
          reference_ranges: {
            rangeType: param.rangeType,
            normalRanges: param.normalRanges,
            units: param.units
          },
          test_price: 0,
          is_active: true,
          processing_time_hours: 24
        }));

      if (testInserts.length > 0) {
        const { error: testsError } = await supabase
          .from('lab_tests')
          .insert(testInserts);

        if (testsError) throw testsError;
      }

      await fetchForms(); // Refresh the list
      return { success: true };
    } catch (err) {
      console.error('Error saving test form:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [fetchForms]);

  return {
    forms,
    loading,
    error,
    refetch: fetchForms,
    saveTestForm
  };
}

// Lab Dashboard Summary Hook
export function useLabDashboard() {
  const { hospitalConfig } = useAuth();
  const [dashboardData, setDashboardData] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // 🏥 EXPLICIT HOSPITAL FILTERING - If-Else Condition
      let hospitalFilter = '';
      if (hospitalConfig.name === 'hope') {
        hospitalFilter = 'hope';
        console.log('🏥 HOPE Hospital login detected - fetching hope lab dashboard data');
      } else if (hospitalConfig.name === 'ayushman') {
        hospitalFilter = 'ayushman';
        console.log('🏥 AYUSHMAN Hospital login detected - fetching ayushman lab dashboard data');
      } else {
        hospitalFilter = 'hope'; // default fallback
        console.log('🏥 Unknown hospital type, defaulting to hope lab dashboard data');
        console.log('🚨 DEBUG: hospitalConfig.name was:', hospitalConfig.name);
      }

      // Fetch summary statistics in parallel with patient hospital filtering
      const [ordersResult, samplesResult, resultsResult, qcResult] = await Promise.all([
        supabase
          .from('lab_orders')
          .select('order_status, priority, patients!inner(hospital_name)')
          .eq('patients.hospital_name', hospitalFilter)
          .limit(1000),
        supabase
          .from('lab_samples')
          .select('processing_status, sample_quality, lab_orders!inner(patients!inner(hospital_name))')
          .eq('lab_orders.patients.hospital_name', hospitalFilter)
          .limit(1000),
        // Results are counted in SQL, not here. `test_results` does not exist
        // on this database -- this panel read a confident zero for as long as
        // it has been on screen -- and the real table, lab_results, has no
        // foreign key to visits, so there is no client-side join to the
        // hospital. Counting 560k rows in the browser is not an option either.
        supabase.rpc('lab_result_stats', { p_hospital_type: hospitalFilter }),
        supabase.from('quality_controls').select('qc_status').limit(1000) // QC might not have direct hospital filtering
      ]);

      // Process the data to create dashboard metrics
      const orderStats = {
        total: ordersResult.data?.length || 0,
        pending: ordersResult.data?.filter(o => o.order_status === 'Created').length || 0,
        inProgress: ordersResult.data?.filter(o => ['Sample_Collected', 'Sample_Received', 'In_Progress'].includes(o.order_status)).length || 0,
        completed: ordersResult.data?.filter(o => o.order_status === 'Completed').length || 0,
        critical: ordersResult.data?.filter(o => o.priority === 'Critical').length || 0
      };

      const sampleStats = {
        total: samplesResult.data?.length || 0,
        received: samplesResult.data?.filter(s => s.processing_status === 'Received').length || 0,
        processing: samplesResult.data?.filter(s => s.processing_status === 'Processing').length || 0,
        completed: samplesResult.data?.filter(s => s.processing_status === 'Completed').length || 0,
        rejected: samplesResult.data?.filter(s => s.sample_quality === 'Rejected').length || 0
      };

      // Already aggregated by lab_result_stats(): four integers, not rows.
      const resultCounts = (resultsResult.data ?? {}) as Record<string, number>;
      const resultStats = {
        total: Number(resultCounts.total) || 0,
        pending: Number(resultCounts.pending) || 0,
        final: Number(resultCounts.final) || 0,
        // Counted from is_abnormal, the only real column of its kind. Nothing
        // sets it today, so this reads 0 until something does.
        critical: Number(resultCounts.critical) || 0
      };

      const qcStats = {
        total: qcResult.data?.length || 0,
        passed: qcResult.data?.filter(q => q.qc_status === 'Pass').length || 0,
        failed: qcResult.data?.filter(q => q.qc_status === 'Fail').length || 0
      };

      setDashboardData({
        orders: orderStats,
        samples: sampleStats,
        results: resultStats,
        qualityControl: qcStats
      });
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch dashboard data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  return {
    dashboardData,
    loading,
    error,
    refetch: fetchDashboardData
  };
}

// Lab Subspecialties Hook
export function useLabSubspecialties() {
  const [subspecialties, setSubspecialties] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSubspecialties = async () => {
      console.log('🔍 [DEBUG] Fetching lab subspecialties...');
      setLoading(true);
      setError(null);

      try {
        const { data, error: supabaseError } = await supabase
          .from('lab_sub_speciality')
          .select('*')
          .not('name', 'is', null)  // Filter out null names
          .order('name');

        console.log('📊 [DEBUG] Supabase response:', { data, error: supabaseError });

        if (supabaseError) {
          console.error('❌ [DEBUG] Supabase error:', supabaseError);
          throw supabaseError;
        }

        console.log('📋 [DEBUG] Subspecialties data:', data);
        setSubspecialties(data || []);
      } catch (err) {
        console.error('❌ [DEBUG] Error fetching lab subspecialties:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch lab subspecialties');
        setSubspecialties([]);
      } finally {
        setLoading(false);
        console.log('🏁 [DEBUG] Fetch complete. Loading:', false);
      }
    };

    fetchSubspecialties();
  }, []);

  console.log('🔄 [useLabSubspecialties] Returning:', {
    subspecialties,
    length: subspecialties?.length,
    loading,
    error
  });

  return { subspecialties, loading, error };
}
