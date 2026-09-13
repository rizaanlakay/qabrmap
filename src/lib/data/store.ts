// Central Data Store for QabrMap with Supabase Cloud Sync + Offline-First IndexedDB Hydration

import { Cemetery, Grave, SurveySession, ProvenanceLog, Correction, GraveRelationship } from '@/types';
import { MOCK_CEMETERIES, MOCK_GRAVES, MOCK_ACTIVE_SURVEY_SESSION } from './mockData';
import { offlineDb } from '../offline/db';
import { supabase, isSupabaseConfigured } from '../supabase/client';
import { mapDbCemetery, mapDbGrave, graveToDb, personToDb } from '../supabase/mappers';

export interface MyCemeteryGraveEntry {
  grave: Grave;
  cemetery?: Cemetery;
  relationship?: GraveRelationship;
}

class DataStore {
  private isInitialized = false;
  private memoryCemeteries: Cemetery[] = [...MOCK_CEMETERIES];
  private memoryGraves: Grave[] = [...MOCK_GRAVES];
  private activeSurvey: SurveySession = { ...MOCK_ACTIVE_SURVEY_SESSION };
  private corrections: Correction[] = [];
  private savedCemeteries: Set<string> = new Set(['cem_athlone', 'cem_mowbray']);
  private savedGraveIds: Set<string> = new Set(['grave_8660', 'grave_mowbray_grandmother']);
  private relationships: Map<string, GraveRelationship> = new Map([
    [
      'grave_8660',
      {
        graveId: 'grave_8660',
        category: 'family',
        specificRelation: 'Father',
        notes: 'May Allah grant him Jannatul Firdaus',
        savedAt: '2026-09-12T10:00:00Z',
      },
    ],
    [
      'grave_mowbray_grandmother',
      {
        graveId: 'grave_mowbray_grandmother',
        category: 'family',
        specificRelation: 'Grandmother',
        notes: 'Beloved Grandmother, dearly missed',
        savedAt: '2026-09-12T10:30:00Z',
      },
    ],
  ]);

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
      const graveCount = await offlineDb.graves.count();
      if (graveCount === 0 || graveCount < this.memoryGraves.length) {
        await offlineDb.graves.bulkPut(this.memoryGraves);
      }
      const sessCount = await offlineDb.surveySessions.count();
      if (sessCount === 0) {
        await offlineDb.surveySessions.put(this.activeSurvey);
      }
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

  async getCemeteryById(id: string): Promise<Cemetery | undefined> {
    const list = await this.getCemeteries();
    return list.find((c) => c.id === id);
  }

  // --- GRAVES ---
  async getGraves(cemeteryId?: string): Promise<Grave[]> {
    let resultList: Grave[] = [];

    // 1. Try Supabase Cloud
    if (isSupabaseConfigured && supabase && typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        let query = supabase.from('graves').select('*, person:persons(*)');
        if (cemeteryId) {
          query = query.eq('cemetery_id', cemeteryId);
        }
        const { data, error } = await query;
        if (!error && data && data.length > 0) {
          resultList = data.map(mapDbGrave);
          // Sync to Dexie IndexedDB in background
          if (typeof window !== 'undefined') {
            offlineDb.graves.bulkPut(resultList).catch(() => {});
          }
        }
      } catch (err) {
        console.warn('Supabase getGraves error, falling back to local:', err);
      }
    }

    // 2. Fallback to Dexie IndexedDB
    if (resultList.length === 0 && typeof window !== 'undefined') {
      try {
        if (cemeteryId) {
          resultList = await offlineDb.graves.where('cemeteryId').equals(cemeteryId).toArray();
        } else {
          resultList = await offlineDb.graves.toArray();
        }
      } catch (e) {}
    }

    // 3. Fallback to memory
    if (resultList.length === 0) {
      if (cemeteryId) {
        resultList = this.memoryGraves.filter((g) => g.cemeteryId === cemeteryId);
      } else {
        resultList = this.memoryGraves;
      }
    }

    // Attach saved personal relationships (Family, Friend, Coworker, etc.)
    return resultList.map((g) => ({
      ...g,
      relationship: this.relationships.get(g.id),
    }));
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
          grave.relationship = this.relationships.get(grave.id);
          return grave;
        }
      } catch (err) {}
    }

    const list = await this.getGraves();
    return list.find((g) => g.id === id);
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
        return numMatch || fullNameMatch;
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

      if (filterType === 'names') {
        return fullNameMatch || firstNameMatch || surnameMatch;
      }
      if (filterType === 'numbers') {
        return numMatch;
      }
      return numMatch || fullNameMatch || firstNameMatch || surnameMatch;
    });
  }

  async saveNewGrave(grave: Grave): Promise<Grave> {
    this.memoryGraves.unshift(grave);

    // Save to local IndexedDB
    if (typeof window !== 'undefined') {
      try {
        await offlineDb.graves.put(grave);
      } catch (e) {
        console.warn('Failed to save to local IndexedDB', e);
      }
    }

    // Save to Supabase Cloud
    if (isSupabaseConfigured && supabase) {
      try {
        if (grave.person) {
          await supabase.from('persons').upsert(personToDb(grave.person), { onConflict: 'id' });
        }
        await supabase.from('graves').upsert(graveToDb(grave), { onConflict: 'id' });
      } catch (err) {
        console.warn('Failed to sync new grave to Supabase:', err);
      }
    }

    // Update active survey counts
    this.activeSurvey.capturedCount++;
    this.activeSurvey.processedCount++;
    return grave;
  }

  // --- SURVEY SESSIONS ---
  getActiveSurveySession(): SurveySession {
    return this.activeSurvey;
  }

  async updateSurveySession(session: SurveySession): Promise<void> {
    this.activeSurvey = session;
    if (typeof window !== 'undefined') {
      try {
        await offlineDb.surveySessions.put(session);
      } catch (e) {}
    }
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
