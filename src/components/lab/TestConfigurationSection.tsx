import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Plus, FlaskConical, X, GripVertical } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface SubTest {
  id: string;
  name: string;
  unit: string;
  type?: 'Numeric' | 'Text'; // Type field for numeric or text values
  textValue?: string; // Text value when type is Text
  formula?: string; // Formula for auto-calculation
  isMandatory?: boolean; // When true, sub-test shows in entry mode and print
  ageRanges: AgeRange[];
  normalRanges: NormalRange[];
  subTests?: SubTest[]; // Nested sub-tests
}

export interface AgeRange {
  id: string;
  minAge: string;
  maxAge: string;
  unit: 'Days' | 'Months' | 'Years';
  description: string;
}

export interface NormalRange {
  id: string;
  ageRange: string;
  gender: 'Male' | 'Female' | 'Both' | 'Child';
  minValue: string;
  maxValue: string;
  unit: string;
}

interface TestConfigurationSectionProps {
  testName: string;
  onTestNameChange: (testName: string) => void;
  subTests: SubTest[];
  onSubTestsChange: (subTests: SubTest[]) => void;
  onReorder?: () => void;  // Callback when drag-drop reorder happens
  isLoading?: boolean;
  labId?: string; // Lab/Panel ID for direct formula save
}

const TestConfigurationSection: React.FC<TestConfigurationSectionProps> = ({
  testName,
  onTestNameChange,
  subTests,
  onSubTestsChange,
  onReorder,
  isLoading = false,
  labId
}) => {
  const [nextSubTestId, setNextSubTestId] = useState(1);
  const [isFormulaDialogOpen, setIsFormulaDialogOpen] = useState(false);
  const [currentSubTestForFormula, setCurrentSubTestForFormula] = useState<SubTest | null>(null);
  const [selectedTest, setSelectedTest] = useState('');
  const [formula, setFormula] = useState('');
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [isSavingFormula, setIsSavingFormula] = useState(false);

  const { toast } = useToast();

  const addNewSubTest = () => {
    const newSubTest: SubTest = {
      id: `subtest_${nextSubTestId}`,
      name: '',
      unit: '',
      type: 'Numeric', // Default to Numeric
      textValue: '',
      isMandatory: true, // Default to mandatory
      ageRanges: [],
      normalRanges: [],
      subTests: []
    };
    onSubTestsChange([...subTests, newSubTest]);
    setNextSubTestId(nextSubTestId + 1);
  };

  const updateSubTest = (id: string, updatedSubTest: Partial<SubTest>) => {
    onSubTestsChange(subTests.map(st =>
      st.id === id ? { ...st, ...updatedSubTest } : st
    ));
  };

  // Helper to recursively update formula in nested subTests
  const updateSubTestFormula = (tests: SubTest[], targetId: string, newFormula: string): SubTest[] => {
    return tests.map(subTest => {
      // Check if this is the target
      if (subTest.id === targetId) {
        return { ...subTest, formula: newFormula };
      }
      // Recursively check nested subTests
      if (subTest.subTests && subTest.subTests.length > 0) {
        return {
          ...subTest,
          subTests: updateSubTestFormula(subTest.subTests, targetId, newFormula)
        };
      }
      return subTest;
    });
  };

  const removeSubTest = (id: string) => {
    onSubTestsChange(subTests.filter(st => st.id !== id));
  };

  // Nested sub-test functions
  const addNestedSubTest = (parentId: string) => {
    const newNestedSubTest: SubTest = {
      id: `subtest_${nextSubTestId}`,
      name: '',
      unit: '',
      type: 'Numeric', // Default to Numeric
      textValue: '',
      isMandatory: true, // Default to mandatory
      ageRanges: [],
      normalRanges: [],
      subTests: []
    };
    setNextSubTestId(nextSubTestId + 1);

    const updateNestedSubTests = (tests: SubTest[]): SubTest[] => {
      return tests.map(test => {
        if (test.id === parentId) {
          return {
            ...test,
            subTests: [...(test.subTests || []), newNestedSubTest]
          };
        }
        if (test.subTests && test.subTests.length > 0) {
          return {
            ...test,
            subTests: updateNestedSubTests(test.subTests)
          };
        }
        return test;
      });
    };

    onSubTestsChange(updateNestedSubTests(subTests));
  };

  const updateNestedSubTest = (parentId: string, nestedId: string, updatedSubTest: Partial<SubTest>) => {
    const updateNested = (tests: SubTest[]): SubTest[] => {
      return tests.map(test => {
        if (test.id === parentId) {
          return {
            ...test,
            subTests: (test.subTests || []).map(nested =>
              nested.id === nestedId ? { ...nested, ...updatedSubTest } : nested
            )
          };
        }
        if (test.subTests && test.subTests.length > 0) {
          return {
            ...test,
            subTests: updateNested(test.subTests)
          };
        }
        return test;
      });
    };

    onSubTestsChange(updateNested(subTests));
  };

  const removeNestedSubTest = (parentId: string, nestedId: string) => {
    const removeNested = (tests: SubTest[]): SubTest[] => {
      return tests.map(test => {
        if (test.id === parentId) {
          return {
            ...test,
            subTests: (test.subTests || []).filter(nested => nested.id !== nestedId)
          };
        }
        if (test.subTests && test.subTests.length > 0) {
          return {
            ...test,
            subTests: removeNested(test.subTests)
          };
        }
        return test;
      });
    };

    onSubTestsChange(removeNested(subTests));
  };

  const addAgeRange = (subTestId: string) => {
    const newAgeRange: AgeRange = {
      id: `agerange_${Date.now()}`,
      minAge: '',
      maxAge: '',
      unit: 'Years',
      description: ''
    };

    updateSubTest(subTestId, {
      ageRanges: [...(subTests.find(st => st.id === subTestId)?.ageRanges || []), newAgeRange]
    });
  };

  const updateAgeRange = (subTestId: string, ageRangeId: string, updatedRange: Partial<AgeRange>) => {
    const subTest = subTests.find(st => st.id === subTestId);
    if (!subTest) return;

    const updatedAgeRanges = subTest.ageRanges.map(ar =>
      ar.id === ageRangeId ? { ...ar, ...updatedRange } : ar
    );

    updateSubTest(subTestId, { ageRanges: updatedAgeRanges });
  };

  const removeAgeRange = (subTestId: string, ageRangeId: string) => {
    const subTest = subTests.find(st => st.id === subTestId);
    if (!subTest) return;

    updateSubTest(subTestId, {
      ageRanges: subTest.ageRanges.filter(ar => ar.id !== ageRangeId)
    });
  };

  const addNormalRange = (subTestId: string) => {
    const newNormalRange: NormalRange = {
      id: `normalrange_${Date.now()}`,
      ageRange: '- Years',
      gender: 'Both',
      minValue: '',
      maxValue: '',
      unit: ''
    };

    updateSubTest(subTestId, {
      normalRanges: [...(subTests.find(st => st.id === subTestId)?.normalRanges || []), newNormalRange]
    });
  };

  const updateNormalRange = (subTestId: string, normalRangeId: string, updatedRange: Partial<NormalRange>) => {
    const subTest = subTests.find(st => st.id === subTestId);
    if (!subTest) return;

    const updatedNormalRanges = subTest.normalRanges.map(nr =>
      nr.id === normalRangeId ? { ...nr, ...updatedRange } : nr
    );

    updateSubTest(subTestId, { normalRanges: updatedNormalRanges });
  };

  const removeNormalRange = (subTestId: string, normalRangeId: string) => {
    const subTest = subTests.find(st => st.id === subTestId);
    if (!subTest) return;

    updateSubTest(subTestId, {
      normalRanges: subTest.normalRanges.filter(nr => nr.id !== normalRangeId)
    });
  };

  // Drag and drop handlers
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();

    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      return;
    }

    const newSubTests = [...subTests];
    const [draggedItem] = newSubTests.splice(draggedIndex, 1);
    newSubTests.splice(dropIndex, 0, draggedItem);

    onSubTestsChange(newSubTests);
    setDraggedIndex(null);

    // Trigger auto-save callback after reordering
    if (onReorder) {
      console.log('🔄 Drag-drop complete! Triggering auto-save...');
      setTimeout(() => {
        onReorder();
      }, 100);
    } else {
    }
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  // Functions for nested sub-test age ranges
  const addNestedAgeRange = (parentId: string, nestedId: string) => {
    const newAgeRange: AgeRange = {
      id: `agerange_${Date.now()}`,
      minAge: '',
      maxAge: '',
      unit: 'Years',
      description: ''
    };

    const updateNested = (tests: SubTest[]): SubTest[] => {
      return tests.map(test => {
        if (test.id === parentId) {
          return {
            ...test,
            subTests: (test.subTests || []).map(nested =>
              nested.id === nestedId
                ? { ...nested, ageRanges: [...nested.ageRanges, newAgeRange] }
                : nested
            )
          };
        }
        if (test.subTests && test.subTests.length > 0) {
          return { ...test, subTests: updateNested(test.subTests) };
        }
        return test;
      });
    };

    onSubTestsChange(updateNested(subTests));
  };

  const updateNestedAgeRange = (parentId: string, nestedId: string, ageRangeId: string, updatedRange: Partial<AgeRange>) => {
    const updateNested = (tests: SubTest[]): SubTest[] => {
      return tests.map(test => {
        if (test.id === parentId) {
          return {
            ...test,
            subTests: (test.subTests || []).map(nested =>
              nested.id === nestedId
                ? {
                    ...nested,
                    ageRanges: nested.ageRanges.map(ar =>
                      ar.id === ageRangeId ? { ...ar, ...updatedRange } : ar
                    )
                  }
                : nested
            )
          };
        }
        if (test.subTests && test.subTests.length > 0) {
          return { ...test, subTests: updateNested(test.subTests) };
        }
        return test;
      });
    };

    onSubTestsChange(updateNested(subTests));
  };

  const removeNestedAgeRange = (parentId: string, nestedId: string, ageRangeId: string) => {
    const updateNested = (tests: SubTest[]): SubTest[] => {
      return tests.map(test => {
        if (test.id === parentId) {
          return {
            ...test,
            subTests: (test.subTests || []).map(nested =>
              nested.id === nestedId
                ? { ...nested, ageRanges: nested.ageRanges.filter(ar => ar.id !== ageRangeId) }
                : nested
            )
          };
        }
        if (test.subTests && test.subTests.length > 0) {
          return { ...test, subTests: updateNested(test.subTests) };
        }
        return test;
      });
    };

    onSubTestsChange(updateNested(subTests));
  };

  // Functions for nested sub-test normal ranges
  const addNestedNormalRange = (parentId: string, nestedId: string) => {
    const newNormalRange: NormalRange = {
      id: `normalrange_${Date.now()}`,
      ageRange: '- Years',
      gender: 'Both',
      minValue: '',
      maxValue: '',
      unit: ''
    };

    const updateNested = (tests: SubTest[]): SubTest[] => {
      return tests.map(test => {
        if (test.id === parentId) {
          return {
            ...test,
            subTests: (test.subTests || []).map(nested =>
              nested.id === nestedId
                ? { ...nested, normalRanges: [...nested.normalRanges, newNormalRange] }
                : nested
            )
          };
        }
        if (test.subTests && test.subTests.length > 0) {
          return { ...test, subTests: updateNested(test.subTests) };
        }
        return test;
      });
    };

    onSubTestsChange(updateNested(subTests));
  };

  const updateNestedNormalRange = (parentId: string, nestedId: string, normalRangeId: string, updatedRange: Partial<NormalRange>) => {
    const updateNested = (tests: SubTest[]): SubTest[] => {
      return tests.map(test => {
        if (test.id === parentId) {
          return {
            ...test,
            subTests: (test.subTests || []).map(nested =>
              nested.id === nestedId
                ? {
                    ...nested,
                    normalRanges: nested.normalRanges.map(nr =>
                      nr.id === normalRangeId ? { ...nr, ...updatedRange } : nr
                    )
                  }
                : nested
            )
          };
        }
        if (test.subTests && test.subTests.length > 0) {
          return { ...test, subTests: updateNested(test.subTests) };
        }
        return test;
      });
    };

    onSubTestsChange(updateNested(subTests));
  };

  const removeNestedNormalRange = (parentId: string, nestedId: string, normalRangeId: string) => {
    const updateNested = (tests: SubTest[]): SubTest[] => {
      return tests.map(test => {
        if (test.id === parentId) {
          return {
            ...test,
            subTests: (test.subTests || []).map(nested =>
              nested.id === nestedId
                ? { ...nested, normalRanges: nested.normalRanges.filter(nr => nr.id !== normalRangeId) }
                : nested
            )
          };
        }
        if (test.subTests && test.subTests.length > 0) {
          return { ...test, subTests: updateNested(test.subTests) };
        }
        return test;
      });
    };

    onSubTestsChange(updateNested(subTests));
  };

  // Formula helper functions
  const appendToFormula = (value: string) => {
    setFormula(prev => prev + value);
  };

  const clearFormula = () => {
    setFormula('');
  };

  const deleteLastChar = () => {
    setFormula(prev => prev.slice(0, -1));
  };

  const openFormulaDialog = (subTest: SubTest) => {
    console.log('🔍 openFormulaDialog called with subTest:', subTest);

    // Store the entire subTest object to avoid ID mismatch issues
    setCurrentSubTestForFormula(subTest);
    setSelectedTest('none');
    setFormula(subTest?.formula || '');
    setIsFormulaDialogOpen(true);
  };

  const saveFormula = async () => {
    // Use stored subTest object directly (no ID lookup needed)
    console.log('🔍 saveFormula called');
    console.log('🔍 currentSubTestForFormula:', currentSubTestForFormula);

    if (!currentSubTestForFormula) {
      toast({
        title: "Error",
        description: "Sub-test not found. Please try again.",
        variant: "destructive"
      });
      return;
    }

    if (!currentSubTestForFormula.name || !currentSubTestForFormula.name.trim()) {
      toast({
        title: "Error",
        description: "Sub-test name is required to save formula. Please enter a name first.",
        variant: "destructive"
      });
      return;
    }

    // Update local state - use recursive helper to also update nested subTests
    const updatedSubTests = updateSubTestFormula(subTests, currentSubTestForFormula.id, formula);

    onSubTestsChange(updatedSubTests);

    // Also update the stored object
    setCurrentSubTestForFormula({ ...currentSubTestForFormula, formula: formula });

    // If labId is available, save directly to database
    if (labId && testName) {
      setIsSavingFormula(true);

      try {
        const formulaData = {
          lab_id: labId,
          test_name: testName,
          sub_test_name: currentSubTestForFormula.name,
          formula: formula || null,
          test_type: currentSubTestForFormula.type || 'Numeric',
          text_value: currentSubTestForFormula.type === 'Text' ? (currentSubTestForFormula.textValue || null) : null,
          is_active: true
        };

        const { error: formulaError } = await supabase
          .from('lab_test_formulas')
          .upsert(formulaData, {
            onConflict: 'lab_id,test_name,sub_test_name'
          });

        if (formulaError) {
          console.error('⚠️ Error saving formula to database:', formulaError);
          toast({
            title: "Warning",
            description: `Formula updated locally but failed to save to database: ${formulaError.message}`,
            variant: "destructive"
          });
        } else {
          toast({
            title: "Success",
            description: `Formula saved successfully for ${currentSubTestForFormula.name}`,
          });
          setIsFormulaDialogOpen(false);
        }
      } catch (error) {
        console.error('⚠️ Unexpected error saving formula:', error);
        toast({
          title: "Error",
          description: `Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          variant: "destructive"
        });
      } finally {
        setIsSavingFormula(false);
      }
    } else {
      // No labId available, just close dialog (will save on panel save)
      toast({
        title: "Info",
        description: "Formula updated. Click 'Save Panel' to persist changes.",
      });
      setIsFormulaDialogOpen(false);
    }
  };

  // Get dynamic test options from current test's sub-tests
  const getDynamicTestOptions = () => {
    const options: string[] = [];

    // Add all parent sub-tests
    subTests.forEach(subTest => {
      if (subTest.name && subTest.name.trim()) {
        options.push(subTest.name);
      }

      // Add nested sub-tests (indented)
      if (subTest.subTests && subTest.subTests.length > 0) {
        subTest.subTests.forEach(nested => {
          if (nested.name && nested.name.trim()) {
            options.push(`  ${nested.name}`); // Indent nested with spaces
          }
        });
      }
    });

    return options;
  };

  const dynamicTestOptions = getDynamicTestOptions();

  // Get nested sub-tests for the current sub-test
  const getCurrentSubTestNestedTests = () => {
    const findSubTest = (tests: SubTest[], id: string): SubTest | null => {
      for (const test of tests) {
        if (test.id === id) return test;
        if (test.subTests && test.subTests.length > 0) {
          const found = findSubTest(test.subTests, id);
          if (found) return found;
        }
      }
      return null;
    };

    if (!currentSubTestForFormula) return [];
    const currentSubTest = findSubTest(subTests, currentSubTestForFormula.id);
    return currentSubTest?.subTests || [];
  };

  return (
    <div className="space-y-6 border rounded-lg p-6 bg-gray-50">
      {/* Sub-Test Configuration Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-800">Sub-Test Configuration</h3>
        <Button
          type="button"
          onClick={addNewSubTest}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700"
          size="sm"
        >
          <Plus className="h-4 w-4" />
          Add Sub-Test
        </Button>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="text-center py-8 text-gray-500">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-300 mx-auto mb-2"></div>
          <p>Loading existing sub-test configurations...</p>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && subTests.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <FlaskConical className="h-12 w-12 mx-auto mb-2 text-gray-300" />
          <p>No sub-tests configured yet. Click "Add Sub-Test" to get started.</p>
        </div>
      )}

      {/* Sub-Test Rows */}
      {subTests.map((subTest, index) => (
        <div
          key={subTest.id}
          className={`border border-gray-200 rounded-lg p-4 bg-white space-y-4 relative ${draggedIndex === index ? 'opacity-50' : ''}`}
          draggable
          onDragStart={() => handleDragStart(index)}
          onDragOver={(e) => handleDragOver(e, index)}
          onDrop={(e) => handleDrop(e, index)}
          onDragEnd={handleDragEnd}
        >
          {/* Drag handle */}
          <div className="absolute top-2 left-2 cursor-move">
            <GripVertical className="h-5 w-5 text-gray-400 hover:text-gray-600" />
          </div>

          {/* Remove button */}
          <Button
            type="button"
            onClick={() => removeSubTest(subTest.id)}
            className="absolute top-2 right-2 w-5 h-5 rounded-full bg-gray-200 hover:bg-red-200 p-0 flex items-center justify-center"
            size="sm"
            variant="ghost"
          >
            <X className="h-3 w-3 text-red-500" />
          </Button>

          {/* Sub-Test Header */}
          <div className="flex items-center gap-3 ml-8">
            <div className="flex-1 grid grid-cols-4 gap-4">
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-1 block">Sub Test Name</Label>
                <Input
                  placeholder="e.g. HB"
                  value={subTest.name}
                  onChange={(e) => updateSubTest(subTest.id, { name: e.target.value })}
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-1 block">Unit</Label>
                <Input
                  placeholder="e.g. g/dL"
                  value={subTest.unit}
                  onChange={(e) => updateSubTest(subTest.id, { unit: e.target.value })}
                  className="h-9"
                />
              </div>
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-1 block">Type</Label>
                <Select
                  value={subTest.type || 'Numeric'}
                  onValueChange={(value: 'Numeric' | 'Text') => updateSubTest(subTest.id, { type: value })}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Numeric">Numeric</SelectItem>
                    <SelectItem value="Text">Text</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 pt-6">
                <Checkbox
                  id={`mandatory-${subTest.id}`}
                  checked={subTest.isMandatory !== false}
                  onCheckedChange={(checked) => updateSubTest(subTest.id, { isMandatory: checked === true })}
                />
                <Label
                  htmlFor={`mandatory-${subTest.id}`}
                  className="text-sm font-medium text-gray-700 cursor-pointer"
                >
                  Mandatory
                </Label>
              </div>
            </div>
          </div>

          {/* Conditional rendering based on type */}
          {subTest.type === 'Text' ? (
            /* Text Type - Show only text area */
            <div className="space-y-3">
              <div>
                <Label className="text-sm font-medium text-gray-700 mb-1 block">Text Value</Label>
                <Textarea
                  placeholder="Enter text value..."
                  value={subTest.textValue || ''}
                  onChange={(e) => updateSubTest(subTest.id, { textValue: e.target.value })}
                  className="min-h-[100px]"
                />
              </div>
            </div>
          ) : (
            /* Numeric Type - Show all numeric options */
            <>
              {/* Age Ranges Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold text-gray-800">Age Ranges</Label>
                  <Button
                    type="button"
                    onClick={() => addAgeRange(subTest.id)}
                    className="bg-green-600 hover:bg-green-700 text-white px-3 py-1 h-7"
                    size="sm"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add Age Range
                  </Button>
                </div>

                {/* Show Formula if exists */}
                {subTest.formula && (
                  <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded-md">
                    <span className="text-xs font-medium text-blue-700">Formula:</span>
                    <code className="text-xs bg-blue-100 px-2 py-0.5 rounded text-blue-800">
                      {subTest.formula}
                    </code>
                  </div>
                )}

            {/* Age Range Headers */}
            {subTest.ageRanges.length > 0 && (
              <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-600 px-2">
                <div className="col-span-2">Min Age</div>
                <div className="col-span-2">Max Age</div>
                <div className="col-span-2">Unit</div>
                <div className="col-span-5">Description</div>
                <div className="col-span-1"></div>
              </div>
            )}

            {/* Age Range Rows */}
            {subTest.ageRanges.map((ageRange) => (
              <div key={ageRange.id} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-2">
                  <Input
                    placeholder="1"
                    value={ageRange.minAge}
                    onChange={(e) => updateAgeRange(subTest.id, ageRange.id, { minAge: e.target.value })}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    placeholder="5"
                    value={ageRange.maxAge}
                    onChange={(e) => updateAgeRange(subTest.id, ageRange.id, { maxAge: e.target.value })}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <Select
                    value={ageRange.unit}
                    onValueChange={(value: 'Days' | 'Months' | 'Years') =>
                      updateAgeRange(subTest.id, ageRange.id, { unit: value })
                    }
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Days">Days</SelectItem>
                      <SelectItem value="Months">Months</SelectItem>
                      <SelectItem value="Years">Years</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-5">
                  <Input
                    placeholder="Baby"
                    value={ageRange.description}
                    onChange={(e) => updateAgeRange(subTest.id, ageRange.id, { description: e.target.value })}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="col-span-1 flex justify-end">
                  <Button
                    type="button"
                    onClick={() => removeAgeRange(subTest.id, ageRange.id)}
                    className="w-6 h-6 rounded-full bg-red-100 hover:bg-red-200 p-0 flex items-center justify-center"
                    size="sm"
                    variant="ghost"
                  >
                    <X className="h-3 w-3 text-red-500" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Normal Ranges Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold text-gray-800">Normal Ranges</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={() => addNormalRange(subTest.id)}
                  className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1 h-7"
                  size="sm"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Normal Range
                </Button>
                <Button
                  type="button"
                  onClick={() => openFormulaDialog(subTest)}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 h-7"
                  size="sm"
                >
                  Formula
                </Button>
              </div>
            </div>

            {/* Normal Range Headers */}
            {subTest.normalRanges.length > 0 && (
              <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-600 px-2">
                <div className="col-span-2">Age Range</div>
                <div className="col-span-2">Gender</div>
                <div className="col-span-2">Min Value</div>
                <div className="col-span-2">Max Value</div>
                <div className="col-span-3">Unit</div>
                <div className="col-span-1"></div>
              </div>
            )}

            {/* Normal Range Rows */}
            {subTest.normalRanges.map((normalRange) => (
              <div key={normalRange.id} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-2">
                  <Select
                    value={normalRange.ageRange}
                    onValueChange={(value) => updateNormalRange(subTest.id, normalRange.id, { ageRange: value })}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="- Years">- Years</SelectItem>
                      {subTest.ageRanges.map((ar, arIndex) => (
                        <SelectItem key={`${ar.id}-${arIndex}`} value={`${ar.minAge}-${ar.maxAge} ${ar.unit}`}>
                          {ar.minAge}-{ar.maxAge} {ar.unit}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Select
                    value={normalRange.gender}
                    onValueChange={(value: 'Male' | 'Female' | 'Both') =>
                      updateNormalRange(subTest.id, normalRange.id, { gender: value })
                    }
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Both">Both</SelectItem>
                      <SelectItem value="Male">Male</SelectItem>
                      <SelectItem value="Female">Female</SelectItem>
                      <SelectItem value="Child">Child</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Input
                    placeholder="Up to"
                    value={normalRange.minValue}
                    onChange={(e) => updateNormalRange(subTest.id, normalRange.id, { minValue: e.target.value })}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    placeholder="16.0"
                    value={normalRange.maxValue}
                    onChange={(e) => updateNormalRange(subTest.id, normalRange.id, { maxValue: e.target.value })}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="col-span-3">
                  <Input
                    placeholder="g/dL"
                    value={normalRange.unit}
                    onChange={(e) => updateNormalRange(subTest.id, normalRange.id, { unit: e.target.value })}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="col-span-1 flex justify-end">
                  <Button
                    type="button"
                    onClick={() => removeNormalRange(subTest.id, normalRange.id)}
                    className="w-6 h-6 rounded-full bg-red-100 hover:bg-red-200 p-0 flex items-center justify-center"
                    size="sm"
                    variant="ghost"
                  >
                    <X className="h-3 w-3 text-red-500" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Nested Sub-Tests Section */}
          {subTest.subTests && subTest.subTests.length > 0 && (
            <div className="space-y-3 mt-4 pl-6 border-l-4 border-blue-300">
              <Label className="text-sm font-semibold text-blue-800">Nested Sub-Tests</Label>
              {subTest.subTests.map((nestedSubTest) => (
                <div key={nestedSubTest.id} className="border border-blue-200 rounded-lg p-4 bg-blue-50 space-y-3 relative">
                  {/* Remove nested sub-test button */}
                  <Button
                    type="button"
                    onClick={() => removeNestedSubTest(subTest.id, nestedSubTest.id)}
                    className="absolute top-2 right-2 w-5 h-5 rounded-full bg-gray-200 hover:bg-red-200 p-0 flex items-center justify-center"
                    size="sm"
                    variant="ghost"
                  >
                    <X className="h-3 w-3 text-red-500" />
                  </Button>

                  {/* Nested Sub-Test Header */}
                  <div className="grid grid-cols-4 gap-3">
                    <div>
                      <Label className="text-xs font-medium text-gray-700 mb-1 block">Nested Sub Test Name</Label>
                      <Input
                        placeholder="e.g. Differential Count"
                        value={nestedSubTest.name}
                        onChange={(e) => updateNestedSubTest(subTest.id, nestedSubTest.id, { name: e.target.value })}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-medium text-gray-700 mb-1 block">Unit</Label>
                      <Input
                        placeholder="e.g. %"
                        value={nestedSubTest.unit}
                        onChange={(e) => updateNestedSubTest(subTest.id, nestedSubTest.id, { unit: e.target.value })}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs font-medium text-gray-700 mb-1 block">Type</Label>
                      <Select
                        value={nestedSubTest.type || 'Numeric'}
                        onValueChange={(value: 'Numeric' | 'Text') =>
                          updateNestedSubTest(subTest.id, nestedSubTest.id, { type: value })
                        }
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Numeric">Numeric</SelectItem>
                          <SelectItem value="Text">Text</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center gap-2 pt-5">
                      <Checkbox
                        id={`nested-mandatory-${nestedSubTest.id}`}
                        checked={nestedSubTest.isMandatory !== false}
                        onCheckedChange={(checked) =>
                          updateNestedSubTest(subTest.id, nestedSubTest.id, { isMandatory: checked === true })
                        }
                      />
                      <Label
                        htmlFor={`nested-mandatory-${nestedSubTest.id}`}
                        className="text-xs font-medium text-gray-700 cursor-pointer"
                      >
                        Mandatory
                      </Label>
                    </div>
                  </div>

                  {/* Conditional: Text type shows a text value box; Numeric shows ranges */}
                  {nestedSubTest.type === 'Text' ? (
                    <div>
                      <Label className="text-xs font-medium text-gray-700 mb-1 block">Text Value</Label>
                      <Textarea
                        placeholder="Enter text value..."
                        value={nestedSubTest.textValue || ''}
                        onChange={(e) => updateNestedSubTest(subTest.id, nestedSubTest.id, { textValue: e.target.value })}
                        className="min-h-[80px] text-sm"
                      />
                    </div>
                  ) : (
                  <>
                  {/* Nested Age Ranges */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold text-gray-700">Age Ranges</Label>
                      <Button
                        type="button"
                        onClick={() => addNestedAgeRange(subTest.id, nestedSubTest.id)}
                        className="bg-green-600 hover:bg-green-700 text-white px-2 py-1 h-6 text-xs"
                        size="sm"
                      >
                        <Plus className="h-2 w-2 mr-1" />
                        Add Age Range
                      </Button>
                    </div>

                    {/* Show Formula if exists for nested sub-test */}
                    {nestedSubTest.formula && (
                      <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded-md">
                        <span className="text-xs font-medium text-blue-700">Formula:</span>
                        <code className="text-xs bg-blue-100 px-2 py-0.5 rounded text-blue-800">
                          {nestedSubTest.formula}
                        </code>
                      </div>
                    )}

                    {nestedSubTest.ageRanges.map((ageRange) => (
                      <div key={ageRange.id} className="grid grid-cols-12 gap-2 items-center">
                        <div className="col-span-2">
                          <Input
                            placeholder="1"
                            value={ageRange.minAge}
                            onChange={(e) => updateNestedAgeRange(subTest.id, nestedSubTest.id, ageRange.id, { minAge: e.target.value })}
                            className="h-7 text-xs"
                          />
                        </div>
                        <div className="col-span-2">
                          <Input
                            placeholder="5"
                            value={ageRange.maxAge}
                            onChange={(e) => updateNestedAgeRange(subTest.id, nestedSubTest.id, ageRange.id, { maxAge: e.target.value })}
                            className="h-7 text-xs"
                          />
                        </div>
                        <div className="col-span-2">
                          <Select
                            value={ageRange.unit}
                            onValueChange={(value: 'Days' | 'Months' | 'Years') =>
                              updateNestedAgeRange(subTest.id, nestedSubTest.id, ageRange.id, { unit: value })
                            }
                          >
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Days">Days</SelectItem>
                              <SelectItem value="Months">Months</SelectItem>
                              <SelectItem value="Years">Years</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="col-span-5">
                          <Input
                            placeholder="Description"
                            value={ageRange.description}
                            onChange={(e) => updateNestedAgeRange(subTest.id, nestedSubTest.id, ageRange.id, { description: e.target.value })}
                            className="h-7 text-xs"
                          />
                        </div>
                        <div className="col-span-1 flex justify-end">
                          <Button
                            type="button"
                            onClick={() => removeNestedAgeRange(subTest.id, nestedSubTest.id, ageRange.id)}
                            className="w-5 h-5 rounded-full bg-red-100 hover:bg-red-200 p-0 flex items-center justify-center"
                            size="sm"
                            variant="ghost"
                          >
                            <X className="h-2 w-2 text-red-500" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Nested Normal Ranges */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold text-gray-700">Normal Ranges</Label>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          onClick={() => addNestedNormalRange(subTest.id, nestedSubTest.id)}
                          className="bg-purple-600 hover:bg-purple-700 text-white px-2 py-1 h-6 text-xs"
                          size="sm"
                        >
                          <Plus className="h-2 w-2 mr-1" />
                          Add Normal Range
                        </Button>
                        <Button
                          type="button"
                          onClick={() => openFormulaDialog(nestedSubTest)}
                          className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 h-6 text-xs"
                          size="sm"
                        >
                          Formula
                        </Button>
                      </div>
                    </div>

                    {nestedSubTest.normalRanges.map((normalRange) => (
                      <div key={normalRange.id} className="grid grid-cols-12 gap-2 items-center">
                        <div className="col-span-2">
                          <Select
                            value={normalRange.ageRange}
                            onValueChange={(value) => updateNestedNormalRange(subTest.id, nestedSubTest.id, normalRange.id, { ageRange: value })}
                          >
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="- Years">- Years</SelectItem>
                              {nestedSubTest.ageRanges.map((ar, arIndex) => (
                                <SelectItem key={`${ar.id}-${arIndex}`} value={`${ar.minAge}-${ar.maxAge} ${ar.unit}`}>
                                  {ar.minAge}-{ar.maxAge} {ar.unit}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="col-span-2">
                          <Select
                            value={normalRange.gender}
                            onValueChange={(value: 'Male' | 'Female' | 'Both') =>
                              updateNestedNormalRange(subTest.id, nestedSubTest.id, normalRange.id, { gender: value })
                            }
                          >
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Both">Both</SelectItem>
                              <SelectItem value="Male">Male</SelectItem>
                              <SelectItem value="Female">Female</SelectItem>
                              <SelectItem value="Child">Child</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="col-span-2">
                          <Input
                            placeholder="-Up to"
                            value={normalRange.minValue}
                            onChange={(e) => updateNestedNormalRange(subTest.id, nestedSubTest.id, normalRange.id, { minValue: e.target.value })}
                            className="h-7 text-xs"
                          />
                        </div>
                        <div className="col-span-2">
                          <Input
                            placeholder="Max"
                            value={normalRange.maxValue}
                            onChange={(e) => updateNestedNormalRange(subTest.id, nestedSubTest.id, normalRange.id, { maxValue: e.target.value })}
                            className="h-7 text-xs"
                          />
                        </div>
                        <div className="col-span-3">
                          <Input
                            placeholder="Unit"
                            value={normalRange.unit}
                            onChange={(e) => updateNestedNormalRange(subTest.id, nestedSubTest.id, normalRange.id, { unit: e.target.value })}
                            className="h-7 text-xs"
                          />
                        </div>
                        <div className="col-span-1 flex justify-end">
                          <Button
                            type="button"
                            onClick={() => removeNestedNormalRange(subTest.id, nestedSubTest.id, normalRange.id)}
                            className="w-5 h-5 rounded-full bg-red-100 hover:bg-red-200 p-0 flex items-center justify-center"
                            size="sm"
                            variant="ghost"
                          >
                            <X className="h-2 w-2 text-red-500" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                  </>
                  )}
                </div>
              ))}
            </div>
          )}

              {/* Add Nested Sub-Test Button */}
              <div className="flex justify-end mt-3">
                <Button
                  type="button"
                  onClick={() => addNestedSubTest(subTest.id)}
                  className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 h-7 text-xs"
                  size="sm"
                >
                  <Plus className="h-3 w-3" />
                  Add Nested Sub-Test
                </Button>
              </div>
            </>
          )}
        </div>
      ))}

      {/* Formula Dialog */}
      <Dialog open={isFormulaDialogOpen} onOpenChange={setIsFormulaDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Formula Builder</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Select Test Dropdown */}
            <div className="flex items-center gap-4">
              <Label className="w-24">Select Test:</Label>
              <Select
                value={selectedTest}
                onValueChange={(value) => {
                  setSelectedTest(value);
                  if (value !== 'none') {
                    // Add selected test to formula
                    setFormula(prev => prev + value);
                    // Reset selection to "Please Select"
                    setTimeout(() => setSelectedTest('none'), 100);
                  }
                }}
              >
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Please Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Please Select</SelectItem>
                  {dynamicTestOptions.map((testName, index) => (
                    <SelectItem key={index} value={testName}>
                      {testName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Formula Input */}
            <div className="space-y-2">
              <Label>Formula:</Label>
              <Textarea
                value={formula}
                onChange={(e) => setFormula(e.target.value)}
                placeholder="Enter or build your formula"
                className="min-h-[80px] text-lg font-mono"
              />
            </div>

            {/* Calculator Buttons */}
            <div className="grid grid-cols-11 gap-2">
              {/* Number Buttons 1-9 */}
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <Button
                  key={num}
                  type="button"
                  onClick={() => appendToFormula(num.toString())}
                  className="bg-blue-500 hover:bg-blue-600 text-white h-10"
                >
                  {num}
                </Button>
              ))}

              {/* 0 Button */}
              <Button
                type="button"
                onClick={() => appendToFormula('0')}
                className="bg-blue-500 hover:bg-blue-600 text-white h-10"
              >
                0
              </Button>

              {/* Operator Buttons */}
              <Button
                type="button"
                onClick={() => appendToFormula('.')}
                className="bg-blue-500 hover:bg-blue-600 text-white h-10"
              >
                .
              </Button>
            </div>

            {/* Second Row of Buttons */}
            <div className="grid grid-cols-8 gap-2">
              <Button
                type="button"
                onClick={() => appendToFormula('+')}
                className="bg-blue-500 hover:bg-blue-600 text-white h-10"
              >
                +
              </Button>
              <Button
                type="button"
                onClick={() => appendToFormula('-')}
                className="bg-blue-500 hover:bg-blue-600 text-white h-10"
              >
                -
              </Button>
              <Button
                type="button"
                onClick={() => appendToFormula('*')}
                className="bg-blue-500 hover:bg-blue-600 text-white h-10"
              >
                *
              </Button>
              <Button
                type="button"
                onClick={() => appendToFormula('/')}
                className="bg-blue-500 hover:bg-blue-600 text-white h-10"
              >
                /
              </Button>
              <Button
                type="button"
                onClick={() => appendToFormula('(')}
                className="bg-blue-500 hover:bg-blue-600 text-white h-10"
              >
                (
              </Button>
              <Button
                type="button"
                onClick={() => appendToFormula(')')}
                className="bg-blue-500 hover:bg-blue-600 text-white h-10"
              >
                )
              </Button>
              <Button
                type="button"
                onClick={() => appendToFormula('^2')}
                className="bg-blue-500 hover:bg-blue-600 text-white h-10"
              >
                x²
              </Button>
              <Button
                type="button"
                onClick={() => appendToFormula('^3')}
                className="bg-blue-500 hover:bg-blue-600 text-white h-10"
              >
                x³
              </Button>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-between pt-4">
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={deleteLastChar}
                  variant="destructive"
                >
                  DEL
                </Button>
                <Button
                  type="button"
                  onClick={clearFormula}
                  variant="outline"
                >
                  Clear
                </Button>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={() => setIsFormulaDialogOpen(false)}
                  variant="outline"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={saveFormula}
                  disabled={isSavingFormula}
                >
                  {isSavingFormula ? 'Saving...' : 'Save Formula'}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TestConfigurationSection;