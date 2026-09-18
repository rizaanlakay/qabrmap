'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Cemetery, Grave, MapGrave, DeviceTelemetry, AIStructuredExtraction, CaptureSaveAttempt, Survey, SurveyCapture } from '@/types';
import { dataStore } from '@/lib/data/store';
import { toMapGrave } from '@/lib/graves/mapGraves';
import { getGraveIdFromUrl, withGraveParam } from '@/lib/share/graveLink';
import type { VisitFix } from '@/lib/graves/visits';
import { compassPermission } from '@/lib/device/compass';
import { surveyStore } from '@/lib/surveys/surveyStore';
import {
  discardSurveyCapture,
  markCaptureSaved,
  queueSurveyCapture,
  rememberCaptureAttempt,
  startSurveyQueue,
  surveyQueue,
} from '@/lib/surveys/surveyQueue';
import { useLiveValue } from '@/lib/surveys/useSurveyData';
import { countCaptures } from '@/lib/surveys/queueRules';
import { blobToDataUrl } from '@/lib/surveys/capturePhoto';
import type { OpenGraveResult } from '@/components/surveys/SurveyCaptureList';

// Components
import { StatusBar } from '@/components/ui/StatusBar';
import { BottomNav, NavTab } from '@/components/ui/BottomNav';
import { Lock, ArrowLeft, Sparkles, ExternalLink } from 'lucide-react';
import { PaywallScreen } from '@/components/common/PaywallScreen';

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
import { AddPhotoConfirmScreen } from '@/components/screens/AddPhotoConfirmScreen';
import { SurveySessionScreen } from '@/components/screens/SurveySessionScreen';
import { OfflineStatusScreen } from '@/components/screens/OfflineStatusScreen';
import { MyCemeteriesScreen } from '@/components/screens/MyCemeteriesScreen';
import { RegisterScreen } from '@/components/screens/RegisterScreen';
import { ProfileScreen } from '@/components/screens/ProfileScreen';
import { AdminDashboard } from '@/components/admin/AdminDashboard';
import { UpgradeProScreen } from '@/components/screens/UpgradeProScreen';
import { useAuth } from '@/lib/auth/AuthContext';
import { AuthModal } from '@/components/auth/AuthModal';
import { useWakeLock } from '@/lib/device/useWakeLock';
import { useUserLocation } from '@/lib/device/useUserLocation';
import { useInstallOffer } from '@/lib/pwa/useInstallOffer';
import { InstallAppCard } from '@/components/common/InstallAppCard';

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
  | 'add-photo'
  | 'survey-session'
  | 'offline-status'
  | 'profile'
  | 'admin'
  | 'upgrade-pro';

// Used when the photo couldn't be read, so the user types everything in
const EMPTY_EXTRACTION: AIStructuredExtraction = {
  graveNumber: '',
  firstName: '',
  middleNames: [],
  surname: '',
  fullName: '',
  confidence: 0,
  rawOcrText: '',
  otherText: [],
  fieldConfidences: { graveNumber: 0, fullName: 0, dates: 0 },
};

function QabrMapAppContent() {
  // Global Application State
  const [currentScreen, setCurrentScreen] = useState<ScreenId>('home');
  const [previousScreen, setPreviousScreen] = useState<ScreenId>('home');
  const [currentNavTab, setCurrentNavTab] = useState<NavTab>('home');
  const [cemeteryFilter, setCemeteryFilter] = useState<'nearby' | 'my-cemeteries' | 'recent' | 'all'>('nearby');
  const [storeVersion, setStoreVersion] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  // Keep mobile screen awake when navigating to a cemetery or in AR mode
  const shouldKeepAwake = ['navigation', 'ar-guidance', 'cemetery-map'].includes(currentScreen);
  useWakeLock(shouldKeepAwake);

  // Weekly "Install Ta'awun Qabr Map" offer, only on the home screen so it never covers navigation or capture
  const installOffer = useInstallOffer({ enabled: mounted && currentScreen === 'home' });

  // Ask for the phone's position only while the Explore screen is open; it drives the Nearby chip and distances
  const exploreLocation = useUserLocation(mounted && currentScreen === 'cemetery-select');

  // Data State
  const [cemeteries, setCemeteries] = useState<Cemetery[]>([]);
  const [selectedCemetery, setSelectedCemetery] = useState<Cemetery | null>(null);
  const [graves, setGraves] = useState<Grave[]>([]);
  const [selectedGrave, setSelectedGrave] = useState<Grave | null>(null);
  // The cemetery map holds a slim row per grave, and the full grave is fetched when one is opened
  const [mapGraves, setMapGraves] = useState<MapGrave[]>([]);
  const [mapGravesLoading, setMapGravesLoading] = useState(false);
  const [selectedMapGraveId, setSelectedMapGraveId] = useState<string | null>(null);
  // Only the latest request may fill the map, so a slow cemetery can't overwrite the one opened after it
  const mapGravesRequest = useRef(0);

  // The admin export needs every grave in full, so they load only when that screen opens
  useEffect(() => {
    if (currentScreen !== 'admin' || !selectedCemetery) return;
    dataStore.getGraves(selectedCemetery.id).then(setGraves);
  }, [currentScreen, selectedCemetery]);

  // Grave that "Add a Photo" is capturing for; null when capture maps a new grave
  const [photoTargetGrave, setPhotoTargetGrave] = useState<Grave | null>(null);
  // Bumped after a photo is added so the grave details carousel reloads its photos
  const [gravePhotosVersion, setGravePhotosVersion] = useState(0);
  // The survey camera adds to surveyForCamera; reviewCapture is the survey photo open on the Confirm screen
  const [captureMode, setCaptureMode] = useState<'single' | 'survey'>('single');
  const [surveyForCamera, setSurveyForCamera] = useState<Survey | null>(null);
  const [reviewCapture, setReviewCapture] = useState<SurveyCapture | null>(null);
  const reviewAttempt = useRef<CaptureSaveAttempt | null>(null);

  // User simulated/real GPS (Cape Town Athlone Cemetery vicinity)
  const [userLocation, setUserLocation] = useState({
    lat: -33.96782,
    lng: 18.50302,
  });

  // Capture & AI Pipeline Temporary State: empty until a photo is actually taken
  const [capturedImage, setCapturedImage] = useState<string>('');
  const [capturedTelemetry, setCapturedTelemetry] = useState<DeviceTelemetry | null>(null);
  // Whole-grave photo taken after a low-accuracy capture; saved after the grave itself
  const [capturedGravePhoto, setCapturedGravePhoto] = useState<string | null>(null);
  const [extractedData, setExtractedData] = useState<AIStructuredExtraction>(EMPTY_EXTRACTION);
  // Shown once on the grave details page after a save, for example when the whole-grave photo failed
  const [detailsNotice, setDetailsNotice] = useState<string | null>(null);

  const { user, profile, openAuthModal, loading: authLoading } = useAuth();
  const userId = user?.id;
  const isPro = profile?.subscriptionType === 'Pro' || user?.user_metadata?.subscription_type === 'Pro';

  // Survey photos on this phone, for the offline screen and the survey camera's counter
  const myCaptures = useLiveValue<SurveyCapture[]>(
    () => (userId ? surveyStore.userCaptures(userId) : Promise.resolve([])),
    [userId],
    []
  );
  const pendingUploads = countCaptures(myCaptures).pending;
  const queuedCount = surveyForCamera ? myCaptures.filter((capture) => capture.surveyId === surveyForCamera.id).length : 0;

  // The survey queue runs while the app is open. Signing in lifts a pause caused by an ended session.
  useEffect(() => {
    if (mounted) startSurveyQueue();
  }, [mounted]);
  useEffect(() => {
    if (userId) void surveyQueue.signedIn();
  }, [userId]);

  // Set by the ?mode=capture home screen shortcut; acted on once auth has loaded
  const pendingCaptureLaunch = useRef(false);

  // True while a shared ?grave= link is being resolved, so the URL sync below doesn't strip it early
  const deepLinkPending = useRef(false);

  // Load initial data
  useEffect(() => {
    setMounted(true);

    // Home screen shortcuts from the installed app's manifest open straight into search or capture
    const launchMode = new URLSearchParams(window.location.search).get('mode');
    if (launchMode === 'search' || launchMode === 'capture') {
      if (launchMode === 'search') {
        setCurrentNavTab('search');
        setCurrentScreen('search');
      } else {
        pendingCaptureLaunch.current = true;
      }
      const launchUrl = new URL(window.location.href);
      launchUrl.searchParams.delete('mode');
      window.history.replaceState(
        window.history.state,
        '',
        `${launchUrl.pathname}${launchUrl.search}${launchUrl.hash}`
      );
    }

    // Open a shared grave link directly on its details view
    const linkedGraveId = getGraveIdFromUrl(window.location.href);
    if (linkedGraveId) {
      deepLinkPending.current = true;
      dataStore
        .getGraveById(linkedGraveId)
        .catch(() => undefined)
        .then((grave) => {
          deepLinkPending.current = false;
          if (grave) {
            setSelectedGrave(grave);
            setPreviousScreen('home');
            setCurrentScreen('grave-details');
          } else {
            window.history.replaceState(window.history.state, '', withGraveParam(window.location.href, null));
          }
        });
    }

    dataStore.getCemeteries().then((cems) => {
      setCemeteries(cems);
      if (cems.length > 0) {
        setSelectedCemetery(cems[0]);
      }
    });

    // Track the connection for the offline screen
    const updateOnline = () => setIsOffline(!navigator.onLine);
    updateOnline();
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  // Mapping a grave records who added it, so signed-out visitors are asked to sign in first
  const openCapture = useCallback(() => {
    if (!user) {
      openAuthModal();
      return;
    }
    // Ask for compass access inside this tap, because iOS only shows the prompt during a tap
    void compassPermission.request();
    setCurrentNavTab('capture');
    setCaptureMode('single');
    setPhotoTargetGrave(null);
    setCurrentScreen('capture');
  }, [user, openAuthModal]);

  // The survey camera stays open and queues each photo for the survey
  const openSurveyCamera = (survey: Survey) => {
    void compassPermission.request();
    setSurveyForCamera(survey);
    setCaptureMode('survey');
    setPhotoTargetGrave(null);
    setCurrentScreen('capture');
  };

  useEffect(() => {
    if (!pendingCaptureLaunch.current || authLoading) return;
    pendingCaptureLaunch.current = false;
    openCapture();
  }, [authLoading, openCapture]);

  // Keep the address bar in sync with the open grave so it can be copied or refreshed
  useEffect(() => {
    if (deepLinkPending.current) return;
    const graveId = currentScreen === 'grave-details' && selectedGrave ? selectedGrave.id : null;
    const next = withGraveParam(window.location.href, graveId);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) {
      window.history.replaceState(window.history.state, '', next);
    }
  }, [currentScreen, selectedGrave]);

  // Handle Bottom Nav clicks
  const handleSelectNavTab = (tab: NavTab) => {
    if (tab === 'capture') {
      openCapture();
      return;
    }
    setCurrentNavTab(tab);
    if (tab === 'home') setCurrentScreen('home');
    if (tab === 'search') setCurrentScreen('search');
    if (tab === 'surveys') setCurrentScreen('survey-session');
    if (tab === 'profile') setCurrentScreen('profile');
  };

  // Switch Cemetery
  // Pull to refresh on the Explore list: reload from Supabase (which also refreshes the offline copy)
  // and keep the selected cemetery pointing at its fresh row
  const refreshCemeteries = useCallback(async () => {
    const cems = await dataStore.getCemeteries();
    setCemeteries(cems);
    setSelectedCemetery((prev) => (prev ? cems.find((c) => c.id === prev.id) ?? prev : prev));
  }, []);

  const loadMapGraves = useCallback((cemeteryId: string) => {
    const request = ++mapGravesRequest.current;
    setMapGravesLoading(true);
    dataStore
      .getMapGraves(cemeteryId)
      .then((list) => {
        if (request === mapGravesRequest.current) setMapGraves(list);
      })
      .finally(() => {
        if (request === mapGravesRequest.current) setMapGravesLoading(false);
      });
  }, []);

  const handleSelectCemetery = (cemetery: Cemetery) => {
    setSelectedCemetery(cemetery);
    setSelectedGrave(null);
    setSelectedMapGraveId(null);
    setMapGraves([]);
    loadMapGraves(cemetery.id);
    setCurrentScreen('cemetery-map');
  };

  // A grave tapped on the map is only a dot with a name, so its full details are fetched before it opens
  const handleOpenMapGrave = async (graveId: string) => {
    const grave = await dataStore.getGraveById(graveId).catch(() => undefined);
    if (grave) handleOpenGrave(grave);
  };

  const replaceMapGrave = (updated: Grave) =>
    setMapGraves((list) => list.map((item) => (item.id === updated.id ? toMapGrave(updated) : item)));

  // Back from grave details to wherever it was opened from
  const leaveGraveDetails = () => {
    setDetailsNotice(null);
    if (previousScreen === 'my-cemeteries') setCurrentScreen('my-cemeteries');
    else if (previousScreen === 'cemetery-map') setCurrentScreen('cemetery-map');
    else if (previousScreen === 'home') setCurrentScreen('home');
    else if (previousScreen === 'survey-session') setCurrentScreen('survey-session');
    else setCurrentScreen('search');
  };

  // Open Grave Details
  const handleOpenGrave = (grave: Grave) => {
    setDetailsNotice(null);
    // Feeds "Recently viewed" on the search screen
    dataStore.recordGraveViewed(grave.id);
    setPreviousScreen(currentScreen);
    setSelectedGrave(grave);
    setCurrentScreen('grave-details');
  };

  // Navigation Trigger
  const handleStartNavigation = (grave: Grave) => {
    setDetailsNotice(null);
    setSelectedGrave(grave);
    setCurrentScreen('navigation');
  };

  // Capture Trigger
  const handleCaptureComplete = async (dataUrl: string, telemetry: DeviceTelemetry, gravePhotoDataUrl?: string) => {
    // Survey photos are stored and processed in the background; a failure here tells the camera to say so.
    // A survey-mode shot must never fall through to the paid ai-processing path below.
    if (captureMode === 'survey') {
      if (surveyForCamera) await queueSurveyCapture(surveyForCamera, dataUrl, telemetry, cemeteries);
      return;
    }
    setCapturedImage(dataUrl);
    setCapturedTelemetry(telemetry);
    setCapturedGravePhoto(gravePhotoDataUrl ?? null);
    // A photo for an existing grave skips the AI read and the new-grave form
    setCurrentScreen(photoTargetGrave ? 'add-photo' : 'ai-processing');
  };

  // A survey photo that needs a person opens on the Confirm screen with its own photo, reading and save ids
  const handleReviewCapture = async (capture: SurveyCapture) => {
    if (!capture.photo) return;
    setCapturedImage(await blobToDataUrl(capture.photo));
    setCapturedTelemetry(capture.telemetry);
    setCapturedGravePhoto(null);
    setExtractedData(capture.reading ?? EMPTY_EXTRACTION);
    reviewAttempt.current = capture.attempt;
    setReviewCapture(capture);
    setCurrentScreen('confirm-details');
  };

  const leaveReview = () => {
    setReviewCapture(null);
    reviewAttempt.current = null;
    setCurrentScreen('survey-session');
  };

  const openSavedGrave = async (graveId: string): Promise<OpenGraveResult> => {
    const grave = await dataStore.getGraveById(graveId).catch(() => undefined);
    if (!grave) return navigator.onLine ? 'removed' : 'offline';
    setPreviousScreen('survey-session');
    setSelectedGrave(grave);
    setCurrentScreen('grave-details');
    return 'opened';
  };

  // The photo has been read. Stable so the processing screen doesn't read it again on every render.
  const handleProcessingFinished = useCallback((extraction: AIStructuredExtraction) => {
    setExtractedData(extraction);
    setCurrentScreen('confirm-details');
  }, []);

  const handleEnterDetailsManually = () => {
    setExtractedData(EMPTY_EXTRACTION);
    setCurrentScreen('confirm-details');
  };

  // A saved grave opens on its own details page
  const handleGraveSaved = (saved: Grave, outcome: 'created' | 'added-photo', gravePhotoSaved?: boolean) => {
    setSelectedGrave(saved);
    // The photo went onto a grave that was already mapped, so its photo carousel must reload
    if (outcome === 'added-photo') setGravePhotosVersion((v) => v + 1);
    setDetailsNotice(gravePhotoSaved === false ? "The whole-grave photo couldn't be saved. You can add it from this page." : null);
    setCapturedGravePhoto(null);
    const cemetery = cemeteries.find((c) => c.id === saved.cemeteryId);
    if (cemetery) setSelectedCemetery(cemetery);
    setMapGraves((list) => (list.length > 0 && list[0].cemeteryId !== saved.cemeteryId ? [] : list));
    setSelectedMapGraveId(saved.id);
    loadMapGraves(saved.cemeteryId);
    setPreviousScreen('home');
    setCurrentNavTab('home');
    setCurrentScreen('grave-details');
  };

  // Only signed-in visitors can confirm a grave, so the screens get no handler otherwise
  const handleConfirmVisit = user
    ? async (grave: Grave, fix: VisitFix) => {
        const updated = await dataStore.recordGraveVisit(grave, fix);
        setSelectedGrave(updated);
        replaceMapGrave(updated);
        return updated;
      }
    : undefined;

  // Sync Now on the offline screen wakes the survey queue
  const handleTriggerSync = async () => {
    await surveyQueue.wake();
  };

  // Screens where bottom nav is hidden (immersive viewports)
  const isImmersiveScreen = [
    'navigation',
    'ar-guidance',
    'capture',
    'ai-processing',
    'confirm-details',
    'add-photo',
    'register',
  ].includes(currentScreen);

  const isDarkStatus = ['cemetery-map', 'navigation', 'ar-guidance', 'capture'].includes(currentScreen);

  return (
    <div className="w-full h-full flex flex-col relative overflow-hidden bg-slate-50">

      {/* Screen Routing */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        {currentScreen === 'home' && (
          <HomeScreen
            myCemeteryCount={mounted ? dataStore.getMyCemeteryCount() : 0}
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
                openCapture();
              } else if (screen === 'register') {
                setCurrentScreen('register');
              } else if (screen === 'upgrade-pro') {
                setPreviousScreen(currentScreen);
                setCurrentScreen('upgrade-pro');
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
            locationStatus={exploreLocation.status}
            userPosition={exploreLocation.position}
            locationMessage={exploreLocation.message}
            onRetryLocation={exploreLocation.retry}
            onRefresh={refreshCemeteries}
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
            graves={mapGraves}
            isLoadingGraves={mapGravesLoading}
            selectedGraveId={selectedMapGraveId}
            isGraveSaved={(id) => dataStore.isGraveSaved(id)}
            userLocation={userLocation}
            onSelectGrave={setSelectedMapGraveId}
            onOpenGraveDetails={handleOpenMapGrave}
            onBack={() => setCurrentScreen('cemetery-select')}
            onSwitchCemetery={() => {
              setCemeteryFilter('nearby');
              setCurrentScreen('cemetery-select');
            }}
          />
        )}

        {currentScreen === 'search' && (
          <SearchScreen
            onSelectGrave={handleOpenGrave}
            onBack={() => setCurrentScreen('home')}
          />
        )}

        {currentScreen === 'grave-details' && selectedGrave && (
          <GraveDetailsScreen
            grave={selectedGrave}
            onNavigateToGrave={handleStartNavigation}
            onAddPhoto={(grave) => {
              // Photos are attributed to an account, so signed-out visitors are asked to sign in first
              if (!user) {
                openAuthModal();
                return;
              }
              // Same as opening Capture: iOS only shows the compass prompt during a tap
              void compassPermission.request();
              setCaptureMode('single');
              setPhotoTargetGrave(grave);
              setCurrentScreen('capture');
            }}
            photosVersion={gravePhotosVersion}
            notice={detailsNotice}
            canDelete={Boolean(user && selectedGrave.createdBy === user.id)}
            canEdit={Boolean(user && selectedGrave.createdBy === user.id)}
            onEdited={(updated) => {
              setSelectedGrave(updated);
              replaceMapGrave(updated);
            }}
            onDeleted={() => {
              const deletedId = selectedGrave.id;
              setMapGraves((list) => list.filter((grave) => grave.id !== deletedId));
              setSelectedMapGraveId((id) => (id === deletedId ? null : id));
              leaveGraveDetails();
              setSelectedGrave(null);
            }}
            onBack={leaveGraveDetails}
            onOpenProfile={() => {
              setCurrentNavTab('profile');
              setCurrentScreen('profile');
            }}
            onUpgradePro={() => {
              setPreviousScreen('grave-details');
              setCurrentScreen('upgrade-pro');
            }}
          />
        )}

        {currentScreen === 'navigation' && selectedGrave && (
          <NavigationScreen
            targetGrave={selectedGrave}
            cemetery={
              (selectedCemetery && selectedCemetery.id === selectedGrave.cemeteryId)
                ? selectedCemetery
                : cemeteries.find((c) => c.id === selectedGrave.cemeteryId) || selectedCemetery || undefined
            }
            userLocation={userLocation}
            onUpdateUserLocation={setUserLocation}
            onOpenARGuidance={() => setCurrentScreen('ar-guidance')}
            onConfirmVisit={handleConfirmVisit}
            onEndNavigation={() => setCurrentScreen('grave-details')}
            onBack={() => setCurrentScreen('grave-details')}
          />
        )}

        {currentScreen === 'ar-guidance' && selectedGrave && (
          <ARGuidanceScreen
            targetGrave={selectedGrave}
            userLocation={userLocation}
            onUpdateUserLocation={setUserLocation}
            onConfirmVisit={handleConfirmVisit}
            onClose={() => setCurrentScreen('navigation')}
          />
        )}

        {currentScreen === 'capture' && (
          <CaptureScreen
            mode={captureMode}
            surveyCemetery={captureMode === 'survey' ? cemeteries.find((c) => c.id === surveyForCamera?.cemeteryId) : undefined}
            cemeteries={cemeteries}
            queuedCount={queuedCount}
            onCaptureComplete={handleCaptureComplete}
            onBack={() => {
              if (captureMode === 'survey') {
                setCaptureMode('single');
                setCurrentScreen('survey-session');
              } else if (photoTargetGrave) {
                setPhotoTargetGrave(null);
                setCurrentScreen('grave-details');
              } else {
                setCurrentScreen('home');
              }
            }}
          />
        )}

        {currentScreen === 'ai-processing' && capturedTelemetry && (
          <AIProcessingScreen
            capturedImage={capturedImage}
            onProcessingFinished={handleProcessingFinished}
            onEnterManually={handleEnterDetailsManually}
            onBack={() => setCurrentScreen('capture')}
          />
        )}

        {currentScreen === 'confirm-details' && capturedTelemetry && (
          <ConfirmDetailsScreen
            // A new key per capture, so a review never reuses another photo's form or save ids
            key={reviewCapture?.id ?? 'capture'}
            initialData={extractedData}
            capturedImage={capturedImage}
            telemetry={capturedTelemetry}
            cemeteries={cemeteries}
            gravePhoto={capturedGravePhoto ?? undefined}
            title={reviewCapture ? 'Review Survey Photo' : undefined}
            defaultCemeteryId={reviewCapture?.cemeteryId}
            initialAttempt={reviewCapture?.attempt}
            initialCandidate={reviewCapture?.matchCandidate}
            onAttemptChange={(attempt) => {
              if (!reviewCapture) return;
              reviewAttempt.current = attempt;
              void rememberCaptureAttempt(reviewCapture.id, attempt);
            }}
            onDiscard={
              reviewCapture
                ? () => {
                    void discardSurveyCapture(reviewCapture.id);
                    leaveReview();
                  }
                : undefined
            }
            onSaved={(grave, outcome, gravePhotoSaved) => {
              if (reviewCapture) {
                void markCaptureSaved(reviewCapture.id, grave.id, outcome, reviewAttempt.current ?? reviewCapture.attempt);
                setReviewCapture(null);
                reviewAttempt.current = null;
              }
              handleGraveSaved(grave, outcome, gravePhotoSaved);
            }}
            onRequireSignIn={openAuthModal}
            onBack={() => (reviewCapture ? leaveReview() : setCurrentScreen('capture'))}
          />
        )}

        {currentScreen === 'add-photo' && photoTargetGrave && capturedTelemetry && (
          <AddPhotoConfirmScreen
            grave={photoTargetGrave}
            capturedImage={capturedImage}
            gravePhoto={capturedGravePhoto ?? undefined}
            telemetry={capturedTelemetry}
            onSaved={() => {
              setPhotoTargetGrave(null);
              setCapturedGravePhoto(null);
              setGravePhotosVersion((v) => v + 1);
              setCurrentScreen('grave-details');
            }}
            onRetake={() => setCurrentScreen('capture')}
            onCancel={() => {
              setPhotoTargetGrave(null);
              setCurrentScreen('grave-details');
            }}
          />
        )}

        {currentScreen === 'survey-session' &&
          (!isPro ? (
            <PaywallScreen
              headerTitle="My Surveys"
              headerSubtitle="Continuous Cemetery Surveys"
              title="Survey Sessions are Disabled"
              description={
                <p>
                  Cemetery survey sessions and continuous multi-grave mapping tools are exclusive to <strong>Pro members</strong>. Everyone on the Free plan can search, map individual graves, and save loved ones.
                </p>
              }
              primaryButtonText="Return to Home"
              onPrimaryAction={() => {
                setCurrentNavTab('home');
                setCurrentScreen('home');
              }}
              onBack={() => {
                setCurrentNavTab('home');
                setCurrentScreen('home');
              }}
              onViewAccount={() => {
                setCurrentNavTab('profile');
                setCurrentScreen('profile');
              }}
              onUpgradePro={() => {
                setPreviousScreen('survey-session');
                setCurrentScreen('upgrade-pro');
              }}
            />
          ) : user ? (
            <SurveySessionScreen
              userId={user.id}
              cemeteries={cemeteries}
              onContinueSurvey={openSurveyCamera}
              onReviewCapture={(capture) => void handleReviewCapture(capture)}
              onOpenGrave={openSavedGrave}
              onBack={() => setCurrentScreen('home')}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <p className="text-sm font-semibold text-slate-800">Sign in to run surveys</p>
              <button
                onClick={openAuthModal}
                className="mt-3 py-2.5 px-5 rounded-xl bg-brand-forest hover:bg-brand-dark text-white text-xs font-semibold"
              >
                Sign in
              </button>
            </div>
          ))}

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
        {currentScreen === 'upgrade-pro' && (
          <UpgradeProScreen
            onBack={() => {
              if (previousScreen && previousScreen !== 'upgrade-pro') {
                setCurrentScreen(previousScreen);
              } else {
                setCurrentScreen('home');
              }
            }}
            onNavigate={(screen) => setCurrentScreen(screen as ScreenId)}
          />
        )}
        {installOffer.visible && installOffer.platform !== 'unsupported' && (
          <InstallAppCard
            platform={installOffer.platform}
            onInstall={installOffer.install}
            onDismiss={installOffer.dismiss}
          />
        )}
      </main>

      {/* Mobile Bottom Navigation (when not in full-screen camera/navigation) */}
      {!isImmersiveScreen && (
        <BottomNav
          currentTab={currentNavTab}
          onSelectTab={handleSelectNavTab}
          isLoggedIn={Boolean(user)}
          isPro={isPro}
          onRequireAuth={() => openAuthModal()}
          onProRequired={() => {
            setCurrentNavTab('surveys');
            setCurrentScreen('survey-session');
          }}
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


