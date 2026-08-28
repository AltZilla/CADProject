import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchAlertZones, createAlertZone as createAlertZoneApi, deleteAlertZone as deleteAlertZoneApi } from '@/api/alertZones';
import { useAppStore } from '@/store/appStore';
import type { AlertZone } from '@/types/alert';

export function useAlertZones() {
  const queryClient = useQueryClient();
  const setAlertZones = useAppStore(s => s.setAlertZones);

  const { data } = useQuery({
    queryKey: ['alertZones'],
    queryFn: fetchAlertZones,
  });

  useEffect(() => {
    if (data) {
      setAlertZones(data);
    }
  }, [data, setAlertZones]);

  const { mutateAsync: createZone, isPending: isCreating } = useMutation({
    mutationFn: (newZone: Omit<AlertZone, 'zone_id' | 'active' | 'created_at'>) => createAlertZoneApi(newZone),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alertZones'] });
    },
  });

  const { mutateAsync: deleteZone, isPending: isDeleting } = useMutation({
    mutationFn: (zoneId: string) => deleteAlertZoneApi(zoneId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alertZones'] });
    },
  });

  return { createZone, deleteZone, isCreating, isDeleting };
}
