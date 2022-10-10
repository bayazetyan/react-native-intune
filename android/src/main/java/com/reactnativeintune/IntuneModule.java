package com.reactnativeintune;

import android.util.Log;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.module.annotations.ReactModule;

// Intune SDK
import com.microsoft.intune.mam.client.app.MAMComponents;
import com.microsoft.intune.mam.client.strict.MAMStrictMode;
import com.microsoft.intune.mam.policy.MAMEnrollmentManager;
import com.microsoft.intune.mam.policy.MAMServiceAuthenticationCallback;

@ReactModule(name = IntuneModule.NAME)
public class IntuneModule extends ReactContextBaseJavaModule {
    public static final String NAME = "Intune";
    private MAMServiceAuthenticationCallback serviceAuthenticationCallback;

    public IntuneModule(ReactApplicationContext reactContext) {
      super(reactContext);
      MAMStrictMode.enable();
    }

    @Override
    @NonNull
    public String getName() {
        return NAME;
    }

    @ReactMethod
    public void registerAndEnroll( final String identity, final String aadId, final String tenantId, final String token, final Promise promise) {
      try {
        MAMEnrollmentManager enrollmentManager = MAMComponents.get(MAMEnrollmentManager.class);

        if (enrollmentManager != null) {
          serviceAuthenticationCallback = new IntuneMAMServiceAuthenticationCallback();
          enrollmentManager.registerAuthenticationCallback(serviceAuthenticationCallback);
          ((IntuneMAMServiceAuthenticationCallback) serviceAuthenticationCallback).updateToken(token);
        }

        if (enrollmentManager != null) {
          enrollmentManager.registerAccountForMAM(identity, aadId, tenantId);

          promise.resolve(true);
        }
      } catch (Exception e) {
        Log.e("Intune", "exception: " + e.getMessage());
        Log.e("Intune", "exception: " + e.toString());
        Log.e("MsIntuneMamModule", "Exception: " + e.getStackTrace());
        promise.resolve(e.getMessage());
      }
    }

}
