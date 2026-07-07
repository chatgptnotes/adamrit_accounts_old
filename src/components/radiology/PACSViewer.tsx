// @ts-nocheck
// PACS Viewer Component - Study Browser, Image Upload, Gallery, Archive & Sharing
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Search,
  Filter,
  Upload,
  Camera,
  Archive,
  Share2,
  Eye,
  FileImage,
  HardDrive,
  RefreshCw,
  X,
  Download,
  Link,
  Clock,
  Image,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { logActivity } from '@/lib/activity-logger';
import { captureInAppPhoto } from '@/lib/captureInAppPhoto';
import { geoToDbFields } from '@/lib/geotag';
import { GeotagStatus } from '@/components/GeotagStatus';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

// ---------- Types ----------

interface PACSViewerProps {
  patients: Array<{
    id: string;
    name: string;
    gender?: string;
    age?: number;
    phone?: string;
  }>;
  dicomStudies: Array<{
    id: string;
    study_instance_uid?: string;
    modality?: string;
    study_description?: string;
    series_count?: number;
    image_count?: number;
    body_part_examined?: string;
    quality_score?: number;
    order_id?: string;
    patient_id?: string;
    created_at?: string;
    archived?: boolean;
    pacs_location?: string;
    archive_location?: string;
    study_size_mb?: number;
    technical_adequacy?: string;
    artifacts_present?: boolean;
    artifact_description?: string;
  }>;
}

interface PACSImage {
  id: string;
  study_id: string;
  file_path: string;
  file_name: string;
  body_part?: string;
  description?: string;
  created_at: string;
}

// ---------- Component ----------

const PACSViewer: React.FC<PACSViewerProps> = ({ patients, dicomStudies }) => {
  const { toast } = useToast();

  // Filter state
  const [patientSearch, setPatientSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [modalityFilter, setModalityFilter] = useState('All');
  const [bodyPartFilter, setBodyPartFilter] = useState('');
  const [archiveFilter, setArchiveFilter] = useState('All');

  // Selection state
  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null);

  // Image gallery state
  const [galleryImages, setGalleryImages] = useState<PACSImage[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [fullImageDialog, setFullImageDialog] = useState(false);
  const [fullImageUrl, setFullImageUrl] = useState('');
  const [fullImageName, setFullImageName] = useState('');

  // Upload state
  const [uploadDialog, setUploadDialog] = useState(false);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadGeo, setUploadGeo] = useState(null);
  const [uploadBodyPart, setUploadBodyPart] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploading, setUploading] = useState(false);

  // Camera capture state
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Share dialog state
  const [shareDialog, setShareDialog] = useState(false);
  const [shareLink, setShareLink] = useState('');

  // ---------- Helpers ----------

  /** Look up patient name from patients prop by id */
  const getPatientName = useCallback(
    (patientId?: string): string => {
      if (!patientId) return 'Unknown';
      const patient = patients.find((p) => p.id === patientId);
      return patient ? patient.name : 'Unknown';
    },
    [patients]
  );

  /** Currently selected study object */
  const selectedStudy = dicomStudies.find((s) => s.id === selectedStudyId) || null;

  // ---------- Filtering ----------

  const filteredStudies = dicomStudies.filter((study) => {
    // Patient name search
    if (patientSearch) {
      const name = getPatientName(study.patient_id).toLowerCase();
      if (!name.includes(patientSearch.toLowerCase())) return false;
    }
    // Date range
    if (dateFrom && study.created_at) {
      if (new Date(study.created_at) < new Date(dateFrom)) return false;
    }
    if (dateTo && study.created_at) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      if (new Date(study.created_at) > end) return false;
    }
    // Modality
    if (modalityFilter !== 'All' && study.modality !== modalityFilter) return false;
    // Body part
    if (bodyPartFilter) {
      const bp = (study.body_part_examined || '').toLowerCase();
      if (!bp.includes(bodyPartFilter.toLowerCase())) return false;
    }
    // Archive status
    if (archiveFilter === 'Active' && study.archived) return false;
    if (archiveFilter === 'Archived' && !study.archived) return false;

    return true;
  });

  // ---------- Storage / archive stats ----------

  const totalStudies = dicomStudies.length;
  const totalSizeMB = dicomStudies.reduce((sum, s) => sum + (s.study_size_mb || 0), 0);
  const archivedCount = dicomStudies.filter((s) => s.archived).length;

  // ---------- Gallery: fetch images for selected study ----------

  const fetchGalleryImages = useCallback(async (studyId: string) => {
    setGalleryLoading(true);
    try {
      const { data, error } = await (supabase as any)
        .from('pacs_images')
        .select('*')
        .eq('study_id', studyId);
      if (error) throw error;
      setGalleryImages(data || []);
    } catch (err: any) {
      console.error('Error fetching gallery images:', err);
      setGalleryImages([]);
    } finally {
      setGalleryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedStudyId) {
      fetchGalleryImages(selectedStudyId);
    } else {
      setGalleryImages([]);
    }
  }, [selectedStudyId, fetchGalleryImages]);

  // ---------- Image upload ----------

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadFile(file);
    const reader = new FileReader();
    reader.onload = () => setUploadPreview(reader.result as string);
    reader.readAsDataURL(file);
    // Stop camera if active
    stopCamera();
  };

  const handleUploadImage = async () => {
    if (!uploadFile || !selectedStudyId) return;
    setUploading(true);
    try {
      const timestamp = Date.now();
      const ext = uploadFile.name.split('.').pop() || 'png';
      const filePath = `studies/${selectedStudyId}/${timestamp}.${ext}`;

      // Upload file to Supabase Storage
      const { error: uploadError } = await (supabase as any).storage
        .from('radiology-images')
        .upload(filePath, uploadFile);
      if (uploadError) throw uploadError;

      // Save metadata to pacs_images table
      const { error: insertError } = await (supabase as any)
        .from('pacs_images')
        .insert({
          study_id: selectedStudyId,
          file_path: filePath,
          file_name: uploadFile.name,
          body_part: uploadBodyPart || null,
          description: uploadDescription || null,
          mime_type: uploadFile.type || 'image/jpeg',
          ...geoToDbFields(uploadGeo, uploadGeo ? 'in_app_camera' : 'file_picker'),
        });
      if (insertError) throw insertError;

      await logActivity('PACS Image Upload', {
        study_id: selectedStudyId,
        file_name: uploadFile.name,
        body_part: uploadBodyPart,
      });

      toast({
        title: 'Image Uploaded',
        description: `${uploadFile.name} uploaded successfully.`,
      });

      // Reset upload state and refresh gallery
      resetUploadState();
      setUploadDialog(false);
      fetchGalleryImages(selectedStudyId);
    } catch (err: any) {
      console.error('Upload error:', err);
      toast({
        title: 'Upload Failed',
        description: err.message || 'Could not upload image.',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  const resetUploadState = () => {
    setUploadFile(null);
    setUploadPreview(null);
    setUploadGeo(null);
    setUploadBodyPart('');
    setUploadDescription('');
    stopCamera();
  };

  // ---------- Camera capture ----------

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraActive(true);
    } catch (err: any) {
      console.error('Camera error:', err);
      toast({
        title: 'Camera Error',
        description: 'Could not access camera. Please check permissions.',
        variant: 'destructive',
      });
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const capturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    const result = await captureInAppPhoto(videoRef.current, canvasRef.current);
    if (!result) return;
    const file = new File([result.blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' });
    setUploadFile(file);
    setUploadGeo(result.geo);
    setUploadPreview(URL.createObjectURL(result.blob));
    stopCamera();
  };

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // ---------- Delete gallery image ----------

  const handleDeleteImage = async (image: PACSImage) => {
    try {
      // Remove from storage
      await (supabase as any).storage.from('radiology-images').remove([image.file_path]);
      // Remove from table
      const { error } = await (supabase as any)
        .from('pacs_images')
        .delete()
        .eq('id', image.id);
      if (error) throw error;

      await logActivity('PACS Image Deleted', {
        study_id: image.study_id,
        file_name: image.file_name,
      });

      toast({ title: 'Image Deleted', description: `${image.file_name} removed.` });
      if (selectedStudyId) fetchGalleryImages(selectedStudyId);
    } catch (err: any) {
      console.error('Delete error:', err);
      toast({
        title: 'Delete Failed',
        description: err.message || 'Could not delete image.',
        variant: 'destructive',
      });
    }
  };

  // ---------- View full image ----------

  const handleViewImage = async (image: PACSImage) => {
    try {
      const { data } = (supabase as any).storage
        .from('radiology-images')
        .getPublicUrl(image.file_path);
      setFullImageUrl(data?.publicUrl || '');
      setFullImageName(image.file_name);
      setFullImageDialog(true);
    } catch (err) {
      console.error('Error getting image URL:', err);
    }
  };

  // ---------- Archive toggle ----------

  const handleToggleArchive = async () => {
    if (!selectedStudy) return;
    try {
      const newArchived = !selectedStudy.archived;
      const { error } = await (supabase as any)
        .from('dicom_studies')
        .update({ archived: newArchived })
        .eq('id', selectedStudy.id);
      if (error) throw error;

      await logActivity('PACS Study Archive Toggle', {
        study_id: selectedStudy.id,
        archived: newArchived,
      });

      toast({
        title: newArchived ? 'Study Archived' : 'Study Unarchived',
        description: `Study ${selectedStudy.study_instance_uid || selectedStudy.id} has been ${newArchived ? 'archived' : 'restored'}.`,
      });
    } catch (err: any) {
      console.error('Archive toggle error:', err);
      toast({
        title: 'Error',
        description: err.message || 'Could not update archive status.',
        variant: 'destructive',
      });
    }
  };

  // ---------- Share ----------

  const handleShare = () => {
    if (!selectedStudy) return;
    const token = selectedStudy.id;
    setShareLink(`${window.location.origin}/pacs/shared/${token}`);
    setShareDialog(true);
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      toast({ title: 'Link Copied', description: 'Shareable link copied to clipboard.' });
    } catch {
      toast({ title: 'Copy Failed', description: 'Could not copy link.', variant: 'destructive' });
    }
  };

  // ---------- Quality score color helper ----------

  const getQualityColor = (score?: number): string => {
    if (!score) return 'bg-gray-200';
    if (score >= 80) return 'bg-green-500';
    if (score >= 60) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  // ---------- Render ----------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HardDrive className="h-6 w-6 text-blue-600" />
          <div>
            <h2 className="text-2xl font-bold">PACS Viewer</h2>
            <p className="text-sm text-muted-foreground">
              Browse studies, manage images, archive and share
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (selectedStudyId) {
                setUploadDialog(true);
              } else {
                toast({
                  title: 'No Study Selected',
                  description: 'Select a study first to upload images.',
                  variant: 'destructive',
                });
              }
            }}
          >
            <Upload className="h-4 w-4 mr-2" />
            Upload Image
          </Button>
        </div>
      </div>

      {/* Archive Storage Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Studies</p>
                <p className="text-2xl font-bold text-blue-600">{totalStudies}</p>
              </div>
              <FileImage className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total Size</p>
                <p className="text-2xl font-bold text-green-600">
                  {totalSizeMB >= 1024
                    ? `${(totalSizeMB / 1024).toFixed(1)} GB`
                    : `${totalSizeMB.toFixed(1)} MB`}
                </p>
              </div>
              <HardDrive className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Archived Studies</p>
                <p className="text-2xl font-bold text-orange-600">{archivedCount}</p>
              </div>
              <Archive className="h-8 w-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter Bar */}
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            {/* Patient search */}
            <div>
              <Label className="text-xs mb-1 block">Patient</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search patient..."
                  value={patientSearch}
                  onChange={(e) => setPatientSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
            {/* Date from */}
            <div>
              <Label className="text-xs mb-1 block">From Date</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            {/* Date to */}
            <div>
              <Label className="text-xs mb-1 block">To Date</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            {/* Modality */}
            <div>
              <Label className="text-xs mb-1 block">Modality</Label>
              <Select value={modalityFilter} onValueChange={setModalityFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All</SelectItem>
                  <SelectItem value="CT">CT</SelectItem>
                  <SelectItem value="MRI">MRI</SelectItem>
                  <SelectItem value="X-Ray">X-Ray</SelectItem>
                  <SelectItem value="USG">USG</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* Body Part */}
            <div>
              <Label className="text-xs mb-1 block">Body Part</Label>
              <Input
                placeholder="e.g. Brain"
                value={bodyPartFilter}
                onChange={(e) => setBodyPartFilter(e.target.value)}
              />
            </div>
            {/* Archive status */}
            <div>
              <Label className="text-xs mb-1 block">Archive Status</Label>
              <Select value={archiveFilter} onValueChange={setArchiveFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All</SelectItem>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main content: Study Table + Detail Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Study Browser Table */}
        <div className={selectedStudy ? 'lg:col-span-2' : 'lg:col-span-3'}>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Filter className="h-5 w-5 text-blue-600" />
                Study Browser
                <Badge variant="outline" className="ml-2">
                  {filteredStudies.length} studies
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Patient Name</TableHead>
                      <TableHead>Study Date</TableHead>
                      <TableHead>Modality</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-center">Series</TableHead>
                      <TableHead className="text-center">Images</TableHead>
                      <TableHead className="text-right">Size (MB)</TableHead>
                      <TableHead>Quality</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredStudies.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                          No studies match the current filters.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredStudies.map((study) => (
                        <TableRow
                          key={study.id}
                          className={`cursor-pointer hover:bg-blue-50 transition-colors ${
                            selectedStudyId === study.id ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
                          }`}
                          onClick={() => setSelectedStudyId(study.id)}
                        >
                          <TableCell className="font-medium">
                            {getPatientName(study.patient_id)}
                          </TableCell>
                          <TableCell>
                            {study.created_at
                              ? format(new Date(study.created_at), 'dd MMM yyyy')
                              : '-'}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                study.modality === 'CT'
                                  ? 'bg-blue-100 text-blue-800 border-blue-300'
                                  : study.modality === 'MRI'
                                  ? 'bg-purple-100 text-purple-800 border-purple-300'
                                  : study.modality === 'X-Ray'
                                  ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
                                  : study.modality === 'USG'
                                  ? 'bg-green-100 text-green-800 border-green-300'
                                  : 'bg-gray-100 text-gray-800 border-gray-300'
                              }
                            >
                              {study.modality || '-'}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[180px] truncate">
                            {study.study_description || '-'}
                          </TableCell>
                          <TableCell className="text-center">{study.series_count ?? '-'}</TableCell>
                          <TableCell className="text-center">{study.image_count ?? '-'}</TableCell>
                          <TableCell className="text-right">
                            {study.study_size_mb != null ? study.study_size_mb.toFixed(1) : '-'}
                          </TableCell>
                          <TableCell>
                            {study.quality_score != null ? (
                              <div className="flex items-center gap-2">
                                <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${getQualityColor(study.quality_score)}`}
                                    style={{ width: `${Math.min(study.quality_score, 100)}%` }}
                                  />
                                </div>
                                <span className="text-xs">{study.quality_score}%</span>
                              </div>
                            ) : (
                              '-'
                            )}
                          </TableCell>
                          <TableCell>
                            {study.archived ? (
                              <Badge className="bg-orange-100 text-orange-800">Archived</Badge>
                            ) : (
                              <Badge className="bg-green-100 text-green-800">Active</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Study Details Panel (shown when a study is selected) */}
        {selectedStudy && (
          <div className="lg:col-span-1 space-y-4">
            {/* Study Info Card */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Study Details</CardTitle>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setSelectedStudyId(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Basic study info */}
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Study UID</span>
                    <span className="font-mono text-xs max-w-[160px] truncate">
                      {selectedStudy.study_instance_uid || '-'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Date</span>
                    <span>
                      {selectedStudy.created_at
                        ? format(new Date(selectedStudy.created_at), 'dd MMM yyyy HH:mm')
                        : '-'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Modality</span>
                    <Badge variant="outline">{selectedStudy.modality || '-'}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Description</span>
                    <span className="text-right max-w-[160px]">
                      {selectedStudy.study_description || '-'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Body Part</span>
                    <span>{selectedStudy.body_part_examined || '-'}</span>
                  </div>
                </div>

                {/* Series & Image counts */}
                <div className="border-t pt-3">
                  <p className="text-sm font-medium mb-1">Series Information</p>
                  <p className="text-sm text-muted-foreground">
                    {selectedStudy.series_count ?? 0} series with{' '}
                    {selectedStudy.image_count ?? 0} total images
                  </p>
                </div>

                {/* Quality */}
                <div className="border-t pt-3">
                  <p className="text-sm font-medium mb-2">Quality Assessment</p>
                  {selectedStudy.quality_score != null ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${getQualityColor(selectedStudy.quality_score)}`}
                            style={{ width: `${Math.min(selectedStudy.quality_score, 100)}%` }}
                          />
                        </div>
                        <span className="text-sm font-medium">{selectedStudy.quality_score}%</span>
                      </div>
                      {selectedStudy.technical_adequacy && (
                        <p className="text-xs text-muted-foreground">
                          Technical adequacy: {selectedStudy.technical_adequacy}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Not assessed</p>
                  )}
                </div>

                {/* Artifacts */}
                <div className="border-t pt-3">
                  <p className="text-sm font-medium mb-1">Artifacts</p>
                  {selectedStudy.artifacts_present ? (
                    <div>
                      <Badge className="bg-red-100 text-red-800 mb-1">Artifacts Present</Badge>
                      {selectedStudy.artifact_description && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {selectedStudy.artifact_description}
                        </p>
                      )}
                    </div>
                  ) : (
                    <Badge className="bg-green-100 text-green-800">No Artifacts</Badge>
                  )}
                </div>

                {/* PACS Info */}
                <div className="border-t pt-3">
                  <p className="text-sm font-medium mb-2">PACS Information</p>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Location</span>
                      <span>{selectedStudy.pacs_location || '-'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Archive Status</span>
                      <span>
                        {selectedStudy.archived ? (
                          <Badge className="bg-orange-100 text-orange-800">Archived</Badge>
                        ) : (
                          <Badge className="bg-green-100 text-green-800">Active</Badge>
                        )}
                      </span>
                    </div>
                    {selectedStudy.archive_location && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Archive Location</span>
                        <span className="text-xs max-w-[140px] truncate">
                          {selectedStudy.archive_location}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Storage */}
                <div className="border-t pt-3">
                  <p className="text-sm font-medium mb-1">Storage</p>
                  <p className="text-sm text-muted-foreground">
                    {selectedStudy.study_size_mb != null
                      ? `${selectedStudy.study_size_mb.toFixed(1)} MB`
                      : 'Unknown'}
                  </p>
                </div>

                {/* Action buttons */}
                <div className="border-t pt-3 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" size="sm" disabled>
                      <Eye className="h-4 w-4 mr-1" />
                      View Report
                    </Button>
                    <Button variant="outline" size="sm" disabled>
                      <FileImage className="h-4 w-4 mr-1" />
                      Dose Data
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleToggleArchive}
                    >
                      <Archive className="h-4 w-4 mr-1" />
                      {selectedStudy.archived ? 'Unarchive' : 'Archive'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleShare}>
                      <Share2 className="h-4 w-4 mr-1" />
                      Share
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Image Gallery Card */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Image className="h-5 w-5 text-blue-600" />
                    Image Gallery
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setUploadDialog(true)}
                  >
                    <Upload className="h-4 w-4 mr-1" />
                    Add
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {galleryLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <RefreshCw className="h-5 w-5 animate-spin text-blue-600 mr-2" />
                    <span className="text-sm text-muted-foreground">Loading images...</span>
                  </div>
                ) : galleryImages.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileImage className="h-10 w-10 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No images uploaded for this study.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {galleryImages.map((img) => (
                      <div
                        key={img.id}
                        className="relative group border rounded-lg overflow-hidden aspect-square bg-gray-50"
                      >
                        <img
                          src={
                            (supabase as any).storage
                              .from('radiology-images')
                              .getPublicUrl(img.file_path).data?.publicUrl || ''
                          }
                          alt={img.file_name}
                          className="w-full h-full object-cover"
                        />
                        {/* Hover overlay */}
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-white hover:bg-white/20"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleViewImage(img);
                            }}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-white hover:bg-white/20"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteImage(img);
                            }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        {/* File name label */}
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-1 py-0.5">
                          <p className="text-[10px] text-white truncate">{img.file_name}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* ---- Upload Dialog ---- */}
      <Dialog
        open={uploadDialog}
        onOpenChange={(open) => {
          if (!open) {
            resetUploadState();
          }
          setUploadDialog(open);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload Image to Study</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* File input / Camera section */}
            {!uploadPreview && !cameraActive && (
              <div className="flex gap-3">
                <div className="flex-1">
                  <Label htmlFor="file-upload" className="text-sm mb-1 block">
                    Select Image (JPG, PNG)
                  </Label>
                  <Input
                    id="file-upload"
                    type="file"
                    accept="image/jpeg,image/png"
                    onChange={handleFileSelect}
                  />
                </div>
                <div className="flex items-end">
                  <Button variant="outline" onClick={startCamera}>
                    <Camera className="h-4 w-4 mr-2" />
                    Camera
                  </Button>
                </div>
              </div>
            )}

            {/* Camera preview */}
            {cameraActive && !uploadPreview && (
              <div className="space-y-3">
                <div className="relative bg-black rounded-lg overflow-hidden">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    className="w-full rounded-lg"
                  />
                </div>
                <div className="flex gap-2 justify-center">
                  <Button onClick={() => void capturePhoto()}>
                    <Camera className="h-4 w-4 mr-2" />
                    Capture
                  </Button>
                  <Button variant="outline" onClick={stopCamera}>
                    <X className="h-4 w-4 mr-2" />
                    Cancel
                  </Button>
                </div>
                {/* Hidden canvas for capture */}
                <canvas ref={canvasRef} className="hidden" />
              </div>
            )}

            {/* Image preview after capture / upload */}
            {uploadPreview && (
              <div className="space-y-3">
                <div className="border rounded-lg overflow-hidden bg-gray-50">
                  <img
                    src={uploadPreview}
                    alt="Preview"
                    className="w-full max-h-64 object-contain"
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setUploadFile(null);
                    setUploadPreview(null);
                    setUploadGeo(null);
                  }}
                >
                  <X className="h-4 w-4 mr-1" />
                  Remove
                </Button>
                {uploadFile && (
                  <GeotagStatus geo={uploadGeo} />
                )}
              </div>
            )}

            {/* Metadata fields */}
            <div className="space-y-3">
              <div>
                <Label className="text-sm mb-1 block">Body Part</Label>
                <Select value={uploadBodyPart} onValueChange={setUploadBodyPart}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select body part" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Head">Head</SelectItem>
                    <SelectItem value="Chest">Chest</SelectItem>
                    <SelectItem value="Abdomen">Abdomen</SelectItem>
                    <SelectItem value="Spine">Spine</SelectItem>
                    <SelectItem value="Pelvis">Pelvis</SelectItem>
                    <SelectItem value="Upper Extremity">Upper Extremity</SelectItem>
                    <SelectItem value="Lower Extremity">Lower Extremity</SelectItem>
                    <SelectItem value="Brain">Brain</SelectItem>
                    <SelectItem value="Neck">Neck</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm mb-1 block">Description</Label>
                <Input
                  placeholder="Brief description of the image"
                  value={uploadDescription}
                  onChange={(e) => setUploadDescription(e.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                resetUploadState();
                setUploadDialog(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUploadImage}
              disabled={!uploadFile || uploading}
            >
              {uploading ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Full Image View Dialog ---- */}
      <Dialog open={fullImageDialog} onOpenChange={setFullImageDialog}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{fullImageName}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center bg-gray-50 rounded-lg p-4">
            {fullImageUrl ? (
              <img
                src={fullImageUrl}
                alt={fullImageName}
                className="max-w-full max-h-[70vh] object-contain rounded"
              />
            ) : (
              <p className="text-muted-foreground">Image not available</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" asChild>
              <a href={fullImageUrl} target="_blank" rel="noopener noreferrer" download>
                <Download className="h-4 w-4 mr-2" />
                Download
              </a>
            </Button>
            <Button variant="outline" onClick={() => setFullImageDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Share Dialog ---- */}
      <Dialog open={shareDialog} onOpenChange={setShareDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Share Study</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Generate a shareable link for this study. The link provides time-limited
              read-only access to authorized viewers.
            </p>
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <Link className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={shareLink} readOnly className="pl-8 font-mono text-xs" />
              </div>
              <Button variant="outline" size="sm" onClick={handleCopyLink}>
                Copy
              </Button>
            </div>
            <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-lg">
              <Clock className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
              <p className="text-xs text-blue-800">
                This link will expire in 24 hours. Recipients must have valid credentials
                to view the study data. All access is logged for audit purposes.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShareDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PACSViewer;
