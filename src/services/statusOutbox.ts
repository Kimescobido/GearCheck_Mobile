import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { auth, db } from '../../firebaseConfig';

export type AlertStatus = 'Acknowledged' | 'Resolved' | 'False Alarm';

export type PendingStatusUpdate = {
  alertId: string;
  status: AlertStatus;
  officerId: string;
  queuedAt: number;
  mutationId: string;
  error?: string;
};

const STORAGE_KEY_PREFIX = '@ppe-mobile/status-outbox/v1/';
const listeners = new Set<(updates: PendingStatusUpdate[]) => void>();
const inFlight = new Map<string, string>();

let activeOfficerId: string | null = null;
let pendingUpdates: PendingStatusUpdate[] = [];
let activationId = 0;
let loadedOfficerId: string | null = null;
let activationPromise: Promise<void> | null = null;

const storageWrites = new Map<string, Promise<void>>();

function isTemporaryConnectionError(error: any) {
  const code = String(error?.code || '').toLowerCase().replace(/^firestore\//, '');
  const message = String(error?.message || '').toLowerCase();
  return ['unavailable', 'deadline-exceeded', 'network-request-failed', 'resource-exhausted'].includes(code)
    || /network|offline|timed out|timeout|connection/.test(message);
}

function storageKey(officerId: string) {
  return `${STORAGE_KEY_PREFIX}${officerId}`;
}

function publish() {
  const snapshot = pendingUpdates.map((update) => ({ ...update }));
  listeners.forEach((listener) => listener(snapshot));
}

function persist(officerId: string, updates: PendingStatusUpdate[]) {
  const previous = storageWrites.get(officerId) || Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => AsyncStorage.setItem(storageKey(officerId), JSON.stringify(updates)));
  storageWrites.set(officerId, next);
  return next;
}

async function replaceQueuedUpdate(
  officerId: string,
  mutationId: string,
  replacement?: PendingStatusUpdate,
) {
  if (activeOfficerId !== officerId) return;
  const current = pendingUpdates.find((item) => item.mutationId === mutationId);
  if (!current) return;

  const next = replacement
    ? pendingUpdates.map((item) => item.mutationId === mutationId ? replacement : item)
    : pendingUpdates.filter((item) => item.mutationId !== mutationId);

  await persist(officerId, next);
  if (activeOfficerId === officerId) {
    pendingUpdates = next;
    publish();
  }
}

async function syncOne(update: PendingStatusUpdate) {
  if (activeOfficerId !== update.officerId || auth.currentUser?.uid !== update.officerId) return;
  const flightKey = `${update.officerId}:${update.alertId}`;
  const queued = pendingUpdates.find((item) => item.alertId === update.alertId);
  if (!queued || queued.mutationId !== update.mutationId || inFlight.has(flightKey)) return;

  inFlight.set(flightKey, update.mutationId);
  try {
    await updateDoc(doc(db, 'ppe_alerts', update.alertId), {
      status: update.status,
      responding_officer_id: update.officerId,
      responded_at: serverTimestamp(),
    });
    await replaceQueuedUpdate(update.officerId, update.mutationId);
  } catch (error: any) {
    const current = pendingUpdates.find((item) => item.mutationId === update.mutationId);
    if (current && !isTemporaryConnectionError(error)) {
      await replaceQueuedUpdate(update.officerId, update.mutationId, {
        ...current,
        error: error?.message || 'Could not sync this status update.',
      });
    }
  } finally {
    if (inFlight.get(flightKey) === update.mutationId) {
      inFlight.delete(flightKey);
    }

    const latest = pendingUpdates.find((item) => item.alertId === update.alertId && item.officerId === update.officerId);
    if (latest && latest.mutationId !== update.mutationId && !latest.error) {
      void syncOne(latest);
    }
  }
}

export async function activateStatusOutbox(officerId: string | null) {
  const currentActivation = ++activationId;
  activeOfficerId = officerId;
  pendingUpdates = [];
  loadedOfficerId = null;
  publish();

  if (!officerId) {
    activationPromise = Promise.resolve();
    return activationPromise;
  }

  const loading = AsyncStorage.getItem(storageKey(officerId)).then((stored) => {
    if (currentActivation !== activationId || activeOfficerId !== officerId) return;
    const parsed = stored ? JSON.parse(stored) : [];
    pendingUpdates = Array.isArray(parsed) ? parsed : [];
    loadedOfficerId = officerId;
    publish();
    void syncPendingStatusUpdates();
  }).catch((error) => {
    console.error('Could not load saved status updates:', error);
    throw error;
  });
  activationPromise = loading;
  return loading;
}

async function ensureQueueLoaded(officerId: string) {
  if (activeOfficerId === officerId && loadedOfficerId === officerId) return;
  if (activeOfficerId === officerId && activationPromise) {
    await activationPromise;
    if (loadedOfficerId === officerId) return;
  }
  await activateStatusOutbox(officerId);
  if (loadedOfficerId !== officerId) throw new Error('Could not load saved status changes. Please try again.');
}

export async function enqueueStatusUpdate(
  alertId: string,
  status: AlertStatus,
  officerId: string,
) {
  if (!alertId || !officerId || auth.currentUser?.uid !== officerId) {
    throw new Error('Sign in again before changing an alert status.');
  }

  await ensureQueueLoaded(officerId);

  const update: PendingStatusUpdate = {
    alertId,
    status,
    officerId,
    queuedAt: Date.now(),
    mutationId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
  const next = [
    ...pendingUpdates.filter((item) => item.alertId !== alertId),
    update,
  ];

  await persist(officerId, next);
  if (activeOfficerId === officerId) {
    pendingUpdates = next;
    publish();
    void syncOne(update);
  }
  return update;
}

export async function retryStatusUpdate(alertId: string) {
  const update = pendingUpdates.find((item) => item.alertId === alertId);
  if (!update) return;
  const retried = { ...update, error: undefined };
  await replaceQueuedUpdate(update.officerId, update.mutationId, retried);
  void syncOne(retried);
}

export function syncPendingStatusUpdates() {
  if (!activeOfficerId || auth.currentUser?.uid !== activeOfficerId) return;
  pendingUpdates
    .filter((update) => !update.error)
    .forEach((update) => void syncOne(update));
}

export function subscribeStatusOutbox(listener: (updates: PendingStatusUpdate[]) => void) {
  listeners.add(listener);
  listener(pendingUpdates.map((update) => ({ ...update })));
  return () => { listeners.delete(listener); };
}

export function getStatusOutboxSnapshot() {
  return pendingUpdates.map((update) => ({ ...update }));
}

export function addStatusOutboxAppStateListener() {
  const onChange = (state: AppStateStatus) => {
    if (state === 'active') syncPendingStatusUpdates();
  };
  const subscription = AppState.addEventListener('change', onChange);
  return () => subscription.remove();
}
