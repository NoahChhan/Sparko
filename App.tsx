import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import HomeScreen from './src/screens/HomeScreen';
import ResultsScreen from './src/screens/ResultsScreen';
import { ParkingFacility } from './src/data/inventory';
import { OccupancyResult } from './src/data/occupancy';
import { ETABreakdown } from './src/engine/eta';
import { RiskBucket, ResultTag } from './src/engine/ranking';
import { TransitETA } from './src/engine/transit';

// Serialized result — navigation params must be JSON-serializable
export type SerializedResult = {
  facility: ParkingFacility;
  eta: ETABreakdown;
  occupancy: OccupancyResult;
  arrivalTime: string;       // ISO string
  slackMinutes: number | null;
  bucket: RiskBucket;
  score: number;
  tags: ResultTag[];
};

export type SerializedTransitResult = TransitETA & {
  arrivalTime: string; // ISO string
};

export type RootStackParamList = {
  Home: undefined;
  Results: {
    results: SerializedResult[];
    mode: 'leave_now' | 'arrive_by';
    arriveByTime: string | null;
    transitResult: SerializedTransitResult | null;
    originLabel: string;
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <StatusBar style="light" />
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#0f0f0f' },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Results" component={ResultsScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
