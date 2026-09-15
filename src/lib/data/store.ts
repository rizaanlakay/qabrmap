// Central Data Store for QabrMap with Supabase Cloud Sync + Offline-First IndexedDB Hydration

import {
  Cemetery,
  Grave,
  GravePhoto,
  DeviceTelemetry,
  ProvenanceLog,
  Correction,
  GraveRelationship,
} from '@/types';
import { MOCK_CEMETERIES, MOCK_GRAVES } from './mockData';
import { offlineDb } from '../offline/db';
import { supabase, isSupabaseConfigured } from '../supabase/client';
import { mapDbCemetery, mapDbGrave, mapDbGravePhoto } from '../supabase/mappers';
import { buildSavedGrave, MatchFoundResult, saveMappedGrave, SaveMappedGraveInput } from '../capture/saveMappedGrave';
import { findMatchingGraves as lookUpMatchingGraves, MatchCandidate, MatchCheckParams } from '../graves/matchCandidate';
import {
  DELETE_NOT_SET_UP_MESSAGE,
  DeleteGraveError,
  deleteMappedGrave,
  staleGraveIds,
} from '../graves/deleteMappedGrave';
import { SaveGraveError, NOT_SET_UP_MESSAGE } from '../supabase/saveGraveErrors';
import { GRAVE_PHOTOS_BUCKET, deleteGravePhoto, uploadGravePhoto } from '../supabase/storage';
import { isMissingTableError } from '../supabase/errors';
import { cemeteryCoveragePercent } from './cemeteryStats';

// Earlier builds seeded these sample graves into every device's offline cache, and saved two of them as
// "Father" and "Grandmother"; they are cleared on start-up so they never reappear
const SAMPLE_GRAVE_IDS = MOCK_GRAVES.map((grave) => grave.id);
const SAMPLE_SAVED_GRAVE_IDS = ['grave_8660', 'grave_mowbray_grandmother'];

export interface MyCemeteryGraveEntry {
  grave: Grave;
  cemetery?: Cemetery;
  relationship?: GraveRelationship;
}

export type SaveNewGraveResult = { outcome: 'created' | 'added-photo'; grave: Grave } | MatchFoundResult;

class DataStore {
  private isInitialized = false;
  private memoryCemeteries: Cemetery[] = [...MOCK_CEMETERIES];
  private corrections: Correction[] = [];
  private savedCemeteries: Set<string> = new Set();
  private savedGraveIds: Set<string> = new Set();
  private relationships: Map<string, GraveRelationship> = new Map();

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const storedCems = localStorage.getItem('qabrmap_my_cemeteries');
        if (storedCems) {
          this.savedCemeteries = new Set(JSON.parse(storedCems));
        }
        const storedGraves = localStorage.getItem('qabrmap_saved_graves');
        if (storedGraves) {
          this.savedGraveIds = new Set(JSON.parse(storedGraves));
        }
        const storedRels = localStorage.getItem('qabrmap_relationships');
        if (storedRels) {
          const arr = JSON.parse(storedRels) as GraveRelationship[];
          arr.forEach((r) => this.relationships.set(r.graveId, r));
        }

        const hadSampleSaves = SAMPLE_SAVED_GRAVE_IDS.some(
          (id) => this.savedGraveIds.has(id) || this.relationships.has(id)
        );
        if (hadSampleSaves) {
          SAMPLE_SAVED_GRAVE_IDS.forEach((id) => {
            this.savedGraveIds.delete(id);
            this.relationships.delete(id);
          });
          this.persistSavedGraves();
          this.persistRelationships();
        }
      } catch (e) {
        console.warn('LocalStorage load error', e);
      }
    }
    this.init();
  }

  private persistMyCemeteries() {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(
          'qabrmap_my_cemeteries',
          JSON.stringify(Array.from(this.savedCemeteries))
        );
      } catch (e) {}
    }
  }

  private persistSavedGraves() {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(
          'qabrmap_saved_graves',
          JSON.stringify(Array.from(this.savedGraveIds))
        );
      } catch (e) {}
    }
  }

  private persistRelationships() {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(
          'qabrmap_relationships',
          JSON.stringify(Array.from(this.relationships.values()))
        );
      } catch (e) {}
    }
  }

  // Sync user saved graves from Supabase
  async syncUserSavedGraves(userId: string) {
    if (!isSupabaseConfigured || !supabase) return;
    try {
      const { data, error } = await supabase
        .from('saved_graves')
        .select('*')
        .eq('user_id', userId);

      if (!error && data && data.length > 0) {
        for (const row of data) {
          this.savedGraveIds.add(row.grave_id);
          this.relationships.set(row.grave_id, {
            graveId: row.grave_id,
            category: row.category || 'other',
            specificRelation: row.specific_relation || 'Loved One',
            notes: row.notes || undefined,
            savedAt: row.saved_at || new Date().toISOString(),
          });
        }
        this.persistSavedGraves();
        this.persistRelationships();
      }
    } catch (e) {
      console.warn('Could not sync user saved graves from Supabase:', e);
    }
  }

  // --- MY CEMETERIES (Graves of loved ones at cemeteries) ---
  isGraveSaved(graveId: string): boolean {
    return this.savedGraveIds.has(graveId) || this.relationships.has(graveId);
  }

  toggleSavedGrave(graveId: string): boolean {
    if (this.isGraveSaved(graveId)) {
      this.savedGraveIds.delete(graveId);
      this.persistSavedGraves();

      if (isSupabaseConfigured && supabase) {
        supabase.auth.getUser().then(({ data }) => {
          if (data?.user) {
            supabase
              .from('saved_graves')
              .delete()
              .eq('user_id', data.user.id)
              .eq('grave_id', graveId)
              .then();
          }
        }).catch(() => {});
      }
      return false;
    } else {
      this.savedGraveIds.add(graveId);
      this.persistSavedGraves();

      if (isSupabaseConfigured && supabase) {
        supabase.auth.getUser().then(({ data }) => {
          if (data?.user) {
            supabase
              .from('saved_graves')
              .upsert({
                user_id: data.user.id,
                grave_id: graveId,
                category: 'other',
                saved_at: new Date().toISOString(),
              }, { onConflict: 'user_id,grave_id' })
              .then();
          }
        }).catch(() => {});
      }
      return true;
    }
  }

  async getMyCemeteriesGraves(): Promise<MyCemeteryGraveEntry[]> {
    const allGraves = await this.getGraves();
    const allCemeteries = await this.getCemeteries();
    const cemMap = new Map(allCemeteries.map((c) => [c.id, c]));

    const entries: MyCemeteryGraveEntry[] = [];
    for (const grave of allGraves) {
      if (this.isGraveSaved(grave.id)) {
        const cemetery = cemMap.get(grave.cemeteryId);
        const relationship = this.relationships.get(grave.id);
        entries.push({
          grave: {
            ...grave,
            relationship,
          },
          cemetery,
          relationship,
        });
      }
    }
    return entries;
  }

  getMyCemeteriesGraveCount(): number {
    const allSaved = new Set([
      ...Array.from(this.savedGraveIds),
      ...Array.from(this.relationships.keys()),
    ]);
    return allSaved.size;
  }

  // --- CEMETERY LEVEL FAVORITES / SAVES ---
  isMyCemetery(cemeteryId: string): boolean {
    return this.savedCemeteries.has(cemeteryId);
  }

  toggleMyCemetery(cemeteryId: string): boolean {
    if (this.savedCemeteries.has(cemeteryId)) {
      this.savedCemeteries.delete(cemeteryId);
    } else {
      this.savedCemeteries.add(cemeteryId);
    }
    this.persistMyCemeteries();
    return this.savedCemeteries.has(cemeteryId);
  }

  async getMyCemeteries(): Promise<Cemetery[]> {
    const all = await this.getCemeteries();
    return all.filter((c) => this.savedCemeteries.has(c.id));
  }

  getMyCemeteryCount(): number {
    return this.getMyCemeteriesGraveCount();
  }

  // --- GRAVE RELATIONSHIPS (Family, Friend, Coworker, etc.) ---
  getGraveRelationship(graveId: string): GraveRelationship | undefined {
    return this.relationships.get(graveId);
  }

  saveGraveRelationship(rel: GraveRelationship): void {
    this.relationships.set(rel.graveId, rel);
    this.savedGraveIds.add(rel.graveId);
    this.persistRelationships();
    this.persistSavedGraves();

    // Cloud sync if user is logged in
    if (isSupabaseConfigured && supabase) {
      supabase.auth.getUser().then(({ data }) => {
        if (data?.user) {
          supabase
            .from('saved_graves')
            .upsert({
              user_id: data.user.id,
              grave_id: rel.graveId,
              category: rel.category,
              specific_relation: rel.specificRelation,
              notes: rel.notes,
              saved_at: rel.savedAt || new Date().toISOString(),
            }, { onConflict: 'user_id,grave_id' })
            .then();
        }
      }).catch(() => {});
    }
  }

  removeGraveRelationship(graveId: string): void {
    this.relationships.delete(graveId);
    this.persistRelationships();

    if (isSupabaseConfigured && supabase) {
      supabase.auth.getUser().then(({ data }) => {
        if (data?.user) {
          supabase
            .from('saved_graves')
            .delete()
            .eq('user_id', data.user.id)
            .eq('grave_id', graveId)
            .then();
        }
      }).catch(() => {});
    }
  }

  getAllRelationships(): GraveRelationship[] {
    return Array.from(this.relationships.values());
  }

  private async init() {
    if (typeof window === 'undefined') return;

    try {
      // 1. Initialize Dexie offline tables
      await offlineDb.cemeteries.bulkPut(this.memoryCemeteries);
      await offlineDb.graves.bulkDelete(SAMPLE_GRAVE_IDS);
      this.isInitialized = true;

      // 2. Check if user is logged in to sync their saved graves
      if (isSupabaseConfigured && supabase) {
        const { data } = await supabase.auth.getUser();
        if (data?.user) {
          await this.syncUserSavedGraves(data.user.id);
        }
      }
    } catch (e) {
      console.warn('DataStore initialization notice:', e);
    }
  }

  // --- CEMETERIES ---
  async getCemeteries(): Promise<Cemetery[]> {
    return this.withLiveGraveCounts(await this.loadCemeteries());
  }

  // "Graves mapped" is counted from the graves themselves; the stored figure was seed data
  private async withLiveGraveCounts(cemeteries: Cemetery[]): Promise<Cemetery[]> {
    const counts = await Promise.all(cemeteries.map((cemetery) => this.countGraves(cemetery.id)));
    return cemeteries.map((cemetery, i) => {
      const mapped = counts[i] ?? 0;
      return {
        ...cemetery,
        mappedGravesCount: mapped,
        coveragePercentage: cemeteryCoveragePercent(mapped, cemetery.totalGravesEstimate) ?? 0,
      };
    });
  }

  private async countGraves(cemeteryId: string): Promise<number | null> {
    if (isSupabaseConfigured && supabase && typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const { count, error } = await supabase
          .from('graves')
          .select('id', { count: 'exact', head: true })
          .eq('cemetery_id', cemeteryId);
        if (!error && count !== null) return count;
      } catch (err) {
        console.warn('Could not count graves, using this device:', err);
      }
    }
    // No IndexedDB during server rendering or in Node
    if (typeof indexedDB === 'undefined') return null;
    try {
      return await offlineDb.graves.where('cemeteryId').equals(cemeteryId).count();
    } catch {
      return null;
    }
  }

  private async loadCemeteries(): Promise<Cemetery[]> {
    // 1. Try Supabase Cloud
    if (isSupabaseConfigured && supabase && typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const { data, error } = await supabase.from('cemeteries').select('*');
        if (!error && data && data.length > 0) {
          const mapped = data.map(mapDbCemetery);
          this.memoryCemeteries = mapped;
          if (typeof window !== 'undefined') {
            offlineDb.cemeteries.bulkPut(mapped).catch(() => {});
          }
          return mapped;
        }
      } catch (err) {
        console.warn('Supabase getCemeteries error, falling back to local:', err);
      }
    }

    // 2. Fallback to Dexie IndexedDB
    if (typeof window !== 'undefined') {
      try {
        const stored = await offlineDb.cemeteries.toArray();
        if (stored.length > 0) return stored;
      } catch (e) {}
    }

    // 3. Fallback to memory
    return this.memoryCemeteries;
  }

  // Graves from the database don't carry their cemetery's name, which screens show
  private cemeteryNameFor(cemeteryId: string): string | undefined {
    return this.memoryCemeteries.find((cemetery) => cemetery.id === cemeteryId)?.name;
  }

  async getCemeteryById(id: string): Promise<Cemetery | undefined> {
    const list = await this.getCemeteries();
    return list.find((c) => c.id === id);
  }

  // --- GRAVES ---
  async getGraves(cemeteryId?: string): Promise<Grave[]> {
    let resultList: Grave[] = [];
    let loadedFromCloud = false;

    // 1. Try Supabase Cloud. A successful answer is the truth, even when it has no graves.
    if (isSupabaseConfigured && supabase && typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        let query = supabase.from('graves').select('*, person:persons(*)');
        if (cemeteryId) {
          query = query.eq('cemetery_id', cemeteryId);
        }
        const { data, error } = await query;
        if (!error && data) {
          loadedFromCloud = true;
          resultList = data.map(mapDbGrave);
          if (typeof indexedDB !== 'undefined') {
            // Keep the offline copy in step with the cloud, including graves deleted on another device
            const freshIds = resultList.map((grave) => grave.id);
            const fresh = resultList;
            const cachedIds = cemeteryId
              ? offlineDb.graves.where('cemeteryId').equals(cemeteryId).primaryKeys()
              : offlineDb.graves.toCollection().primaryKeys();
            cachedIds
              .then((ids) => offlineDb.graves.bulkDelete(staleGraveIds(ids as string[], freshIds)))
              .then(() => (fresh.length > 0 ? offlineDb.graves.bulkPut(fresh) : undefined))
              .catch(() => {});
          }
        }
      } catch (err) {
        console.warn('Supabase getGraves error, falling back to local:', err);
      }
    }

    // 2. Offline or unreachable: use the graves cached on this device
    if (!loadedFromCloud && typeof indexedDB !== 'undefined') {
      try {
        if (cemeteryId) {
          resultList = await offlineDb.graves.where('cemeteryId').equals(cemeteryId).toArray();
        } else {
          resultList = await offlineDb.graves.toArray();
        }
      } catch (e) {}
    }

    // Attach saved personal relationships (Family, Friend, Coworker, etc.)
    return resultList.map((g) => ({
      ...g,
      cemeteryName: g.cemeteryName || this.cemeteryNameFor(g.cemeteryId),
      relationship: this.relationships.get(g.id),
    }));
  }

  // Deletes a grave the signed-in user mapped, with its photos, and forgets it on this device.
  // Throws DeleteGraveError, for example when other people have added to the grave.
  async deleteGrave(graveId: string): Promise<void> {
    if (!isSupabaseConfigured || !supabase) throw new DeleteGraveError('not-set-up', DELETE_NOT_SET_UP_MESSAGE);
    const client = supabase;

    await deleteMappedGrave(graveId, {
      client,
      isOnline: () => typeof navigator === 'undefined' || navigator.onLine,
      deletePhotos: async (paths) => {
        await client.storage.from(GRAVE_PHOTOS_BUCKET).remove(paths);
      },
    });

    if (typeof indexedDB !== 'undefined') await offlineDb.graves.delete(graveId).catch(() => {});
    this.savedGraveIds.delete(graveId);
    this.relationships.delete(graveId);
    this.persistSavedGraves();
    this.persistRelationships();
  }

  async getGraveById(id: string): Promise<Grave | undefined> {
    // Try Supabase directly
    if (isSupabaseConfigured && supabase && typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const { data, error } = await supabase
          .from('graves')
          .select('*, person:persons(*)')
          .eq('id', id)
          .single();

        if (!error && data) {
          const grave = mapDbGrave(data);
          grave.cemeteryName = this.cemeteryNameFor(grave.cemeteryId);
          grave.relationship = this.relationships.get(grave.id);
          return grave;
        }
      } catch (err) {}
    }

    const list = await this.getGraves();
    return list.find((g) => g.id === id);
  }

  // --- GRAVE PHOTOS ---
  // Every photo for a grave, primary first then oldest first. Empty until the grave_photos migration is applied.
  async getGravePhotos(graveId: string): Promise<GravePhoto[]> {
    if (!isSupabaseConfigured || !supabase || typeof navigator === 'undefined' || !navigator.onLine) return [];
    try {
      const { data, error } = await supabase
        .from('grave_photos')
        .select('*')
        .eq('grave_id', graveId)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true });
      if (error) {
        if (!isMissingTableError(error)) console.warn('Could not load grave photos:', error);
        return [];
      }
      return (data || []).map(mapDbGravePhoto);
    } catch (err) {
      console.warn('Could not load grave photos:', err);
      return [];
    }
  }

  // Uploads a photo and attaches it to an existing grave. Needs a signed-in user and a connection.
  async addGravePhoto(grave: Grave, imageDataUrl: string, telemetry?: DeviceTelemetry): Promise<GravePhoto> {
    if (!isSupabaseConfigured || !supabase) throw new Error('Photo uploads are not available right now.');
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error("You're offline. Connect to the internet to add this photo.");
    }

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) throw new Error('Sign in to add photos to a grave.');

    let upload: Awaited<ReturnType<typeof uploadGravePhoto>> = null;
    try {
      // A unique file name per upload, so no existing photo is ever overwritten
      upload = await uploadGravePhoto({ file: imageDataUrl, cemeteryId: grave.cemeteryId, graveId: grave.id, upsert: false });
    } catch {
      upload = null;
    }
    if (!upload?.publicUrl) throw new Error('The photo could not be uploaded. Please try again.');

    const { data, error } = await supabase
      .from('grave_photos')
      .insert({
        grave_id: grave.id,
        storage_path: upload.path || null,
        public_url: upload.publicUrl,
        uploaded_by: auth.user.id,
        captured_at: telemetry?.timestamp ?? new Date().toISOString(),
        capture_latitude: telemetry?.latitude ?? null,
        capture_longitude: telemetry?.longitude ?? null,
        gps_accuracy_meters: telemetry?.gpsAccuracy ?? null,
        heading_degrees: telemetry?.headingDegrees ?? null,
      })
      .select()
      .single();

    if (error || !data) {
      // Don't leave an orphaned file in storage when the photo row can't be saved
      if (upload.path) await deleteGravePhoto(upload.path);
      if (isMissingTableError(error)) throw new Error('Grave photos are not set up in the database yet.');
      throw new Error('The photo was uploaded but could not be saved. Please try again.');
    }
    return mapDbGravePhoto(data);
  }

  async searchGraves(query: string, filterType: 'all' | 'saved' | 'names' | 'numbers' = 'all'): Promise<Grave[]> {
    const q = query.trim().toLowerCase();
    const all = await this.getGraves();

    if (filterType === 'saved') {
      const saved = all.filter((g) => this.relationships.has(g.id));
      if (!q) return saved;
      return saved.filter((g) => {
        const numMatch = g.graveNumber.toLowerCase().includes(q);
        const fullNameMatch = g.person?.fullName.toLowerCase().includes(q) ?? false;
        const nicknameMatch = g.person?.nickname?.toLowerCase().includes(q) ?? false;
        return numMatch || fullNameMatch || nicknameMatch;
      });
    }

    if (!q) {
      return all.slice(0, 15);
    }

    return all.filter((g) => {
      const numMatch = g.graveNumber.toLowerCase().includes(q);
      const fullNameMatch = g.person?.fullName.toLowerCase().includes(q) ?? false;
      const firstNameMatch = g.person?.firstName.toLowerCase().includes(q) ?? false;
      const surnameMatch = g.person?.surname.toLowerCase().includes(q) ?? false;
      // Families often only know someone by their nickname
      const nicknameMatch = g.person?.nickname?.toLowerCase().includes(q) ?? false;

      if (filterType === 'names') {
        return fullNameMatch || firstNameMatch || surnameMatch || nicknameMatch;
      }
      if (filterType === 'numbers') {
        return numMatch;
      }
      return numMatch || fullNameMatch || firstNameMatch || surnameMatch || nicknameMatch;
    });
  }

  // Saves a grave captured on this device, or adds its photo to a grave already mapped. Needs a signed-in user
  // and a connection; throws SaveGraveError.
  async saveNewGrave(input: SaveMappedGraveInput): Promise<SaveNewGraveResult> {
    if (!isSupabaseConfigured || !supabase) throw new SaveGraveError('not-set-up', NOT_SET_UP_MESSAGE);

    const result = await saveMappedGrave(input, {
      client: supabase,
      isOnline: () => typeof navigator === 'undefined' || navigator.onLine,
      uploadPhoto: uploadGravePhoto,
      deletePhoto: deleteGravePhoto,
    });
    if (result.outcome === 'match-found') return result;

    // The grave is saved at this point, so a failed read-back on a weak connection mustn't report a failure
    const fresh = await this.getGraveById(result.graveId).catch(() => undefined);
    const saved = fresh ?? buildSavedGrave(input, result, new Date().toISOString());

    // Another person's grave can't be rebuilt from this form, so only a grave read back from the cloud is cached for it
    if (typeof window !== 'undefined' && (fresh || result.outcome === 'created')) {
      offlineDb.graves.put(saved).catch(() => {});
    }
    return { outcome: result.outcome, grave: saved };
  }

  // Graves already mapped that may be this person. Empty offline or on any failure, because the save checks again.
  async findMatchingGraves(params: MatchCheckParams): Promise<MatchCandidate[]> {
    if (!isSupabaseConfigured || !supabase) return [];
    if (typeof navigator !== 'undefined' && !navigator.onLine) return [];
    return lookUpMatchingGraves(supabase, params);
  }

  // --- PROVENANCE ---
  getProvenanceLogs(graveId: string): ProvenanceLog[] {
    return [
      {
        id: 'prov_1',
        graveId,
        contributor: 'Surveyor #14 (R. Dollie)',
        timestamp: '12 Sep 2026, 14:31',
        action: 'Field Survey Photo & Telemetry Captured',
        source: 'FIELD_SURVEY',
        confidence: 0.98,
        details: 'GPS fix ±2.8m, Compass 62° NE, monocular depth 2.1m',
      },
      {
        id: 'prov_2',
        graveId,
        contributor: 'QabrVision AI Engine v2.4',
        timestamp: '12 Sep 2026, 14:32',
        action: 'OCR & Structured Name Extraction',
        source: 'AI_OCR_V1',
        confidence: 0.97,
        details: 'Extracted Abdul Wahab Hassan Narker, B. 1947-01-28, D. 2016-09-23',
      },
      {
        id: 'prov_3',
        graveId,
        contributor: 'Community Verifier (Imam A. Patel)',
        timestamp: '12 Sep 2026, 14:35',
        action: 'Verified & Approved Entry',
        source: 'COMMUNITY_AUDIT',
        confidence: 1.0,
        details: 'Cross-referenced against Athlone Burial Register Vol 14',
      },
    ];
  }

  // --- CORRECTIONS ---
  async reportCorrection(correction: Omit<Correction, 'id' | 'createdAt' | 'status'>): Promise<void> {
    const newCorr: Correction = {
      ...correction,
      id: 'corr_' + Date.now(),
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };
    this.corrections.push(newCorr);

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from('corrections').insert({
          id: newCorr.id,
          grave_id: newCorr.graveId,
          issue_type: newCorr.issueType,
          description: newCorr.description,
          status: newCorr.status,
          created_at: newCorr.createdAt,
        });
      } catch (err) {
        console.warn('Failed to insert correction to Supabase:', err);
      }
    }
  }
}

export const dataStore = new DataStore();
