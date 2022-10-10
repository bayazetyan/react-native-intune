import * as React from 'react';

import { StyleSheet, View, Text } from 'react-native';
// import { registerAndEnroll } from 'react-native-intune';

export default function App() {
  return (
    <View style={styles.container}>
      <Text>Welcome</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  box: {
    width: 60,
    height: 60,
    marginVertical: 20,
  },
});
