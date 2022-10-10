package com.reactnativeintune;

import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.microsoft.intune.mam.policy.MAMServiceAuthenticationCallback;

public class IntuneMAMServiceAuthenticationCallback implements MAMServiceAuthenticationCallback {

  private String token = null;

  public void updateToken(String aadToken) {
    Log.v("Intune", aadToken);
    token = aadToken;
  }

  @Nullable
  @Override
  public String acquireToken(@NonNull String upn, @NonNull String aadId, @NonNull String resourceId) {
    final String[] scopes = {resourceId + "/.default"};

    return token;
  }
}
