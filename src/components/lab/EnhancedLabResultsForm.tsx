import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Loader2, FileUp, Save, Eye, Printer, Download, ArrowLeft, Plus, List } from 'lucide-react';
import { useLabTestConfig, TestResult, SubTest } from '@/hooks/useLabTestConfig';
import { WhatsAppReportButton } from './WhatsAppReportButton';

interface Patient {
  name: string;
  age: number;
  gender: 'Male' | 'Female';
  type: string;
  refBy: string;
  labSampleId: string;
  date: string;
  phone?: string;
}

interface EnhancedLabResultsFormProps {
  patient: Patient;
  onSave: (results: TestResult[]) => void;
  onPreview: (results: TestResult[]) => void;
  onPrint: (results: TestResult[]) => void;
  onDownload: (results: TestResult[]) => void;
}

const EnhancedLabResultsForm: React.FC<EnhancedLabResultsFormProps> = ({
  patient,
  onSave,
  onPreview,
  onPrint,
  onDownload
}) => {
  const {
    availableTests,
    subTests,
    loadingTests,
    loadingSubTests,
    fetchSubTestsForTest,
    getNormalRange,
    isAbnormalValue,
    debugTestData
  } = useLabTestConfig();

  const [selectedTest, setSelectedTest] = useState<string>('');
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [authenticatedResult, setAuthenticatedResult] = useState(false);
  const [showEntryMode, setShowEntryMode] = useState(false);

  // Helper function to check if a value already ends with the unit (case-insensitive)
  const valueContainsUnit = (value: string | number | null | undefined, unitToCheck: string): boolean => {
    if (!value || !unitToCheck) return false;
    const valueStr = String(value).toLowerCase().trim();
    const unitStr = unitToCheck.toLowerCase().trim();
    return valueStr.endsWith(unitStr);
  };

  // Helper function to format range with unit, avoiding duplicates like "sec sec"
  const formatRangeWithUnit = (minVal: string | number, maxVal: string | number, displayUnit: string): string => {
    const minHasUnit = valueContainsUnit(minVal, displayUnit);
    const maxHasUnit = valueContainsUnit(maxVal, displayUnit);
    const shouldAppendUnit = displayUnit && displayUnit.toLowerCase() !== 'unit' && !minHasUnit && !maxHasUnit;
    const unitSuffix = shouldAppendUnit ? ` ${displayUnit}` : '';
    return `${minVal} - ${maxVal}${unitSuffix}`;
  };

  // Helper function to find correct normal range based on patient gender
  // Supports both numeric and text values (words, symbols like <5, >10, Positive, etc.)
  const findNormalRangeForGender = (
    normalRanges: Array<{gender?: string; min_value: string | number; max_value: string | number; unit?: string}> | undefined,
    patientGender: string,
    unit: string
  ): string => {
    if (!normalRanges || normalRanges.length === 0) {
      return '';  // No data - return empty string
    }

    // First try to find exact gender match (Male/Female)
    const genderMatch = normalRanges.find(
      nr => nr.gender?.toLowerCase() === patientGender.toLowerCase()
    );

    if (genderMatch) {
      return formatRangeWithUnit(genderMatch.min_value, genderMatch.max_value, genderMatch.unit || unit);
    }

    // Fallback to 'Both' if no gender-specific range found
    const bothMatch = normalRanges.find(
      nr => nr.gender?.toLowerCase() === 'both'
    );

    if (bothMatch) {
      return formatRangeWithUnit(bothMatch.min_value, bothMatch.max_value, bothMatch.unit || unit);
    }

    // Final fallback: use first available range
    return formatRangeWithUnit(normalRanges[0].min_value, normalRanges[0].max_value, normalRanges[0].unit || unit);
  };

  useEffect(() => {
    if (selectedTest) {
      fetchSubTestsForTest(selectedTest);
      debugTestData(selectedTest);
    }
  }, [selectedTest, fetchSubTestsForTest, debugTestData]);

  useEffect(() => {
    console.log('📦 SubTests updated:', subTests.length, 'tests');
    console.log('🔍 Checking for formulas:');
    subTests.forEach((st, idx) => {
      if (st.formula) {
      } else {
      }
    });

    const results: TestResult[] = [];

    subTests.forEach((subTest, subTestIndex) => {
      // Add parent sub-test with metadata
      results.push({
        subTestId: subTest.id,
        subTestName: subTest.sub_test_name,
        observedValue: '',
        normalRange: findNormalRangeForGender(subTest.normal_ranges, patient.gender, subTest.unit),
        status: '',
        comments: '',
        abnormal: false,
        // Store reference to original subTest for formula lookup
        _subTestData: subTest
      } as TestResult & { _subTestData?: SubTest });

      // Add nested sub-tests if they exist
      if (subTest.nested_sub_tests && subTest.nested_sub_tests.length > 0) {
        console.log(`  📦 Adding ${subTest.nested_sub_tests.length} nested sub-tests for ${subTest.sub_test_name}`);
        subTest.nested_sub_tests.forEach((nested, idx) => {
          results.push({
            subTestId: `${subTest.id}_nested_${idx}`,
            subTestName: `  ${nested.name}`, // Indent nested sub-tests
            observedValue: '',
            normalRange: findNormalRangeForGender(nested.normal_ranges, patient.gender, nested.unit),
            status: '',
            comments: '',
            abnormal: false,
            // Store reference to nested subTest for unit display
            _subTestData: { unit: nested.unit || nested.normal_ranges?.[0]?.unit || '' }
          } as TestResult & { _subTestData?: { unit: string } });
        });
      }
    });

    console.log('🔍 SubTests with formulas:', subTests.filter(st => st.formula).map(st => ({
      name: st.sub_test_name,
      formula: st.formula
    })));
    setTestResults(results);
  }, [subTests, patient.age, patient.gender]);

  // Function to calculate formula-based values
  const calculateFormulaValues = (updatedResults: TestResult[]) => {
    console.log('🧮 Starting formula calculations...');
    console.log('📋 Test Results:', updatedResults.map(r => ({ name: r.subTestName, value: r.observedValue })));

    // DEBUG: Check if _subTestData exists
    console.log('🔍 Checking _subTestData in results:');
    updatedResults.forEach((r, idx) => {
      const subTestData = (r as any)._subTestData;
      if (subTestData?.formula) {
      }
    });

    // Get formulas from the stored _subTestData in results
    const resultsWithFormulas = updatedResults.filter(r => {
      const subTestData = (r as any)._subTestData;
      return subTestData && subTestData.formula;
    });

    console.log('📋 Results with formulas:', resultsWithFormulas.map(r => {
      const subTestData = (r as any)._subTestData;
      return { name: r.subTestName, formula: subTestData?.formula };
    }));

    if (resultsWithFormulas.length === 0) {
      console.warn('⚠️ NO FORMULAS FOUND! Calculation skipped.');
      return updatedResults;
    }

    // Multi-pass calculation for chain formulas (e.g., A/G Ratio depends on Globulin which depends on Protein - Albumin)
    let changesMade = true;
    let iterations = 0;
    const maxIterations = 10; // Prevent infinite loops

    while (changesMade && iterations < maxIterations) {
      changesMade = false;
      iterations++;
      console.log(`\n🔄 Formula calculation pass ${iterations}...`);

      // Create a map of test name to value AND index for easy lookup
      // Rebuild each iteration to pick up newly calculated values
      const valueMap = new Map<string, { value: number | null, index: number }>();
      updatedResults.forEach((result, resultIndex) => {
        const cleanName = result.subTestName.trim();
        const numValue = parseFloat(result.observedValue);

        // Store value OR null if empty (to detect deletions)
        if (!isNaN(numValue) && result.observedValue !== '') {
          valueMap.set(cleanName, { value: numValue, index: resultIndex });
          valueMap.set(cleanName.toLowerCase(), { value: numValue, index: resultIndex });
          if (iterations === 1) {
            console.log(`  📍 Stored value for "${cleanName}" (index ${resultIndex}): ${numValue}`);
          }
        } else if (result.observedValue === '' || result.observedValue.trim() === '') {
          // Empty value - mark as null for deletion detection
          valueMap.set(cleanName, { value: null, index: resultIndex });
          valueMap.set(cleanName.toLowerCase(), { value: null, index: resultIndex });
          if (iterations === 1) {
            console.log(`  🗑️ Empty value for "${cleanName}" (index ${resultIndex})`);
          }
        }
      });

      if (iterations === 1) {
        console.log('📊 Value map:', Object.fromEntries(valueMap));
      }

      // Check each result with formula
      resultsWithFormulas.forEach((resultWithFormula) => {
      const subTestData = (resultWithFormula as any)._subTestData;
      if (subTestData && subTestData.formula && subTestData.formula.trim()) {
        console.log(`\n📐 Processing formula for "${subTestData.sub_test_name}":`);
        let formula = subTestData.formula;
        let originalFormula = formula;

        // Replace test names in formula with actual values
        let hasAllValues = true;
        let replacements = 0;

        // Track if any dependency is null/empty (for clearing calculated values)
        let hasNullDependency = false;

        // Sort test names by length (longest first) to avoid partial replacements
        const sortedResults = [...updatedResults].sort((a, b) =>
          b.subTestName.trim().length - a.subTestName.trim().length
        );

        // Try to match with all available test results
        sortedResults.forEach((result) => {
          const testName = result.subTestName.trim();
          const mapEntry = valueMap.get(testName);
          const value = mapEntry?.value;

          // Create regex to match the test name (case-insensitive, word boundaries)
          // Escape special regex characters
          const escapedName = testName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`\\b${escapedName}\\b`, 'gi');

          const matches = formula.match(regex);
          if (matches) {
            // This test name is in the formula
            console.log(`  🔍 Found "${testName}" in formula (value: ${value})`);
            if (value === null) {
              // Dependency is empty/deleted
              console.log(`  🗑️ "${testName}" is EMPTY - will clear calculated value`);
              hasNullDependency = true;
            } else if (value !== undefined && value !== null) {
              // Valid value found
              console.log(`  🔧 BEFORE: ${formula}`);
              formula = formula.replace(regex, value.toString());
              console.log(`  🔧 AFTER: ${formula}`);
              replacements++;
            } else {
              // Value not entered yet
              hasAllValues = false;
            }
          }
        });

        console.log(`  📝 Replacements made: ${replacements}`);
        console.log(`  📝 Formula after replacements: ${formula}`);
        console.log(`  📝 Has null dependency: ${hasNullDependency}`);

        // Find the correct index in updatedResults for this sub-test
        const targetIndex = updatedResults.findIndex(r =>
          r.subTestName.trim().toLowerCase() === subTestData.sub_test_name.trim().toLowerCase()
        );

        console.log(`  📍 Target index for "${subTestData.sub_test_name}": ${targetIndex}`);

        // If any dependency is null/deleted, clear the calculated value
        if (hasNullDependency && targetIndex >= 0) {
          console.log(`  🗑️ Clearing calculated value for "${subTestData.sub_test_name}"`);
          updatedResults[targetIndex].observedValue = '';
          return; // Skip to next formula
        }

        // Check if formula still contains any test names (letters except scientific notation)
        const hasUnresolvedNames = /[a-zA-Z]/.test(formula.replace(/[eE][+-]?[0-9]+/g, '').replace(/[^a-zA-Z0-9+\-*/().\s]/g, ''));
        if (hasUnresolvedNames) {
          hasAllValues = false;
        }

        // Only calculate if we made replacements and all values are available
        if (hasAllValues && replacements > 0 && targetIndex >= 0) {
          try {
            // Safe evaluation (only allow numbers and basic operators)
            const sanitizedFormula = formula.replace(/[^0-9+\-*/().\s]/g, '');
            console.log(`  🔢 Sanitized formula: ${sanitizedFormula}`);

            if (sanitizedFormula.trim()) {
              // Use Function constructor for safe evaluation
              const result = new Function(`return ${sanitizedFormula}`)();

              if (!isNaN(result) && isFinite(result)) {
                const calculatedValue = result.toFixed(2);
                const previousValue = updatedResults[targetIndex].observedValue;
                if (previousValue !== calculatedValue) {
                  updatedResults[targetIndex].observedValue = calculatedValue;
                  changesMade = true; // Trigger another pass for chain calculations
                }
              } else {
              }
            }
          } catch (error) {
            console.error(`  ❌ Error calculating formula for ${subTestData.sub_test_name}:`, error);
          }
        } else if (replacements === 0) {
        } else {
        }
      }
    });

    } // End while loop

    console.log(`🏁 Formula calculations complete after ${iterations} pass(es)\n`);
    return updatedResults;
  };

  const handleValueChange = (index: number, value: string) => {
    console.log(`\n🔄 VALUE CHANGE TRIGGERED for index ${index}:`);

    // Deep copy to preserve _subTestData
    let updatedResults = testResults.map(r => ({ ...r }));
    updatedResults[index].observedValue = value;

    const subTest = subTests[index];
    if (subTest) {
      const status = isAbnormalValue(value, subTest, patient.age, patient.gender);
      updatedResults[index].status = status;
    }

    console.log('📊 Current test results before calculation:');
    updatedResults.forEach((r, i) => {
      if (r.observedValue) {
      }
    });

    // Auto-calculate formula-based fields
    console.log('🔄 Triggering formula calculation...');
    updatedResults = calculateFormulaValues(updatedResults);

    console.log('📊 Test results after calculation:');
    updatedResults.forEach((r, i) => {
      if (r.observedValue) {
      }
    });

    setTestResults(updatedResults);
  };

  const handleCommentsChange = (index: number, comments: string) => {
    const updatedResults = [...testResults];
    updatedResults[index].comments = comments;
    setTestResults(updatedResults);
  };

  const handleAbnormalChange = (index: number, abnormal: boolean) => {
    const updatedResults = [...testResults];
    updatedResults[index].abnormal = abnormal;
    setTestResults(updatedResults);
  };

  const handleFileChange = (index: number, file: File | undefined) => {
    const updatedResults = [...testResults];
    updatedResults[index].file = file;
    setTestResults(updatedResults);
  };

  // Manual trigger for formula calculations
  const handleRecalculate = () => {
    console.log('🔄 Manual recalculation triggered');
    const updatedResults = calculateFormulaValues([...testResults]);
    setTestResults(updatedResults);
  };

  const handleNormalRangeChange = (index: number, normalRange: string) => {
    const updatedResults = [...testResults];
    updatedResults[index].normalRange = normalRange;
    setTestResults(updatedResults);
  };

  const addMoreTests = () => {
    setSelectedTest('');
    setTestResults([]);
  };

  const handleQuickTestSelection = (testName: string) => {
    setSelectedTest(testName);
    setShowEntryMode(false);
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'normal':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'high':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'low':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <Card className="max-w-6xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Lab Results Entry Form</span>
          <Button variant="outline" onClick={() => window.history.back()}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Patient Information */}
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="font-medium">Patient Name:</span> {patient.name}
            </div>
            <div>
              <span className="font-medium">Age/Sex:</span> {patient.age} / {patient.gender}
            </div>
            <div>
              <span className="font-medium">Type:</span> {patient.type}
            </div>
            <div>
              <span className="font-medium">Ref By:</span> {patient.refBy}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm mt-2">
            <div>
              <span className="font-medium">Visit ID:</span> {patient.labSampleId}
            </div>
            <div>
              <span className="font-medium">Date:</span> {patient.date}
            </div>
          </div>
        </div>

        {/* Lab Results Entry */}
        <div className="bg-gray-50 p-4 rounded-lg">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-4">
              <span className="text-sm font-medium">9/13/2025 4:18:09 PM</span>
              <Badge variant="outline">Lab Results</Badge>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="authenticated"
                  checked={authenticatedResult}
                  onCheckedChange={setAuthenticatedResult}
                />
                <label htmlFor="authenticated" className="text-sm">Authenticated Result</label>
              </div>
            </div>
          </div>

          {/* Test Selection */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium">Select Test</label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowEntryMode(!showEntryMode)}
                className="flex items-center space-x-2"
              >
                <List className="h-4 w-4" />
                <span>Entry Mode</span>
              </Button>
            </div>

            {showEntryMode ? (
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h3 className="text-sm font-semibold text-blue-800 mb-3">Quick Test Selection</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {availableTests.map((test) => (
                    <Button
                      key={test}
                      variant="outline"
                      size="sm"
                      onClick={() => handleQuickTestSelection(test)}
                      className="justify-start text-left h-auto p-3 hover:bg-blue-100"
                    >
                      <div>
                        <div className="font-medium text-sm">{test}</div>
                        <div className="text-xs text-gray-500 mt-1">
                          Click to select and view sub-tests
                        </div>
                      </div>
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <Select value={selectedTest} onValueChange={setSelectedTest} disabled={loadingTests}>
                <SelectTrigger className="w-full max-w-md">
                  <SelectValue placeholder={loadingTests ? "Loading tests..." : "Choose a test"} />
                </SelectTrigger>
                <SelectContent>
                  {availableTests.map((test) => (
                    <SelectItem key={test} value={test}>{test}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Results Table */}
          {selectedTest && (
            <div className="space-y-4">
              {loadingSubTests ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mr-2" />
                  Loading sub-tests for {selectedTest}...
                </div>
              ) : subTests.length === 0 ? (
                <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                  <div className="text-yellow-800">
                    <strong>No sub-tests found for "{selectedTest}"</strong>
                    <p className="text-sm mt-1">
                      Please ensure the lab_test_config table has data for this test.
                      Check the browser console for debugging information.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Table Headers */}
                  <div className="grid grid-cols-3 gap-4 font-medium text-sm text-gray-700 border-b pb-3">
                    <div>INVESTIGATION</div>
                    <div>OBSERVED VALUE</div>
                    <div>NORMAL RANGE</div>
                  </div>

                  {/* Main Test Header */}
                  <div className="bg-gray-50 p-3 rounded">
                    <div className="grid grid-cols-3 gap-4 items-center">
                      <div>
                        <span className="font-semibold text-blue-600">Main Test</span>
                        <br />
                        <span className="font-medium">{selectedTest}</span>
                      </div>
                      <div className="text-center text-gray-500 italic">
                        - Test Group Header -
                      </div>
                      <div className="text-center text-gray-500 italic">
                        - See Sub Tests -
                      </div>
                    </div>
                  </div>

                  {/* Sub-tests */}
                  {testResults.map((result, index) => (
                    <div key={result.subTestId} className="border-l-2 border-blue-300 pl-4">
                      <div className="grid grid-cols-3 gap-4 items-start mb-3">
                        <div>
                          <div className="flex items-center space-x-2 mb-2">
                            <span className="w-1 h-1 bg-blue-500 rounded-full"></span>
                            <span className="font-medium">{result.subTestName}</span>
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center space-x-2 mb-2">
                            <Input
                              type="text"
                              placeholder="Enter value"
                              value={result.observedValue}
                              onChange={(e) => handleValueChange(index, e.target.value)}
                              className="flex-1"
                            />
                            {/* Display unit from subTest data */}
                            {(result as any)._subTestData?.unit && (result as any)._subTestData.unit.toLowerCase() !== 'unit' && (
                              <span className="text-xs text-gray-600 min-w-[50px]">
                                {(result as any)._subTestData.unit}
                              </span>
                            )}
                            {result.status && (
                              <Badge className={getStatusBadgeColor(result.status)} variant="outline">
                                {result.status.toUpperCase()}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div>
                          <Input
                            type="text"
                            placeholder="Enter normal range"
                            value={result.normalRange}
                            onChange={(e) => handleNormalRangeChange(index, e.target.value)}
                            className="w-full"
                          />
                        </div>
                      </div>

                      {/* Comments and file upload row */}
                      <div className="grid grid-cols-3 gap-4 mb-4">
                        <div></div>
                        <div className="col-span-2">
                          <Textarea
                            placeholder="Comments..."
                            value={result.comments}
                            onChange={(e) => handleCommentsChange(index, e.target.value)}
                            className="mb-2 min-h-[60px]"
                          />
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-4">
                              <div className="flex items-center space-x-2">
                                <Checkbox
                                  id={`abnormal-${index}`}
                                  checked={result.abnormal}
                                  onCheckedChange={(checked) => handleAbnormalChange(index, checked as boolean)}
                                />
                                <label htmlFor={`abnormal-${index}`} className="text-sm">Abnormal</label>
                              </div>
                            </div>
                            <div className="flex items-center space-x-2">
                              <input
                                type="file"
                                id={`file-${index}`}
                                className="hidden"
                                onChange={(e) => handleFileChange(index, e.target.files?.[0])}
                              />
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => document.getElementById(`file-${index}`)?.click()}
                                className="text-xs"
                              >
                                Choose File
                              </Button>
                              {result.file ? (
                                <span className="text-xs text-green-600">{result.file.name}</span>
                              ) : (
                                <span className="text-xs text-gray-500">No file chosen</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Add More Button */}
                  <div className="flex justify-center pt-4 border-t">
                    <Button variant="outline" onClick={addMoreTests} className="bg-orange-600 text-white hover:bg-orange-700">
                      Add more
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          {testResults.length > 0 && (
            <div className="flex justify-center space-x-4 pt-6 border-t">
              <Button onClick={handleRecalculate} variant="secondary" className="px-6">
                <Plus className="h-4 w-4 mr-2 rotate-45" />
                Calculate Formulas
              </Button>
              <Button onClick={() => onSave(testResults)} className="px-6">
                <Save className="h-4 w-4 mr-2" />
                Save Results
              </Button>
              <Button variant="outline" onClick={() => onPreview(testResults)}>
                <Eye className="h-4 w-4 mr-2" />
                Preview Report
              </Button>
              <Button variant="outline" onClick={() => onPrint(testResults)}>
                <Printer className="h-4 w-4 mr-2" />
                Print Report
              </Button>
              <Button variant="outline" onClick={() => onDownload(testResults)}>
                <Download className="h-4 w-4 mr-2" />
                Download Files
              </Button>
              <WhatsAppReportButton
                patientName={patient.name}
                mobile={patient.phone || null}
                testNames={selectedTest ? [selectedTest] : []}
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default EnhancedLabResultsForm;