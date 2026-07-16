import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";
import { useTileAccess } from "@/hooks/useTileAccess";

const db = supabase as any;

function getCategoryIcon(category: string): string {
  const icons: Record<string, string> = {
    government: "🏛️",
    insurance: "🛡️",
    tpa: "📋",
    private: "🏥",
  };
  return icons[category] || "🏢";
}

interface AreaWithCorporate {
  id: string;
  area_name: string;
  district: string;
  hospitals: string | null;
  dispensaries: string | null;
  distance_km: number | null;
  google_maps_link: string | null;
  corporate_id: string;
  corporate_master: { name: string; category: string };
}

interface Contact {
  id: string;
  name: string;
  designation: string | null;
  phone: string | null;
  photo_url: string | null;
  is_primary: boolean;
  area_id: string;
}

interface Meeting {
  id: string;
  area_id: string;
  contact_id: string | null;
  meeting_date: string;
}

function StatCard({ label, value, icon, bg }: { label: string; value: number; icon: string; bg: string }) {
  return (
    <div className={`${bg} rounded-xl p-4 flex items-center gap-3`}>
      <span className="text-2xl">{icon}</span>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-sm text-gray-600">{label}</p>
      </div>
    </div>
  );
}

export default function LocationMaster() {
  const navigate = useNavigate();
  const { canSeeTile } = useTileAccess();
  const [areas, setAreas] = useState<AreaWithCorporate[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await db
        .from("corporate_areas")
        .select("*, corporate_master!inner(name, category)")
        .order("district");
      setAreas(data || []);
      setLoading(false);
    })();
  }, []);

  // Group by district
  const locationMap = useMemo(() => {
    const map: Record<string, AreaWithCorporate[]> = {};
    for (const a of areas) {
      const key = a.district || "Unknown";
      if (!map[key]) map[key] = [];
      map[key].push(a);
    }
    return map;
  }, [areas]);

  const districts = useMemo(() => {
    return Object.keys(locationMap).sort();
  }, [locationMap]);

  const filteredDistricts = useMemo(() => {
    if (!search.trim()) return districts;
    const q = search.toLowerCase();
    return districts.filter((d) => d.toLowerCase().includes(q));
  }, [districts, search]);

  // Fetch contacts & meetings when district selected
  useEffect(() => {
    if (!selectedDistrict || !locationMap[selectedDistrict]) {
      setContacts([]);
      setMeetings([]);
      return;
    }
    const areaIds = locationMap[selectedDistrict].map((a) => a.id);
    if (areaIds.length === 0) return;

    (async () => {
      const [cRes, mRes] = await Promise.all([
        db.from("corporate_area_contacts").select("*").in("area_id", areaIds),
        db.from("corporate_area_meetings").select("*").in("area_id", areaIds).order("meeting_date", { ascending: false }),
      ]);
      setContacts(cRes.data || []);
      setMeetings(mRes.data || []);
    })();
  }, [selectedDistrict, locationMap]);

  const areasInLocation = selectedDistrict ? locationMap[selectedDistrict] || [] : [];

  // Contact count per area
  const contactCountByArea = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of contacts) {
      m[c.area_id] = (m[c.area_id] || 0) + 1;
    }
    return m;
  }, [contacts]);

  // Meeting count per area
  const meetingCountByArea = useMemo(() => {
    const m: Record<string, number> = {};
    for (const mt of meetings) {
      m[mt.area_id] = (m[mt.area_id] || 0) + 1;
    }
    return m;
  }, [meetings]);

  // Last meeting per contact
  const lastMeetingByContact = useMemo(() => {
    const m: Record<string, string> = {};
    for (const mt of meetings) {
      if (mt.contact_id && !m[mt.contact_id]) {
        m[mt.contact_id] = mt.meeting_date;
      }
    }
    return m;
  }, [meetings]);

  // Area to corporate name map
  const areaCorporateMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of areasInLocation) {
      m[a.id] = a.corporate_master?.name || "Unknown";
    }
    return m;
  }, [areasInLocation]);

  // Stats
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const corporateCount = new Set(areasInLocation.map((a) => a.corporate_id)).size;
  const facilityCount = areasInLocation.reduce((n, a) => {
    let count = 0;
    if (a.hospitals) count += a.hospitals.split(",").length;
    if (a.dispensaries) count += a.dispensaries.split(",").length;
    return n + count;
  }, 0);
  const contactCount = contacts.length;
  const meetingCount = meetings.filter((m) => m.meeting_date >= monthStart).length;

  const mapsLink = areasInLocation.find((a) => a.google_maps_link)?.google_maps_link;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">📍 Location Master</h1>
      <p className="text-gray-500 text-sm mb-6">Location-first view of corporates, doctors & facilities</p>

      {/* Search */}
      <Input
        placeholder="Search locations..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 max-w-md"
      />

      {/* Location Cards */}
      <div className={`flex gap-3 mb-6 pb-2 ${isMobile ? "overflow-x-auto" : "flex-wrap"}`}>
        {filteredDistricts.map((district) => {
          const count = locationMap[district].length;
          const isSelected = selectedDistrict === district;
          return (
            <button
              key={district}
              onClick={() => setSelectedDistrict(isSelected ? null : district)}
              className={`flex-shrink-0 px-4 py-3 rounded-xl border text-left transition ${
                isSelected
                  ? "border-blue-600 ring-2 ring-blue-200 bg-blue-50"
                  : "border-gray-200 bg-white hover:shadow-md"
              }`}
            >
              <p className="font-semibold text-gray-900">{district}</p>
              <p className="text-xs text-gray-500">{count} area{count !== 1 ? "s" : ""} · {new Set(locationMap[district].map((a) => a.corporate_id)).size} corporate{new Set(locationMap[district].map((a) => a.corporate_id)).size !== 1 ? "s" : ""}</p>
            </button>
          );
        })}
        {filteredDistricts.length === 0 && (
          <p className="text-gray-400 text-sm py-4">No locations found</p>
        )}
      </div>

      {/* Selected Location Content */}
      {selectedDistrict && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {canSeeTile("l-corporates") && <StatCard label="Corporates" value={corporateCount} icon="🏢" bg="bg-blue-50" />}
            {canSeeTile("l-hospitals") && <StatCard label="Hospitals/Dispensaries" value={facilityCount} icon="🏥" bg="bg-green-50" />}
            {canSeeTile("l-contacts") && <StatCard label="Referral Contacts" value={contactCount} icon="👨‍⚕️" bg="bg-purple-50" />}
            {canSeeTile("l-meetings") && <StatCard label="Meetings This Month" value={meetingCount} icon="📋" bg="bg-orange-50" />}
          </div>

          {/* Map Link */}
          {mapsLink && (
            <a
              href={mapsLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 mb-6 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm"
            >
              📍 Open in Google Maps
            </a>
          )}

          {/* Section 1: Corporate Offices */}
          <h2 className="text-lg font-bold text-gray-900 mb-3">Corporate Offices in {selectedDistrict}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {areasInLocation.map((area) => (
              <div
                key={area.id}
                className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition"
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">{getCategoryIcon(area.corporate_master?.category)}</span>
                  <div>
                    <h3 className="font-bold text-gray-900">{area.corporate_master?.name}</h3>
                    <p className="text-sm text-gray-500">{area.area_name}</p>
                  </div>
                </div>
                {area.hospitals && <p className="text-sm text-gray-600">🏥 {area.hospitals}</p>}
                {area.dispensaries && <p className="text-sm text-gray-600">💊 {area.dispensaries}</p>}
                {area.distance_km && (
                  <p className="text-sm text-blue-600">📍 {area.distance_km} km from Nagpur</p>
                )}
                <p className="text-xs text-gray-400 mt-2">
                  {contactCountByArea[area.id] || 0} contacts · {meetingCountByArea[area.id] || 0} meetings
                </p>
                <button
                  onClick={() => navigate(`/corporate-master/${area.corporate_id}/area/${area.id}`)}
                  className="text-blue-600 text-sm mt-2 inline-block hover:underline"
                >
                  View Details →
                </button>
              </div>
            ))}
          </div>

          {/* Section 2: Referral Doctors */}
          <h2 className="text-lg font-bold text-gray-900 mb-3">Referral Doctors in {selectedDistrict}</h2>
          {contacts.length === 0 ? (
            <p className="text-gray-400 text-sm mb-8">No contacts found in this location</p>
          ) : isMobile ? (
            /* Mobile card view */
            <div className="space-y-3 mb-8">
              {contacts.map((c) => (
                <div key={c.id} className="bg-white border border-gray-200 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-1">
                    {c.photo_url ? (
                      <img src={c.photo_url} className="w-8 h-8 rounded-full object-cover" alt="" />
                    ) : (
                      <span>👤</span>
                    )}
                    <span className="font-medium text-gray-900">{c.name}</span>
                    {c.is_primary && (
                      <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">Primary</span>
                    )}
                  </div>
                  {c.designation && <p className="text-sm text-gray-600">{c.designation}</p>}
                  <p className="text-sm text-gray-500">{areaCorporateMap[c.area_id]}</p>
                  {c.phone && (
                    <a href={`tel:${c.phone}`} className="text-blue-600 text-sm">
                      {c.phone}
                    </a>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    {lastMeetingByContact[c.id]
                      ? `Last meeting: ${new Date(lastMeetingByContact[c.id]).toLocaleDateString()}`
                      : "No meetings yet"}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            /* Desktop table */
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-8">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-3 text-gray-600">Doctor/Contact</th>
                      <th className="text-left p-3 text-gray-600">Designation</th>
                      <th className="text-left p-3 text-gray-600">Organization</th>
                      <th className="text-left p-3 text-gray-600">Phone</th>
                      <th className="text-left p-3 text-gray-600">Last Meeting</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.map((c) => (
                      <tr key={c.id} className="border-t border-gray-100 hover:bg-blue-50">
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            {c.photo_url ? (
                              <img src={c.photo_url} className="w-8 h-8 rounded-full object-cover" alt="" />
                            ) : (
                              <span>👤</span>
                            )}
                            <span className="font-medium text-gray-900">{c.name}</span>
                            {c.is_primary && (
                              <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                                Primary
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3 text-gray-600">{c.designation}</td>
                        <td className="p-3 text-gray-600">{areaCorporateMap[c.area_id]}</td>
                        <td className="p-3">
                          {c.phone ? (
                            <a href={`tel:${c.phone}`} className="text-blue-600">
                              {c.phone}
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="p-3 text-gray-500">
                          {lastMeetingByContact[c.id]
                            ? new Date(lastMeetingByContact[c.id]).toLocaleDateString()
                            : "No meetings yet"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {!selectedDistrict && districts.length > 0 && (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">📍</p>
          <p>Select a location above to see corporates, doctors & facilities</p>
        </div>
      )}
    </div>
  );
}
