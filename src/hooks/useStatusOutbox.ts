import { useEffect, useState } from 'react';
import {
  getStatusOutboxSnapshot,
  PendingStatusUpdate,
  subscribeStatusOutbox,
} from '../services/statusOutbox';

export function useStatusOutbox() {
  const [pendingUpdates, setPendingUpdates] = useState<PendingStatusUpdate[]>(getStatusOutboxSnapshot());

  useEffect(() => subscribeStatusOutbox(setPendingUpdates), []);

  return pendingUpdates;
}
