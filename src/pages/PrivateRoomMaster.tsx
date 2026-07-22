import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { BedDouble, Eye, Edit, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

// A private room is a room_management row with is_private = true. maximum_rooms
// holds the bed count; occupancy is derived live from visits.ward_allotted.
interface PrivateRoom {
  id: string;
  ward_type: string;
  location: string;
  ward_id: string;
  maximum_rooms: number;
  hospital_name?: string;
  is_private?: boolean;
  has_attached_washroom?: boolean;
  floor?: string | null;
  room_number?: string | null;
}

interface RoomFormData {
  floor: string;
  room_number: string;
  maximum_rooms: string;
  has_attached_washroom: boolean;
}

type Availability = 'Available' | 'Partially Occupied' | 'Full';

const EMPTY_FORM: RoomFormData = {
  floor: 'Second Floor',
  room_number: '',
  maximum_rooms: '1',
  has_attached_washroom: false,
};

const availabilityFor = (beds: number, occupied: number): Availability => {
  if (occupied <= 0) return 'Available';
  if (occupied >= beds) return 'Full';
  return 'Partially Occupied';
};

const availabilityColor = (status: Availability) =>
  status === 'Available'
    ? 'text-green-700 bg-green-100'
    : status === 'Full'
      ? 'text-red-700 bg-red-100'
      : 'text-amber-700 bg-amber-100';

const PrivateRoomMaster: React.FC = () => {
  const { hospitalConfig } = useAuth();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<PrivateRoom[]>([]);
  // ward_id -> number of currently-admitted (not discharged) patients in it
  const [occupancy, setOccupancy] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<PrivateRoom | null>(null);
  const [formData, setFormData] = useState<RoomFormData>(EMPTY_FORM);

  const fetchRooms = async () => {
    try {
      setLoading(true);

      let query = (supabase as any)
        .from('room_management')
        .select('*')
        .eq('is_private', true)
        .order('room_number', { ascending: true });

      if (hospitalConfig?.name) {
        query = query.eq('hospital_name', hospitalConfig.name);
      }

      const { data, error } = await query;
      if (error) throw error;

      const roomRows = (data || []) as PrivateRoom[];
      setRooms(roomRows);

      // Live occupancy: currently-admitted patients per room (ward_allotted).
      const wardIds = roomRows.map((r) => r.ward_id).filter(Boolean);
      if (wardIds.length > 0) {
        const { data: visits, error: visitError } = await (supabase as any)
          .from('visits')
          .select('ward_allotted, discharge_date')
          .in('ward_allotted', wardIds)
          .is('discharge_date', null);
        if (visitError) throw visitError;
        const counts: Record<string, number> = {};
        (visits || []).forEach((v: { ward_allotted: string | null }) => {
          if (v.ward_allotted) counts[v.ward_allotted] = (counts[v.ward_allotted] || 0) + 1;
        });
        setOccupancy(counts);
      } else {
        setOccupancy({});
      }
    } catch (error) {
      console.error('Error fetching private rooms:', error);
      toast.error('Failed to fetch private rooms');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hospitalConfig?.name]);

  const filteredRooms = rooms.filter(
    (room) =>
      room.room_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      room.ward_type?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      room.floor?.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const handleAddRoom = async () => {
    try {
      if (!formData.floor || !formData.room_number || !formData.maximum_rooms) {
        toast.error('Please fill in floor, room number and bed count');
        return;
      }
      const beds = parseInt(formData.maximum_rooms, 10);
      if (!Number.isFinite(beds) || beds < 1) {
        toast.error('Bed count must be at least 1');
        return;
      }

      const wardType = `${formData.floor} - Room No. ${formData.room_number}`;
      const wardId = `PVT${Date.now().toString(36).toUpperCase()}`;

      const { error } = await (supabase as any)
        .from('room_management')
        .insert([
          {
            ward_type: wardType,
            location: 'Hope Group',
            ward_id: wardId,
            maximum_rooms: beds,
            hospital_name: hospitalConfig?.name || null,
            is_private: true,
            has_attached_washroom: formData.has_attached_washroom,
            floor: formData.floor,
            room_number: formData.room_number,
          },
        ]);
      if (error) throw error;

      toast.success('Private room added');
      setIsAddDialogOpen(false);
      setFormData(EMPTY_FORM);
      fetchRooms();
    } catch (error: any) {
      console.error('Error adding private room:', error);
      toast.error(error?.code === '23505' ? 'Room ID already exists' : 'Failed to add room');
    }
  };

  const handleEditRoom = async () => {
    try {
      if (!selectedRoom || !formData.floor || !formData.room_number || !formData.maximum_rooms) {
        toast.error('Please fill in all required fields');
        return;
      }
      const beds = parseInt(formData.maximum_rooms, 10);
      if (!Number.isFinite(beds) || beds < 1) {
        toast.error('Bed count must be at least 1');
        return;
      }

      const { error } = await (supabase as any)
        .from('room_management')
        .update({
          ward_type: `${formData.floor} - Room No. ${formData.room_number}`,
          maximum_rooms: beds,
          is_private: true,
          has_attached_washroom: formData.has_attached_washroom,
          floor: formData.floor,
          room_number: formData.room_number,
          updated_at: new Date().toISOString(),
        })
        .eq('id', selectedRoom.id);
      if (error) throw error;

      toast.success('Private room updated');
      setIsEditDialogOpen(false);
      setSelectedRoom(null);
      setFormData(EMPTY_FORM);
      fetchRooms();
    } catch (error) {
      console.error('Error updating private room:', error);
      toast.error('Failed to update room');
    }
  };

  const handleDeleteRoom = async () => {
    try {
      if (!selectedRoom) return;
      const { error } = await (supabase as any)
        .from('room_management')
        .delete()
        .eq('id', selectedRoom.id);
      if (error) throw error;
      toast.success('Private room deleted');
      setIsDeleteDialogOpen(false);
      setSelectedRoom(null);
      fetchRooms();
    } catch (error) {
      console.error('Error deleting private room:', error);
      toast.error('Failed to delete room');
    }
  };

  const openEditDialog = (room: PrivateRoom) => {
    setSelectedRoom(room);
    setFormData({
      floor: room.floor || 'Second Floor',
      room_number: room.room_number || '',
      maximum_rooms: room.maximum_rooms.toString(),
      has_attached_washroom: !!room.has_attached_washroom,
    });
    setIsEditDialogOpen(true);
  };

  const openViewDialog = (room: PrivateRoom) => {
    setSelectedRoom(room);
    setIsViewDialogOpen(true);
  };

  const openDeleteDialog = (room: PrivateRoom) => {
    setSelectedRoom(room);
    setIsDeleteDialogOpen(true);
  };

  return (
    <div className="container mx-auto p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2 text-indigo-700">
              <BedDouble className="h-8 w-8" />
              Private Room Master
            </h1>
            <p className="text-gray-600 mt-2">Manage private rooms, beds, washroom and live availability</p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                setFormData(EMPTY_FORM);
                setIsAddDialogOpen(true);
              }}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700"
            >
              Add Private Room
            </Button>
            <Button onClick={() => navigate(-1)} className="bg-blue-600 hover:bg-blue-700">
              Back
            </Button>
          </div>
        </div>
      </div>

      {/* Search */}
      <Card className="mb-8">
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div className="flex-1">
              <Input
                placeholder="Search by room number, floor or name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <Button onClick={fetchRooms}>Refresh</Button>
          </div>
        </CardContent>
      </Card>

      {/* Rooms Table */}
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="text-center py-8">Loading...</div>
          ) : filteredRooms.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No private rooms found</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-gray-400">
                  <TableRow>
                    <TableHead className="font-bold text-black">Floor</TableHead>
                    <TableHead className="font-bold text-black">Room No.</TableHead>
                    <TableHead className="font-bold text-black">Beds</TableHead>
                    <TableHead className="font-bold text-black">Attached Washroom</TableHead>
                    <TableHead className="font-bold text-black">Availability</TableHead>
                    <TableHead className="font-bold text-black">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRooms.map((room, index) => {
                    const occupied = occupancy[room.ward_id] || 0;
                    const status = availabilityFor(room.maximum_rooms, occupied);
                    return (
                      <TableRow key={room.id} className={index % 2 === 0 ? 'bg-gray-100' : 'bg-white'}>
                        <TableCell>{room.floor || '-'}</TableCell>
                        <TableCell className="font-medium">{room.room_number || room.ward_type}</TableCell>
                        <TableCell>{room.maximum_rooms}</TableCell>
                        <TableCell>{room.has_attached_washroom ? 'Yes' : 'No'}</TableCell>
                        <TableCell>
                          <span className={`px-2 py-1 rounded text-xs font-semibold ${availabilityColor(status)}`}>
                            {status} ({occupied}/{room.maximum_rooms})
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button size="sm" variant="ghost" onClick={() => openViewDialog(room)} className="p-2 hover:bg-gray-200">
                              <Eye className="h-4 w-4 text-blue-600" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => openEditDialog(room)} className="p-2 hover:bg-gray-200">
                              <Edit className="h-4 w-4 text-blue-600" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => openDeleteDialog(room)} className="p-2 hover:bg-gray-200">
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit share the same fields */}
      {[
        { open: isAddDialogOpen, setOpen: setIsAddDialogOpen, title: 'Add Private Room', onSave: handleAddRoom, cta: 'Add Room', prefix: 'add' },
        { open: isEditDialogOpen, setOpen: setIsEditDialogOpen, title: 'Edit Private Room', onSave: handleEditRoom, cta: 'Update Room', prefix: 'edit' },
      ].map((dlg) => (
        <Dialog key={dlg.prefix} open={dlg.open} onOpenChange={dlg.setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{dlg.title}</DialogTitle>
              <DialogDescription>Enter the private room details</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor={`${dlg.prefix}_floor`}>Floor *</Label>
                <Input
                  id={`${dlg.prefix}_floor`}
                  placeholder="e.g., Second Floor"
                  value={formData.floor}
                  onChange={(e) => setFormData({ ...formData, floor: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor={`${dlg.prefix}_room_number`}>Room Number *</Label>
                <Input
                  id={`${dlg.prefix}_room_number`}
                  placeholder="e.g., 22"
                  value={formData.room_number}
                  onChange={(e) => setFormData({ ...formData, room_number: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor={`${dlg.prefix}_beds`}>Number of Beds *</Label>
                <Input
                  id={`${dlg.prefix}_beds`}
                  type="number"
                  min={1}
                  placeholder="e.g., 2"
                  value={formData.maximum_rooms}
                  onChange={(e) => setFormData({ ...formData, maximum_rooms: e.target.value })}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor={`${dlg.prefix}_washroom`}>Attached Washroom</Label>
                <Switch
                  id={`${dlg.prefix}_washroom`}
                  checked={formData.has_attached_washroom}
                  onCheckedChange={(checked) => setFormData({ ...formData, has_attached_washroom: checked })}
                />
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => dlg.setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={dlg.onSave} className="bg-indigo-600 hover:bg-indigo-700">
                  {dlg.cta}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      ))}

      {/* View Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Private Room Details</DialogTitle>
          </DialogHeader>
          {selectedRoom && (
            <div className="space-y-3">
              <div><Label>Floor</Label><p className="font-medium mt-1">{selectedRoom.floor || '-'}</p></div>
              <div><Label>Room Number</Label><p className="font-medium mt-1">{selectedRoom.room_number || selectedRoom.ward_type}</p></div>
              <div><Label>Beds</Label><p className="font-medium mt-1">{selectedRoom.maximum_rooms}</p></div>
              <div><Label>Attached Washroom</Label><p className="font-medium mt-1">{selectedRoom.has_attached_washroom ? 'Yes' : 'No'}</p></div>
              <div>
                <Label>Availability</Label>
                <p className="font-medium mt-1">
                  {availabilityFor(selectedRoom.maximum_rooms, occupancy[selectedRoom.ward_id] || 0)}{' '}
                  ({occupancy[selectedRoom.ward_id] || 0}/{selectedRoom.maximum_rooms})
                </p>
              </div>
              <div className="flex justify-end pt-4">
                <Button variant="outline" onClick={() => setIsViewDialogOpen(false)}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Private Room</DialogTitle>
            <DialogDescription>Are you sure? This action cannot be undone.</DialogDescription>
          </DialogHeader>
          {selectedRoom && (
            <div className="space-y-4">
              <div className="bg-gray-100 p-4 rounded">
                <p><strong>Room:</strong> {selectedRoom.ward_type}</p>
                <p><strong>Beds:</strong> {selectedRoom.maximum_rooms}</p>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>Cancel</Button>
                <Button onClick={handleDeleteRoom} className="bg-red-600 hover:bg-red-700">Delete Room</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PrivateRoomMaster;
