import { createAdminClient } from "@/lib/supabase/admin";
import {
  deserializeProviderCredentials,
  type ProviderCredentialsMap,
  type SupportedProviderId,
} from "@/lib/provider-key-registry";

export type { ProviderCredentialsMap, SupportedProviderId } from "@/lib/provider-key-registry";

async function getUserProviderSecret(userId: string, providerId: SupportedProviderId) {
  const admin = createAdminClient();

  const { data: providerKey, error: providerKeyError } = await admin
    .from("user_provider_keys")
    .select("id, provider_id, status, vault_secret_id")
    .eq("user_id", userId)
    .eq("provider_id", providerId)
    .eq("status", "active")
    .maybeSingle();

  if (providerKeyError) {
    console.error("Unable to load provider key metadata", providerKeyError);
    throw new Error(`Unable to load ${providerId} key metadata.`);
  }

  if (!providerKey) {
    return null;
  }

  const { data, error } = await admin.rpc("get_provider_key", {
    p_user_id: userId,
    p_provider_id: providerId,
  });

  if (error) {
    console.error("Unable to decrypt provider key", {
      providerId,
      error,
    });
    throw new Error(`Unable to load ${providerId} key.`);
  }

  return typeof data === "string" && data.trim() ? data : null;
}

export async function getUserProviderCredentials<T extends SupportedProviderId>(
  userId: string,
  providerId: T,
): Promise<ProviderCredentialsMap[T] | null> {
  const secret = await getUserProviderSecret(userId, providerId);
  return secret ? deserializeProviderCredentials(providerId, secret) : null;
}

export async function getUserProviderApiKey(userId: string, providerId: "google-gemini") {
  const secret = await getUserProviderSecret(userId, providerId);
  return secret;
}
