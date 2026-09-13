'use client';

import React, { useState, useEffect } from 'react';
import { Cemetery, Grave, DeviceTelemetry, AIStructuredExtraction, AIProcessingState, SurveySession } from '@/types';
import { dataStore } from '@/lib/data/store';
import { syncManager } from '@/lib/offline/sync';

// Components
import { StatusBar } from '@/components/ui/StatusBar';
import { BottomNav, NavTab } from '@/components/ui/BottomNav';

// 12 Screens
import { HomeScreen } from '@/components/screens/HomeScreen';
import { CemeterySelectScreen } from '@/components/screens/CemeterySelectScreen';
import { CemeteryMapScreen } from '@/components/screens/CemeteryMapScreen';
import { SearchScreen } from '@/components/screens/SearchScreen';
import { GraveDetailsScreen } from '@/components/screens/GraveDetailsScreen';
import { NavigationScreen } from '@/components/screens/NavigationScreen';
import { ARGuidanceScreen } from '@/components/screens/ARGuidanceScreen';
import { CaptureScreen } from '@/components/screens/CaptureScreen';
import { AIProcessingScreen } from '@/components/screens/AIProcessingScreen';
import { ConfirmDetailsScreen } from '@/components/screens/ConfirmDetailsScreen';
import { SurveySessionScreen } from '@/components/screens/SurveySessionScreen';
import { OfflineStatusScreen } from '@/components/screens/OfflineStatusScreen';
import { MyCemeteriesScreen } from '@/components/screens/MyCemeteriesScreen';
import { RegisterScreen } from '@/components/screens/RegisterScreen';
import { ProfileScreen } from '@/components/screens/ProfileScreen';
import { AdminDashboard } from '@/components/admin/AdminDashboard';
import { useAuth } from '@/lib/auth/AuthContext';
import { AuthModal } from '@/components/auth/AuthModal';
import { useWakeLock } from '@/lib/device/useWakeLock';

export type ScreenId =
  | 'home'
  | 'register'
  | 'cemetery-select'
  | 'my-cemeteries'
  | 'cemetery-map'
  | 'search'
  | 'grave-details'
  | 'navigation'
  | 'ar-guidance'
  | 'capture'
  | 'ai-processing'
  | 'confirm-details'
  | 'survey-session'
  | 'offline-status'
  | 'profile'
  | 'admin';

function QabrMapAppContent() {
  // Global Application State
  const [currentScreen, setCurrentScreen] = useState<ScreenId>('home');
  const [previousScreen, setPreviousScreen] = useState<ScreenId>('home');
  const [currentNavTab, setCurrentNavTab] = useState<NavTab>('home');
  const [cemeteryFilter, setCemeteryFilter] = useState<'nearby' | 'my-cemeteries' | 'recent' | 'all'>('nearby');
  const [storeVersion, setStoreVersion] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [pendingUploads, setPendingUploads] = useState(3);

  // Keep mobile screen awake when navigating to a cemetery or in AR mode
  const shouldKeepAwake = ['navigation', 'ar-guidance', 'cemetery-map'].includes(currentScreen);
  useWakeLock(shouldKeepAwake);

  // Data State
  const [cemeteries, setCemeteries] = useState<Cemetery[]>([]);
  const [selectedCemetery, setSelectedCemetery] = useState<Cemetery | null>(null);
  const [graves, setGraves] = useState<Grave[]>([]);
  const [selectedGrave, setSelectedGrave] = useState<Grave | null>(null);
  const [surveySession, setSurveySession] = useState<SurveySession>(dataStore.getActiveSurveySession());

  // User simulated/real GPS (Cape Town Athlone Cemetery vicinity)
  const [userLocation, setUserLocation] = useState({
    lat: -33.96782,
    lng: 18.50302,
  });

  // Capture & AI Pipeline Temporary State
  const [capturedImage, setCapturedImage] = useState<string>('/sample-gravestone.svg');
  const [capturedTelemetry, setCapturedTelemetry] = useState<DeviceTelemetry>({
    latitude: -33.967521,
    longitude: 18.503277,
    gpsAccuracy: 4.2,
    headingDegrees: 62.0,
    timestamp: new Date().toISOString(),
  });
  const [extractedData, setExtractedData] = useState<AIStructuredExtraction>({
    graveNumber: '8660',
    firstName: 'Abdul',
    middleNames: ['Wahab'],
    surname: 'Hassan Narker',
    fullName: 'Abdul Wahab Hassan Narker',
    birthDate: '1947-01-28',
    deathDate: '2016-09-23',
    gender: 'male',
    confidence: 0.97,
    rawOcrText: '8660\nABDUL\nWAHAB\nHASSAN\nNARKER\nB. 28-01-1947\nD. 23-09-2016',
    otherText: [],
    fieldConfidences: { graveNumber: 0.99, fullName: 0.98, dates: 0.96 },
  });

  // Load initial data
  useEffect(() => {
    setMounted(true);
    dataStore.getCemeteries().then((cems) => {
      setCemeteries(cems);
      if (cems.length > 0) {
        setSelectedCemetery(cems[0]);
      }
    });

    dataStore.getGraves('cem_athlone').then((gList) => {
      setGraves(gList);
      const defaultGrave = gList.find((g) => g.graveNumber === '8660') || gList[0];
      if (defaultGrave) setSelectedGrave(defaultGrave);
    });

    // Subscribe to SyncManager
    const unsub = syncManager.subscribe((status) => {
      setIsOffline(!status.isOnline);
      setPendingUploads(status.pendingCount || 3);
    });

    return () => unsub();
  }, []);

  // Handle Bottom Nav clicks
  const handleSelectNavTab = (tab: NavTab) => {
    setCurrentNavTab(tab);
    if (tab === 'home') setCurrentScreen('home');
    if (tab === 'search') setCurrentScreen('search');
    if (tab === 'capture') setCurrentScreen('capture');
    if (tab === 'surveys') setCurrentScreen('survey-session');
    if (tab === 'profile') setCurrentScreen('profile');
  };

  // Switch Cemetery
  const handleSelectCemetery = (cemetery: Cemetery) => {
    setSelectedCemetery(cemetery);
    dataStore.getGraves(cemetery.id).then((gList) => {
      setGraves(gList);
      if (gList.length > 0) setSelectedGrave(gList[0]);
    });
    setCurrentScreen('cemetery-map');
  };

  // Open Grave Details
  const handleOpenGrave = (grave: Grave) => {
    setPreviousScreen(currentScreen);
    setSelectedGrave(grave);
    setCurrentScreen('grave-details');
  };

  // Navigation Trigger
  const handleStartNavigation = (grave: Grave) => {
    setSelectedGrave(grave);
    setCurrentScreen('navigation');
  };

  // Capture Trigger
  const handleCaptureComplete = (dataUrl: string, telemetry: DeviceTelemetry) => {
    setCapturedImage(dataUrl);
    setCapturedTelemetry(telemetry);
    setCurrentScreen('ai-processing');
  };

  // AI Pipeline Finished Handover
  const handleProcessingFinished = (state: AIProcessingState) => {
    if (state.data?.structured) {
      setExtractedData(state.data.structured);
    }
    setCurrentScreen('confirm-details');
  };

  // Save Grave Confirmation
  const handleSaveGrave = async (grave: Grave) => {
    const saved = await dataStore.saveNewGrave(grave);
    setSelectedGrave(saved);
    const updated = await dataStore.getGraves(selectedCemetery?.id);
    setGraves(updated);
    setSurveySession(dataStore.getActiveSurveySession());
    setCurrentScreen('survey-session');
  };

  // Trigger Sync
  const handleTriggerSync = async () => {
    await syncManager.syncPendingUploads();
    setPendingUploads(0);
  };

  // Screens where bottom nav is hidden (immersive viewports)
  const isImmersiveScreen = [
    'navigation',
    'ar-guidance',
    'capture',
    'ai-processing',
    'confirm-details',
    'register',
  ].includes(currentScreen);

  const isDarkStatus = ['cemetery-map', 'navigation', 'ar-guidance', 'capture'].includes(currentScreen);
  const { user, openAuthModal } = useAuth();

  return (
    <div className="w-full h-full flex flex-col relative overflow-hidden bg-slate-50">

      {/* Screen Routing */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        {currentScreen === 'home' && (
          <HomeScreen
            myCemeteryCount={mounted ? dataStore.getMyCemeteryCount() : 2}
            onNavigate={(screen) => {
              if (screen === 'cemetery-select') {
                setCemeteryFilter('nearby');
                setCurrentScreen('cemetery-select');
              } else if (screen === 'my-cemeteries') {
                setCurrentScreen('my-cemeteries');
              } else if (screen === 'search') {
                setCurrentNavTab('search');
                setCurrentScreen('search');
              } else if (screen === 'capture') {
                setCurrentNavTab('capture');
                setCurrentScreen('capture');
              } else if (screen === 'register') {
                setCurrentScreen('register');
              }
            }}
          />
        )}

        {currentScreen === 'register' && (
          <RegisterScreen
            cemeteries={cemeteries}
            onFinish={() => {
              setCurrentScreen('home');
              setStoreVersion((v) => v + 1);
            }}
            onGoToSignIn={() => {
              setCurrentScreen('home');
              openAuthModal();
            }}
          />
        )}

        {currentScreen === 'cemetery-select' && (
          <CemeterySelectScreen
            cemeteries={cemeteries}
            selectedCemetery={selectedCemetery}
            initialFilter={cemeteryFilter}
            isMyCemetery={(id) => dataStore.isMyCemetery(id)}
            onToggleMyCemetery={(id) => {
              dataStore.toggleMyCemetery(id);
              setStoreVersion((v) => v + 1);
            }}
            onSelectCemetery={handleSelectCemetery}
            onBack={() => setCurrentScreen('home')}
          />
        )}

        {currentScreen === 'my-cemeteries' && (
          <MyCemeteriesScreen
            onSelectGrave={handleOpenGrave}
            onNavigateToGrave={handleStartNavigation}
            onFindGrave={() => {
              setCurrentNavTab('search');
              setCurrentScreen('search');
            }}
            onBack={() => setCurrentScreen('home')}
          />
        )}

        {currentScreen === 'cemetery-map' && selectedCemetery && (
          <CemeteryMapScreen
            cemetery={selectedCemetery}
            graves={graves}
            selectedGrave={selectedGrave}
            userLocation={userLocation}
            onSelectGrave={(grave) => setSelectedGrave(grave)}
            onOpenGraveDetails={handleOpenGrave}
            onBack={() => setCurrentScreen('home')}
            onSwitchCemetery={() => {
              setCemeteryFilter('nearby');
              setCurrentScreen('cemetery-select');
            }}
          />
        )}

        {currentScreen === 'search' && (
          <SearchScreen
            initialQuery="Abdul Wahab"
            onSelectGrave={handleOpenGrave}
            onBack={() => setCurrentScreen('home')}
          />
        )}

        {currentScreen === 'grave-details' && selectedGrave && (
          <GraveDetailsScreen
            grave={selectedGrave}
            onNavigateToGrave={handleStartNavigation}
            onAddPhoto={() => setCurrentScreen('capture')}
            onBack={() => {
              if (previousScreen === 'my-cemeteries') setCurrentScreen('my-cemeteries');
              else if (previousScreen === 'cemetery-map') setCurrentScreen('cemetery-map');
              else setCurrentScreen('search');
            }}
          />
        )}

        {currentScreen === 'navigation' && selectedGrave && (
          <NavigationScreen
            targetGrave={selectedGrave}
            userLocation={userLocation}
            onUpdateUserLocation={(newLoc) => setUserLocation(newLoc)}
            onOpenARGuidance={() => setCurrentScreen('ar-guidance')}
            onEndNavigation={() => setCurrentScreen('grave-details')}
            onBack={() => setCurrentScreen('grave-details')}
          />
        )}

        {currentScreen === 'ar-guidance' && selectedGrave && (
          <ARGuidanceScreen
            targetGrave={selectedGrave}
            userLocation={userLocation}
            onClose={() => setCurrentScreen('navigation')}
          />
        )}

        {currentScreen === 'capture' && (
          <CaptureScreen
            onCaptureComplete={handleCaptureComplete}
            onBack={() => setCurrentScreen('home')}
          />
        )}

        {currentScreen === 'ai-processing' && (
          <AIProcessingScreen
            capturedImage={capturedImage}
            telemetry={capturedTelemetry}
            onProcessingFinished={handleProcessingFinished}
            onBack={() => setCurrentScreen('capture')}
          />
        )}

        {currentScreen === 'confirm-details' && (
          <ConfirmDetailsScreen
            initialData={extractedData}
            capturedImage={capturedImage}
            telemetry={capturedTelemetry}
            cemeteryId={selectedCemetery?.id}
            onSaveGrave={handleSaveGrave}
            onBack={() => setCurrentScreen('capture')}
          />
        )}

        {currentScreen === 'survey-session' && (
          <SurveySessionScreen
            session={surveySession}
            onCaptureNextGrave={() => setCurrentScreen('capture')}
            onBack={() => setCurrentScreen('home')}
          />
        )}

        {currentScreen === 'offline-status' && (
          <OfflineStatusScreen
            pendingUploadCount={pendingUploads}
            onContinue={() => setCurrentScreen('home')}
            onTriggerSync={handleTriggerSync}
            onBack={() => setCurrentScreen('home')}
          />
        )}

        {currentScreen === 'profile' && (
          <ProfileScreen
            onNavigate={(screen) => setCurrentScreen(screen as ScreenId)}
            onBack={() => setCurrentScreen('home')}
          />
        )}

        {currentScreen === 'admin' && selectedCemetery && (
          <AdminDashboard
            cemetery={selectedCemetery}
            graves={graves}
            onBack={() => setCurrentScreen('home')}
          />
        )}
      </main>

      {/* Mobile Bottom Navigation (when not in full-screen camera/navigation) */}
      {!isImmersiveScreen && (
        <BottomNav
          currentTab={currentNavTab}
          onSelectTab={handleSelectNavTab}
          isLoggedIn={Boolean(user)}
          onRequireAuth={() => openAuthModal()}
        />
      )}

      {/* Auth Modal with Guided Onboarding link */}
      <AuthModal onOpenRegistrationFlow={() => setCurrentScreen('register')} />
    </div>
  );
}

export default function QabrMapApp() {
  return (
    <div className="w-full h-full flex justify-center bg-slate-950">
      <div className="w-full max-w-md h-full bg-white relative flex flex-col shadow-2xl overflow-hidden">
        <QabrMapAppContent />
      </div>
    </div>
  );
}


