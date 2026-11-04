'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ComputerBridge, type BridgeState, type CompanionInfo } from './bridge-client';
import type { CommandRecord } from './receipt';

export type ServerDevice = {
  id: string; name: string; extension_id: string; origin: string; state: 'active' | 'revoked'; disabled: boolean;
  enabled_actions: string[]; volume_auto: boolean; catalogue: unknown[]; created_at: string; last_seen_at: string | null; revoked_at: string | null; host_version: string | null;
};
export type ServerCommand = CommandRecord & { device_id: string; source: 'text' | 'voice'; digest: string; auto_eligible: boolean; actions: unknown[]; proposal_expires_at: string; claimed_at: string | null; authorized_at: string | null };
export type ComputerServerStatus = {
  settings: { enabled: boolean; consent_version: string | null }; devices: ServerDevice[]; commands: ServerCommand[];
  extension_id: string; origin: string; consent_version: string; retention_days: number; server_now: string;
};

export function useComputer() {
  const [server, setServer] = useState<ComputerServerStatus | null>(null);
  const [bridgeState, setBridgeState] = useState<BridgeState>({ extension: 'checking' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const bridge = useRef<ComputerBridge | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const ticket = ++generation.current;
    setLoading(true);
    try {
      const response = await fetch('/api/v1/computer', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Computer status unavailable.');
      if (ticket !== generation.current) return;
      setServer(data); setError('');
      if (!bridge.current) {
        bridge.current = new ComputerBridge(data.extension_id);
        bridge.current.onEvent((frame) => {
          if (frame.name === 'status' && frame.payload?.companion) setBridgeState((s) => s.extension === 'installed' ? { extension: 'installed', host: 'connected', companion: frame.payload!.companion as CompanionInfo, extensionId: s.extensionId } : s);
          if (frame.name === 'status' && frame.payload?.hostConnected === false) setBridgeState((s) => s.extension === 'installed' ? { extension: 'installed', host: 'disconnected', reason: String(frame.payload!.reason ?? 'host_disconnected'), message: '', extensionId: s.extensionId } : s);
        });
      }
      const state = await bridge.current.status();
      if (ticket === generation.current) setBridgeState(state);
    } catch (cause) {
      if (ticket === generation.current) setError(cause instanceof Error ? cause.message : 'Computer status unavailable.');
    } finally { if (ticket === generation.current) setLoading(false); }
  }, []);
  useEffect(() => {
    // Initial load of external server/bridge state.
    void refresh();
    const gen = generation, link = bridge;
    return () => { gen.current++; link.current?.close(); link.current = null; };
  }, [refresh]);

  const companion = bridgeState.extension === 'installed' && bridgeState.host === 'connected' ? bridgeState.companion : null;
  const activeDevices = server?.devices.filter((d) => d.state === 'active') ?? [];
  // "This Mac" = the paired device the connected companion reports AND the server lists as ours.
  const thisDevice = companion?.deviceId ? activeDevices.find((d) => d.id === companion.deviceId) ?? null : null;
  const pairedElsewhere = !!companion?.paired && !!companion.deviceId && !thisDevice;
  return { server, bridgeState, companion, thisDevice, activeDevices, pairedElsewhere, error, loading, refresh, bridge };
}
