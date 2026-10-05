import { useCallback, useEffect, useRef, useState } from 'react';
import { requestJSON } from '../api.js';

export default function useObjectInteractions(socketRef, roomId, onUpdate) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);
  const inFlight = useRef(0);
  const updateRef = useRef(onUpdate);
  updateRef.current = onUpdate;
  useEffect(() => {
    mounted.current = true;
    const socket = socketRef.current;
    const update = (item) => updateRef.current([item]);
    const snapshot = ({ items }) => updateRef.current(items);
    socket?.on('object_update', update);
    socket?.on('object_snapshot', snapshot);
    return () => {
      mounted.current = false;
      socket?.off('object_update', update);
      socket?.off('object_snapshot', snapshot);
    };
  }, [socketRef]);

  const action = useCallback(
    async (item, actionName, data = {}) => {
      const socket = socketRef.current;
      if (!socket?.connected) throw new Error('Reconecta con la habitación para usar el objeto.');
      inFlight.current++;
      setPending(true);
      setError('');
      try {
        const result = await new Promise((resolve, reject) => {
          // A timeout prevents a dropped connection from leaving the controls disabled.
          socket.timeout(5000).emit(
            'object_action',
            {
              itemId: item.id,
              action: actionName,
              revision: item.revision ?? 0,
              ...data,
            },
            (error, response) => {
              if (error || !response?.ok)
                reject(
                  new Error(
                    error
                      ? 'La acción tardó demasiado. Inténtalo de nuevo.'
                      : response?.error || 'No se pudo completar.',
                  ),
                );
              else resolve(response);
            },
          );
        });
        if (mounted.current && result.item) updateRef.current([result.item]);
        return result;
      } catch (error) {
        if (mounted.current) setError(error.message);
        throw error;
      } finally {
        inFlight.current--;
        if (mounted.current) setPending(inFlight.current > 0);
      }
    },
    [socketRef],
  );

  async function configure(item, config) {
    const result = await requestJSON(
      `/api/rooms/${roomId}/objects/${encodeURIComponent(item.id)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: item.revision ?? 0, config }),
      },
    );
    if (mounted.current) updateRef.current([result]);
    return result;
  }
  return { action, configure, pending, error };
}
