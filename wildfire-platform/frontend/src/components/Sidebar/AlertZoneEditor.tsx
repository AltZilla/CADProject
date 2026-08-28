import React, { useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { useAlertZones } from '@/hooks/useAlertZones';
import Button from '../UI/Button';
import { PlusCircle, Trash2, MapPin } from 'lucide-react';

export default function AlertZoneEditor() {
  const alertZones = useAppStore(s => s.alertZones);
  const isDrawingZone = useAppStore(s => s.isDrawingZone);
  const setIsDrawingZone = useAppStore(s => s.setIsDrawingZone);
  const drawnZonePoints = useAppStore(s => s.drawnZonePoints);
  const resetDrawnZonePoints = useAppStore(s => s.resetDrawnZonePoints);
  
  const { createZone, deleteZone, isCreating, isDeleting } = useAlertZones();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (drawnZonePoints.length < 3) return;
    
    // Close the loop
    const coords = [...drawnZonePoints, drawnZonePoints[0]];
    
    await createZone({
      name,
      email,
      geometry: {
        type: 'Polygon',
        coordinates: [coords]
      }
    });
    
    setName('');
    setEmail('');
    resetDrawnZonePoints();
    setIsDrawingZone(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-slate-300 mb-4">Saved Alert Zones</h3>
        {alertZones.length === 0 ? (
          <p className="text-xs text-slate-500">No alert zones configured.</p>
        ) : (
          <div className="space-y-2">
            {alertZones.map(zone => (
              <div key={zone.zone_id} className="bg-slate-800 p-3 rounded-lg flex justify-between items-center border border-slate-700">
                <div>
                  <div className="text-sm font-medium text-slate-200">{zone.name}</div>
                  <div className="text-xs text-slate-400">{zone.email}</div>
                </div>
                <Button 
                  size="sm" 
                  variant="danger" 
                  onClick={() => deleteZone(zone.zone_id)}
                  loading={isDeleting}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="pt-4 border-t border-slate-700">
        {!isDrawingZone && drawnZonePoints.length === 0 && (
          <Button className="w-full" onClick={() => setIsDrawingZone(true)}>
            <PlusCircle size={16} className="mr-2" /> Draw Zone on Map
          </Button>
        )}

        {isDrawingZone && (
          <div className="bg-slate-800 p-4 rounded-lg border border-orange-500/50">
            <p className="text-sm text-slate-300 mb-2 flex items-center gap-2">
              <MapPin size={16} className="text-orange-500" />
              Click on map to draw polygon points.
            </p>
            <p className="text-xs text-slate-500 mb-4">Points added: {drawnZonePoints.length}</p>
            
            <div className="flex gap-2">
              {drawnZonePoints.length >= 3 && (
                <Button size="sm" onClick={() => setIsDrawingZone(false)}>Finish Shape</Button>
              )}
              <Button size="sm" variant="outline" onClick={() => { setIsDrawingZone(false); resetDrawnZonePoints(); }}>Cancel</Button>
            </div>
          </div>
        )}

        {!isDrawingZone && drawnZonePoints.length >= 3 && (
          <form onSubmit={handleSubmit} className="bg-slate-800 p-4 rounded-lg border border-slate-700 space-y-3">
            <h4 className="text-sm font-medium text-slate-200 mb-2">Save New Zone</h4>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Zone Name</label>
              <input 
                required 
                value={name} 
                onChange={e => setName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm text-slate-200 focus:border-orange-500 outline-none" 
                placeholder="e.g. North Valley" 
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Alert Email</label>
              <input 
                required 
                type="email"
                value={email} 
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm text-slate-200 focus:border-orange-500 outline-none" 
                placeholder="alerts@example.com" 
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button type="submit" className="flex-1" loading={isCreating}>Save Zone</Button>
              <Button type="button" variant="outline" onClick={resetDrawnZonePoints}>Cancel</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
