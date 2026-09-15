'use client';

import React, { useState } from 'react';
import { ARSensorGuidanceScreen, ARSensorGuidanceScreenProps } from './ARSensorGuidanceScreen';
import { ARTrackedGuidanceScreen } from './ARTrackedGuidanceScreen';

// The tracked screen paints the line on the real floor; if its engine cannot start on this phone or
// connection, the sensor-driven screen takes over with the same props
export const ARGuidanceScreen: React.FC<ARSensorGuidanceScreenProps> = (props) => {
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  if (fallbackReason) return <ARSensorGuidanceScreen {...props} />;
  return <ARTrackedGuidanceScreen {...props} onFallback={setFallbackReason} />;
};
