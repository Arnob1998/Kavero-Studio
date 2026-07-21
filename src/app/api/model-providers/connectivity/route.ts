import { NextResponse } from "next/server";
import {
  createLiteLlmClient,
  getConfigurationConnectivityResult,
  getFailedConnectivityResult,
  getModelGatewayConfig,
  getSuccessfulConnectivityResult,
  isModelGatewayError,
} from "@/modules/model-providers";
import { createClient } from "@/lib/supabase/server";

function canFallbackToModelList(error: unknown) {
  return (
    isModelGatewayError(error) &&
    (error.details.status === 404 || error.details.status === 405)
  );
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checkedAt = new Date().toISOString();
  const config = getModelGatewayConfig();
  const configResult = getConfigurationConnectivityResult(config, checkedAt);

  if (configResult) {
    return NextResponse.json(configResult);
  }

  if (config.status !== "configured") {
    return NextResponse.json(getFailedConnectivityResult("configuration_error", checkedAt), { status: 500 });
  }

  const client = createLiteLlmClient({ config });

  try {
    await client.getModelInfo();
    return NextResponse.json(getSuccessfulConnectivityResult("model-info", checkedAt));
  } catch (modelInfoError) {
    if (!canFallbackToModelList(modelInfoError)) {
      const errorCode = isModelGatewayError(modelInfoError)
        ? modelInfoError.details.errorCode
        : "provider_error";
      return NextResponse.json(getFailedConnectivityResult(errorCode, checkedAt), { status: 502 });
    }

    try {
      await client.listModels();
      return NextResponse.json(getSuccessfulConnectivityResult("model-list", checkedAt));
    } catch (modelListError) {
      const errorCode = isModelGatewayError(modelListError)
        ? modelListError.details.errorCode
        : "provider_error";
      return NextResponse.json(getFailedConnectivityResult(errorCode, checkedAt), { status: 502 });
    }
  }
}
