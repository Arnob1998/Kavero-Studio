import type { BrowserImageModel } from '@/modules/model-providers/image-browser';
import { localProfiles, type LocalProfile } from '@/modules/model-providers/local/browser-profiles';
import type { ModelQuickPickerOption } from './model-quick-picker';

/** Image-role choices only. Conversation/prompt-assistant choices keep their own slot. */
export function generationImageOptions({ cloud, localEnabled, connectEnabled, references, sequence, activeResult, generating, availableLocal = [], cloudLogos = {} }: {
  cloud: readonly BrowserImageModel[]; localEnabled: boolean; connectEnabled: boolean;
  availableLocal?: readonly LocalProfile[]; cloudLogos?: Record<string,string>;
  references: number; sequence: boolean; activeResult: boolean; generating: boolean;
}): ModelQuickPickerOption[] {
  const localBlocked = generating ? 'Wait for the current generation to finish.'
    : activeResult ? 'Close the current result before changing to this model.'
    : references ? 'Text-to-image only. Remove reference images before selecting this model.'
    : sequence ? 'Single images only. Turn off sequence mode before selecting this model.' : undefined;
  return [
    ...cloud.map(model => ({ value: `cloud:${model.modelAlias}`, label: model.displayLabel, location: 'Cloud', logo: cloudLogos[model.modelAlias],
      description: `Cloud · ${model.supportsReferenceEditing ? 'Text to image · Reference editing' : 'Text to image'}`,
      disabledReason: references > model.maximumReferenceImages ? `Supports up to ${model.maximumReferenceImages} reference images. Remove references before selecting.` : undefined,
    })),
    ...(localEnabled ? localProfiles.filter(model=>availableLocal.includes(model.profile)).map(model => ({ value: `local:${model.profile}`, label: model.label, location: 'This computer', logo: '/models/qwen.svg',
      description: 'This computer · Text to image only · 512 × 512 · 1 image · Installed', disabledReason: localBlocked,
    })) : []),
  ];
}
